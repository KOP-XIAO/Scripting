// widget.tsx — 主屏幕小组件（中号为主）：车次/航班号 · 出发到达 · 时间 · 倒计时 · 检票口/登机口 · 座位
// 数据源：Storage 里的本机行程（rail.trips，由 app 侧写入）——widget 扩展进程读不到 App
// 文档目录，Storage 是同脚本跨进程共享的可靠通道。
//
// 隐私：小组件只读本机 Storage，页面本身不含任何网络请求；不读取、不上传任何图片。
// 全局对象（禁止从 scripting 导入）：Storage

import { HStack, Image, RoundedRectangle, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import {
  countdownText,
  gateLabel,
  monthDayText,
  seatText,
  weekdayText,
  type TripMode,
} from "./services/parse"
import { getShowPassenger, nextTrip, type TripRecord } from "./services/trips"
import { getTheme } from "./services/theme"

const SCRIPT_NAME = "Trip Reminder"
// 官方构造器：scripting://run_single/<name>（保证每次点按都重新执行入口文件）
const RUN_URL = Script.createRunSingleURLScheme(SCRIPT_NAME)

const modeIcon = (m: TripMode) => (m === "flight" ? "airplane.departure" : "tram.fill")

function Badge({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <Text
      font="caption"
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
        打开脚本，用「从截图识别」导入火车票或机票截图即可
      </Text>
    </VStack>
  )
}

function TripBody({ trip, showPassenger }: { trip: TripRecord; showPassenger: boolean }) {
  const theme = getTheme()
  const countdown = countdownText(trip)
  const soon =
    countdown.includes("分钟") || countdown.includes("即将") || countdown === "行程中"
  return (
    <VStack alignment="leading" spacing={8}>
      {/* 抬头：号码徽标 + 承运人/车型 + 日期 */}
      <HStack spacing={6}>
        <Image systemName={modeIcon(trip.mode)} font={13} foregroundStyle={theme.accent} />
        <Badge text={trip.code || "—"} bg={theme.accent} fg="#FFFFFF" />
        {trip.carrier ? (
          <Text font="caption2" foregroundStyle={theme.warn} lineLimit={1}>
            {trip.carrier}
          </Text>
        ) : null}
        <Spacer />
        <Text font="caption" foregroundStyle={theme.sub}>
          {`${monthDayText(trip.departDate)} ${weekdayText(trip.departDate)}`.trim()}
        </Text>
      </HStack>

      {/* 时间与地点 */}
      <HStack spacing={10} frame={{ maxWidth: "infinity" } as never}>
        <VStack alignment="leading" spacing={1}>
          <Text font="title2" fontWeight="bold" monospaced foregroundStyle={theme.ink}>
            {trip.departTime || "--:--"}
          </Text>
          <Text font="caption" foregroundStyle={theme.ink} lineLimit={1}>
            {trip.fromPlace || "—"}
          </Text>
        </VStack>
        <Image systemName="arrow.right" font={13} foregroundStyle={theme.sub} />
        <VStack alignment="leading" spacing={1}>
          <Text font="title2" fontWeight="bold" monospaced foregroundStyle={theme.ink}>
            {trip.arriveTime || "--:--"}
          </Text>
          <Text font="caption" foregroundStyle={theme.ink} lineLimit={1}>
            {trip.toPlace || "—"}
          </Text>
        </VStack>
        <Spacer />
        <Text font="headline" fontWeight="bold" foregroundStyle={soon ? theme.warn : theme.accent} lineLimit={1}>
          {countdown}
        </Text>
      </HStack>

      {/* 闸口 / 座位 / 登机时间 / 乘客 */}
      <HStack spacing={10}>
        <HStack spacing={4}>
          <Image systemName="ticket.fill" font={11} foregroundStyle={theme.accent} />
          <Text font="caption" monospaced foregroundStyle={theme.ink}>
            {trip.gate ? `${gateLabel(trip.mode)} ${trip.gate}` : `${gateLabel(trip.mode)} —`}
          </Text>
        </HStack>
        {trip.mode === "flight" && trip.boardingTime ? (
          <Text font="caption" monospaced foregroundStyle={theme.warn}>
            {`登机 ${trip.boardingTime}`}
          </Text>
        ) : null}
        <Text font="caption" monospaced foregroundStyle={theme.ink}>
          {seatText(trip)}
        </Text>
        {showPassenger && trip.passenger ? (
          <Text font="caption" foregroundStyle={theme.sub} lineLimit={1}>
            {trip.passenger}
          </Text>
        ) : null}
        <Spacer />
      </HStack>
    </VStack>
  )
}

function MediumView() {
  const theme = getTheme()
  const trip = nextTrip()
  const showPassenger = getShowPassenger()
  return (
    <ZStack>
      <Background />
      <VStack
        alignment="leading"
        spacing={0}
        padding={16}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
        widgetURL={RUN_URL}
      >
        {trip ? <TripBody trip={trip} showPassenger={showPassenger} /> : <EmptyView />}
        <Spacer />
        <HStack spacing={4}>
          <RoundedRectangle frame={{ width: 18, height: 3 }} cornerRadius={1.5} fill={theme.accent} />
          <Text font="caption2" monospaced foregroundStyle={theme.sub}>
            本机数据 · 不联网
          </Text>
          <Spacer />
        </HStack>
      </VStack>
    </ZStack>
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
            <Text font="caption2" foregroundStyle={theme.warn} lineLimit={2}>
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
