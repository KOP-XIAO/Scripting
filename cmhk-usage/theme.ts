// theme.ts — CMHK Usage 视觉主题（widget 与 app 内页共用）
// 设计方向：深色玻璃质感卡片 + 青蓝渐变流量环，现代化数据展示。

export const theme = {
  // 卡片底色：深海军蓝渐变
  cardBackground: {
    gradient: [
      { color: "#0B1B33", location: 0 },
      { color: "#0E2748", location: 0.55 },
      { color: "#123A63", location: 1 },
    ],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  } as const,

  // 流量环渐变（青 -> 蓝 -> 靛）
  ringGradient: [
    { color: "#34E1D1", location: 0 },
    { color: "#2AA8FF", location: 0.55 },
    { color: "#5B6CFF", location: 1 },
  ] as const,

  // 流量不足时切换的警示渐变
  ringWarning: [
    { color: "#FFD66E", location: 0 },
    { color: "#FF9F43", location: 1 },
  ] as const,
  ringDanger: [
    { color: "#FF8A7A", location: 0 },
    { color: "#FF4D6D", location: 1 },
  ] as const,

  ringTrack: "rgba(255,255,255,0.10)",

  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.72)",
  textTertiary: "rgba(255,255,255,0.45)",

  accent: "#2AA8FF",
  accentGreen: "#34E1D1",
  divider: "rgba(255,255,255,0.12)",
}

// 按剩余流量比例选渐变
export function ringStops(remainingRatio: number) {
  if (remainingRatio <= 0.1) return theme.ringDanger
  if (remainingRatio <= 0.25) return theme.ringWarning
  return theme.ringGradient
}
