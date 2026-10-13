// widget.tsx — 主屏幕小组件（中号为主）：车次/航班号 · 出发到达 · 时间 · 倒计时 · 检票口/登机口 · 座位
// 数据源：Storage 里的本机行程（rail.trips，由 app 侧写入）——widget 扩展进程读不到 App
// 文档目录，Storage 是同脚本跨进程共享的可靠通道。
//
// 隐私：小组件只读本机 Storage，页面本身不含任何网络请求；不读取、不上传任何图片。
// 全局对象（禁止从 scripting 导入）：Storage

import { GeometryReader, HStack, Image, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import {
  countdownText,
  type TripMode,
} from "./services/parse"
import { nextTrip } from "./services/trips"
import { getTheme } from "./services/theme"
import { TripWidget } from "./components/trip-widget"

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
  if (theme.backgroundAsset) {
    return (
      <Image
        filePath={`${Script.directory}/assets/${theme.backgroundAsset}`}
        resizable={true}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
      />
    )
  }
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

function MediumView() {
  const trip = nextTrip()
  const theme = getTheme()
  const now = Date.now()
  return (
    <GeometryReader>
      {proxy => <TripWidget trip={trip} theme={theme} width={proxy.size.width} height={proxy.size.height} now={now} widgetURL={RUN_URL} />}
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
              <Badge text={trip.code || "—"} bg={theme.accent} fg={theme.badgeInk ?? "#FFFFFF"} />
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
