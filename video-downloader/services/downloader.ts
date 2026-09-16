// services/downloader.ts — 核心下载逻辑
// 支持：微信视频号（本地元宝 Cookie 解析，在线服务兜底）/ m3u8（选最高码率变体逐分片拼接）/
//       mp4 等直链 / YouTube、B站等平台链接（经 cobalt 兼容解析实例取直链）
// 全局对象（禁止从 scripting 导入）：FileManager、AVAsset、AVAssetExportSession
// 需要从 scripting 导入：fetch、Path

import { Path, fetch } from "scripting"
import { sanitizeFileName, todayStr } from "../utils/common"
import type { Preferences } from "./preferences"
import { getYuanbaoCookie } from "./preferences"
import { resolveWxChannels } from "./wxchannels"
import { isDouyinUrl, resolveDouyin } from "./douyin"
import { sniffPageForVideo } from "./pagesniff"
import { appendDebug } from "./debug"

export type VideoKind = "wx-channels" | "douyin" | "m3u8" | "direct" | "platform"

export type ResolvedVideo = { label: string; url: string; ext: string }

export type DownloadedFile = { path: string; name: string; bytes: number; durationSec?: number }

export type DownloadOutcome = {
  kind: VideoKind
  title: string
  dir: string
  files: DownloadedFile[]
}

export type RunOptions = {
  prefs: Preferences
  onLog?: (line: string) => void
  onProgress?: (done: number, total: number) => void
}

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

// 视频号解析（本地/在线）在 services/wxchannels.ts 中实现

