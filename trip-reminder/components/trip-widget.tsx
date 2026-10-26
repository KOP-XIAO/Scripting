// 首页、设置预览与中号小组件共用布局、背景、字号及间距。
import { GeometryReader, HStack, Image, PathShape, Spacer, Text, VStack, ZStack } from "scripting"
import { countdownText, departTimestamp, durationText, gateLabel, isDepartureToday, monthDayText, weekdayText, type TripMode } from "../services/parse"
import { displaySeat, getHideSeatNumber, type TripRecord } from "../services/trips"
import { type Theme } from "../services/theme"
import { railJourneyStops } from "../services/rail-stops"
import { ThemeBackground } from "./theme-background"

const modeIcon = (m: TripMode) => (m === "flight" ? "airplane.departure" : "tram.fill")

export function TripBadge({ trip, theme, now = Date.now() }: { trip: { code: string; departDate: string }; theme: Theme; now?: number }) {
  const today = isDepartureToday(trip.departDate, now)
  return (
    <Text
      font="headline"
      fontWeight={today ? "bold" : "semibold"}
      fontDesign={today ? "rounded" : "monospaced"}
      foregroundStyle={today ? theme.badgeInk ?? "#FFFFFF" : theme.ink}
      padding={{ top: 2, bottom: 2, leading: 6, trailing: 6 }}
      background={today ? theme.accent : theme.accentSoft}
      clipShape={{ type: "rect", cornerRadius: 6, style: "continuous" }}
      lineLimit={1}
    >
      {trip.code || "—"}
    </Text>
  )
}

function EmptyView({ theme }: { theme: Theme }) {
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={6}>
        <Image systemName="tram.fill" font={14} foregroundStyle={theme.accent} />
        <Image systemName="airplane.departure" font={14} foregroundStyle={theme.accent} />
        <Text font="headline" fontWeight="bold" foregroundStyle={theme.ink} monospaced>
          TRIP REMINDER
        </Text>
      </HStack>
      <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.ink}>
        暂无行程
      </Text>
      <Text font="caption" foregroundStyle={theme.sub} lineLimit={2}>
        打开脚本，用「从相册选行程截图识别」导入火车票或机票截图即可
      </Text>
    </VStack>
  )
}

