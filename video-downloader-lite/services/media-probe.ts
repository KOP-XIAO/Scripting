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
  return `${Math.min(width, height)}p`
}
