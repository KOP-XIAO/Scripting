// widget.tsx — 主屏幕小组件：最近下载一览 + 「＋」快速入口 + 角落刷新按钮
// 数据源：Storage 里的快照（vdl.widget.latest）——widget 扩展进程的
//   FileManager 目录与 App 不一致，读不到历史文件，Storage 是同脚本
//   跨进程共享的可靠通道（cmhk-usage 真机实证）。
// 点击行为：small 整个组件 widgetURL 跳回主脚本并自动读剪贴板；
//           medium 左侧信息同理，右侧「＋ 下载」为独立 Link 按钮。
// 全局对象（禁止从 scripting 导入）：Storage

import { Button, HStack, Image, Link, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import { getWidgetSnapshot, type WidgetSnapshot } from "./services/history"
import { ReloadWidgetIntent } from "./app_intents"
import { formatBytes, formatDate, formatDuration } from "./utils/common"

const SCRIPT_NAME = "Video Downloader"
// 官方构造器：scripting://run_single/<name>?autopaste=1
// run_single 保证每次点按都重新执行入口文件（autopaste 参数才会生效）
const RUN_URL = Script.createRunSingleURLScheme(SCRIPT_NAME, { autopaste: "1" })
const ACCENT = "rgba(88, 86, 214, 1)"

function LatestInfo({ latest, compact }: { latest: WidgetSnapshot | null; compact?: boolean }) {
  if (!latest) {
    return (
      <VStack alignment="leading" spacing={4}>
        <Text font="headline">暂无下载记录</Text>
        <Text font="caption" foregroundStyle="#8E8E93">
          复制视频链接后点下方按钮
        </Text>
      </VStack>
    )
  }
  const meta = [
    formatBytes(latest.bytes),
    formatDuration(latest.durationSec),
    formatDate(latest.createdAt).slice(5), // 去掉年份，省空间
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <VStack alignment="leading" spacing={4}>
      <Text font="headline" lineLimit={compact ? 1 : 2}>
        {latest.title || latest.fileName}
      </Text>
      <HStack spacing={6}>
        <Text font="caption" foregroundStyle="#8E8E93" lineLimit={1}>
          {meta}
        </Text>
        {latest.note.includes("相册") ? (
          <Text font="caption2" foregroundStyle={ACCENT}>
            已存相册
          </Text>
        ) : null}
      </HStack>
    </VStack>
  )
}

// 角落悬浮刷新按钮：plain 无底色；图标内缩避开圆角裁切（cmhk 真机教训）
function RefreshButton({ offsetX, offsetY }: { offsetX: number; offsetY: number }) {
  return (
    <Button intent={ReloadWidgetIntent(undefined)} buttonStyle="plain">
      <ZStack frame={{ width: 26, height: 26 }}>
        <Image
          systemName="arrow.clockwise"
          font={10}
          foregroundStyle="#8E8E93"
          frame={{ width: 10, height: 10 }}
          offset={{ x: offsetX, y: offsetY }}
        />
      </ZStack>
    </Button>
  )
}

function SmallView({ latest }: { latest: WidgetSnapshot | null }) {
  return (
    <ZStack alignment="topTrailing">
      <VStack alignment="leading" spacing={8} padding widgetURL={RUN_URL}>
        <HStack spacing={6}>
          <Image systemName="arrow.down.circle.fill" font={14} foregroundStyle={ACCENT} />
          <Text font="caption" fontWeight="semibold">
            视频下载器
          </Text>
        </HStack>
        <LatestInfo latest={latest} compact />
        <Spacer />
        {/* 大按钮入口：整个 small 组件可点，这里做大只是视觉引导 */}
        <HStack spacing={6}>
          <Image systemName="plus.circle.fill" font={24} foregroundStyle={ACCENT} />
          <Text font="subheadline" foregroundStyle={ACCENT} fontWeight="bold">
            粘贴链接下载
          </Text>
        </HStack>
      </VStack>
      {/* 右上角刷新，避开底部入口行 */}
      <RefreshButton offsetX={-3} offsetY={3} />
    </ZStack>
  )
}

function MediumView({ latest }: { latest: WidgetSnapshot | null }) {
  return (
    <ZStack alignment="bottomLeading">
      <HStack spacing={12} padding>
        <VStack alignment="leading" spacing={8} widgetURL={RUN_URL}>
          <HStack spacing={6}>
            <Image systemName="arrow.down.circle.fill" font={14} foregroundStyle={ACCENT} />
            <Text font="caption" fontWeight="semibold">
              视频下载器
            </Text>
          </HStack>
          <LatestInfo latest={latest} />
          <Spacer />
        </VStack>
        <Spacer />
        {/* 大添加按钮：独立 Link 目标，加大图标与热区 */}
        <VStack>
          <Spacer />
          <Link url={RUN_URL}>
            <HStack
              spacing={6}
              padding={{ leading: 18, trailing: 18, top: 12, bottom: 12 }}
            >
              <Image systemName="plus.circle.fill" font={22} foregroundStyle={ACCENT} />
              <Text font="title3" fontWeight="bold" foregroundStyle={ACCENT}>
                下载
              </Text>
            </HStack>
          </Link>
          <Spacer />
        </VStack>
      </HStack>
      {/* 左下角刷新：信息区下方空白角 */}
      <RefreshButton offsetX={3} offsetY={-3} />
    </ZStack>
  )
}

function run() {
  const latest = getWidgetSnapshot()
  const view = Widget.family === "systemMedium" ? (
    <MediumView latest={latest} />
  ) : (
    <SmallView latest={latest} />
  )
  Widget.present(view, {
    // 15 分钟重载一次兜底（iOS 按预算裁量）；主刷新靠 App 侧的 Widget.reloadAll()
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) },
  })
}

try {
  run()
} catch (e) {
  Widget.present(<Text padding>{String(e)}</Text>)
}
