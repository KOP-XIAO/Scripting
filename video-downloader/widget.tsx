// widget.tsx — 主屏幕小组件：主题化深色背景 + 最近下载 + 大「＋」入口 + 角落刷新
// 数据源：Storage 里的快照（vdl.widget.latest）；主题：Storage 里的 vdl.theme。
//   widget 扩展进程读不到 App 文档目录，Storage 是同脚本跨进程共享的可靠通道（cmhk 实证）。
// 背景：ZStack 底层 = 主题渐变 + 烘焙 PNG 纹理（assets/widget-bg-<主题>-<尺寸>.png）+
//   来源感水印（play/video 图标与 YT·IG·WX·XHS 字样，表达“下载各平台视频”）。
// 全局对象（禁止从 scripting 导入）：Storage

import { Button, HStack, Image, Link, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import { getWidgetSnapshot, type WidgetSnapshot, type WidgetSnapshotItem } from "./services/history"
import { getTheme } from "./services/theme"
import { formatBytes, formatDate, formatDuration } from "./utils/common"
import { ReloadWidgetIntent } from "./app_intents"

const SCRIPT_NAME = "Video Downloader"
// 官方构造器：scripting://run_single/<name>?autopaste=1
// run_single 保证每次点按都重新执行入口文件（autopaste 参数才会生效）
const RUN_URL = Script.createRunSingleURLScheme(SCRIPT_NAME, { autopaste: "1" })

const TEXT_PRIMARY = "#F0F3F6"
const TEXT_SECONDARY = "#9BA3AB"

const KIND_SHORT: Record<string, string> = {
  "wx-channels": "视频号",
  douyin: "抖音",
  m3u8: "M3U8",
  direct: "直链",
  platform: "平台",
}

function LatestInfo({
  item,
  lines,
  accent,
}: {
  item: WidgetSnapshotItem | null
  lines: number
  accent: string
}) {
  if (!item) {
    return (
      <VStack alignment="leading" spacing={4}>
        <Text font="subheadline" fontWeight="semibold" foregroundStyle={TEXT_PRIMARY}>
          暂无下载记录
        </Text>
        <Text font="caption" foregroundStyle={TEXT_SECONDARY}>
          复制视频链接后点下方按钮
        </Text>
      </VStack>
    )
  }
  const line1 = [formatBytes(item.bytes), formatDuration(item.durationSec)].filter(Boolean).join(" · ")
  return (
    <VStack alignment="leading" spacing={3}>
      <Text font="subheadline" fontWeight="semibold" lineLimit={lines} foregroundStyle={TEXT_PRIMARY}>
        {item.title || item.fileName}
      </Text>
      <Text font="caption2" monospaced foregroundStyle={TEXT_SECONDARY} lineLimit={1}>
        {line1}
      </Text>
      <HStack spacing={4}>
        <Text font="caption2" monospaced foregroundStyle={TEXT_SECONDARY} lineLimit={1}>
          {formatDate(item.createdAt).slice(5)}
        </Text>
        <Text font="caption2" monospaced foregroundStyle={accent} lineLimit={1}>
          {KIND_SHORT[item.kind] ?? item.kind}
        </Text>
      </HStack>
    </VStack>
  )
}

// 次近一条（一行简报）
function SecondRow({ item }: { item: WidgetSnapshotItem | null }) {
  if (!item) return null
  return (
    <HStack spacing={6}>
      <Image systemName="clock" font={9} foregroundStyle={TEXT_SECONDARY} />
      <Text font="caption2" foregroundStyle={TEXT_SECONDARY} lineLimit={1}>
        {`前一条：${item.title || item.fileName}`}
      </Text>
    </HStack>
  )
}

// 角落悬浮刷新按钮：plain 无底色；图标内缩避开圆角裁切（cmhk 真机教训）
function RefreshButton({ offsetX, offsetY, color }: { offsetX: number; offsetY: number; color: string }) {
  return (
    <Button intent={ReloadWidgetIntent(undefined)} buttonStyle="plain">
      <ZStack frame={{ width: 26, height: 26 }}>
        <Image
          systemName="arrow.clockwise"
          font={10}
          foregroundStyle={color}
          frame={{ width: 10, height: 10 }}
          offset={{ x: offsetX, y: offsetY }}
        />
      </ZStack>
    </Button>
  )
}

// 背景层：主题渐变打底 + 主题 PNG 纹理 + 散乱图标堆 + 底部平台字样
function BackgroundLayer({ family }: { family: "small" | "medium" }) {
  const theme = getTheme()
  return (
    <ZStack>
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
        background={{
          gradient: [
            { color: theme.bgTop, location: 0 },
            { color: theme.bgBottom, location: 1 },
          ],
          startPoint: { x: 0, y: 0 },
          endPoint: { x: 1, y: 1 },
        } as any}
      >
        <Spacer />
      </VStack>
      <Image
        filePath={`${Script.directory}/assets/widget-bg-${theme.key}-${family}.png`}
        resizable={true}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
        opacity={0.9}
      />
      {family === "medium" ? (
        <VStack alignment="trailing" padding={14} frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}>
          <Spacer />
          <Text font="caption2" monospaced foregroundStyle="rgba(255,255,255,0.10)">
            YT · IG · WX · XHS
          </Text>
        </VStack>
      ) : null}
    </ZStack>
  )
}

