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

  // v1.19.23 已用段填充：柔和珊瑚（75% 不透明度）。
  // v1.19.22 的暗 ember(30%) 叠深蓝底发闷发暗（用户："过于暗色系"）——提亮到 75%，
  // 叠底后呈清晰温暖的陶土橙(#C38572)，与冷色亮渐变的剩余段形成暖/冷对照。
  // 层级仍靠饱和度区分：剩余段是高饱和亮渐变，已用段是柔和暖色，主次分明。
  ringUsed: "rgba(255,158,130,0.75)",

  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.72)",
  textTertiary: "rgba(255,255,255,0.45)",

  accent: "#2AA8FF",
  accentGreen: "#34E1D1",
  divider: "rgba(255,255,255,0.12)",
}

// 剩余比例（用量/总量）：非法或零总量返回 null，调用方回退中性色
export function usageRatio(total?: number | null, remaining?: number | null): number | null {
  if (total == null || remaining == null || total <= 0) return null
  return Math.max(0, Math.min(1, remaining / total))
}

// v1.19.25 剩余用量数字的颜色分级（用户建议，四档比三档更细腻）：
//   ≥60% 青绿（健康）/ 30-60% 黄（偏低）/ 10-30% 橙（警戒）/ <10% 红（危险）
// 阈值与流量环渐变（ringStops）一致——数字与环同色系，一眼读出健康度。
export function dataTierColor(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return theme.textPrimary
  if (ratio < 0.1) return "#FF6B6B"
  if (ratio < 0.3) return "#FF9F43"
  if (ratio < 0.6) return "#FFD66E"
  return theme.accentGreen
}

// 按剩余流量比例选渐变（阈值与 dataTierColor 对齐：0.1 / 0.3）
export function ringStops(remainingRatio: number) {
  if (remainingRatio <= 0.1) return theme.ringDanger
  if (remainingRatio <= 0.3) return theme.ringWarning
  return theme.ringGradient
}
