// widget.tsx — 主屏幕小组件：深色终端风背景 + 最近下载 + 大「＋」入口 + 角落刷新
// 数据源：Storage 里的快照（vdl.widget.latest）——widget 扩展进程的
//   FileManager 目录与 App 不一致，Storage 是同脚本跨进程共享的可靠通道（cmhk 实证）。
// 背景：ZStack 底层 = 渐变 + 烘焙的 PNG 纹理（assets/widget-bg-*.png），
//   装饰与背景同层、内容在最上（cmhk v1.19.8 层级教训）。
// 全局对象（禁止从 scripting 导入）：Storage

import { Button, HStack, Image, Link, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import { getWidgetSnapshot, type WidgetSnapshot } from "./services/history"
import { formatBytes, formatDate, formatDuration } from "./utils/common"
import { ReloadWidgetIntent } from "./app_intents"

const SCRIPT_NAME = "Video Downloader"
// 官方构造器：scripting://run_single/<name>?autopaste=1
// run_single 保证每次点按都重新执行入口文件（autopaste 参数才会生效）
const RUN_URL = Script.createRunSingleURLScheme(SCRIPT_NAME, { autopaste: "1" })

// 终端绿配色（与 App 内日志卡同色系）
const THEME = {
  accent: "#8B85FF",
  accentSoft: "rgba(139, 133, 255, 0.55)",
  textPrimary: "#F0F3F6",
  textSecondary: "#9BA3AB",
  bgGradient: {
    gradient: [
      { color: "#100F1C", location: 0 },
      { color: "#191436", location: 1 },
    ],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  } as const,
}

function LatestInfo({ latest, compact }: { latest: WidgetSnapshot | null; compact?: boolean }) {
  if (!latest) {
    return (
      <VStack alignment="leading" spacing={4}>
        <Text font="headline" foregroundStyle={THEME.textPrimary}>
          暂无下载记录
        </Text>
        <Text font="caption" foregroundStyle={THEME.textSecondary}>
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
      <Text font="headline" lineLimit={compact ? 1 : 2} foregroundStyle={THEME.textPrimary}>
        {latest.title || latest.fileName}
      </Text>
      <HStack spacing={6}>
        <Text font="caption" monospaced foregroundStyle={THEME.textSecondary} lineLimit={1}>
          {meta}
        </Text>
        {latest.note.includes("相册") ? (
          <Text font="caption2" foregroundStyle={THEME.accent}>
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
          foregroundStyle={THEME.accentSoft}
          frame={{ width: 10, height: 10 }}
          offset={{ x: offsetX, y: offsetY }}
        />
      </ZStack>
    </Button>
  )
}

// 背景层：渐变打底 + PNG 纹理（点阵/扫描线/柔光）+ 大号半透明水印图标
function BackgroundLayer({ family }: { family: "small" | "medium" }) {
  return (
    <ZStack>
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never} background={THEME.bgGradient as any}>
        <Spacer />
      </VStack>
      <Image
        filePath={`${Script.directory}/assets/widget-bg-${family}.png`}
        resizable={true}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
        opacity={0.9}
      />
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}>
        <Spacer />
        <HStack frame={{ maxWidth: "infinity" } as never}>
          <Spacer />
          <Image
            systemName="arrow.down.circle.fill"
            font={family === "medium" ? 90 : 70}
            foregroundStyle="rgba(255,255,255,0.05)"
          />
        </HStack>
      </VStack>
    </ZStack>
  )
}

function SmallView({ latest }: { latest: WidgetSnapshot | null }) {
  return (
    <ZStack alignment="topTrailing">
      <BackgroundLayer family="small" />
      <VStack alignment="leading" spacing={8} padding widgetURL={RUN_URL}>
        <HStack spacing={6}>
          <Image systemName="arrow.down.circle.fill" font={14} foregroundStyle={THEME.accent} />
          <Text font="caption" fontWeight="semibold" foregroundStyle={THEME.textPrimary} monospaced>
            视频下载器
          </Text>
        </HStack>
        <LatestInfo latest={latest} compact />
        <Spacer />
        {/* 大按钮入口：整个 small 组件可点，这里做大是视觉引导 */}
        <HStack spacing={6}>
          <Image systemName="plus.circle.fill" font={24} foregroundStyle={THEME.accent} />
          <Text font="subheadline" foregroundStyle={THEME.accent} fontWeight="bold">
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
      <BackgroundLayer family="medium" />
      <HStack spacing={12} padding>
        <VStack alignment="leading" spacing={8} widgetURL={RUN_URL}>
          <HStack spacing={6}>
            <Image systemName="arrow.down.circle.fill" font={14} foregroundStyle={THEME.accent} />
            <Text font="caption" fontWeight="semibold" foregroundStyle={THEME.textPrimary} monospaced>
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
            <HStack spacing={6} padding={{ leading: 18, trailing: 18, top: 12, bottom: 12 }}>
              <Image systemName="plus.circle.fill" font={22} foregroundStyle={THEME.accent} />
              <Text font="title3" fontWeight="bold" foregroundStyle={THEME.accent}>
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
  const medium = Widget.family === "systemMedium"
  Widget.present(medium ? <MediumView latest={latest} /> : <SmallView latest={latest} />, {
    // 15 分钟重载兜底（iOS 按预算裁量）；主刷新靠 App 侧的 Widget.reloadAll()
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) },
  })
}

try {
  run()
} catch (e) {
  Widget.present(<Text padding>{String(e)}</Text>)
}
