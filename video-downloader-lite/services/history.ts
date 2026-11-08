// services/history.ts — Lite 版下载历史：JSON 文件存储（不依赖 Pro 专属的 SQLite）
// 导出接口与 Pro 版完全一致，上层 index.tsx / intent.tsx 无需改动。
// FileManager 为全局对象，禁止从 scripting 导入。

import { Path } from "scripting"
import { newId, hostOf } from "../utils/common"
import { probeMedia, resolutionLabel, generateThumbFile, saveThumbnailImage } from "./media-probe"
import { appendDebug } from "./debug"

export type HistoryRecord = {
  id: string
  source_url: string
  kind: string
  title: string
  file_path: string
  file_name: string
  bytes_written: number
  duration_sec?: number
  resolution?: string // 如 "1080p"（短边），无则为空
  format?: string // 如 "MP4"
  thumb_path?: string // 缩略图文件路径（下载时生成）
  created_at: string
  note: string
}

export type NewHistoryItem = {
  sourceURL: string
  kind: string
  title: string
  filePath: string
  fileName: string
  bytesWritten: number
  durationSec?: number
  resolution?: string
  format?: string
  thumbPath?: string
  note?: string
}

const ROOT_DIR = Path.join(FileManager.documentsDirectory, "Video", "Downloader")
const DB_PATH = Path.join(ROOT_DIR, "history.json")

// 上限从设置读（默认 200）；超出部分连记录带本地文件一起删
function maxRecords(): number {
  try {
    const v = Storage.get<number>("vdl.preferences")
    const n = (v as any)?.maxHistoryRecords
    return typeof n === "number" && n > 0 ? Math.floor(n) : 200
  } catch {
    return 200
  }
}

async function trimToLimit(list: HistoryRecord[]): Promise<HistoryRecord[]> {
  const cap = maxRecords()
  if (list.length <= cap) return list
  const overflow = list.slice(cap)
  for (const r of overflow) {
    if (await FileManager.exists(r.file_path)) {
      try {
        await FileManager.remove(r.file_path)
      } catch {}
    }
  }
  return list.slice(0, cap)
}

// -------------------------------------------------------------
// 小组件快照：widget 扩展进程的 FileManager 目录与 App 不一致，
// 读不到历史文件；Storage（UserDefaults 同脚本跨进程共享，cmhk 实证）
// 才是可靠的通道。每次历史变更后把最近两条 + 统计写进 Storage。
// -------------------------------------------------------------
export const WIDGET_SNAPSHOT_KEY = "vdl.widget.latest"

export type WidgetSnapshotItem = {
  kind: string
  host: string
  resolution: string
  format: string
  title: string
  fileName: string
  bytes: number
  durationSec: number
  createdAt: string
  note: string
}

export type WidgetSnapshot = {
  latest: WidgetSnapshotItem | null
  second: WidgetSnapshotItem | null
  totalCount: number
  totalBytes: number
}

function toSnapshotItem(r: HistoryRecord): WidgetSnapshotItem {
  return {
    kind: r.kind,
    host: hostOf(r.source_url),
    resolution: r.resolution ?? "",
    format: r.format ?? "",
    title: r.title,
    fileName: r.file_name,
    bytes: r.bytes_written,
    durationSec: r.duration_sec ?? 0,
    createdAt: r.created_at,
    note: r.note,
  }
}

export function writeWidgetSnapshot(list: HistoryRecord[]) {
  try {
    const sorted = sortDesc(list)
    // 次数按来源链接去重（同一视频的多编码/重下只算一次）；
    // 总大小按来源求和（同来源多文件取合计流量）
    const bySource = new Map<string, number>()
    for (const r of sorted) bySource.set(r.source_url, (bySource.get(r.source_url) ?? 0) + (r.bytes_written || 0))
    Storage.set(WIDGET_SNAPSHOT_KEY, {
      latest: sorted[0] ? toSnapshotItem(sorted[0]) : null,
      second: sorted[1] ? toSnapshotItem(sorted[1]) : null,
      totalCount: bySource.size,
      totalBytes: [...bySource.values()].reduce((a, b) => a + b, 0),
    } satisfies WidgetSnapshot)
  } catch {}
}

// 兼容 v1.5.x 的旧扁平快照（{title,...}）→ 视作只有 latest
export function getWidgetSnapshot(): WidgetSnapshot | null {
  try {
    const raw = Storage.get<any>(WIDGET_SNAPSHOT_KEY)
    if (!raw) return null
    if ("totalCount" in raw) return raw as WidgetSnapshot
    return {
      latest: raw.title ? (raw as WidgetSnapshotItem) : null,
      second: null,
      totalCount: raw.title ? 1 : 0,
      totalBytes: raw.bytes ?? 0,
    }
  } catch {
    return null
  }
}

