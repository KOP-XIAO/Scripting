// services/preferences.ts — 持久化偏好（Storage 为全局对象，禁止从 scripting 导入）

export type SaveMode = "ask" | "photos" | "files" | "keep"
export type WxCodec = "h264" | "h265" | "both"

export type Preferences = {
  cobaltApi: string // cobalt 兼容解析实例，如 https://cobalt.example.com
  defaultSaveMode: SaveMode // 下载完成后的默认动作
  wxCodec: WxCodec // 视频号编码偏好
  transcodeTsToMp4: boolean // m3u8 拼接为 .ts 后是否转码 mp4
  dedupe: boolean // 同一来源链接已下载则跳过
  maxMB: number // 直链大小上限，0 = 不限制
  debugLog: boolean // 是否记录诊断日志
  autoStartOnEntry: boolean // 小组件/URL scheme 带入链接后自动开始下载
  askQuality: boolean // 多路清晰度/编码时弹出选择
  autoCleanDays: number // 自动清理 N 天前的本地下载文件（0=关闭）
  nameTemplate: string // 文件命名模板，支持 {title} {label} {date}
  maxHistoryRecords: number // 历史记录上限，超出连记录带本地文件一起删
}

export const PREFS_KEY = "vdl.preferences"

export const DEFAULT_PREFERENCES: Preferences = {
  cobaltApi: "",
  defaultSaveMode: "ask",
  wxCodec: "h264",
  transcodeTsToMp4: false,
  dedupe: true,
  maxMB: 0,
  debugLog: true,
  autoStartOnEntry: true,
  askQuality: false,
  autoCleanDays: 0,
  nameTemplate: "{title}",
  maxHistoryRecords: 200,
}

export function getPreferences(): Preferences {
  const saved = Storage.get<Partial<Preferences>>(PREFS_KEY)
  return { ...DEFAULT_PREFERENCES, ...(saved || {}) }
}

export function persistPreferences(next: Preferences) {
  Storage.set(PREFS_KEY, next)
}

export const SAVE_MODE_LABELS: Record<SaveMode, string> = {
  ask: "每次询问",
  photos: "自动保存到相册",
  files: "自动导出到文件",
  keep: "仅保留在下载目录",
}

export const WX_CODEC_LABELS: Record<WxCodec, string> = {
  h264: "仅 H.264（兼容性最好）",
  h265: "仅 H.265（体积更小）",
  both: "两个编码都保存",
}

// -------------------------------------------------------------
// 元宝 Cookie（视频号本地解析用）—— 存系统钥匙串，不进普通偏好
// Keychain 为全局对象，禁止从 scripting 导入
// -------------------------------------------------------------
const KC_YUANBAO_COOKIE = "vdl.yuanbao.cookie"

export function getYuanbaoCookie(): string {
  try {
    if (typeof Keychain === "undefined") return ""
    return Keychain.get(KC_YUANBAO_COOKIE) ?? ""
  } catch {
    return ""
  }
}

export function setYuanbaoCookie(value: string) {
  try {
    if (typeof Keychain === "undefined") return
    if (value.trim()) Keychain.set(KC_YUANBAO_COOKIE, value.trim())
    else Keychain.remove(KC_YUANBAO_COOKIE)
  } catch {}
}
