// 中号小组件与设置预览共用布局、背景、字号及间距。
import { HStack, Image, Spacer, Text, VStack, ZStack } from "scripting"
import { countdownText, departTimestamp, durationText, gateLabel, monthDayText, weekdayText, type TripMode } from "../services/parse"
import { type TripRecord } from "../services/trips"
import { type Theme } from "../services/theme"
import { ThemeBackground } from "./theme-background"

const modeIcon = (m: TripMode) => (m === "flight" ? "airplane.departure" : "tram.fill")

function Badge({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <Text
      font="headline"
      fontWeight="bold"
      monospaced
      foregroundStyle={fg}
      padding={{ top: 2, bottom: 2, leading: 6, trailing: 6 }}
      background={bg}
      clipShape={{ type: "rect", cornerRadius: 6, style: "continuous" }}
    >
      {text}
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
function TripBody({ trip, theme, width, height, now }: { trip: TripRecord; theme: Theme; width: number; height: number; now: number }) {
  const delta = departTimestamp(trip) - now
  const soon = delta >= 0 && delta < 3600000
  const seat = trip.mode === "flight"
    ? trip.seatNo || "—"
    : [trip.seatCar ? `${trip.seatCar}车` : "", trip.seatNo].filter(Boolean).join(" ") || "—"
  // 各列明确分宽，不能让第一列的 infinity frame 将内容推到中间。
  const countdownWidth = Math.floor(width * 0.44)
  const gateWidth = Math.floor(width * 0.19)
  const seatWidth = Math.max(0, width - countdownWidth - gateWidth - 16)
  return (
    <VStack alignment="leading" spacing={0} frame={{ width, height }}>
      <HStack spacing={6} frame={{ width, height: 24 }}>
        <Image systemName={modeIcon(trip.mode)} font={14} foregroundStyle={theme.accent} />
        <Badge text={trip.code || "—"} bg={theme.accent} fg={theme.badgeInk ?? "#FFFFFF"} />
        {trip.carrier ? <Text font="caption2" foregroundStyle={theme.sub} lineLimit={1}>{trip.carrier}</Text> : null}
        <Spacer />
        <Text font="caption2" foregroundStyle={theme.sub} lineLimit={1}>
          {`${monthDayText(trip.departDate)} ${weekdayText(trip.departDate)}`.trim()}
        </Text>
      </HStack>
      <Spacer />
      <VStack alignment="leading" spacing={4} frame={{ width, height: 40 }}>
        <HStack spacing={5}>
          <Text font="headline" fontWeight="semibold" monospaced foregroundStyle={theme.ink}>{trip.departTime || "--:--"}</Text>
          <Image systemName="arrow.right" font={10} foregroundStyle={theme.sub} />
          <Text font="headline" fontWeight="semibold" monospaced foregroundStyle={theme.ink}>{trip.arriveTime || "--:--"}</Text>
          <Text font="caption2" foregroundStyle={theme.sub} lineLimit={1}>{`｜${durationText(trip)}`}</Text>
          <Spacer />
        </HStack>
        <HStack spacing={5}>
          <Text font="caption" foregroundStyle={theme.ink} lineLimit={1}>{trip.fromPlace || "未填出发地"}</Text>
          <Image systemName="arrow.right" font={10} foregroundStyle={theme.sub} />
          <Text font="caption" foregroundStyle={theme.ink} lineLimit={1}>{trip.toPlace || "未填到达地"}</Text>
          <Spacer />
        </HStack>
      </VStack>
      <Spacer />
      {/* 三栏同高；每个标签、数值所在行同高，座别不再改变基线。 */}
      <HStack spacing={8} frame={{ width, height: 48 }}>
        <VStack alignment="leading" spacing={0} frame={{ width: countdownWidth, height: 48 }}>
          <HStack spacing={0} frame={{ width: countdownWidth, height: 13 }}>
            <Text font="caption2" foregroundStyle={theme.sub}>距出发</Text><Spacer />
          </HStack>
          <HStack spacing={0} frame={{ width: countdownWidth, height: 21 }}>
            <Text font="subheadline" fontWeight="semibold" foregroundStyle={soon ? theme.warn : theme.accent} lineLimit={1}>{countdownText(trip, now)}</Text><Spacer />
          </HStack>
          <HStack spacing={0} frame={{ width: countdownWidth, height: 14 }}>
            {trip.mode === "flight" && trip.boardingTime ? <Text font="caption2" foregroundStyle={theme.sub}>{`登机 ${trip.boardingTime}`}</Text> : null}<Spacer />
          </HStack>
        </VStack>
        <VStack alignment="leading" spacing={0} frame={{ width: gateWidth, height: 48 }}>
          <HStack spacing={0} frame={{ width: gateWidth, height: 13 }}>
            <Text font="caption2" foregroundStyle={theme.sub}>{gateLabel(trip.mode)}</Text><Spacer />
          </HStack>
          <HStack spacing={0} frame={{ width: gateWidth, height: 21 }}>
            <Text font="headline" fontWeight="bold" monospaced foregroundStyle={theme.warn} lineLimit={1}>{trip.gate || "—"}</Text><Spacer />
          </HStack>
          <Spacer />
        </VStack>
        <VStack alignment="leading" spacing={0} frame={{ width: seatWidth, height: 48 }}>
          <HStack spacing={0} frame={{ width: seatWidth, height: 13 }}>
            <Text font="caption2" foregroundStyle={theme.sub} lineLimit={1}>{trip.seatClass ? `座位｜${trip.seatClass}` : "座位"}</Text><Spacer />
          </HStack>
          <HStack spacing={0} frame={{ width: seatWidth, height: 21 }}>
            <Text font="headline" fontWeight="bold" monospaced foregroundStyle={theme.accent} lineLimit={1}>{seat}</Text><Spacer />
          </HStack>
          <Spacer />
        </VStack>
      </HStack>
    </VStack>
  )
}

export function TripWidget({ trip, theme, width, height, now = Date.now(), widgetURL }: {
  trip: TripRecord | null; theme: Theme; width: number; height: number; now?: number; widgetURL?: string
}) {
  // 宿主扣除系统边距后高度较小时，减少额外内边距。
  const inset = height >= 150 ? 28 : 12
  return (
    <ZStack frame={{ width, height }} widgetURL={widgetURL}>
      <VStack frame={{ width, height }} background={<ThemeBackground theme={theme} />}><Spacer /></VStack>
      {trip ? <TripBody trip={trip} theme={theme} width={Math.max(0, width - inset)} height={Math.max(0, height - inset)} now={now} />
        : <VStack alignment="leading" padding={14}><EmptyView theme={theme} /></VStack>}
    </ZStack>
  )
}
