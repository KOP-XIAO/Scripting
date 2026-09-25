// services/media-probe.ts — 本地视频媒体信息探测（时长/分辨率）
// 独立成模块供 downloader 与 history 共同使用（避免 widget 进程拖入下载依赖链）。
// AVAsset 是免费全局对象；失败静默返回零值。

export type MediaInfo = { durationSec: number; width: number; height: number }

export async function probeMedia(path: string): Promise<MediaInfo> {
  try {
    if (typeof AVAsset === "undefined") return { durationSec: 0, width: 0, height: 0 }
    const asset = new AVAsset(path)
    const d = await asset.loadDuration()
    let w = 0
    let h = 0
    try {
      const tracks = await asset.loadTracks("video")
      if (tracks.length) {
        const size = await tracks[0].loadNaturalSize()
        w = size?.width ?? 0
        h = size?.height ?? 0
      }
    } catch {}
    asset.dispose()
    const sec = d?.seconds ?? 0
    return { durationSec: isFinite(sec) && sec > 0 ? sec : 0, width: w, height: h }
  } catch {
    return { durationSec: 0, width: 0, height: 0 }
  }
}

// 分辨率 → 清晰度标签（短边 p：竖屏 1080×1920 与横屏 1920×1080 都是 1080p）
export function resolutionLabel(width: number, height: number): string {
  if (!width || !height) return ""
  return `${Math.round(Math.min(width, height))}p`
}

// 抽帧 → 中心裁切到 72:46 → JPEG 落盘，返回缩略图路径（失败返回 ""）
// 在下载时调用，历史行只渲染这个文件（不做实时抽帧，hooks 在嵌套组件里不可靠）
export async function generateThumbFile(videoPath: string, durationSec?: number): Promise<string> {
  try {
    if (typeof AVAsset === "undefined" || typeof MediaTime === "undefined") return ""
    const asset = new AVAsset(videoPath)
    const sec = durationSec && durationSec > 2 ? Math.max(0.1, durationSec * 0.1) : 0.1
    const r = await asset.generateImage(MediaTime.make({ seconds: sec, preferredTimescale: 600 }), {
      maximumSize: { width: 320, height: 320 },
    })
    asset.dispose()
    if (!r?.image) return ""
    // 中心裁切到 72:46（width/height 为像素，croppedTo 同空间）
    let image = r.image
    const pw = image.width
    const ph = image.height
    if (pw > 0 && ph > 0) {
      const ratio = 72 / 46
      if (pw / ph > ratio) {
        const nw = Math.round(ph * ratio)
        image = image.croppedTo({ x: Math.round((pw - nw) / 2), y: 0, width: nw, height: ph }) ?? image
      } else {
        const nh = Math.round(pw / ratio)
        image = image.croppedTo({ x: 0, y: Math.round((ph - nh) / 2), width: pw, height: nh }) ?? image
      }
    }
    const data = image.toJPEGData ? image.toJPEGData(0.75) : null
    if (!data) return ""
    const thumbPath = `${videoPath}.thumb.jpg`
    await FileManager.writeAsData(thumbPath, data)
    return thumbPath
  } catch {
    return ""
  }
}
