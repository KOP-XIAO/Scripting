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
  note?: string
}

const ROOT_DIR = Path.join(FileManager.documentsDirectory, "Video", "Downloader")
const DB_PATH = Path.join(ROOT_DIR, "history.sqlite")
let db: SQLiteDatabase | null = null

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
      created_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    )
  `)
}

export async function listHistory(limit?: number): Promise<HistoryRecord[]> {
  const database = await getDatabase()
  const sql = `
    SELECT id, source_url, kind, title, file_path, file_name, bytes_written, created_at, note
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
    `SELECT id, source_url, kind, title, file_path, file_name, bytes_written, created_at, note
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
    created_at: new Date().toISOString(),
    note: item.note ?? "",
  }
  await database.execute(
    `INSERT OR REPLACE INTO downloads
      (id, source_url, kind, title, file_path, file_name, bytes_written, created_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.source_url,
      record.kind,
      record.title,
      record.file_path,
      record.file_name,
      record.bytes_written,
      record.created_at,
      record.note,
    ],
  )
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
}

export async function clearHistoryRecords() {
  const database = await getDatabase()
  await database.execute(`DELETE FROM downloads`)
}