const DIRECT_EXT_RE = /\.(mp4|webm|mov|m4v|mkv|flv|ogv|ts)(\?|#|$)/i
const WX_RE = /^https?:\/\/([a-z0-9-]+\.)?weixin\.qq\.com\/sph\//i

export const KIND_LABELS: Record<VideoKind, string> = {
  "wx-channels": "微信视频号",
  douyin: "抖音（无水印）",
  m3u8: "m3u8 直播/点播流",
  direct: "视频直链",
  platform: "平台链接（需解析实例）",
}

// -------------------------------------------------------------
// 类型识别与 URL 工具（不依赖 URL 类，regex 够用且最稳）
// -------------------------------------------------------------
export function detectKind(url: string): VideoKind {
  if (WX_RE.test(url)) return "wx-channels"
  if (isDouyinUrl(url)) return "douyin"
  if (/\.m3u8(\?|#|$)/i.test(url)) return "m3u8"
  if (DIRECT_EXT_RE.test(url)) return "direct"
  return "platform"
}

function extOf(url: string, fallback: string): string {
  const m = url.match(/\.([a-z0-9]{2,4})(\?|#|$)/i)
  return m ? m[1].toLowerCase() : fallback
}

// 简易相对 URL 解析
function resolveUrl(base: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref
  if (ref.startsWith("//")) return base.split(":")[0] + ":" + ref
  const origin = base.match(/^(https?:\/\/[^/]+)/i)?.[1] ?? ""
  if (ref.startsWith("/")) return origin + ref
  return base.slice(0, base.lastIndexOf("/") + 1) + ref
}

// -------------------------------------------------------------
// 底层 fetch
// -------------------------------------------------------------
async function fetchBytes(url: string, referer: string | undefined, maxMB: number): Promise<Uint8Array> {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, ...(referer ? { Referer: referer } : {}) },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url.slice(0, 120)}`)
  if (maxMB > 0) {
    const len = Number(resp.headers.get("content-length") ?? 0)
    if (len > maxMB * 1048576) {
      throw new Error(`文件 ${(len / 1048576).toFixed(0)}MB 超过上限 ${maxMB}MB（可在设置中调整）`)
    }
  }
  return new Uint8Array(await resp.arrayBuffer())
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

// 探测视频时长（秒）。AVAsset 是免费全局对象；不可用时静默返回 0
async function probeDuration(path: string): Promise<number> {
  try {
    if (typeof AVAsset === "undefined") return 0
    const asset = new AVAsset(path)
    const d = await asset.loadDuration()
    asset.dispose()
    const s = d?.seconds ?? 0
    return isFinite(s) && s > 0 ? s : 0
  } catch {
    return 0
  }
}

// -------------------------------------------------------------
// 微信视频号解析
// -------------------------------------------------------------
// 视频号解析已抽到 services/wxchannels.ts（本地元宝 Cookie 两步 + 在线兜底）
// -------------------------------------------------------------
function filterWxCodec(videos: ResolvedVideo[], codec: Preferences["wxCodec"]): ResolvedVideo[] {
  if (codec === "both") return videos
  const want = codec === "h265" ? "H265" : "H264"
  const picked = videos.filter((v) => v.label === want || v.label === "default")
  return picked.length ? picked : videos // 目标编码不可得时保底全给
}

// -------------------------------------------------------------
// cobalt 兼容解析实例（平台链接）
// -------------------------------------------------------------
async function resolveViaCobalt(apiBase: string, url: string): Promise<ResolvedVideo> {
  const base = apiBase.replace(/\/+$/, "")
  // cobalt 新版 API 是 POST /，旧版是 POST /api/json —— 两个都试
  const headers = { Accept: "application/json", "Content-Type": "application/json", "User-Agent": UA }
  const body = JSON.stringify({ url, downloadMode: "auto" })
  let resp = await fetch(`${base}/`, { method: "POST", headers, body })
  if (resp.status === 404 || resp.status === 405) {
    resp = await fetch(`${base}/api/json`, { method: "POST", headers, body })
  }
  if (!resp.ok) throw new Error(`解析实例 HTTP ${resp.status}（请检查实例地址或更换实例）`)
  const data: any = await resp.json()
  const direct = data?.url as string | undefined
  if (
    direct &&
    (data.status === "tunnel" || data.status === "redirect" || data.status === "success" || !data.status)
  ) {
    return { label: "", url: direct, ext: extOf(direct, "mp4") }
  }
  const picker = data?.picker?.[0]?.url as string | undefined
  if (picker) return { label: "", url: picker, ext: extOf(picker, "mp4") }
  throw new Error(`解析实例未返回直链: ${data?.status ?? "unknown"} ${data?.error?.code ?? ""}`)
}

// -------------------------------------------------------------
// m3u8：主列表选最高码率变体 → 逐分片下载 → 拼接 → 可选转码
// -------------------------------------------------------------
async function downloadM3U8(
  url: string,
  destPathNoExt: string,
  opts: RunOptions,
): Promise<DownloadedFile> {
  const log = opts.onLog ?? (() => {})
  const playlistText = new TextDecoder().decode(await fetchBytes(url, undefined, 0))
  const lines = playlistText.split("\n").map((l) => l.trim()).filter(Boolean)

  let mediaUrl = url
  if (lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"))) {
    let bestBw = -1
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (l.startsWith("#EXT-X-STREAM-INF") && i + 1 < lines.length) {
        const bw = Number(l.match(/BANDWIDTH=(\d+)/)?.[1] ?? 0)
        if (bw >= bestBw && !lines[i + 1].startsWith("#")) {
          bestBw = bw
          mediaUrl = resolveUrl(url, lines[i + 1])
        }
      }
    }
    log(`主播放列表，选择码率 ${bestBw > 0 ? `${(bestBw / 1000).toFixed(0)}kbps` : "未知"} 的变体`)
  }

  const mediaText = mediaUrl === url ? playlistText : new TextDecoder().decode(await fetchBytes(mediaUrl, undefined, 0))
  const segs = mediaText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((s) => resolveUrl(mediaUrl, s))
  if (!segs.length) throw new Error("m3u8 播放列表里没有分片")

  const isFmp4 = /\.(mp4|m4s|cmfv)(\?|#|$)/i.test(segs[0]) || mediaText.includes("#EXT-X-MAP")
  const ext = isFmp4 ? "mp4" : "ts"
  log(`共 ${segs.length} 个分片，封装格式 ${ext}`)

  const chunks: Uint8Array[] = []
  let total = 0
  const maxBytes = opts.prefs.maxMB > 0 ? opts.prefs.maxMB * 1048576 : Infinity
  for (let i = 0; i < segs.length; i++) {
    const b = await fetchBytes(segs[i], mediaUrl, 0)
    total += b.length
    if (total > maxBytes) throw new Error(`累计超过大小上限 ${opts.prefs.maxMB}MB，已中止`)
    chunks.push(b)
    opts.onProgress?.(i + 1, segs.length)
    if (i % 10 === 0 || i === segs.length - 1) {
      log(`分片 ${i + 1}/${segs.length}（${(total / 1048576).toFixed(1)} MB）`)
    }
  }

  let outPath = `${destPathNoExt}.${ext}`
  await FileManager.writeAsBytes(outPath, concatBytes(chunks, total))
  log(`已写入 ${outPath.split("/").pop()}（${(total / 1048576).toFixed(1)} MB）`)

  // 可选：.ts 重编码为 .mp4（AVAssetExportSession 为全局对象，可能不存在则跳过）
  if (!isFmp4 && opts.prefs.transcodeTsToMp4) {
    try {
      if (typeof AVAsset === "undefined" || typeof AVAssetExportSession === "undefined") {
        throw new Error("当前 Scripting 版本无 AVAssetExportSession")
      }
      const mp4Path = `${destPathNoExt}.mp4`
      const session = new AVAssetExportSession(new AVAsset(outPath), "HighestQuality")
      session.outputFileType = "mp4"
      await session.exportTo(mp4Path)
      session.dispose()
      const stat = await FileManager.stat(mp4Path)
      log(`已转码为 ${mp4Path.split("/").pop()}`)
      return { path: mp4Path, name: mp4Path.split("/").pop() ?? "", bytes: stat.size ?? total }
    } catch (e) {
      log(`转码失败，保留 .ts（可用 VLC 等播放器打开）: ${e}`)
      appendDebug(`m3u8 转码失败: ${e}`)
    }
  }
  return { path: outPath, name: outPath.split("/").pop() ?? "", bytes: total }
}

// -------------------------------------------------------------
// 主入口
// -------------------------------------------------------------
export async function runDownload(inputUrl: string, opts: RunOptions): Promise<DownloadOutcome> {
  const log = (line: string) => {
    opts.onLog?.(line)
    appendDebug(line)
  }
  const url = inputUrl.trim()
  if (!/^https?:\/\//i.test(url)) throw new Error("请输入有效的 http(s) 链接")
  const kind = detectKind(url)
  log(`识别类型: ${KIND_LABELS[kind]}`)

  // 解析出直链清单
  let title = "video"
  let targets: ResolvedVideo[] = []
  if (kind === "wx-channels") {
    const cookie = getYuanbaoCookie()
    log(cookie ? "视频号解析：本地元宝通道" : "视频号解析：在线服务（未配置元宝 Cookie）")
    const r = await resolveWxChannels(url, cookie)
    title = r.title
    targets = filterWxCodec(r.videos, opts.prefs.wxCodec)
    log(`视频号: ${title}（保存 ${targets.map((t) => t.label).join("/")}，通道 ${r.route}）`)
  } else if (kind === "douyin") {
    const r = await resolveDouyin(url)
    title = r.title
    targets = r.videos.slice(0, 1) // 默认 1080p；备份清晰度不重复下载
    log(`抖音: ${title}（无水印直链，aweme ${r.awemeId}）`)
  } else if (kind === "platform") {
    // 先尝试页面嗅探（腾讯云点播嵌入 / og:video / 内嵌 video_url / 裸直链），
    // 失败再回退 cobalt 解析实例
    try {
      const r = await sniffPageForVideo(url)
      title = r.title
      targets = r.videos.slice(0, 1) // 只下最优一路
      log(`页面嗅探命中（${r.route}）: ${title}`)
    } catch (e) {
      appendDebug(`页面嗅探未命中: ${e}`)
      const api = opts.prefs.cobaltApi.trim()
      if (!api) {
        throw new Error(
          `页面嗅探未命中（${e instanceof Error ? e.message : e}），且未配置解析实例：` +
            "请在「设置 → 平台解析」里填写 cobalt 兼容 API 地址后重试",
        )
      }
      targets = [await resolveViaCobalt(api, url)]
      log(`解析成功: ${targets[0].url.slice(0, 100)}…`)
    }
  } else {
    title = sanitizeFileName(url.split("/").pop()?.split("?")[0] ?? "video").replace(/\.[a-z0-9]{2,4}$/i, "")
  }

  // 输出目录：与桌面版 skill 一致 Documents/Video/Downloads/日期-标题/
  const dir = Path.join(
    FileManager.documentsDirectory,
    "Video",
    "Downloads",
    `${todayStr()}-${sanitizeFileName(title)}`,
  )
  await FileManager.createDirectory(dir, true)

  const files: DownloadedFile[] = []
  if (kind === "m3u8") {
    files.push(await downloadM3U8(url, Path.join(dir, sanitizeFileName(title)), opts))
  } else {
    const list = targets.length ? targets : [{ label: "", url, ext: extOf(url, "mp4") }]
    for (const t of list) {
      const name = `${sanitizeFileName(title)}${t.label ? `-${t.label}` : ""}.${t.ext}`
      const path = Path.join(dir, name)
      log(`开始下载 ${name}`)
      const bytes = await fetchBytes(t.url, url, opts.prefs.maxMB)
      await FileManager.writeAsBytes(path, bytes)
      log(`完成 ${name}（${(bytes.length / 1048576).toFixed(1)} MB）`)
      files.push({ path, name, bytes: bytes.length })
    }
  }

  // 探测时长（AVAsset 为免费全局对象；失败静默返回 0）
  for (const f of files) {
    f.durationSec = await probeDuration(f.path)
  }

  // 下载报告，对齐桌面版 download-report.md
  const report = [
    `# 下载报告`,
    ``,
    `- 来源: ${url}`,
    `- 类型: ${KIND_LABELS[kind]}`,
    `- 时间: ${new Date().toISOString()}`,
    `- 文件:`,
    ...files.map(
      (f) =>
        `  - ${f.name}（${(f.bytes / 1048576).toFixed(1)} MB${f.durationSec ? `，${Math.round(f.durationSec)}s` : ""}）`,
    ),
    ``,
  ].join("\n")
  await FileManager.writeAsString(Path.join(dir, "download-report.md"), report)

  return { kind, title, dir, files }
}