// 使用有界内容区，避免嵌套 infinity frame 与 padding 争抢可用高度。
function TripBody({ trip, theme, width, height, now, hideSeatNumber }: { trip: TripRecord; theme: Theme; width: number; height: number; now: number; hideSeatNumber: boolean }) {
  const delta = departTimestamp(trip) - now
  const soon = delta >= 0 && delta < 3600000
  const today = isDepartureToday(trip.departDate, now)
  const journeyDuration = durationText(trip)
  // 预留中英文字宽；长文案用原生缩字兜底，左右列始终等宽。
  const durationUnits = Array.from(journeyDuration).reduce((sum, char) => sum + (char === " " ? 0.35 : char.charCodeAt(0) < 128 ? 0.6 : 1), 0)
  const durationInkWidth = Math.ceil(durationUnits * 11)
  const durationWidth = Math.min(Math.max(64, durationInkWidth + 12), Math.floor(width * 0.34))
  const endpointWidth = Math.max(0, (width - durationWidth - 16) / 2)
  const arrowWidth = Math.max(0, Math.min(durationWidth - 12, Math.max(46, Math.round(durationInkWidth * 0.9))))
  const seat = hideSeatNumber ? "已隐藏" : displaySeat({ ...trip, seatClass: "" }, false)
  const intermediateStops = railJourneyStops(trip).slice(1, -1)
  const showStops = intermediateStops.length > 0 && width >= 200 && height >= 112
  const footerHeight = showStops ? 34 : 48
  // 各列明确分宽，不能让第一列的 infinity frame 将内容推到中间。
  const countdownWidth = Math.floor(width * 0.44)
  const gateWidth = Math.floor(width * 0.19)
  const seatWidth = Math.max(0, width - countdownWidth - gateWidth - 16)
  return (
    <VStack alignment="leading" spacing={0} frame={{ width, height }}>
      <HStack spacing={6} frame={{ width, height: 24 }}>
        <Image systemName={modeIcon(trip.mode)} font={14} foregroundStyle={theme.accent} />
        <TripBadge trip={trip} theme={theme} now={now} />
        {trip.carrier ? <Text font="caption2" foregroundStyle={theme.sub} lineLimit={1}>{trip.carrier}</Text> : null}
        <Spacer />
        <Text font="caption2" fontWeight={today ? "semibold" : "regular"} foregroundStyle={today ? theme.accent : theme.sub} lineLimit={1}>
          {today ? `今天 · ${monthDayText(trip.departDate)}` : `${monthDayText(trip.departDate)} ${weekdayText(trip.departDate)}`.trim()}
        </Text>
      </HStack>
      <Spacer />
      <HStack spacing={8} frame={{ width, height: 40 }}>
        <VStack alignment="leading" spacing={4} frame={{ width: endpointWidth, height: 40 }}>
          <HStack spacing={0} frame={{ width: endpointWidth, height: 20 }}>
            <Text font="headline" fontWeight="semibold" monospaced foregroundStyle={theme.ink} lineLimit={1}>{trip.departTime || "--:--"}</Text><Spacer />
          </HStack>
          <HStack spacing={0} frame={{ width: endpointWidth, height: 16 }}>
            <Text font="caption" foregroundStyle={theme.ink} lineLimit={1}>{trip.fromPlace || "未填出发地"}</Text><Spacer />
          </HStack>
        </VStack>
        <VStack alignment="center" spacing={4} frame={{ width: durationWidth, height: 40 }}>
          <Text font={11} foregroundStyle={theme.sub} lineLimit={1} minScaleFactor={0.75}
            multilineTextAlignment="center" frame={{ width: durationWidth, height: 20, alignment: "center" }}>{journeyDuration}</Text>
          <PathShape frame={{ width: arrowWidth, height: 16 }}
            stroke={{ shapeStyle: theme.accent, strokeStyle: { lineWidth: 1.3, lineCap: "round", lineJoin: "round" } }}
            draw={(path, size) => {
              if (size.width < 20) return
              const span = size.width - 12
              const point = (t: number) => ({ x: 9.5 + span * t, y: 9 - 14 * t * (1 - t) })
              path.addEllipse({ x: 1, y: 6.5, width: 5, height: 5 })
              // All segments follow the same arc; gaps suggest a journey without extra labels.
              for (const [a, b] of [[0, 0.13], [0.23, 0.36], [0.46, 1]]) {
                const start = point(a)
                path.move(start)
                path.addQuadCurve(point(b), {
                  x: start.x + span * (b - a) / 2,
                  y: start.y + (-14 + 28 * a) * (b - a) / 2,
                })
              }
              const tip = point(1)
              const angle = Math.atan2(14, span)
              const dx = Math.cos(angle), dy = Math.sin(angle)
              path.move({ x: tip.x - 5 * dx + 3 * dy, y: tip.y - 5 * dy - 3 * dx })
              path.addLine(tip)
              path.addLine({ x: tip.x - 5 * dx - 3 * dy, y: tip.y - 5 * dy + 3 * dx })
            }} />
        </VStack>
        <VStack alignment="trailing" spacing={4} frame={{ width: endpointWidth, height: 40 }}>
          <HStack spacing={0} frame={{ width: endpointWidth, height: 20 }}>
            <Spacer /><Text font="headline" fontWeight="semibold" monospaced foregroundStyle={theme.ink} lineLimit={1}>{trip.arriveTime || "--:--"}</Text>
          </HStack>
          <HStack spacing={0} frame={{ width: endpointWidth, height: 16 }}>
            <Spacer /><Text font="caption" foregroundStyle={theme.ink} lineLimit={1}>{trip.toPlace || "未填到达地"}</Text>
          </HStack>
        </VStack>
      </HStack>
      <Spacer />
      {/* 三栏同高；每个标签、数值所在行同高，座别不再改变基线。 */}
      <HStack spacing={8} frame={{ width, height: footerHeight }}>
        <VStack alignment="leading" spacing={0} frame={{ width: countdownWidth, height: footerHeight }}>
          <HStack spacing={0} frame={{ width: countdownWidth, height: 13 }}>
            <Text font="caption2" foregroundStyle={theme.sub}>距出发</Text><Spacer />
          </HStack>
          <HStack spacing={0} frame={{ width: countdownWidth, height: 21 }}>
            <Text font="subheadline" fontWeight="semibold" foregroundStyle={soon ? theme.warn : theme.accent} lineLimit={1}>{countdownText(trip, now)}</Text><Spacer />
          </HStack>
          {!showStops ? <HStack spacing={0} frame={{ width: countdownWidth, height: 14 }}>
            {trip.mode === "flight" && trip.boardingTime ? <Text font="caption2" foregroundStyle={theme.sub}>{`登机 ${trip.boardingTime}`}</Text> : null}<Spacer />
          </HStack> : null}
        </VStack>
        <VStack alignment="leading" spacing={0} frame={{ width: gateWidth, height: footerHeight }}>
          <HStack spacing={0} frame={{ width: gateWidth, height: 13 }}>
            <Text font="caption2" foregroundStyle={theme.sub}>{gateLabel(trip.mode)}</Text><Spacer />
          </HStack>
          <HStack spacing={0} frame={{ width: gateWidth, height: 21 }}>
            <Text font="headline" fontWeight="bold" monospaced foregroundStyle={theme.warn} lineLimit={1}>{trip.gate || "—"}</Text><Spacer />
          </HStack>
          <Spacer />
        </VStack>
        <VStack alignment="trailing" spacing={0} frame={{ width: seatWidth, height: footerHeight }}>
          <HStack spacing={0} frame={{ width: seatWidth, height: 13 }}>
            <Spacer /><Text font="caption2" foregroundStyle={theme.sub} lineLimit={1}>{trip.seatClass ? `座位｜${trip.seatClass}` : "座位"}</Text>
          </HStack>
          <HStack spacing={0} frame={{ width: seatWidth, height: 21 }}>
            <Spacer /><Text font="headline" fontWeight="bold" monospaced foregroundStyle={theme.accent} lineLimit={1}>{seat}</Text>
          </HStack>
          <Spacer />
        </VStack>
      </HStack>
      {showStops ? <HStack spacing={0} frame={{ width, height: 14 }}>
        <Text font={11} foregroundStyle={theme.sub} lineLimit={1}>
          {`已识别经停 ${intermediateStops.length} 站 · ${intermediateStops.map(stop => stop.station).join(" · ")}`}
        </Text>
        <Spacer />
      </HStack> : null}
    </VStack>
  )
}

