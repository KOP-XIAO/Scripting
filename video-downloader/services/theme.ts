// services/theme.ts — 可切换外观主题（Storage 持久化，App / Widget 进程共享）
// Storage / Widget 为全局对象，禁止从 scripting 导入

export type ThemeKey =
  | "terminal"
  | "hermes"
  | "prussian"
  | "tiffany"
  | "klein"
  | "burgundy"
  | "sakura"
  | "olive"
  | "graphite"
  | "champagne"

export type Theme = {
  key: ThemeKey
  label: string
  accent: string
  accentSoft: string
  bgTop: string
  bgBottom: string
}

export const THEME_KEY = "vdl.theme"

export const THEMES: Record<ThemeKey, Theme> = {
  terminal: {
    key: "terminal",
    label: "终端绿（默认）",
    accent: "#3FB950",
    accentSoft: "rgba(63, 185, 80, 0.55)",
    bgTop: "#0D1117",
    bgBottom: "#0C1A12",
  },
  hermes: {
    key: "hermes",
    label: "爱马仕橙",
    accent: "#FF6200",
    accentSoft: "rgba(255, 98, 0, 0.55)",
    bgTop: "#171009",
    bgBottom: "#241305",
  },
  prussian: {
    key: "prussian",
    label: "普鲁士蓝",
    accent: "#4A80B4",
    accentSoft: "rgba(74, 128, 180, 0.55)",
    bgTop: "#0A1420",
    bgBottom: "#12283D",
  },
  tiffany: {
    key: "tiffany",
    label: "蒂芙尼蓝",
    accent: "#81D8D0",
    accentSoft: "rgba(129, 216, 208, 0.55)",
    bgTop: "#0C1A1A",
    bgBottom: "#123030",
  },
  klein: {
    key: "klein",
    label: "克莱因蓝",
    accent: "#4C6FFF",
    accentSoft: "rgba(76, 111, 255, 0.55)",
    bgTop: "#0A1030",
    bgBottom: "#14205A",
  },
  burgundy: {
    key: "burgundy",
    label: "勃艮第红",
    accent: "#C04A63",
    accentSoft: "rgba(192, 74, 99, 0.55)",
    bgTop: "#1C0C12",
    bgBottom: "#33101B",
  },
  sakura: {
    key: "sakura",
    label: "樱花粉",
    accent: "#F9A8D4",
    accentSoft: "rgba(249, 168, 212, 0.55)",
    bgTop: "#1D0F16",
    bgBottom: "#33141F",
  },
  olive: {
    key: "olive",
    label: "橄榄绿",
    accent: "#A3B86B",
    accentSoft: "rgba(163, 184, 107, 0.55)",
    bgTop: "#12150C",
    bgBottom: "#1E2410",
  },
  graphite: {
    key: "graphite",
    label: "石墨灰",
    accent: "#9BA3AB",
    accentSoft: "rgba(155, 163, 171, 0.55)",
    bgTop: "#151517",
    bgBottom: "#242428",
  },
  champagne: {
    key: "champagne",
    label: "香槟金",
    accent: "#D4AF6A",
    accentSoft: "rgba(212, 175, 106, 0.55)",
    bgTop: "#171309",
    bgBottom: "#241B0E",
  },
}

export function getThemeKey(): ThemeKey {
  try {
    const k = Storage.get<string>(THEME_KEY)
    if (k && k in THEMES) return k as ThemeKey
  } catch {}
  return "terminal"
}

export function getTheme(): Theme {
  return THEMES[getThemeKey()]
}

export function setThemeKey(key: ThemeKey) {
  Storage.set(THEME_KEY, key)
  // 主题变了立即刷新主屏幕小组件（背景图与配色都随主题）
  try {
    Widget.reloadAll()
  } catch {}
}
