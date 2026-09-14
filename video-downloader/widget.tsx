// widget.tsx — 主屏幕小组件：最近下载一览 + 「＋」快速入口
// 点击行为：small 整个组件通过 widgetURL 跳回主脚本并自动读剪贴板；
//           medium 左侧信息同理，右侧「＋ 下载」按钮为独立 Link。
// URL scheme：scripting://run_single/<脚本名>?autopaste=1
//   —— run_single 保证每次点按都重新执行入口文件（autopaste 才会生效）。
//   —— <脚本名> 取 script.json 的 name 字段；若真机点按无反应，检查此处名称是否一致。
// 全局对象（禁止从 scripting 导入）：FileManager

import { Button, HStack, Image, Link, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import { initDatabase, listHistory, type HistoryRecord } from "./services/history"
import { formatBytes, formatDate, formatDuration } from "./utils/common"
import { ReloadWidgetIntent } from "./app_intents"

const SCRIPT_NAME = "Video Downloader"
// 官方构造器：scripting://run_single/<name>?autopaste=1
// run_single 保证每次点按都重新执行入口文件（autopaste 参数才会生效）
const RUN_URL = Script.createRunSingleURLScheme(SCRIPT_NAME, { autopaste: "1" })
const ACCENT = "rgba(88, 86, 214, 1)"

async function getLatest(): Promise<HistoryRecord | null> {
  try {
    await initDatabase()
    const list = await listHistory(1)
    return list[0] ?? null
  } catch {
    return null
  }
}

function LatestInfo({ latest, compact }: { latest: HistoryRecord | null; compact?: boolean }) {
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
    formatBytes(latest.bytes_written),
    formatDuration(latest.duration_sec ?? 0),
    formatDate(latest.created_at).slice(5), // 去掉年份，省空间
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <VStack alignment="leading" spacing={4}>
      <Text font="headline" lineLimit={compact ? 1 : 2}>
        {latest.title || latest.file_name}
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
      <ZStack frame={{ width: 24, height: 24 }}>
        <Image
          systemName="arrow.clockwise"
          font={9}
          foregroundStyle="#8E8E93"
          frame={{ width: 9, height: 9 }}
          offset={{ x: offsetX, y: offsetY }}
        />
      </ZStack>
    </Button>
  )
}

function SmallView({ latest }: { latest: HistoryRecord | null }) {
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
        <HStack spacing={4}>
          <Image systemName="plus.circle.fill" font={16} foregroundStyle={ACCENT} />
          <Text font="caption" foregroundStyle={ACCENT} fontWeight="semibold">
            粘贴链接下载
          </Text>
        </HStack>
      </VStack>
      {/* 右上角：避开底部「＋」行 */}
      <RefreshButton offsetX={-3} offsetY={3} />
    </ZStack>
  )
}

function MediumView({ latest }: { latest: HistoryRecord | null }) {
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
        <VStack>
          <Spacer />
          <Link url={RUN_URL}>
            <HStack spacing={4} padding={{ leading: 14, trailing: 14, top: 8, bottom: 8 }}>
              <Image systemName="plus" font={12} foregroundStyle={ACCENT} />
              <Text font="subheadline" fontWeight="semibold" foregroundStyle={ACCENT}>
                下载
              </Text>
            </HStack>
          </Link>
          <Spacer />
        </VStack>
      </HStack>
      {/* 左下角：信息区下方的空白角 */}
      <RefreshButton offsetX={3} offsetY={-3} />
    </ZStack>
  )
}

async function run() {
  const latest = await getLatest()
  const view = Widget.family === "systemMedium" ? (
    <MediumView latest={latest} />
  ) : (
    <SmallView latest={latest} />
  )
  Widget.present(view, {
    // 15 分钟重载一次，让"最近下载"保持新鲜（iOS 实际按预算裁量）
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) },
  })
}

run().catch((e) => {
  Widget.present(<Text padding>{String(e)}</Text>)
})
