import { GeometryReader, Image, RoundedRectangle, Script, Text, VStack, ZStack, useEffect, useState } from "scripting"
import { getTheme } from "../services/theme"

// 原生插值只更新三个关键位置；缺少 Animation 时用同一轨迹的 30fps 时钟。
declare const Animation: any
const native = typeof Animation !== "undefined"
  && typeof Animation.easeOut === "function" && typeof Animation.easeIn === "function"
  ? Animation : null

// 完成反馈：提示音 + 触感。AVPlayer / SharedAudioSession / HapticFeedback 均为全局对象
// （生产范本验证：从 "scripting" 导入会静默拿到 undefined），不可用时静默降级。
declare const AVPlayer: any
declare const SharedAudioSession: any
declare const HapticFeedback: any

export function playCompletionFeedback() {
  try {
    if (typeof HapticFeedback !== "undefined" && typeof HapticFeedback.notificationSuccess === "function") {
      HapticFeedback.notificationSuccess()
    }
  } catch {}
  try {
    if (typeof AVPlayer === "undefined") return
    const player = new AVPlayer()
    try {
      // ambient：尊重静音开关并与其他 App 音频混流
      const p = SharedAudioSession?.setCategory?.("ambient", ["mixWithOthers"])
      if (p && typeof p.catch === "function") p.catch(() => {})
    } catch {}
    if (player.setSource(`${Script.directory}/assets/success-chime.wav`)) {
      player.volume = 0.9
      player.onReadyToPlay = () => player.play()
      player.onEnded = () => { try { player.dispose() } catch {} }
      player.onError = () => { try { player.dispose() } catch {} }
    } else {
      try { player.dispose() } catch {}
    }
  } catch {}
}
export const CONFETTI_MS = 2400
const APEX = 0.48
const LAND = 2.1
const clamp = (n: number) => Math.max(0, Math.min(1, n))

type Piece = {
  side: number; spread: number; lift: number; drift: number
  width: number; height: number; angle: number; spin: number; color: string
}

export function newConfettiPieces(accent: string): Piece[] {
  const colors = [accent, "#FFD166", "#FF6B86", "#66D9EF", "#B794F6"]
  return Array.from({ length: 40 }, (_, i) => ({
    side: i % 2 ? 1 : -1,
    spread: (Math.random() - 0.5) * 0.78,
    lift: 0.65 + Math.random() * 0.35,
    drift: (Math.random() - 0.5) * 0.12,
    width: 9 + Math.random() * 7,
    height: i % 4 === 0 ? 11 : 18 + Math.random() * 12,
    angle: Math.random() * 180,
    spin: (i % 2 ? 1 : -1) * (240 + Math.random() * 360),
    color: colors[i % colors.length],
  }))
}

export function confettiPosition(p: Piece, time: number, width: number, height: number) {
  const rise = clamp(time / APEX)
  const fall = clamp((time - APEX) / (LAND - APEX))
  const launchX = p.side * width * 0.38
  const apexX = p.spread * width
  const launchY = height * 0.14
  const apexY = launchY - Math.min(height * 0.4, 250) * p.lift
  const up = 1 - (1 - rise) ** 2
  return {
    x: launchX + (apexX - launchX) * up + p.drift * width * fall,
    y: launchY + (apexY - launchY) * up + (height * 0.58 - apexY) * fall ** 2,
    angle: p.angle + p.spin * clamp(time / LAND),
  }
}

export function ConfettiScene({ width, height, onFinish }: {
  width: number; height: number; onFinish: () => void
}) {
  const [theme] = useState(getTheme)
  const [pieces] = useState(() => newConfettiPieces(theme.accent))
  const [time, setTime] = useState(0)
  const [exiting, setExiting] = useState(false)
  useEffect(() => {
    playCompletionFeedback()
    const timers: ReturnType<typeof setTimeout>[] = []
    let interval: ReturnType<typeof setInterval> | undefined
    if (native) {
      timers.push(setTimeout(() => setTime(APEX), 40))
      timers.push(setTimeout(() => setTime(LAND), 520))
      timers.push(setTimeout(() => setExiting(true), 1900))
    } else {
      const started = Date.now()
      interval = setInterval(() => setTime(Math.min(CONFETTI_MS, Date.now() - started) / 1000), 33)
    }
    timers.push(setTimeout(() => {
      if (interval !== undefined) clearInterval(interval)
      onFinish()
    }, CONFETTI_MS))
    return () => {
      timers.forEach(clearTimeout)
      if (interval !== undefined) clearInterval(interval)
    }
  }, [])

  const fade = native ? (exiting ? 0 : 1) : 1 - clamp((time - 1.9) / 0.45)
  const enter = native ? (time > 0 ? 1 : 0) : 1 - (1 - clamp(time / 0.35)) ** 3
  const motion = native ? {
    animation: time <= APEX ? native.easeOut(APEX) : native.easeIn(LAND - APEX), value: time,
  } : undefined
  return (
    <ZStack frame={{ width, height }} opacity={fade}
      animation={native ? { animation: native.easeOut(0.45), value: fade } : undefined}>
      {pieces.map((piece, i) => {
        const p = confettiPosition(piece, time, width, height)
        return <RoundedRectangle key={i} cornerRadius={3} fill={piece.color}
          frame={{ width: piece.width, height: piece.height }}
          rotationEffect={p.angle} offset={{ x: p.x, y: p.y }} animation={motion} />
      })}
      {/* 提示绘制在纸屑上层，不晃动，也不使用全屏遮罩。 */}
      <VStack spacing={10} padding={22}
        background={theme.bgTop}
        clipShape={{ type: "rect", cornerRadius: 20, style: "continuous" }}
        opacity={enter} scaleEffect={0.9 + enter * 0.1} offset={{ x: 0, y: (1 - enter) * 14 }}
        animation={native ? { animation: native.easeOut(0.35), value: enter } : undefined}>
        <Image systemName="checkmark.circle.fill" font={52} foregroundStyle={theme.accent} />
        <Text font="title2" foregroundStyle="#F0F3F6">下载完成</Text>
      </VStack>
    </ZStack>
  )
}

export function ConfettiOverlay({ onFinish }: { onFinish: () => void }) {
  return <GeometryReader>
    {proxy => <ConfettiScene width={proxy.size.width} height={proxy.size.height} onFinish={onFinish} />}
  </GeometryReader>
}
