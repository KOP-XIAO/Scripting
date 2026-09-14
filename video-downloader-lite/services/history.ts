// services/history.ts — Lite 版下载历史：JSON 文件存储（不依赖 Pro 专属的 SQLite）
// 导出接口与 Pro 版完全一致，上层 index.tsx / intent.tsx 无需改动。
// FileManager 为全局对象，禁止从 scripting 导入。

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
const DB_PATH = Path.join(ROOT_DIR, "history.json")
const MAX_RECORDS = 200 // 上限，防止 JSON 无限增长

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
    created_at: new Date().toISOString(),
    note: item.note ?? "",
  }
  const all = await readAll()
  all.unshift(record)
  await writeAll(all)
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
  await writeAll(all.filter((r) => r.id !== id))
}

export async function updateHistoryNote(id: string, note: string) {
  const all = await readAll()
  const target = all.find((r) => r.id === id)
  if (target) {
    target.note = note
    await writeAll(all)
  }
}

export async function clearHistoryRecords() {
  await writeAll([])
}