function SmallView({ snap }: { snap: WidgetSnapshot | null }) {
  const theme = getTheme()
  return (
    <ZStack alignment="topTrailing">
      <BackgroundLayer family="small" />
      <VStack alignment="leading" spacing={6} padding widgetURL={RUN_URL}>
        <HStack spacing={6}>
          <Image systemName="arrow.down.circle.fill" font={14} foregroundStyle={theme.accent} />
          <Text font="headline" fontWeight="bold" foregroundStyle={theme.accent} monospaced>
            Video Downloader
          </Text>
        </HStack>
        <VStack padding={{ top: 10 }}>
          <LatestInfo item={snap?.latest ?? null} lines={2} accent={theme.accent} />
        </VStack>
        <Spacer />
        <VStack padding={{ top: 6 }}>
          <SecondRow item={snap?.second ?? null} />
        </VStack>
        {/* 大按钮入口：整个 small 组件可点，这里做大是视觉引导 */}
        <HStack spacing={8}>
          <Image systemName="plus.circle.fill" font={28} foregroundStyle={theme.accent} />
          <Text font="headline" foregroundStyle={theme.accent} fontWeight="bold">
            粘贴链接下载
          </Text>
        </HStack>
      </VStack>
      {/* 右上角刷新，避开底部入口行 */}
      <RefreshButton offsetX={-3} offsetY={3} color={theme.accentSoft} />
    </ZStack>
  )
}

function MediumView({ snap }: { snap: WidgetSnapshot | null }) {
  const theme = getTheme()
  return (
    <ZStack alignment="bottomLeading">
      <BackgroundLayer family="medium" />
      <HStack spacing={10} padding>
        <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" } as never} widgetURL={RUN_URL}>
          <HStack spacing={6}>
            <Image systemName="arrow.down.circle.fill" font={14} foregroundStyle={theme.accent} />
            <Text font="headline" fontWeight="bold" foregroundStyle={theme.accent} monospaced>
              Video Downloader
            </Text>
          </HStack>
          <VStack padding={{ top: 12 }}>
            <LatestInfo item={snap?.latest ?? null} lines={2} accent={theme.accent} />
          </VStack>
          <VStack padding={{ top: 6 }}>
          <VStack padding={{ top: 6 }}>
            <SecondRow item={snap?.second ?? null} />
          </VStack>
        </VStack>
          <Spacer />
          </VStack>
        <Spacer />
        {/* 超大添加按钮：纯图标独占，热区拉满 */}
        <VStack>
          <Spacer />
          <Link url={RUN_URL}>
            <VStack padding={{ leading: 10, trailing: 10, top: 16, bottom: 16 }}>
              <Image systemName="plus.circle.fill" font={58} foregroundStyle={theme.accent} />
            </VStack>
          </Link>
          <Spacer />
        </VStack>
      </HStack>
      {/* 左下角刷新：信息区下方空白角 */}
      <RefreshButton offsetX={3} offsetY={-3} color={theme.accentSoft} />
    </ZStack>
  )
}

function run() {
  const snap = getWidgetSnapshot()
  const medium = Widget.family === "systemMedium"
  Widget.present(medium ? <MediumView snap={snap} /> : <SmallView snap={snap} />, {
    // 15 分钟重载兜底（iOS 按预算裁量）；主刷新靠 App 侧的 Widget.reloadAll()
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) },
  })
}

try {
  run()
} catch (e) {
  Widget.present(<Text padding>{String(e)}</Text>)
}
