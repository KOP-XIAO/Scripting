// services/history.ts — SQLite 下载历史（仿社区抖音下载器的实证实现）
// FileManager / SQLite 为全局对象，禁止从 scripting 导入

import { Path } from "scripting"
import { newId, hostOf } from "../utils/common"
import { probeMedia, resolutionLabel, generateThumbFile } from "./media-probe"

export type HistoryRecord = {
  id: string
  source_url: string
  kind: string
  title: string
  file_path: string
  file_name: string
  bytes_written: number
  duration_sec?: number
  resolution?: string
  format?: string
  thumb_path?: string
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
const DB_PATH = Path.join(ROOT_DIR, "history.sqlite")
let db: SQLiteDatabase | null = null

// -------------------------------------------------------------
// 小组件快照：widget 扩展进程读不到 App 文档目录里的 sqlite，
// 走 Storage（同脚本跨进程共享，cmhk 实证）。每次历史变更后同步。
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

// 老记录回填：缺时长/清晰度且文件还在本地的，逐条探测补上
export const LAST_BACKFILL_KEY = "vdl.lastBackfill"

export async function backfillMediaInfo(): Promise<number> {
  let fixed = 0
  let skippedNoFile = 0
  try {
    const database = await getDatabase()
    const rows = await database.fetchAll<HistoryRecord>(
      `SELECT id, file_path, file_name FROM downloads
       WHERE (duration_sec = 0 OR resolution = '') LIMIT 30`,
    )
    for (const r of rows) {
      if (!(await FileManager.exists(r.file_path))) {
        skippedNoFile++
        continue
      }
      const m = await probeMedia(r.file_path)
      const res = m.height > 0 ? resolutionLabel(m.width, m.height) : ""
      const fmt = r.file_name.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toUpperCase() ?? ""
      const thumb = r.thumb_path || (await generateThumbFile(r.file_path, m.durationSec))
      await database.execute(
        `UPDATE downloads SET duration_sec = ?, resolution = ?, format = ?, thumb_path = ? WHERE id = ?`,
        [m.durationSec || 0, res, fmt, thumb, r.id],
      )
      fixed++
    }
    if (fixed) await syncWidgetSnapshot()
    try {
      Storage.set(LAST_BACKFILL_KEY, {
        at: new Date().toISOString(),
        need: rows.length,
        fixed,
        skippedNoFile,
      })
    } catch {}
  } catch {}
  return fixed
}

// 每次打开 App 都重算快照（旧版快照缺新字段时也能自愈）
export async function ensureWidgetSnapshot() {
  try {
    await syncWidgetSnapshot()
  } catch {}
}

export async function syncWidgetSnapshot() {
  try {
    const database = await getDatabase()
    const top = await database.fetchAll<HistoryRecord>(
      `SELECT kind, title, file_name, bytes_written, duration_sec, resolution, format, created_at, note, source_url
       FROM downloads ORDER BY datetime(created_at) DESC LIMIT 2`,
    )
    // 次数按来源链接去重，总大小按来源合计
    const agg = await database.fetchAll<{ n: number; total: number | null }>(
      `SELECT COUNT(*) AS n, SUM(bytes) AS total
       FROM (SELECT source_url, SUM(bytes_written) AS bytes FROM downloads GROUP BY source_url)`,
    )
    const toItem = (r: HistoryRecord | undefined): WidgetSnapshotItem | null =>
      r
        ? {
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
        : null
    Storage.set(WIDGET_SNAPSHOT_KEY, {
      latest: toItem(top[0]),
      second: toItem(top[1]),
      totalCount: agg[0]?.n ?? 0,
      totalBytes: agg[0]?.total ?? 0,
    } satisfies WidgetSnapshot)
  } catch {}
}

// 上限从设置读（默认 200）
function maxRecords(): number {
  try {
    const v = Storage.get<any>("vdl.preferences")
    const n = v?.maxHistoryRecords
    return typeof n === "number" && n > 0 ? Math.floor(n) : 200
  } catch {
    return 200
  }
}

async function trimToLimit() {
  const cap = maxRecords()
  const database = await getDatabase()
  const overflow = await database.fetchAll<HistoryRecord>(
    `SELECT id, file_path FROM downloads ORDER BY datetime(created_at) DESC LIMIT -1 OFFSET ?`,
    [cap],
  )
  for (const r of overflow) {
    if (await FileManager.exists(r.file_path)) {
      try {
        await FileManager.remove(r.file_path)
      } catch {}
    }
    await database.execute(`DELETE FROM downloads WHERE id = ?`, [r.id])
  }
}

async function ensureRootDir() {
  if (!(await FileManager.exists(ROOT_DIR))) {
    await FileManager.createDirectory(ROOT_DIR, true)
  }
}

async function getDatabase(): Promise<SQLiteDatabase> {
  await ensureRootDir()
  if (!db) {
    db = SQLite.open(DB_PATH)
  }
  return db
}

export async function initDatabase() {
  const database = await getDatabase()
  await database.execute(`
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      bytes_written INTEGER NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    )
  `)

  // 老库迁移：补 duration_sec 列
  try {
    await database.execute(`ALTER TABLE downloads ADD COLUMN duration_sec REAL NOT NULL DEFAULT 0`)
  } catch {}
  try {
    await database.execute(`ALTER TABLE downloads ADD COLUMN resolution TEXT NOT NULL DEFAULT ''`)
    await database.execute(`ALTER TABLE downloads ADD COLUMN format TEXT NOT NULL DEFAULT ''`)
  } catch {}
  try {
    await database.execute(`ALTER TABLE downloads ADD COLUMN thumb_path TEXT NOT NULL DEFAULT ''`)
  } catch {}
}

export async function listHistory(limit?: number): Promise<HistoryRecord[]> {
  const database = await getDatabase()
  const sql = `
    SELECT id, source_url, kind, title, file_path, file_name, bytes_written, duration_sec, resolution, format, thumb_path, created_at, note
    FROM downloads
    ORDER BY datetime(created_at) DESC
    ${limit ? `LIMIT ${Math.floor(limit)}` : ""}
  `
  return database.fetchAll<HistoryRecord>(sql)
}

export async function countHistory(): Promise<number> {
  const database = await getDatabase()
  const rows = await database.fetchAll<{ n: number }>(`SELECT COUNT(*) AS n FROM downloads`)
  return rows[0]?.n ?? 0
}

export async function findBySourceURL(url: string): Promise<HistoryRecord[]> {
  const database = await getDatabase()
  return database.fetchAll<HistoryRecord>(
    `SELECT id, source_url, kind, title, file_path, file_name, bytes_written, duration_sec, resolution, format, thumb_path, created_at, note
     FROM downloads WHERE source_url = ? ORDER BY datetime(created_at) DESC`,
    [url],
  )
}

export async function insertHistory(item: NewHistoryItem): Promise<HistoryRecord> {
  const database = await getDatabase()
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
  await database.execute(
    `INSERT OR REPLACE INTO downloads
      (id, source_url, kind, title, file_path, file_name, bytes_written, duration_sec, resolution, format, thumb_path, created_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.source_url,
      record.kind,
      record.title,
      record.file_path,
      record.file_name,
      record.bytes_written,
      record.duration_sec ?? 0,
      record.resolution ?? "",
      record.format ?? "",
      record.thumb_path ?? "",
      record.created_at,
      record.note,
    ],
  )
  await syncWidgetSnapshot()
  await trimToLimit()
  return record
}

export async function deleteHistoryRecord(id: string, deleteFile = false) {
  const database = await getDatabase()
  if (deleteFile) {
    const rows = await database.fetchAll<HistoryRecord>(
      `SELECT file_path FROM downloads WHERE id = ?`,
      [id],
    )
    const path = rows[0]?.file_path
    if (path && (await FileManager.exists(path))) {
      try {
        await FileManager.remove(path)
      } catch {}
    }
  }
  await database.execute(`DELETE FROM downloads WHERE id = ?`, [id])
  await syncWidgetSnapshot()
}

export async function updateHistoryNote(id: string, note: string) {
  const database = await getDatabase()
  await database.execute(
      `UPDATE downloads SET note = CASE
         WHEN note = '' OR instr(note, ?) > 0 THEN note
         ELSE note || '·' || ?
       END WHERE id = ?`,
      [note, note, id],
    )
  await syncWidgetSnapshot()
}

export async function clearHistoryRecords() {
  const database = await getDatabase()
  await database.execute(`DELETE FROM downloads`)
  await syncWidgetSnapshot()
}
