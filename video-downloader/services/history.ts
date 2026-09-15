// services/history.ts — SQLite 下载历史（仿社区抖音下载器的实证实现）
// FileManager / SQLite 为全局对象，禁止从 scripting 导入

import { Path } from "scripting"
import { newId } from "../utils/common"

export type HistoryRecord = {
  id: string
  source_url: string
  kind: string
  title: string
  file_path: string
  file_name: string
  bytes_written: number
  duration_sec?: number
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

// 老版本升级迁移：历史已有数据但还没有快照时，回填一次
export async function ensureWidgetSnapshot() {
  try {
    if (!getWidgetSnapshot()) await syncWidgetSnapshot()
  } catch {}
}

export async function syncWidgetSnapshot() {
  try {
    const database = await getDatabase()
    const top = await database.fetchAll<HistoryRecord>(
      `SELECT title, file_name, bytes_written, duration_sec, created_at, note
       FROM downloads ORDER BY datetime(created_at) DESC LIMIT 2`,
    )
    const agg = await database.fetchAll<{ n: number; total: number | null }>(
      `SELECT COUNT(*) AS n, SUM(bytes_written) AS total FROM downloads`,
    )
    const toItem = (r: HistoryRecord | undefined): WidgetSnapshotItem | null =>
      r
        ? {
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
}

export async function listHistory(limit?: number): Promise<HistoryRecord[]> {
  const database = await getDatabase()
  const sql = `
    SELECT id, source_url, kind, title, file_path, file_name, bytes_written, duration_sec, created_at, note
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
    `SELECT id, source_url, kind, title, file_path, file_name, bytes_written, duration_sec, created_at, note
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
    created_at: new Date().toISOString(),
    note: item.note ?? "",
  }
  await database.execute(
    `INSERT OR REPLACE INTO downloads
      (id, source_url, kind, title, file_path, file_name, bytes_written, duration_sec, created_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.source_url,
      record.kind,
      record.title,
      record.file_path,
      record.file_name,
      record.bytes_written,
      record.duration_sec ?? 0,
      record.created_at,
      record.note,
    ],
  )
  await syncWidgetSnapshot()
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
  await database.execute(`UPDATE downloads SET note = ? WHERE id = ?`, [note, id])
  await syncWidgetSnapshot()
}

export async function clearHistoryRecords() {
  const database = await getDatabase()
  await database.execute(`DELETE FROM downloads`)
  await syncWidgetSnapshot()
}