// 固定高度放在外层容器，GeometryReader 只读取可用宽度。
export function TripWidgetPreview({ trip, theme, now, hideSeatNumber }: {
  trip: TripRecord | null; theme: Theme; now: number; hideSeatNumber: boolean
}) {
  return <VStack spacing={0} frame={{ height: 158 }} clipShape={{ type: "rect", cornerRadius: 16, style: "continuous" }}>
    <GeometryReader>
      {proxy => <TripWidget trip={trip} theme={theme} width={proxy.size.width} height={158} now={now} hideSeatNumber={hideSeatNumber} />}
    </GeometryReader>
  </VStack>
}

export function TripWidget({ trip, theme, width, height, now = Date.now(), widgetURL, hideSeatNumber = getHideSeatNumber() }: {
  trip: TripRecord | null; theme: Theme; width: number; height: number; now?: number; widgetURL?: string; hideSeatNumber?: boolean
}) {
  // 宿主扣除系统边距后高度较小时，减少额外内边距。
  const inset = height >= 150 ? 28 : 12
  return (
    <ZStack frame={{ width, height }} widgetURL={widgetURL}>
      <VStack frame={{ width, height }} background={<ThemeBackground theme={theme} />}><Spacer /></VStack>
      {trip ? <TripBody trip={trip} theme={theme} width={Math.max(0, width - inset)} height={Math.max(0, height - inset)} now={now} hideSeatNumber={hideSeatNumber} />
        : <VStack alignment="leading" padding={14}><EmptyView theme={theme} /></VStack>}
    </ZStack>
  )
}
