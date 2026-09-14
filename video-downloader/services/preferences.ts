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
