// utils/common.ts — 通用小工具（与抖音下载器同源的稳健实现）

export const VERSION = "1.16.7"

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function sanitizeFileName(input: string): string {
  return (
    (input || "video")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "video"
  )
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return dateString
  const p = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}

export function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 秒 → mm:ss / h:mm:ss
export function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds) || seconds <= 0) return ""
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const p = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`
}

// 从分享文本中抽出第一个 http(s) 链接（中文/emoji 贴边也能切开）
export function extractFirstURL(text: string): string | null {
  const urlRegex = /(https?:\/\/[a-zA-Z0-9\-_.~!*'();:@&=+$,/?#[\]%]+)/i
  const match = text.match(urlRegex)
  return match?.[0] || null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function safeJSONParse(text: string | null | undefined): unknown | null {
  if (!text) return null
  const candidates = [text, text.trim(), text.replace(/\u2028|\u2029/g, ""), text.replace(/\\u002F/g, "/")]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed === "string") {
        try {
          return JSON.parse(parsed)
        } catch {
          return parsed
        }
      }
      return parsed
    } catch {}
  }
  return null
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// 取短域名（去 www./m. 前缀）
export function hostOf(url: string): string {
  return (url.match(/^https?:\/\/([^/]+)/i)?.[1] ?? "").replace(/^(www|m)\./, "")
}

const KNOWN_HOSTS: Record<string, string> = {
  "zhibo8.com": "直播吧",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "bilibili.com": "Bilibili",
  "b23.tv": "Bilibili",
  "x.com": "X",
  "twitter.com": "X",
  "instagram.com": "Instagram",
  "tiktok.com": "TikTok",
  "douyin.com": "抖音",
  "iesdouyin.com": "抖音",
  "xiaohongshu.com": "小红书",
  "xhslink.com": "小红书",
  "vimeo.com": "Vimeo",
  "weixin.qq.com": "视频号",
}

// 链接 → 人类可读来源名（已知平台映射 + 短域名兜底）
export function prettySource(url: string): string {
  const host = hostOf(url)
  return KNOWN_HOSTS[host] ?? host
}
