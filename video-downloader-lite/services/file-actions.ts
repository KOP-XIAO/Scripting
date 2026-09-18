// services/file-actions.ts — 下载后的保存动作
// 全局对象（禁止从 scripting 导入）：Photos、Data、DocumentPicker、ShareSheet、Dialog

import { getPreferences, type SaveMode } from "./preferences"
import type { DownloadedFile } from "./downloader"

const PHOTOS_OK_RE = /\.(mp4|mov|m4v)$/i

export function canSaveToPhotos(name: string): boolean {
  return PHOTOS_OK_RE.test(name)
}

export type ActionResult = {
  message: string
  savedToPhotos: boolean // true 表示文件已移动进相册（本地副本不再存在）
  movedPaths: string[]
}

const ALBUM_NAME = "Video Downloader"
const ALBUM_ID_KEY = "vdl.photos.albumId"

// 找/建「Video Downloader」相簿（id 缓存进 Storage）
async function ensureAlbum(): Promise<any> {
  try {
    const cached = Storage.get<string>(ALBUM_ID_KEY)
    if (cached) {
      const a = await Photos.fetchAlbum(cached)
      if (a) return a
    }
    const found = (await Photos.fetchAlbums({ type: "album" })).find((a: any) => a.title === ALBUM_NAME)
    const album = found ?? (await Photos.createAlbum(ALBUM_NAME))
    if (album) Storage.set(ALBUM_ID_KEY, album.localIdentifier)
    return album
  } catch {
    return null
  }
}

// 存相册用 shouldMoveFile: true —— 成功后本地副本被移走，不再重复占空间；
// 开启相簿开关时把刚存的视频归入「Video Downloader」相簿
export async function saveFilePathToPhotos(filePath: string, fileName: string) {
  if (!canSaveToPhotos(fileName)) {
    throw new Error("该封装格式（非 mp4/mov）不能存入相册，请用「导出到文件」或在设置里开启转码")
  }
  const ok = await Photos.saveVideo(filePath, { fileName, shouldMoveFile: true })
  if (!ok) throw new Error("保存到相册失败（请检查相册权限）")
  if (getPreferences().photoAlbum) {
    try {
      const album = await ensureAlbum()
      if (album) {
        // saveVideo 不返回 asset id，取最新一条视频加入相簿
        const latest = await Photos.fetchAssets({ mediaType: "video", sortBy: "creationDate", ascending: false, limit: 1 })
        if (latest.length) await album.addAssets(latest[0])
      }
    } catch {}
  }
}

export async function exportFilePathToFiles(filePath: string, fileName: string) {
  const data = Data.fromFile(filePath)
  if (!data) throw new Error("读取本地文件失败（若已存入相册，本地副本已被移除）")
  const exported = await DocumentPicker.exportFiles({ files: [{ data, name: fileName }] })
  if (!exported.length) throw new Error("已取消导出")
  return exported[0]
}

export async function shareFile(filePath: string) {
  await ShareSheet.present([filePath])
}

// 尝试把可存相册的文件全部移入相册，返回数量与成功路径
async function moveAllToPhotos(files: DownloadedFile[]): Promise<{ count: number; moved: string[] }> {
  let count = 0
  const moved: string[] = []
  for (const f of files) {
    if (canSaveToPhotos(f.name)) {
      await saveFilePathToPhotos(f.path, f.name)
      count++
      moved.push(f.path)
    }
  }
  return { count, moved }
}

// 下载完成后按偏好执行动作；mode=ask 时弹动作面板
export async function postDownloadAction(files: DownloadedFile[], mode: SaveMode): Promise<ActionResult> {
  const first = files[0]
  if (!first) return { message: "没有下载到文件。", savedToPhotos: false, movedPaths: [] }

  if (mode === "keep") {
    return { message: `已保存到下载目录，共 ${files.length} 个文件。`, savedToPhotos: false, movedPaths: [] }
  }
  if (mode === "photos") {
    const { count, moved } = await moveAllToPhotos(files)
    return count
      ? { message: `已保存 ${count} 个视频到相册（本地副本已移除）。`, savedToPhotos: true, movedPaths: moved }
      : { message: "没有可存相册的格式，文件保留在下载目录。", savedToPhotos: false, movedPaths: [] }
  }
  if (mode === "files") {
    const path = await exportFilePathToFiles(first.path, first.name)
    return { message: `已导出到文件：${path}`, savedToPhotos: false, movedPaths: [] }
  }

  const result = await Dialog.actionSheet({
    title: "下载完成",
    message: `共 ${files.length} 个文件，接下来想做什么？`,
    actions: [
      { label: "保存到相册" },
      { label: "导出到文件" },
      { label: "分享文件" },
      { label: "仅保留到下载目录" },
    ],
    cancelButton: true,
  })
  if (result === 0) {
    const { count, moved } = await moveAllToPhotos(files)
    return count
      ? { message: `已保存 ${count} 个视频到相册（本地副本已移除）。`, savedToPhotos: true, movedPaths: moved }
      : { message: "格式不支持存相册，已保留在下载目录。", savedToPhotos: false, movedPaths: [] }
  }
  if (result === 1) {
    const path = await exportFilePathToFiles(first.path, first.name)
    return { message: `已导出到文件：${path}`, savedToPhotos: false, movedPaths: [] }
  }
  if (result === 2) {
    await shareFile(first.path)
    return { message: "已打开分享面板。", savedToPhotos: false, movedPaths: [] }
  }
  return { message: "已保留到下载目录。", savedToPhotos: false, movedPaths: [] }
}
