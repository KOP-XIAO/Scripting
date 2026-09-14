// services/wxchannels.ts — 微信视频号解析
// 两条路线（对齐桌面版 skill 的 download_video.py，移植自上游 Go 实现
// ltaoo/wx_channels_download 的 pkg/scraper/wxchannels/yuanbao.go）：
//   1. 本地解析（推荐）：元宝 Cookie 两步 HTTP，不依赖任何第三方服务
//      ① POST yuanbao.tencent.com/api/weixin/get_parse_result（需 Cookie）
//         → playable_url（query 里带 token + eid）
//      ② POST channels.weixin.qq.com/finder-preview/api/feed/get_feed_info
//         （无需 Cookie）→ feedInfo（h264/h265 直链）
//   2. 在线解析服务（兜底）：sph.litao.workers.dev（上游已停服/需鉴权时会在
//      这里报错并引导用户去设置里填 Cookie）
// fetch / Path 需从 scripting 导入；其余无依赖

import { fetch } from "scripting"

export type WxVideo = { label: string; url: string; ext: string }
export type WxProfile = { title: string; videos: WxVideo[]; route: string }

const WX_PARSE_API = "https://sph.litao.workers.dev/api/fetch_video_profile"
const YUANBAO_PARSE_API = "https://yuanbao.tencent.com/api/weixin/get_parse_result"
const WX_FINDER_FEED_API = "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info"

const YUANBAO_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"

// 设备头逐字复制自上游 Go 版；若某天解析突然失败，需从已登录的
// yuanbao.tencent.com 浏览器会话里刷新这些值
const YUANBAO_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "content-type": "application/json",
  origin: "https://yuanbao.tencent.com",
  referer: "https://yuanbao.tencent.com/chat/naQivTmsDa/cf4d0079-ed1b-4c55-a3f3-2ca1379727d1",
  "user-agent": YUANBAO_USER_AGENT,
  "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "t-userid": "b9575f6b0a8c4a55a08096904a5ef20a",
  "x-agentid": "naQivTmsDa/cf4d0079-ed1b-4c55-a3f3-2ca1379727d1",
  "x-commit-tag": "72282a0d",
  "x-device-id": "1921b001708100d7fa31002b9646bd0cc15a3e2e1f",
  "x-hy106": "",
  "x-hy92": "e963067ffa31002b9646bd0c03000008b1951a",
  "x-hy93": "1921b001708100d7fa31002b9646bd0cc15a3e2e1f",
  "x-id": "b9575f6b0a8c4a55a08096904a5ef20a",
  "x-instance-id": "5",
  "x-language": "zh-CN",
  "x-os_version": "Mac OS(10.15.7)-Blink",
  "x-platform": "mac",
  "x-requested-with": "XMLHttpRequest",
  "x-source": "web",
  "x-web-third-source": "main",
  "x-webdriver": "0",
  "x-webversion": "2.69.0",
  "x-ybuitest": "0",
}

// 规范化用户粘贴的 Cookie：去掉 "Cookie:" 前缀、合并多行
export function normalizeCookie(raw: string): string {
  let text = raw.trim()
  if (text.toLowerCase().startsWith("cookie:")) text = text.slice(7).trim()
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
}

// 对齐上游 generate_rid()：unix 时间戳 hex + "-" + 8 个随机 hex
function generateRid(): string {
  const stamp = Math.floor(Date.now() / 1000).toString(16)
  const rand = Array.from({ length: 8 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")
  return `${stamp}-${rand}`
}

function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of query.replace(/^\?/, "").split("&")) {
    if (!part) continue
    const eq = part.indexOf("=")
    const k = eq >= 0 ? part.slice(0, eq) : part
    const v = eq >= 0 ? part.slice(eq + 1) : ""
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }
  return out
}

// 步骤 1：元宝解析分享链接（需要 Cookie）
async function yuanbaoParseShareUrl(url: string, cookie: string): Promise<{ token: string; eid: string }> {
  const resp = await fetch(YUANBAO_PARSE_API, {
    method: "POST",
    headers: { ...YUANBAO_HEADERS, cookie },
    body: JSON.stringify({ type: "video_channel_url", url, scene: 1 }),
  })
  if (!resp.ok) throw new Error(`元宝解析 HTTP ${resp.status}`)
  const payload: any = await resp.json()
  const code = payload?.code
  if (code !== 0 && code != null) {
    throw new Error(`元宝解析 code=${code}: ${String(payload?.msg ?? "").slice(0, 120)}（Cookie 可能已过期）`)
  }
  const playableUrl = String(payload?.data?.playable_url ?? "").trim()
  if (!playableUrl) throw new Error("元宝响应缺少 playable_url（Cookie 可能已过期）")
  const q = parseQuery(playableUrl.split("?")[1] ?? "")
  if (!q.token || !q.eid) throw new Error("playable_url 缺少 token/eid 参数")
  return { token: q.token, eid: q.eid }
}

