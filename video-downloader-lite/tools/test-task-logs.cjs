// Run: node video-downloader-lite/tools/test-task-logs.cjs [path-to-typescript]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const root = path.join(__dirname, '..')
const compile = source => ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText
function store() {
  const data = new Map(); let serial = 0
  const Storage = { get: key => data.has(key) ? structuredClone(data.get(key)) : null,
    set: (key, value) => data.set(key, structuredClone(value)) }
  const ctx = { exports: {}, Storage, require: () => ({ newId: () => `task-${++serial}`, hostOf: url => new URL(url).hostname }) }
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'services/task-log.ts'), 'utf8')), ctx)
  return { api: ctx.exports, Storage, data }
}
const { api, Storage } = store()
Storage.set('vdl.debug', ['legacy diagnostic line'])
let updates = 0
const unsubscribe = api.subscribeTaskLogs(() => updates++)
const a = api.beginTaskLog('https://a.example/video', 'app')
const b = api.beginTaskLog('https://a.example/video', 'intent')
assert.notEqual(a, b)
api.appendTaskLog(a, 'step A'); api.appendTaskLog(b, 'step B')
api.titleTaskLog(a, 'Video A')
api.finishTaskLog(a, 'success', 'saved'); api.finishTaskLog(b, 'failed', 'timeout')
const tasks = api.getTaskLogs()
assert.equal(tasks.length, 2)
assert(tasks.find(t => t.id === a).lines[0].includes('step A'))
assert(!api.taskLogText(tasks.find(t => t.id === a)).join('\n').includes('step B'))
assert.equal(tasks.find(t => t.id === b).status, 'failed')
assert(tasks.every(t => t.endedAt))
for (let i = 0; i < 130; i++) api.appendTaskLog(a, 'line ' + i)
assert.equal(api.getTaskLogs().find(t => t.id === a).lines.length, api.MAX_TASK_LINES)
for (let i = 0; i < 40; i++) api.beginTaskLog(`https://v.example/${i}`, 'app')
assert.equal(api.getTaskLogs().length, api.MAX_TASKS)
unsubscribe(); const count = updates
api.clearTaskLogs(); assert.equal(updates, count); assert.equal(api.getTaskLogs().length, 0)
assert.deepEqual(Storage.get('vdl.debug'), ['legacy diagnostic line'])
// Logging failures must never fail the download itself.
const unavailable = { exports: {}, Storage: { get: () => { throw Error('read') }, set: () => { throw Error('write') } },
  require: () => ({ newId: () => 'id', hostOf: () => 'host' }) }
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'services/task-log.ts'), 'utf8')), unavailable)
assert.doesNotThrow(() => { const id = unavailable.exports.beginTaskLog('url', 'app'); unavailable.exports.appendTaskLog(id, 'step'); unavailable.exports.finishTaskLog(id, 'failed', 'message') })

const source = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
const tree = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler
const walk = n => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === 'handleDownload') handler = n; ts.forEachChild(n, walk) }
walk(tree); assert(handler)
const handlerCode = compile('const ' + handler.getText(tree)) + '\nglobalThis.runHandler = handleDownload'
async function exercise(entry, scenario) {
  const { api, Storage } = store()
  const url = 'https://video.example/item'
  let alerts = 0, linkedTaskId
  const history = { initDatabase: async () => {}, findBySourceURL: async () => scenario === 'skipped'
    ? [{ id: 'old', title: 'Old video', file_name: 'old.mp4', file_path: '/old.mp4', note: '', created_at: '2026-10-25' }] : [],
    insertHistory: async () => ({ id: 'history' }), updateHistoryNote: async () => {} }
  const runDownload = async (_url, opts) => {
    opts.onLog('resolve step'); opts.onLog('download step')
    if (scenario === 'failed') throw new Error('download broke')
    if (scenario === 'cancelled') throw new Error('已取消下载')
    return { title: 'Video title', kind: 'direct', sourceLabel: 'direct', files: [{ path: '/video.mp4', name: 'video.mp4', bytes: 100 }] }
  }
  const postDownloadAction = async () => {
    if (scenario === 'save-failed') throw new Error('save broke')
    return { savedToPhotos: false, message: 'Downloaded' }
  }
  const ctx = { ...api, ...history, Error, Storage, FileManager: { exists: async () => true },
    Dialog: { alert: async () => { alerts++ } }, Pasteboard: { setString: async () => {} },
    runDownload, postDownloadAction, appendDebug: () => {}, resolutionLabel: () => '',
    getPreferences: () => ({ dedupe: true, defaultSaveMode: 'keep' }),
  }
  if (entry === 'app') {
    Object.assign(ctx, { loading: false, prefs: ctx.getPreferences(), inputURL: url,
      extractFirstURL: s => s, formatDate: s => s,
      setLastTaskId: id => { linkedTaskId = id },
      setLoading: () => {}, setCelebrate: () => {}, setLastFiles: () => {}, setProgress: () => {}, setStatus: () => {},
      refreshHistory: async () => {}, setTimeout: fn => fn() })
    vm.runInNewContext(handlerCode, ctx)
    await ctx.runHandler(url)
  } else {
    const modules = {
      scripting: { Script: { exit: () => {} }, Widget: { reloadAll: () => {} },
        Intent: { urlsParameter: [url], json: x => x, file: x => x, text: x => x } },
      './services/downloader': { runDownload, detectKind: () => 'direct', KIND_LABELS: { direct: 'direct' } },
      './services/preferences': { getPreferences: ctx.getPreferences }, './services/history': history,
      './services/debug': { appendDebug: ctx.appendDebug }, './services/file-actions': { postDownloadAction },
      './services/media-probe': { resolutionLabel: ctx.resolutionLabel }, './utils/common': { extractFirstURL: s => s },
      './services/task-log': api,
    }
    ctx.exports = {}; ctx.require = name => { assert(modules[name], name); return modules[name] }
    let intent = fs.readFileSync(path.join(root, 'intent.tsx'), 'utf8')
    intent = intent.replace(/\nrun\(\)\s*$/, '\nglobalThis.runIntent = run\n')
    vm.runInNewContext(compile(intent), ctx)
    await ctx.runIntent()
  }
  const records = api.getTaskLogs()
  assert.equal(records.length, 1, `${entry}/${scenario}: one attempt, one task`)
  const expected = scenario === 'save-failed' ? 'failed' : scenario
  assert.equal(records[0].status, expected === 'success' ? 'success' : expected, `${entry}/${scenario}`)
  assert(records[0].endedAt)
  assert.equal(records[0].entry, entry)
  if (entry === 'app') assert.equal(linkedTaskId, records[0].id)
  if (scenario === 'success') assert.equal(records[0].title, 'Video title')
  if (scenario === 'cancelled' && entry === 'app') assert.equal(alerts, 0)
}
;(async () => {
  for (const entry of ['app', 'intent']) for (const scenario of ['success', 'failed', 'save-failed', 'skipped', 'cancelled']) await exercise(entry, scenario)
  console.log('PASS: task isolation, retention, legacy preservation, subscriptions, storage failures and app/intent terminal paths')
})().catch(error => { console.error(error); process.exit(1) })
