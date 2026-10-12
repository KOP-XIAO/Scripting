// widget.tsx — 主屏幕小组件（中号为主）：车次/航班号 · 出发到达 · 时间 · 倒计时 · 检票口/登机口 · 座位
// 数据源：Storage 里的本机行程（rail.trips，由 app 侧写入）——widget 扩展进程读不到 App
// 文档目录，Storage 是同脚本跨进程共享的可靠通道。
//
// 隐私：小组件只读本机 Storage，页面本身不含任何网络请求；不读取、不上传任何图片。
// 全局对象（禁止从 scripting 导入）：Storage

import { GeometryReader, HStack, Image, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import {
  countdownText,
  departTimestamp,
  durationText,
  gateLabel,
  monthDayText,
  weekdayText,
  type TripMode,
} from "./services/parse"
import { nextTrip, type TripRecord } from "./services/trips"
import { getTheme } from "./services/theme"

const SCRIPT_NAME = "Trip Reminder"
// 官方构造器：scripting://run_single/<name>（保证每次点按都重新执行入口文件）
// 某些预览上下文里该 API 可能不可用，失败则退化为不带跳转
let RUN_URL = ""
try {
  RUN_URL = Script.createRunSingleURLScheme(SCRIPT_NAME)
} catch {}

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

function Background() {
  const theme = getTheme()
  return (
    <VStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
      background={{
        gradient: [
          { color: theme.cardTop, location: 0 },
          { color: theme.cardBottom, location: 1 },
        ],
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 1, y: 1 },
      } as any}
    >
      <Spacer />
    </VStack>
  )
}

function EmptyView() {
  const theme = getTheme()
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
function TripBody({ trip, width, height }: { trip: TripRecord; width: number; height: number }) {
  const theme = getTheme()
  const delta = departTimestamp(trip) - Date.now()
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
        <Badge text={trip.code || "—"} bg={theme.accent} fg="#FFFFFF" />
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
            <Text font="subheadline" fontWeight="semibold" foregroundStyle={soon ? theme.warn : theme.accent} lineLimit={1}>{countdownText(trip)}</Text><Spacer />
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
            <Text font="headline" fontWeight="bold" monospaced foregroundStyle={theme.ink} lineLimit={1}>{seat}</Text><Spacer />
          </HStack>
          <Spacer />
        </VStack>
      </HStack>
    </VStack>
  )
}

function MediumView() {
  const trip = nextTrip()
  // 内容区居中并保留安全边距；若宿主已扣除系统边距，则缩减额外内边距。
  return (
    <GeometryReader>
      {proxy => (
        <ZStack frame={{ width: proxy.size.width, height: proxy.size.height }} widgetURL={RUN_URL}>
          <Background />
          {trip ? (
            <TripBody trip={trip} width={Math.max(0, proxy.size.width - (proxy.size.height >= 150 ? 28 : 12))} height={Math.max(0, proxy.size.height - (proxy.size.height >= 150 ? 28 : 12))} />
          ) : (
            <VStack alignment="leading" padding={14}><EmptyView /></VStack>
          )}
        </ZStack>
      )}
    </GeometryReader>
  )
}

// 小号兜底（本脚本以中号为主）：号码 + 时间 + 倒计时，避免误加小号时白屏
function SmallView() {
  const theme = getTheme()
  const trip = nextTrip()
  return (
    <ZStack>
      <Background />
      <VStack
        alignment="leading"
        spacing={6}
        padding={14}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
        widgetURL={RUN_URL}
      >
        {trip ? (
          <VStack alignment="leading" spacing={4}>
            <HStack spacing={5}>
              <Image systemName={modeIcon(trip.mode)} font={11} foregroundStyle={theme.accent} />
              <Badge text={trip.code || "—"} bg={theme.accent} fg="#FFFFFF" />
            </HStack>
            <Text font="title3" fontWeight="bold" monospaced foregroundStyle={theme.ink}>
              {trip.departTime || "--:--"}
            </Text>
            <Text font="caption2" foregroundStyle={theme.ink} lineLimit={1}>
              {trip.fromPlace || "—"}
            </Text>
            <Text font="caption2" foregroundStyle={theme.warn} lineLimit={1}>
              {countdownText(trip)}
            </Text>
          </VStack>
        ) : (
          <Text font="caption" foregroundStyle={theme.sub}>
            请添加中号小组件
          </Text>
        )}
        <Spacer />
      </VStack>
    </ZStack>
  )
}

function run() {
  const medium = Widget.family === "systemMedium"
  Widget.present(medium ? <MediumView /> : <SmallView />, {
    // 倒计时按 5 分钟粒度重载（iOS 按预算裁量）；保存行程时 App 侧会主动 reloadAll
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 5 * 60 * 1000) },
  })
}

try {
  run()
} catch (e) {
  Widget.present(<Text padding>{String(e)}</Text>)
}
