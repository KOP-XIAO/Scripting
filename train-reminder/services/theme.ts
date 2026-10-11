// services/theme.ts — 小组件与 App 的配色（Storage 持久化，两个进程共享）
// Storage / Widget 为全局对象，禁止从 scripting 导入

export type ThemeKey = "ticket" | "midnight"

export type Theme = {
  key: ThemeKey
  label: string
  cardTop: string
  cardBottom: string
  ink: string
  sub: string
  accent: string
  accentSoft: string
  warn: string
}

export const THEME_KEY = "rail.theme"

export const THEMES: Record<ThemeKey, Theme> = {
  ticket: {
    key: "ticket",
    label: "车票白（默认）",
    cardTop: "#FFFFFF",
    cardBottom: "#EEF3FB",
    ink: "#17233A",
    sub: "rgba(23, 35, 58, 0.55)",
    accent: "#2C7BE5",
    accentSoft: "rgba(44, 123, 229, 0.12)",
    warn: "#E8833A",
  },
  midnight: {
    key: "midnight",
    label: "夜行蓝",
    cardTop: "#121A28",
    cardBottom: "#0A111D",
    ink: "#EAF0F8",
    sub: "rgba(234, 240, 248, 0.55)",
    accent: "#4C9AFF",
    accentSoft: "rgba(76, 154, 255, 0.18)",
    warn: "#FFB454",
  },
}

export function getThemeKey(): ThemeKey {
  try {
    const k = Storage.get<string>(THEME_KEY)
    if (k && k in THEMES) return k as ThemeKey
  } catch {}
  return "ticket"
}

export function getTheme(): Theme {
  return THEMES[getThemeKey()]
}

export function setThemeKey(key: ThemeKey) {
  try {
    Storage.set(THEME_KEY, key)
  } catch {}
  try {
    Widget.reloadAll()
  } catch {}
}
