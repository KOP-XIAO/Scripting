// services/douyin.ts — 抖音 H5 无水印直链解析（零配置）
// 移植自 andyshi70/SHY-downloader 的 providers/douyin.py（H5 SSR 路由载荷）：
//   ① GET 分享页（移动端 UA + iesdouyin Referer）
//   ② 抽出 window._ROUTER_DATA JSON → loaderData 里找 videoInfoRes.item_list[0]
//   ③ play_addr.url_list[0] 的 video_id（或 play_addr.uri）
//   ④ 拼 aweme.snssdk.com/aweme/v1/play/?video_id=... 得无水印直链
// fetch 需从 scripting 导入

import { fetch } from "scripting"

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

const HEADERS: Record<string, string> = {
  "User-Agent": MOBILE_UA,
  Referer: "https://www.iesdouyin.com/",
}

export function isDouyinUrl(url: string): boolean {
  return /^https?:\/\/([a-z0-9-]+\.)?(douyin\.com|iesdouyin\.com)(\/|$)/i.test(url.trim())
}

export type DouyinVideo = { label: string; url: string; ext: string }
export type DouyinProfile = { title: string; videos: DouyinVideo[]; awemeId: string }

function first<T>(v: T[] | null | undefined): T | undefined {
  return Array.isArray(v) && v.length ? v[0] : undefined
}

function extractRouterData(html: string): any {
  const m = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})<\/script>/)
  if (!m) throw new Error("分享页里没有 _ROUTER_DATA（页面结构可能已变更）")
  try {
    return JSON.parse(m[1])
  } catch (e) {
    throw new Error(`_ROUTER_DATA JSON 解析失败: ${e}`)
  }
}

function extractItem(routerData: any): any {
  const loaderData = routerData?.loaderData ?? {}
  for (const key of Object.keys(loaderData)) {
    if (!key.includes("video")) continue
    const itemList = loaderData[key]?.videoInfoRes?.item_list
    if (Array.isArray(itemList) && itemList.length) return itemList[0]
  }
  throw new Error("_ROUTER_DATA 里找不到 item_list")
}

export async function resolveDouyin(shareUrl: string): Promise<DouyinProfile> {
  const resp = await fetch(shareUrl.trim(), { headers: HEADERS })
  if (!resp.ok) throw new Error(`抖音分享页 HTTP ${resp.status}`)
  const html = await resp.text()
  const routerData = extractRouterData(html)
  const item = extractItem(routerData)

  const playAddr = item?.video?.play_addr ?? {}
  const playUrl = first<string>(playAddr.url_list) ?? ""
  let resourceId = ""
  const qm = playUrl.match(/[?&]video_id=([^&]+)/)
  if (qm) resourceId = decodeURIComponent(qm[1])
  if (!resourceId) resourceId = String(playAddr.uri ?? "").trim()
  if (!resourceId) throw new Error("分享页载荷里找不到视频资源 ID")

  const awemeId = String(item?.aweme_id ?? "") || (shareUrl.match(/\/(?:video|share\/video)\/(\d+)/)?.[1] ?? "unknown")
  const title = String(item?.desc ?? "").trim() || `抖音视频 ${awemeId}`

  // 无水印端点：1080p 优先；同时给一个 540p 备份
  const mk = (ratio: string, label: string): DouyinVideo => ({
    label,
    url: `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(resourceId)}&ratio=${ratio}&line=0`,
    ext: "mp4",
  })
  return { title, awemeId, videos: [mk("1080p", "1080p"), mk("540p", "540p")] }
}