// 步骤 2：拿 feedInfo（无需 Cookie；上游不校验状态码，2xx 即视为成功）
async function wxGetFeedInfo(token: string, eid: string): Promise<any> {
  const rid = generateRid()
  const pageUrl = "https://channels.weixin.qq.com/finder-preview/pages/feed"
  const api = `${WX_FINDER_FEED_API}?_rid=${encodeURIComponent(rid)}&_pageUrl=${encodeURIComponent(pageUrl)}`
  const referer =
    `${pageUrl}?entry_card_type=48&comment_scene=39&appid=0` +
    `&token=${encodeURIComponent(token)}&entry_scene=0&eid=${encodeURIComponent(eid)}`
  const resp = await fetch(api, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Content-Type": "application/json",
      Origin: "https://channels.weixin.qq.com",
      Referer: referer,
      "User-Agent": YUANBAO_USER_AGENT,
    },
    body: JSON.stringify({ baseReq: { generalToken: token }, exportId: eid }),
  })
  if (resp.status < 200 || resp.status >= 300) throw new Error(`get_feed_info HTTP ${resp.status}`)
  const payload: any = await resp.json()
  if (payload?.errCode !== 0 && payload?.errCode != null) {
    throw new Error(`get_feed_info errCode=${payload.errCode}: ${String(payload?.errMsg ?? "").slice(0, 120)}`)
  }
  const err = payload?.data?.errMsg
  if (err && typeof err === "object" && (err.type || String(err.title ?? "").trim() || String(err.content ?? "").trim())) {
    throw new Error(`get_feed_info: ${String(err.title ?? err.content ?? `type ${err.type}`).slice(0, 120)}`)
  }
  return payload
}

// 在线兜底（原 sph.litao.workers.dev 公共服务）
async function resolveOnline(shareUrl: string): Promise<any> {
  const resp = await fetch(WX_PARSE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": YUANBAO_USER_AGENT },
    body: JSON.stringify({ url: shareUrl }),
  })
  if (!resp.ok) throw new Error(`在线解析服务 HTTP ${resp.status}`)
  const data: any = await resp.json()
  if (data?.errCode) throw new Error(`在线解析失败: ${data.errMsg ?? data.errCode}`)
  if (data?.error) throw new Error(`在线解析失败: ${String(data.error).slice(0, 160)}`)
  return data
}

// 统一出口：有 Cookie 走本地两步，否则在线兜底
export async function resolveWxChannels(shareUrl: string, cookieRaw?: string): Promise<WxProfile> {
  const cookie = cookieRaw ? normalizeCookie(cookieRaw) : ""
  let data: any
  let route: string
  if (cookie) {
    const { token, eid } = await yuanbaoParseShareUrl(shareUrl, cookie)
    data = await wxGetFeedInfo(token, eid)
    route = "yuanbao-local"
  } else {
    try {
      data = await resolveOnline(shareUrl)
      route = "online"
    } catch (e) {
      throw new Error(
        `${e instanceof Error ? e.message : e}\n在线解析服务可能已停服：请在「设置 → 视频号解析」填入元宝 Cookie 改用本地解析`,
      )
    }
  }

  const feed = data?.data?.feedInfo ?? {}
  const author = data?.data?.authorInfo ?? {}
  const title =
    String(feed.description ?? "").trim() || String(author.nickname ?? "").trim() || "视频号视频"

  const videos: WxVideo[] = []
  const h264 = String(feed.h264VideoInfo?.videoUrl ?? "").trim()
  const h265 = String(feed.h265VideoInfo?.videoUrl ?? "").trim()
  const def = String(feed.videoUrl ?? "").trim()
  if (h264) videos.push({ label: "H264", url: h264, ext: "mp4" })
  if (h265 && h265 !== h264) videos.push({ label: "H265", url: h265, ext: "mp4" })
  if (!videos.length && def) videos.push({ label: "default", url: def, ext: "mp4" })
  if (!videos.length) throw new Error("解析成功但没有可下载的视频地址")
  return { title, videos, route }
}
