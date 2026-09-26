// services/file-actions.ts — 下载后的保存动作
// 全局对象（禁止从 scripting 导入）：Photos、Data、DocumentPicker、ShareSheet、Dialog

import { getPreferences, type SaveMode } from "./preferences"
import { appendDebug } from "./debug"
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

// 存相册用 shouldMoveFile: true —— 成功后本地副本被移走，不再重复占空间；
// 开启相簿开关时把刚存的视频归入「Video Downloader」相簿
export async function saveFilePathToPhotos(filePath: string, fileName: string) {
  if (!canSaveToPhotos(fileName)) {
    throw new Error("该封装格式（非 mp4/mov）不能存入相册，请用「导出到文件」或在设置里开启转码")
  }
  const ok = await Photos.saveVideo(filePath, { fileName, shouldMoveFile: true })
  if (!ok) throw new Error("保存到相册失败（请检查相册权限）")
  if (getPreferences().photoAlbum) await addLatestVideoToAlbum(fileName)
  // 相簿归入在 postDownloadAction 之后由调用方触发（addLatestVideoToAlbum）
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

// -------------------------------------------------------------
// 相簿归入 v2（带全侦察）：addAssets 曾谎报成功（读回=0），
// 这版每一步都留痕：同名相簿数量、创建/复用、添加、双通道读回。
// -------------------------------------------------------------
const ALBUM_NAME = "Video Downloader"

async function ensureAlbumV2(): Promise<any> {
  const all: any[] = await Photos.fetchAlbums({ type: "album" })
  const sameName = all.filter((a) => a.title === ALBUM_NAME)
  appendDebug(`相簿v2：同名相簿 ${sameName.length} 个`)
  if (sameName.length > 1) {
    // 多个同名：保留第一个，其余删掉（内容并入第一个）
    for (const dup of sameName.slice(1)) {
      try {
        const assets = await dup.fetchAssets({})
        if (assets.length) await sameName[0].addAssets(assets)
        await Photos.deleteAlbums([dup])
      } catch {}
    }
    appendDebug(`相簿v2：已合并删除 ${sameName.length - 1} 个重复相簿`)
  }
  if (sameName.length) return sameName[0]
  const created = await Photos.createAlbum(ALBUM_NAME)
  appendDebug(`相簿v2：新建相簿 id=${created?.localIdentifier ?? "null"}`)
  return created
}

export async function addLatestVideoToAlbum(fileName: string) {
  try {
    const album = await ensureAlbumV2()
    if (!album) {
      appendDebug("相簿v2：创建/查找失败")
      return
    }
    // 相册写入是异步的，等落账
    await new Promise((r) => setTimeout(r, 800))
    const latest = await Photos.fetchAssets({ mediaType: "video", sortBy: "creationDate", ascending: false, limit: 1 })
    if (!latest.length) {
      appendDebug("相簿v2：没取到最新视频资源")
      return
    }
    const asset = latest[0]
    appendDebug(`相簿v2：取到最新视频 ${asset.localIdentifier?.slice(-8) ?? "?"}（下载的应是 ${fileName}）`)
    const okAdd = await album.addAssets([asset])
    appendDebug(`相簿v2：addAssets 返回 ${okAdd}`)
    // 读回验证：两条通道都查
    const direct = await album.fetchAssets({ mediaType: "video" })
    appendDebug(`相簿v2：读回（collection.fetchAssets）= ${direct.length} 条`)
    const reFetched = await Photos.fetchAlbum(album.localIdentifier)
    if (reFetched) {
      appendDebug(`相簿v2：重取相簿 estimatedAssetCount=${reFetched.estimatedAssetCount}`)
    }
  } catch (e) {
    appendDebug(`相簿v2：异常 ${e}`)
  }
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
