import { appendDebug } from "./debug"
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

const THUMB_DIR = `${FileManager.documentsDirectory}/Video/Downloader/Thumbnails`

function videoCacheKey(videoPath: string): string {
  // 与源文件路径绑定；源视频被移动或清理后，缓存目录中的封面仍然可用。
  let hash = 2166136261
  for (let i = 0; i < videoPath.length; i++) hash = Math.imul(hash ^ videoPath.charCodeAt(i), 16777619)
  return `video-${(hash >>> 0).toString(36)}`
}

// 统一保存本地抽帧与相簿封面。key 必须是稳定的记录/视频标识。
export async function saveThumbnailImage(source: any, key: string): Promise<string> {
  const tag = `thumbSave(${key})`
  try {
    let image = source
    const pw = image?.width ?? 0
    const ph = image?.height ?? 0
    if (!image || pw <= 0 || ph <= 0) {
      appendDebug(`${tag}: 图片对象为空或尺寸无效`)
      return ""
    }
    if (typeof image.renderedIn === "function") {
      const ratio = 72 / 46
      let sx = 0
      let sy = 0
      let sw = pw
      let sh = ph
      if (pw / ph > ratio) {
        sw = Math.round(ph * ratio)
        sx = Math.round((pw - sw) / 2)
      } else {
        sh = Math.round(pw / ratio)
        sy = Math.round((ph - sh) / 2)
      }
      try {
        const cropped = image.renderedIn(
          { width: 216, height: 138 },
          { position: { x: sx, y: sy }, size: { width: sw, height: sh } },
        )
        if (cropped) image = cropped
        else appendDebug(`${tag}: 裁切返回空，用原图`)
      } catch (e) {
        appendDebug(`${tag}: 裁切失败，用原图 · ${String(e)}`)
      }
    }
    const data = image.toJPEGData ? image.toJPEGData(0.75) : null
    if (!data) {
      appendDebug(`${tag}: JPEG 编码失败`)
      return ""
    }
    await FileManager.createDirectory(THUMB_DIR, true)
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "cover"
    const thumbPath = `${THUMB_DIR}/${safeKey}.jpg`
    await FileManager.writeAsData(thumbPath, data)
    // 写盘完成即返回路径。此前用「读回能否解码」决定成败，而刚写出的文件在同一进程里
    // 可能暂时读不到，结果记录存了空路径：下载后不显示封面，必须重启回填才出现。
    // 解码只作为诊断信息；真正不可读时由下载后的补图重试覆盖。
    let decoded = false
    try {
      const check = UIImage.fromFile(thumbPath)
      decoded = !!check && check.width > 0 && check.height > 0
    } catch {}
    appendDebug(`${tag}: 成功 ${pw}×${ph}${decoded ? "，读回正常" : "，读回暂不可解码，稍后重试"}`)
    return thumbPath
  } catch (e) {
    appendDebug(`${tag}: 异常 ${String(e)}`)
    return ""
  }
}

// 抽帧后保存到独立封面缓存；失败返回空字符串。
export async function generateThumbFile(videoPath: string, durationSec?: number): Promise<string> {
  const tag = `thumbGen(${videoPath.split("/").pop()})`
  if (typeof AVAsset === "undefined" || typeof MediaTime === "undefined") {
    appendDebug(`${tag}: AVAsset=${typeof AVAsset} MediaTime=${typeof MediaTime}`)
    return ""
  }
  const asset = new AVAsset(videoPath)
  try {
    const sec = durationSec && durationSec > 2 ? Math.max(0.1, durationSec * 0.1) : 0.1
    const r = await asset.generateImage(MediaTime.make({ seconds: sec, preferredTimescale: 600 }), {
      maximumSize: { width: 320, height: 320 },
    })
    if (!r?.image) {
      appendDebug(`${tag}: generateImage 返回空`)
      return ""
    }
    return await saveThumbnailImage(r.image, videoCacheKey(videoPath))
  } catch (e) {
    appendDebug(`${tag}: 抽帧失败 ${String(e)}`)
    return ""
  } finally {
    asset.dispose()
  }
}
