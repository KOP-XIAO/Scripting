// services/file-actions.ts — 下载后的保存动作
// 全局对象（禁止从 scripting 导入）：Photos、Data、DocumentPicker、ShareSheet、Dialog

import type { SaveMode } from "./preferences"
import type { DownloadedFile } from "./downloader"

const PHOTOS_OK_RE = /\.(mp4|mov|m4v)$/i

export function canSaveToPhotos(name: string): boolean {
  return PHOTOS_OK_RE.test(name)
}

export async function saveFilePathToPhotos(filePath: string, fileName: string) {
  if (!canSaveToPhotos(fileName)) {
    throw new Error("该封装格式（非 mp4/mov）不能存入相册，请用「导出到文件」或在设置里开启转码")
  }
  const ok = await Photos.saveVideo(filePath, { fileName, shouldMoveFile: false })
  if (!ok) throw new Error("保存到相册失败（请检查相册权限）")
}

export async function exportFilePathToFiles(filePath: string, fileName: string) {
  const data = Data.fromFile(filePath)
  if (!data) throw new Error("读取本地文件失败，无法导出")
  const exported = await DocumentPicker.exportFiles({ files: [{ data, name: fileName }] })
  if (!exported.length) throw new Error("已取消导出")
  return exported[0]
}

export async function shareFile(filePath: string) {
  await ShareSheet.present([filePath])
}

// 下载完成后按偏好执行动作；mode=ask 时弹动作面板
// 返回展示给用户的结果文案
export async function postDownloadAction(files: DownloadedFile[], mode: SaveMode): Promise<string> {
  const first = files[0]
  if (!first) return "没有下载到文件。"

  if (mode === "keep") return `已保存到下载目录，共 ${files.length} 个文件。`
  if (mode === "photos") {
    let n = 0
    for (const f of files) {
      if (canSaveToPhotos(f.name)) {
        await saveFilePathToPhotos(f.path, f.name)
        n++
      }
    }
    return n ? `已保存 ${n} 个视频到相册。` : "没有可存相册的格式，文件保留在下载目录。"
  }
  if (mode === "files") {
    const path = await exportFilePathToFiles(first.path, first.name)
    return `已导出到文件：${path}`
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
    let n = 0
    for (const f of files) {
      if (canSaveToPhotos(f.name)) {
        await saveFilePathToPhotos(f.path, f.name)
        n++
      }
    }
    return n ? `已保存 ${n} 个视频到相册。` : "格式不支持存相册，已保留在下载目录。"
  }
  if (result === 1) {
    const path = await exportFilePathToFiles(first.path, first.name)
    return `已导出到文件：${path}`
  }
  if (result === 2) {
    await shareFile(first.path)
    return "已打开分享面板。"
  }
  return "已保留到下载目录。"
}