async function ensureRootDir() {
  if (!(await FileManager.exists(ROOT_DIR))) {
    await FileManager.createDirectory(ROOT_DIR, true)
  }
}

async function readAll(): Promise<HistoryRecord[]> {
  try {
    if (!(await FileManager.exists(DB_PATH))) return []
    const text = await FileManager.readAsString(DB_PATH)
    const arr = JSON.parse(text)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

async function writeAll(list: HistoryRecord[]) {
  await ensureRootDir()
  await FileManager.writeAsString(DB_PATH, JSON.stringify(list))
}

function sortDesc(list: HistoryRecord[]): HistoryRecord[] {
  return [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export async function initDatabase() {
  await ensureRootDir()
  if (!(await FileManager.exists(DB_PATH))) {
    await writeAll([])
  }
}

export async function listHistory(limit?: number): Promise<HistoryRecord[]> {
  const all = sortDesc(await readAll())
  return limit ? all.slice(0, Math.floor(limit)) : all
}

export async function countHistory(): Promise<number> {
  return (await readAll()).length
}

export async function findBySourceURL(url: string): Promise<HistoryRecord[]> {
  return sortDesc(await readAll()).filter((r) => r.source_url === url)
}

export async function insertHistory(item: NewHistoryItem): Promise<HistoryRecord> {
  const record: HistoryRecord = {
    id: newId(),
    source_url: item.sourceURL,
    kind: item.kind,
    title: item.title,
    file_path: item.filePath,
    file_name: item.fileName,
    bytes_written: item.bytesWritten,
    duration_sec: item.durationSec ?? 0,
    resolution: item.resolution ?? "",
    format: item.format ?? "",
    thumb_path: item.thumbPath ?? "",
    created_at: new Date().toISOString(),
    note: item.note ?? "",
  }
  const all = await readAll()
  all.unshift(record)
  const trimmed = await trimToLimit(all)
  await writeAll(trimmed)
  writeWidgetSnapshot(trimmed)
  return record
}

export async function deleteHistoryRecord(id: string, deleteFile = false) {
  const all = await readAll()
  const target = all.find((r) => r.id === id)
  if (deleteFile && target && (await FileManager.exists(target.file_path))) {
    try {
      await FileManager.remove(target.file_path)
    } catch {}
  }
  const rest = all.filter((r) => r.id !== id)
  await writeAll(rest)
  writeWidgetSnapshot(rest)
}

export async function updateHistoryNote(id: string, note: string) {
  const all = await readAll()
  const target = all.find((r) => r.id === id)
  if (target) {
    // 追加而非覆盖：保留来源标签（腾讯云点播 等），重复则不追加
    target.note = target.note ? (target.note.includes(note) ? target.note : `${target.note}·${note}`) : note
    await writeAll(all)
    writeWidgetSnapshot(all)
  }
}

// 缩略图路径非空不代表文件仍存在或能够解码。
function readableThumbnail(path?: string): boolean {
  if (!path) return false
  try {
    return !!UIImage.fromFile(path)
  } catch {
    return false
  }
}

const PHOTO_ALBUM = "Video Downloader"

async function downloaderPhotoAssets(): Promise<any[]> {
  if (typeof Photos === "undefined") return []
  const albums = (await Photos.fetchAlbums({ type: "album" })).filter((a: any) => a.title === PHOTO_ALBUM)
  const groups = await Promise.all(albums.map((album: any) => album.fetchAssets({ mediaType: "video" })))
  return groups.flat().filter((asset: any) => asset?.localIdentifier)
}

// 只接受时间与时长都相符的相簿视频，避免用无关视频冒充历史封面。
function matchPhotoAsset(record: HistoryRecord, assets: any[], used: Set<string>): any | null {
  const createdAt = Date.parse(record.created_at)
  if (!Number.isFinite(createdAt)) return null
  const duration = record.duration_sec ?? 0
  let best: any = null
  let bestScore = Infinity
  for (const asset of assets) {
    if (!asset || used.has(asset.localIdentifier) || typeof asset.creationDate !== "number") continue
    // 历史先写入、视频随后存入相册；允许少量时钟/元数据偏差。
    const deltaSeconds = (asset.creationDate - createdAt) / 1000
    if (deltaSeconds < -120 || deltaSeconds > 600) continue
    let durationDelta = 0
    if (duration > 0) {
      if (!(asset.duration > 0)) continue
      durationDelta = Math.abs(asset.duration - duration)
      if (durationDelta > 1.2) continue
    } else if (Math.abs(deltaSeconds) > 30) {
      continue
    }
    const score = Math.abs(deltaSeconds) + durationDelta * 20
    if (score < bestScore) {
      best = asset
      bestScore = score
    }
  }
  return best
}

// 缺图与缺媒体信息独立判断；本地文件被移入相册时，从指定相簿补图。
export const LAST_BACKFILL_KEY = "vdl.lastBackfill"

export async function backfillMediaInfo(): Promise<number> {
  let fixed = 0
  let skippedNoFile = 0
  let thumbsFixed = 0
  let thumbsFailed = 0
  try {
    const all = sortDesc(await readAll())
    const need = all.filter((r) => !r.duration_sec || !r.resolution || !readableThumbnail(r.thumb_path))
    const repairs = new Map<string, Partial<HistoryRecord>>()
    const usedPhotoAssets = new Set<string>()
    let photoAssets: any[] | null = null
    let photoUnmatched = 0
    let attempted = 0
    for (const r of need) {
      if (attempted >= 30) break
      const patch: Partial<HistoryRecord> = {}
      const localExists = !!r.file_path && (await FileManager.exists(r.file_path))
      if (!localExists) {
        skippedNoFile++
        if (!r.note.includes("相册")) continue
        attempted++
        try {
          if (photoAssets === null) {
            photoAssets = await downloaderPhotoAssets()
            appendDebug(`历史封面：${PHOTO_ALBUM}相簿读取到 ${photoAssets.length} 个视频`)
          }
          const asset = matchPhotoAsset(r, photoAssets, usedPhotoAssets)
          if (!asset) {
            photoUnmatched++
            thumbsFailed++
            continue
          }
          usedPhotoAssets.add(asset.localIdentifier)
          if (!r.duration_sec && asset.duration > 0) patch.duration_sec = asset.duration
          if (!r.resolution && asset.pixelWidth > 0 && asset.pixelHeight > 0) {
            patch.resolution = resolutionLabel(asset.pixelWidth, asset.pixelHeight)
            patch.format = r.file_name.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toUpperCase() ?? ""
          }
          if (!readableThumbnail(r.thumb_path)) {
            const image = await asset.requestImage({
              targetWidth: 320,
              targetHeight: 320,
              contentMode: "aspectFill",
              deliveryMode: "highQualityFormat",
            })
            const path = image ? await saveThumbnailImage(image, `photo-${r.id}`) : ""
            if (readableThumbnail(path)) {
              patch.thumb_path = path
              thumbsFixed++
            } else {
              thumbsFailed++
            }
          }
        } catch (e) {
          thumbsFailed++
          appendDebug(`历史封面：相簿补图失败 · ${r.file_name} · ${String(e)}`)
        }
      } else {
        attempted++
        if (!r.duration_sec || !r.resolution) {
          const m = await probeMedia(r.file_path)
          if (m.durationSec > 0 && m.durationSec !== r.duration_sec) patch.duration_sec = m.durationSec
          if (m.width > 0 && m.height > 0) {
            patch.resolution = resolutionLabel(m.width, m.height)
            patch.format = r.file_name.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toUpperCase() ?? ""
          }
        }
        if (!readableThumbnail(r.thumb_path)) {
          const path = await generateThumbFile(r.file_path, patch.duration_sec ?? r.duration_sec)
          if (readableThumbnail(path)) {
            patch.thumb_path = path
            thumbsFixed++
          } else {
            thumbsFailed++
            appendDebug(`历史封面：抽帧或图片读取失败 · ${r.file_name}`)
          }
        }
      }
      if (Object.keys(patch).length) repairs.set(r.id, patch)
    }
    if (repairs.size) {
      // 抽帧期间可能新增、删除记录或更新备注；重新读取，只合并媒体字段。
      const latest = await readAll()
      const merged = latest.map((r) => {
        const patch = repairs.get(r.id)
        if (!patch) return r
        fixed++
        return { ...r, ...patch }
      })
      if (fixed) {
        await writeAll(merged)
        writeWidgetSnapshot(merged)
      }
    }
    appendDebug(`历史封面回填：待检查 ${need.length}，本轮处理 ${attempted}，已更新 ${fixed}，补图 ${thumbsFixed}，失败 ${thumbsFailed}，相簿未匹配 ${photoUnmatched}，源视频缺失 ${skippedNoFile}`)
    try {
      Storage.set(LAST_BACKFILL_KEY, {
        at: new Date().toISOString(),
        need: need.length,
        fixed,
        skippedNoFile,
        thumbsFixed,
        thumbsFailed,
        photoUnmatched,
      })
    } catch {}
  } catch (e) {
    appendDebug(`历史封面回填失败：${String(e)}`)
  }
  return fixed
}

// 每次打开 App 都重算快照（旧版快照缺新字段时也能自愈）
export async function ensureWidgetSnapshot() {
  try {
    writeWidgetSnapshot(await listHistory())
  } catch {}
}

export async function clearHistoryRecords() {
  await writeAll([])
  writeWidgetSnapshot([])
}
