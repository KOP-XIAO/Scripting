// services/pagesniff.ts — 网页嗅探：平台链接在走 cobalt 前先尝试从页面 HTML 直接嗅探视频
// 覆盖：
//   ① 腾讯云点播嵌入（直播吧等）：vod-player/{appID}/{fileID}/ → getplayinfo 拿 mp4 直链
//   ② og:video / og:video:url meta
//   ③ 页面内嵌 jsondata 的 video_url
//   ④ <video src> 标签
//   ⑤ HTML 里任意 .mp4 / .m3u8 直链
// fetch 需从 scripting 导入

import { fetch } from "scripting"

export type SniffedVideo = { label: string; url: string; ext: string }
export type SniffResult = { title: string; videos: SniffedVideo[]; route: string }

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

function extOf(url: string, fallback = "mp4"): string {
  const m = url.match(/\.([a-z0-9]{2,4})(\?|#|$)/i)
  return m ? m[1].toLowerCase() : fallback
}

function unescapeUrl(u: string): string {
  return u.replace(/\\\//g, "/").replace(/&amp;/g, "&").trim()
}

function htmlTitle(html: string): string {
  return (
    html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ??
    html.match(/<title>([^<]*)<\/title>/i)?.[1] ??
    ""
  ).trim()
}

// 腾讯云点播：vod-player 嵌入 → playvideo.qcloud.com/getplayinfo
async function sniffTencentVod(html: string): Promise<SniffResult | null> {
  const m = html.match(/vod-player\/(\d+)\/(\d+)\//)
  if (!m) return null
  const [, appId, fileId] = m
  const resp = await fetch(`https://playvideo.qcloud.com/getplayinfo/v2/${appId}/${fileId}`, {
    headers: { "User-Agent": MOBILE_UA },
  })
  if (!resp.ok) throw new Error(`腾讯云点播信息 HTTP ${resp.status}`)
  const data: any = await resp.json()
  if (data?.code !== 0) throw new Error(`腾讯云点播信息错误 code=${data?.code}`)

  const videos: SniffedVideo[] = []
  const src = data?.videoInfo?.sourceVideo?.url
  if (src) videos.push({ label: "原片", url: String(src), ext: extOf(src) })
  for (const t of data?.videoInfo?.transcodeList ?? []) {
    const u = String(t?.url ?? "")
    if (u && /\.mp4(\?|#|$)/i.test(u)) {
      videos.push({ label: `转码${t.definition ?? ""}`, url: u, ext: "mp4" })
    }
    if (videos.length >= 3) break
  }
  if (!videos.length) throw new Error("腾讯云点播未返回可用地址")
  const title = String(data?.videoInfo?.basicInfo?.name ?? "").trim()
  return { title: title || "视频", videos, route: "tencent-vod" }
}

// 通用嗅探：og:video / jsondata video_url / <video src> / 裸 mp4|m3u8
function sniffGeneric(html: string, pageUrl: string): SniffResult | null {
  const title = htmlTitle(html) || "网页视频"
  const candidates: SniffedVideo[] = []
  const seen = new Set<string>()
  const push = (label: string, u: string) => {
    u = unescapeUrl(u)
    if (!/^https?:\/\//i.test(u) || seen.has(u)) return
    seen.add(u)
    candidates.push({ label, url: u, ext: extOf(u, u.includes(".m3u8") ? "m3u8" : "mp4") })
  }

  // og:video
  const og = html.match(/<meta\s+property="og:video(?::url|:secure_url)?"\s+content="([^"]+)"/i)
  if (og) push("og:video", og[1])

  // 内嵌 jsondata 的 video_url
  const jd = html.match(/video_url\s*:\s*'([^']+)'/i) ?? html.match(/"video_url"\s*:\s*"([^"]+)"/i)
  if (jd) push("video_url", jd[1])

  // <video src>
  const vsrc = html.match(/<video[^>]+src="([^"]+)"/i)
  if (vsrc) push("video-src", vsrc[1])

  // 裸直链（mp4 优先于 m3u8）
  const bare = html.match(/https?:\/\/[^\s"'<>\\]+\.mp4(\?[^\s"'<>\\]*)?/gi) ?? []
  for (const u of bare.slice(0, 3)) push("页面直链", u)
  if (!candidates.length) {
    const m3u8 = html.match(/https?:\/\/[^\s"'<>\\]+\.m3u8(\?[^\s"'<>\\]*)?/gi) ?? []
    for (const u of m3u8.slice(0, 2)) push("页面 m3u8", u)
  }

  if (!candidates.length) return null
  return { title, videos: candidates.slice(0, 3), route: "html-sniff" }
}

export async function sniffPageForVideo(pageUrl: string): Promise<SniffResult> {
  const resp = await fetch(pageUrl, { headers: { "User-Agent": MOBILE_UA } })
  if (!resp.ok) throw new Error(`页面获取失败 HTTP ${resp.status}`)
  const html = await resp.text()

  const vod = await sniffTencentVod(html)
  if (vod) {
    // 点播接口的 basicInfo.name 常是哈希串，页面标题更有人类可读性，优先采用
    const pageTitle = htmlTitle(html)
    if (pageTitle) vod.title = pageTitle
    return vod
  }
  const generic = sniffGeneric(html, pageUrl)
  if (generic) return generic
  throw new Error("页面里嗅探不到视频地址")
}
