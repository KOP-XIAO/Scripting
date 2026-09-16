// services/history.ts — Lite 版下载历史：JSON 文件存储（不依赖 Pro 专属的 SQLite）
// 导出接口与 Pro 版完全一致，上层 index.tsx / intent.tsx 无需改动。
// FileManager 为全局对象，禁止从 scripting 导入。

import { Path } from "scripting"
import { newId, hostOf } from "../utils/common"
import { probeMedia, resolutionLabel } from "./media-probe"

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
  note?: string
}

const ROOT_DIR = Path.join(FileManager.documentsDirectory, "Video", "Downloader")
const DB_PATH = Path.join(ROOT_DIR, "history.json")
const MAX_RECORDS = 200 // 上限，防止 JSON 无限增长

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
  await FileManager.writeAsString(DB_PATH, JSON.stringify(list.slice(0, MAX_RECORDS)))
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
    created_at: new Date().toISOString(),
    note: item.note ?? "",
  }
  const all = await readAll()
  all.unshift(record)
  await writeAll(all)
  writeWidgetSnapshot(all)
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

// 老记录回填：缺时长/清晰度且文件还在本地的，逐条探测补上（每次最多 30 条，防启动卡顿）
export async function backfillMediaInfo(): Promise<number> {
  let fixed = 0
  try {
    const all = await readAll()
    const need = all.filter((r) => (!r.duration_sec || !r.resolution) && r.file_path)
    for (const r of need.slice(0, 30)) {
      if (!(await FileManager.exists(r.file_path))) continue
      const m = await probeMedia(r.file_path)
      if (m.durationSec > 0) r.duration_sec = m.durationSec
      if (m.height > 0) {
        r.resolution = resolutionLabel(m.width, m.height)
        r.format = r.file_name.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toUpperCase() ?? ""
      }
      fixed++
    }
    if (fixed) {
      await writeAll(all)
      writeWidgetSnapshot(all)
    }
  } catch {}
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
