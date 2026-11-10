// Run: node video-downloader-lite/tools/test-thumb-repair.cjs [path-to-typescript]
// 下载后补图：抽帧首次失败时，同一会话内重试并写回历史，界面无需重进。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const root = path.join(__dirname, '..')
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
}).outputText

function setup({ failTimes = 1, existingThumb = null } = {}) {
  const files = new Map()
  const readable = new Set()
  const logs = []
  let attempts = 0
  let fixedCallbacks = 0
  const Storage = { data: new Map(), get(k) { return this.data.get(k) }, set(k, v) { this.data.set(k, v) }, remove(k) { this.data.delete(k) } }
  const FileManager = {
    documentsDirectory: '/docs',
    async exists(p) { return files.has(p) || readable.has(p) },
    async readAsString(p) { return files.get(p) ?? '' },
    async writeAsString(p, s) { files.set(p, s) },
    async writeAsData(p, d) { files.set(p, d) },
    async createDirectory() {},
    async remove(p) { files.delete(p) },
  }
  const photosRef = { value: undefined }
  const Photos = new Proxy({}, {
    get: (_t, key) => {
      const target = photosRef.value
      if (!target) return undefined
      const v = target[key]
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
  const msg = { exports: {} }
  vm.runInNewContext(compile('utils/common.ts'), msg)
  const create = async (videoPath, duration) => {
    attempts++
    if (attempts <= failTimes) return ''
    const p = `/thumbs/${attempts}.jpg`
    files.set(p, 'jpeg')
    readable.add(p)
    return p
  }
  const albumCover = { path: '' }
  const modules = {
    scripting: { Path: { join: (...parts) => parts.join('/') } },
    './media-probe': { probeMedia: async () => ({ durationSec: 0, width: 0, height: 0 }), resolutionLabel: () => '', generateThumbFile: create, saveThumbnailImage: async () => {
    if (!albumCover.path) return ''
    files.set(albumCover.path, 'jpeg'); readable.add(albumCover.path); return albumCover.path
  } },
    './debug': { appendDebug: line => logs.push(line) },
    '../utils/common': msg.exports,
  }
  const ctx = {
    exports: {}, require: name => { assert(modules[name], name); return modules[name] },
    Storage, FileManager, Photos, UIImage: { fromFile: p => (readable.has(p) ? { width: 216, height: 138 } : null) },
    Path: modules.scripting.Path, setTimeout, Date, JSON, Math, Number, String, Array, Object, Promise, Error,
  }
  vm.runInNewContext(compile('services/history.ts'), ctx)
  return { api: ctx.exports, files, readable, logs, Storage, setPhotos: (p) => { photosRef.value = p }, setAlbumCover: (p) => { albumCover.path = p }, onFixed: () => { fixedCallbacks++ }, callbacks: () => fixedCallbacks, attempts: () => attempts }
}

;(async () => {
  // 首次抽帧失败 → 同会话内重试成功并写回历史
  const t = setup({ failTimes: 1 })
  t.files.set('/docs/a.mp4', 'video')
  const rec = await t.api.insertHistory({ sourceURL: 'https://v.example/a', kind: 'direct', title: 'A', filePath: '/docs/a.mp4', fileName: 'a.mp4', bytesWritten: 10, height: 1080 })
  assert.equal(rec.thumb_path, '')
  const fixed = await t.api.repairRecentThumbnails([rec.id], { attempts: 3, delayMs: 0, onFixed: t.onFixed })
  assert.equal(fixed, 1, 'one cover repaired')
  assert.equal(t.callbacks(), 1, 'UI refresh notified')
  assert.equal(t.attempts(), 2, 'stops retrying once repaired')
  const after = (await t.api.listHistory()).find(r => r.id === rec.id)
  assert(after.thumb_path.startsWith('/thumbs/'), 'thumb path persisted for immediate render')
  assert(after.thumb_path !== '', 'history no longer blank until restart')

  // 已有可读封面：不重复抽帧
  const skip = setup()
  skip.readable.add('/thumbs/ready.jpg')
  skip.files.set('/docs/b.mp4', 'video')
  const r2 = await skip.api.insertHistory({ sourceURL: 'https://v.example/b', kind: 'direct', title: 'B', filePath: '/docs/b.mp4', fileName: 'b.mp4', bytesWritten: 10, thumbPath: '/thumbs/ready.jpg' })
  const countBefore = skip.attempts()
  const skipFixed = await skip.api.repairRecentThumbnails([r2.id], { attempts: 3, delayMs: 0 })
  assert.equal(skipFixed, 0)
  assert.equal(skip.attempts(), countBefore, 'readable cover left alone')

  // 一直失败：不抛错、留下诊断日志，记录保持空封面等待下次启动回填
  const bad = setup({ failTimes: 99 })
  bad.files.set('/docs/c.mp4', 'video')
  const r3 = await bad.api.insertHistory({ sourceURL: 'https://v.example/c', kind: 'direct', title: 'C', filePath: '/docs/c.mp4', fileName: 'c.mp4', bytesWritten: 10 })
  const badFixed = await bad.api.repairRecentThumbnails([r3.id], { attempts: 2, delayMs: 0 })
  assert.equal(badFixed, 0)
  assert(bad.logs.some(l => l.includes('仍未补上')), 'failure leaves a diagnostic trail')

  // 本地视频已不存在：不做抽帧，等启动时的相簿/回填逻辑处理
  const gone = setup({ failTimes: 99 })
  const r4 = await gone.api.insertHistory({ sourceURL: 'https://v.example/d', kind: 'direct', title: 'D', filePath: '/docs/missing.mp4', fileName: 'd.mp4', bytesWritten: 10 })
  assert.equal(await gone.api.repairRecentThumbnails([r4.id], { attempts: 2, delayMs: 0 }), 0)
  assert.equal(gone.attempts(), 0, 'missing local file is left to startup backfill')

  // 存入相册：本地文件已移走，必须从相簿取帧补图
  const album = setup({ failTimes: 99 })
  album.setAlbumCover('/thumbs/from-album.jpg')
  const r5 = await album.api.insertHistory({
    sourceURL: 'https://v.example/e', kind: 'direct', title: 'E',
    filePath: '/docs/gone.mp4', fileName: 'e.mp4', bytesWritten: 10, durationSec: 42,
  })
  await album.api.updateHistoryNote(r5.id, '已存入相册')
  const albumAssets = [{ localIdentifier: 'asset-1', creationDate: Date.parse((await album.api.listHistory())[0].created_at), duration: 42, pixelWidth: 1080, pixelHeight: 1920,
    requestImage: async () => ({ width: 320, height: 320 }) }]
  album.setPhotos({ fetchAlbums: async () => [{ title: 'Video Downloader', fetchAssets: async () => albumAssets }] })
  const albumFixed = await album.api.repairRecentThumbnails([r5.id], { attempts: 2, delayMs: 0 })
  assert.equal(albumFixed, 1, 'photo-album record gets a cover in the same session')
  const albumAfter = (await album.api.listHistory()).find(r => r.id === r5.id)
  assert(albumAfter.thumb_path.includes('from-album'), 'album cover persisted')

  // 空输入与未知 id 立即返回
  assert.equal(await bad.api.repairRecentThumbnails([]), 0)
  assert.equal(await bad.api.repairRecentThumbnails(['missing']), 0)

  // 下载路径上必须等待补图完成后才退出分享入口
  const intent = fs.readFileSync(path.join(root, 'intent.tsx'), 'utf8')
  assert(intent.includes('repairRecentThumbnails'), 'share/intent entry repairs covers before exit')
  const app = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
  assert(app.includes('repairRecentThumbnails(inserted'), 'in-app download repairs covers')
  assert(app.includes('onFixed: () => void refreshHistory()'), 'repaired covers refresh the list')
  console.log('PASS: retry-and-persist repair, skip readable covers, failure trail, and both download entries wired')
})().catch(error => { console.error(error); process.exit(1) })
