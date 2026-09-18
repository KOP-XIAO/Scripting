// services/storage-man.ts — 下载目录的占用统计与清理
// FileManager 为全局对象，禁止从 scripting 导入

import { Path } from "scripting"
import { formatBytes } from "../utils/common"

export type DirInfo = { name: string; path: string; bytes: number }

const DOWNLOADS_DIR = () => Path.join(FileManager.documentsDirectory, "Video", "Downloads")

async function dirSize(path: string): Promise<number> {
  let total = 0
  try {
    const entries = await FileManager.readDirectory(path, true)
    for (const rel of entries) {
      try {
        const st = await FileManager.stat(Path.join(path, rel))
        if (st.type === "file") total += st.size
      } catch {}
    }
  } catch {}
  return total
}

export async function listDownloadDirs(): Promise<{ dirs: DirInfo[]; totalBytes: number }> {
  const root = DOWNLOADS_DIR()
  const dirs: DirInfo[] = []
  if (!(await FileManager.exists(root))) return { dirs, totalBytes: 0 }
  const names = await FileManager.readDirectory(root, false)
  for (const name of names) {
    const p = Path.join(root, name)
    const st = await FileManager.stat(p)
    if (st.type !== "directory") continue
    dirs.push({ name, path: p, bytes: await dirSize(p) })
  }
  dirs.sort((a, b) => b.bytes - a.bytes)
  return { dirs, totalBytes: dirs.reduce((s2, d) => s2 + d.bytes, 0) }
}

export async function clearDownloadDirs(): Promise<number> {
  const root = DOWNLOADS_DIR()
  if (!(await FileManager.exists(root))) return 0
  const names = await FileManager.readDirectory(root, false)
  let n = 0
  for (const name of names) {
    try {
      await FileManager.remove(Path.join(root, name))
      n++
    } catch {}
  }
  return n
}

// 自动清理：删除 N 天前修改的任务目录；返回删除数量
export async function autoCleanDownloads(days: number): Promise<number> {
  if (days <= 0) return 0
  const root = DOWNLOADS_DIR()
  if (!(await FileManager.exists(root))) return 0
  const cutoff = Date.now() - days * 86400000
  const names = await FileManager.readDirectory(root, false)
  let n = 0
  for (const name of names) {
    const p = Path.join(root, name)
    try {
      const st = await FileManager.stat(p)
      // modificationDate 单位依平台可能是秒或毫秒，归一化为毫秒
      const mtime = st.modificationDate < 1e12 ? st.modificationDate * 1000 : st.modificationDate
      if (mtime && mtime < cutoff) {
        await FileManager.remove(p)
        n++
      }
    } catch {}
  }
  return n
}

export { formatBytes }
