// services/theme.ts — 小组件与 App 的配色（Storage 持久化，两个进程共享）
// Storage / Widget 为全局对象，禁止从 scripting 导入

export type ThemeKey = "ticket" | "midnight" | "cyberpunk" | "anime" | "travel" | "forest"

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
  backgroundAsset?: string
  badgeInk?: string
}

export const THEME_KEY = "rail.theme"

export const THEMES: Record<ThemeKey, Theme> = {
  ticket: {
    key: "ticket",
    label: "车票白（默认）",
    cardTop: "#FFFFFF",
    cardBottom: "#EEF3FB",
    ink: "#17233A",
    sub: "#536078",
    accent: "#2165B5",
    accentSoft: "rgba(44, 123, 229, 0.12)",
    warn: "#91440F",
  },
  midnight: {
    key: "midnight",
    label: "夜行蓝",
    backgroundAsset: "theme-midnight.png",
    cardTop: "#121A28",
    cardBottom: "#0A111D",
    ink: "#EAF0F8",
    sub: "#AAB8CD",
    accent: "#4C9AFF",
    accentSoft: "rgba(76, 154, 255, 0.18)",
    warn: "#FFB454",
    badgeInk: "#10202A",
  },
  cyberpunk: {
    key: "cyberpunk",
    label: "赛博朋克",
    cardTop: "#050E1D",
    cardBottom: "#0E142B",
    ink: "#F0F6FC",
    sub: "#C3D5DE",
    accent: "#26E6F5",
    accentSoft: "rgba(38, 230, 245, 0.12)",
    warn: "#FFE64D",
    badgeInk: "#06161B",
    backgroundAsset: "theme-cyberpunk.png",
  },
  anime: {
    key: "anime",
    label: "动漫风景",
    cardTop: "#DAECFA",
    cardBottom: "#F1F7F8",
    ink: "#182D49",
    sub: "#32485E",
    accent: "#215FBA",
    accentSoft: "rgba(33, 95, 186, 0.12)",
    warn: "#7A351D",
    backgroundAsset: "theme-anime.png",
  },
  travel: {
    key: "travel",
    label: "青绿山行",
    cardTop: "#DCEFE9",
    cardBottom: "#BFDCD2",
    ink: "#173E35",
    sub: "#294A3E",
    accent: "#14654E",
    accentSoft: "rgba(20, 101, 78, 0.12)",
    warn: "#854019",
    backgroundAsset: "theme-travel.png",
  },
  forest: {
    key: "forest",
    label: "奶油摩卡",
    backgroundAsset: "theme-mocha.png",
    cardTop: "#FAF6EF",
    cardBottom: "#F6F0E6",
    ink: "#382B25",
    sub: "#705C50",
    accent: "#86583C",
    accentSoft: "rgba(134, 88, 60, 0.12)",
    warn: "#89451D",
    badgeInk: "#FFFFFF",
  },
}

export function getThemeKey(): ThemeKey {
  try {
    const k = Storage.get<string>(THEME_KEY)
    if (k && Object.prototype.hasOwnProperty.call(THEMES, k)) return k as ThemeKey
  } catch {}
  return "ticket"
}

export const ACCENT_KEY = "rail.accent"
export const ACCENTS = {
  theme: { label: "跟随主题", color: "#687787", light: "", dark: "" },
  hermes: { label: "爱马仕橙", color: "#F37021", light: "#A94308", dark: "#FFAD70" },
  tiffany: { label: "蒂芙尼蓝", color: "#81D8D0", light: "#166D68", dark: "#81D8D0" },
  prussian: { label: "普鲁士蓝", color: "#003153", light: "#003153", dark: "#8ABFE0" },
  klein: { label: "克莱因蓝", color: "#002FA7", light: "#002FA7", dark: "#A3B8FF" },
  burgundy: { label: "勃艮第红", color: "#800020", light: "#800020", dark: "#F4A6BB" },
  emerald: { label: "祖母绿", color: "#007A53", light: "#006344", dark: "#83DCB4" },
  violet: { label: "鸢尾紫", color: "#7851A9", light: "#64408F", dark: "#D3B4F5" },
  gold: { label: "香槟金", color: "#C5A36B", light: "#76551E", dark: "#E7C892" },
}
export type AccentKey = keyof typeof ACCENTS

export function getAccentKey(): AccentKey {
  try {
    const k = Storage.get<string>(ACCENT_KEY)
    if (k && Object.prototype.hasOwnProperty.call(ACCENTS, k)) return k as AccentKey
  } catch {}
  return "theme"
}

export function resolveTheme(key: ThemeKey, accentKey: AccentKey): Theme {
  const theme = THEMES[key]
  if (accentKey === "theme") return theme
  const dark = key === "midnight" || key === "cyberpunk"
  const accent = dark ? ACCENTS[accentKey].dark : ACCENTS[accentKey].light
  return { ...theme, accent, warn: accent, badgeInk: dark ? "#10202A" : "#FFFFFF" }
}

export function getTheme(): Theme {
  return resolveTheme(getThemeKey(), getAccentKey())
}

export function setAccentKey(key: AccentKey) {
  try { Storage.set(ACCENT_KEY, key) } catch {}
  try { Widget.reloadAll() } catch {}
}

export function setThemeKey(key: ThemeKey) {
  try {
    Storage.set(THEME_KEY, key)
  } catch {}
  try {
    Widget.reloadAll()
  } catch {}
}
