// widget.tsx — 主屏幕小组件：主题化深色背景 + 最近下载 + 大「＋」入口 + 角落刷新
// 数据源：Storage 里的快照（vdl.widget.latest）；主题：Storage 里的 vdl.theme。
//   widget 扩展进程读不到 App 文档目录，Storage 是同脚本跨进程共享的可靠通道（cmhk 实证）。
// 背景：ZStack 底层 = 主题渐变 + 烘焙 PNG 纹理（assets/widget-bg-<主题>-<尺寸>.png）+
//   来源感水印（play/video 图标与 YT·IG·WX·XHS 字样，表达“下载各平台视频”）。
// 全局对象（禁止从 scripting 导入）：Storage

import { HStack, Image, Link, RoundedRectangle, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import { getWidgetSnapshot, type WidgetSnapshot, type WidgetSnapshotItem } from "./services/history"
import { getTheme, getBadgeGlyph, getWidgetStyle } from "./services/theme"
import { formatBytes, formatDate, formatDuration, formatResolution, prettySource } from "./utils/common"

const SCRIPT_NAME = "Video Downloader Lite"
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
  ink = TEXT_PRIMARY,
  sub = TEXT_SECONDARY,
}: {
  item: WidgetSnapshotItem | null
  lines: number
  accent: string
  ink?: string
  sub?: string
}) {
  if (!item) {
    return (
      <VStack alignment="leading" spacing={4}>
        <Text font="subheadline" fontWeight="semibold" foregroundStyle={ink}>
          暂无下载记录
        </Text>
        <Text font="caption" foregroundStyle={sub}>
          复制视频链接后点下方按钮
        </Text>
      </VStack>
    )
  }
  const line1 = [
    formatBytes(item.bytes),
    formatDuration(item.durationSec),
    item.resolution ? `${formatResolution(item.resolution)} ${item.format ?? ""}`.trim() : "",
  ]
    .filter(Boolean)
    .join(" | ")
  return (
    <VStack alignment="leading" spacing={3}>
      {/* reservesSpace:true 才会真的保住两行高度——裸 lineLimit 只是上限，布局一压就回到一行 */}
      <Text
        font="subheadline"
        fontWeight="semibold"
        lineLimit={{ min: 2, max: 2, reservesSpace: true }}
        foregroundStyle={ink}
      >
        {item.title || item.fileName}
      </Text>
      <Text font="caption2" monospaced foregroundStyle={sub} lineLimit={1}>
        {line1}
      </Text>
      <HStack spacing={4}>
        <Text font="caption2" monospaced foregroundStyle={sub} lineLimit={1}>
          {formatDate(item.createdAt).slice(5)}
        </Text>
        <Text font="caption2" monospaced foregroundStyle={sub}>
          |
        </Text>
        <Text font="caption2" monospaced foregroundStyle={accent} lineLimit={1}>
          {item.kind === "platform" && item.host
            ? prettySource(`https://${item.host}`)
            : KIND_SHORT[item.kind] ?? item.kind}
        </Text>
      </HStack>
    </VStack>
  )
}

// 次近一条（一行简报）
// 「前一条」用一枚随机的鲜亮强调色（每次渲染随机，给深色底一点跳色）
const SECOND_ROW_COLORS = ["#FF9F0A", "#FF6B9D", "#5AC8FA", "#BF5AF2", "#FFD60A", "#30D158", "#64D2FF", "#FF8A65"]

function SecondRow({ item, color }: { item: WidgetSnapshotItem | null; color?: string }) {
  if (!item) return null
  const accent2 = color ?? SECOND_ROW_COLORS[Math.floor(Math.random() * SECOND_ROW_COLORS.length)]
  return (
    <HStack spacing={6}>
      <Image systemName="clock" font={9} foregroundStyle={accent2} />
      <Text font="caption2" foregroundStyle={accent2} lineLimit={1}>
        {`前一条：${item.title || item.fileName}`}
      </Text>
    </HStack>
  )
}

// 下载徽章：烘焙 PNG（squircle + 主题渐变 + 款式字形）+ 右上角随机色 + 角标
// （角标是运行时叠加的 SF 符号，颜色每次渲染随机，与「前一条」共享色池）
function DownloadBadge({ size, accent }: { size: number; accent: string }) {
  const theme = getTheme()
  const glyph = getBadgeGlyph()
  const dotColor = SECOND_ROW_COLORS[Math.floor(Math.random() * SECOND_ROW_COLORS.length)]
  return (
    <ZStack frame={{ width: size, height: size }}>
      <Image
        filePath={`${Script.directory}/assets/widget-badge-${glyph}-${theme.key}.png`}
        resizable={true}
        scaleToFit={true}
        frame={{ width: size, height: size }}
      />
      {/* 手指点击手势角标（"点这里添加"的直觉暗示，随机强调色） */}
      <Image
        systemName="hand.tap.fill"
        font={size * 0.42}
        foregroundStyle={dotColor}
        offset={{ x: size * 0.42, y: size * 0.42 }}
      />
    </ZStack>
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
  // 高度预算（158pt）：padding 24 + 抬头 16 + 标题两行 32 + 元信息两行 30 + 入口 30 ≈ 132 + 间距
  return (
    <ZStack alignment="topTrailing">
      <BackgroundLayer family="small" />
      <VStack alignment="leading" spacing={3} padding={{ top: 12, bottom: 12, leading: 14, trailing: 14 }} widgetURL={RUN_URL}>
        <HStack spacing={6}>
          <Image systemName="play.rectangle.fill" font={13} foregroundStyle={theme.accent} />
          <Text font="subheadline" fontWeight="bold" foregroundStyle={theme.accent} monospaced>
            VIDEO DOWNLOADER
          </Text>
        </HStack>
        <LatestInfo item={snap?.latest ?? null} lines={2} accent={theme.accent} />
        <Spacer />
        {/* 入口：纯图标（文字会让高度爆预算，标题两行优先） */}
        <DownloadBadge size={30} accent={theme.accent} />
      </VStack>
    </ZStack>
  )
}

function MediumView({ snap }: { snap: WidgetSnapshot | null }) {
  const theme = getTheme()
  return (
    <ZStack alignment="bottomLeading">
      <BackgroundLayer family="medium" />
      {/* 分块布局：左信息列撑满 + 右侧大按钮，列间距压到最小（spacing 4 / 按钮无内边距） */}
      <HStack spacing={4} padding>
        <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" } as never} widgetURL={RUN_URL}>
          <HStack spacing={6}>
            <Image systemName="play.rectangle.fill" font={14} foregroundStyle={theme.accent} />
            <Text font="headline" fontWeight="bold" foregroundStyle={theme.accent} monospaced>
              VIDEO DOWNLOADER
            </Text>
          </HStack>
          <VStack padding={{ top: 12 }}>
            <LatestInfo item={snap?.latest ?? null} lines={2} accent={theme.accent} />
          </VStack>
          <VStack padding={{ top: 6 }}>
            <SecondRow item={snap?.second ?? null} />
          </VStack>
          <Spacer />
        </VStack>
        <VStack padding={{ top: 28 }}>
          <Spacer />
          <Link url={RUN_URL}>
            <DownloadBadge size={64} accent={theme.accent} />
          </Link>
          <Spacer />
        </VStack>
      </HStack>
    </ZStack>
  )
}

// -------------------------------------------------------------
// 海报大字风：米色纸感渐变 + 深墨字 + 正红圆形下载钮（纯色绘制，无需烘焙 PNG）
// -------------------------------------------------------------
const POSTER = {
  bgTop: "#F7F2E7",
  bgBottom: "#E9E0CC",
  ink: "#1B1B1B",
  sub: "rgba(27,27,27,0.55)",
  accent: "#C0392B",
}

function PosterBackground({ family }: { family: "small" | "medium" }) {
  return (
    <ZStack>
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
        background={{
          gradient: [
            { color: POSTER.bgTop, location: 0 },
            { color: POSTER.bgBottom, location: 1 },
          ],
          startPoint: { x: 0, y: 0 },
          endPoint: { x: 1, y: 1 },
        } as any}
      >
        <Spacer />
      </VStack>
      {family === "medium" ? (
        <VStack alignment="trailing" padding={14} frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}>
          <Spacer />
          <Text font="caption2" monospaced foregroundStyle="rgba(27,27,27,0.12)">
            YT · IG · WX · XHS
          </Text>
        </VStack>
      ) : null}
    </ZStack>
  )
}

// 海报风下载钮：正红圆形 + 白色箭头（替代烘焙徽章 PNG）
function PosterBadge({ size }: { size: number }) {
  return (
    <ZStack frame={{ width: size, height: size }}>
      <RoundedRectangle cornerRadius={size / 2} fill={POSTER.accent} frame={{ width: size, height: size }} />
      <Image systemName="arrow.down" font={size * 0.42} foregroundStyle="#FFFFFF" />
    </ZStack>
  )
}

function PosterSmallView({ snap }: { snap: WidgetSnapshot | null }) {
  return (
    <ZStack alignment="topTrailing">
      <PosterBackground family="small" />
      <VStack alignment="leading" spacing={3} padding={{ top: 12, bottom: 12, leading: 14, trailing: 14 }} widgetURL={RUN_URL}>
        <HStack spacing={6}>
          <Image systemName="play.rectangle.fill" font={13} foregroundStyle={POSTER.accent} />
          <Text font="subheadline" fontWeight="bold" foregroundStyle={POSTER.ink} monospaced>
            VIDEO DOWNLOADER
          </Text>
        </HStack>
        <LatestInfo item={snap?.latest ?? null} lines={2} accent={POSTER.accent} ink={POSTER.ink} sub={POSTER.sub} />
        <Spacer />
        <PosterBadge size={30} />
      </VStack>
    </ZStack>
  )
}

function PosterMediumView({ snap }: { snap: WidgetSnapshot | null }) {
  return (
    <ZStack alignment="bottomLeading">
      <PosterBackground family="medium" />
      <HStack spacing={4} padding>
        <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" } as never} widgetURL={RUN_URL}>
          <HStack spacing={6}>
            <Image systemName="play.rectangle.fill" font={14} foregroundStyle={POSTER.accent} />
            <Text font="headline" fontWeight="bold" foregroundStyle={POSTER.ink} monospaced>
              VIDEO DOWNLOADER
            </Text>
          </HStack>
          <VStack padding={{ top: 12 }}>
            <LatestInfo item={snap?.latest ?? null} lines={2} accent={POSTER.accent} ink={POSTER.ink} sub={POSTER.sub} />
          </VStack>
          <VStack padding={{ top: 6 }}>
            <SecondRow item={snap?.second ?? null} color={POSTER.accent} />
          </VStack>
          <Spacer />
        </VStack>
        <VStack padding={{ top: 28 }}>
          <Spacer />
          <Link url={RUN_URL}>
            <PosterBadge size={64} />
          </Link>
          <Spacer />
        </VStack>
      </HStack>
    </ZStack>
  )
}

// -------------------------------------------------------------
// 蓝图风：深蓝图纸底 + 细网格线 + 白蓝图字 + 琥珀点缀 + 白色圆环下载钮
// -------------------------------------------------------------
const BLUEPRINT = {
  bgTop: "#10305C",
  bgBottom: "#0A1F3D",
  ink: "#EAF2FF",
  sub: "rgba(234,242,255,0.55)",
  accent: "#FFC82E",
  line: "rgba(234,242,255,0.07)",
  ringCore: "#12345F", // 圆环内芯（近似渐变中值，视觉上与背景融为一体）
}

// 网格：4 横 6 纵细线，Spacer 均分（图纸坐标格）
function BlueprintGrid() {
  const hLine = (
    <RoundedRectangle cornerRadius={0} fill={BLUEPRINT.line}
      frame={{ maxWidth: "infinity", height: 0.5 } as never} />
  )
  const vLine = (
    <RoundedRectangle cornerRadius={0} fill={BLUEPRINT.line}
      frame={{ width: 0.5, maxHeight: "infinity" } as never} />
  )
  return (
    <ZStack>
      <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}>
        <Spacer />{hLine}<Spacer />{hLine}<Spacer />{hLine}<Spacer />{hLine}<Spacer />
      </VStack>
      <HStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}>
        <Spacer />{vLine}<Spacer />{vLine}<Spacer />{vLine}<Spacer />{vLine}<Spacer />{vLine}<Spacer />{vLine}<Spacer />
      </HStack>
    </ZStack>
  )
}

function BlueprintBackground({ family }: { family: "small" | "medium" }) {
  return (
    <ZStack>
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
        background={{
          gradient: [
            { color: BLUEPRINT.bgTop, location: 0 },
            { color: BLUEPRINT.bgBottom, location: 1 },
          ],
          startPoint: { x: 0, y: 0 },
          endPoint: { x: 1, y: 1 },
        } as any}
      >
        <Spacer />
      </VStack>
      <BlueprintGrid />
      {family === "medium" ? (
        <VStack alignment="trailing" padding={14} frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}>
          <Spacer />
          <Text font="caption2" monospaced foregroundStyle="rgba(234,242,255,0.18)">
            DWG.NO VDL-2508 · SCALE 1:1
          </Text>
        </VStack>
      ) : null}
    </ZStack>
  )
}

// 蓝图风下载钮：白色圆环（外圆 - 内芯）+ 琥珀箭头
function BlueprintBadge({ size }: { size: number }) {
  const ring = 3
  return (
    <ZStack frame={{ width: size, height: size }}>
      <RoundedRectangle cornerRadius={size / 2} fill={BLUEPRINT.ink} frame={{ width: size, height: size }} />
      <RoundedRectangle cornerRadius={(size - ring * 2) / 2} fill={BLUEPRINT.ringCore}
        frame={{ width: size - ring * 2, height: size - ring * 2 }} />
      <Image systemName="arrow.down" font={size * 0.38} foregroundStyle={BLUEPRINT.accent} />
    </ZStack>
  )
}

function BlueprintSmallView({ snap }: { snap: WidgetSnapshot | null }) {
  return (
    <ZStack alignment="topTrailing">
      <BlueprintBackground family="small" />
      <VStack alignment="leading" spacing={3} padding={{ top: 12, bottom: 12, leading: 14, trailing: 14 }} widgetURL={RUN_URL}>
        <HStack spacing={6}>
          <Image systemName="play.rectangle.fill" font={13} foregroundStyle={BLUEPRINT.accent} />
          <Text font="subheadline" fontWeight="bold" foregroundStyle={BLUEPRINT.ink} monospaced>
            VIDEO DOWNLOADER
          </Text>
        </HStack>
        <LatestInfo item={snap?.latest ?? null} lines={2} accent={BLUEPRINT.accent} ink={BLUEPRINT.ink} sub={BLUEPRINT.sub} />
        <Spacer />
        <BlueprintBadge size={30} />
      </VStack>
    </ZStack>
  )
}

function BlueprintMediumView({ snap }: { snap: WidgetSnapshot | null }) {
  return (
    <ZStack alignment="bottomLeading">
      <BlueprintBackground family="medium" />
      <HStack spacing={4} padding>
        <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" } as never} widgetURL={RUN_URL}>
          <HStack spacing={6}>
            <Image systemName="play.rectangle.fill" font={14} foregroundStyle={BLUEPRINT.accent} />
            <Text font="headline" fontWeight="bold" foregroundStyle={BLUEPRINT.ink} monospaced>
              VIDEO DOWNLOADER
            </Text>
          </HStack>
          <VStack padding={{ top: 12 }}>
            <LatestInfo item={snap?.latest ?? null} lines={2} accent={BLUEPRINT.accent} ink={BLUEPRINT.ink} sub={BLUEPRINT.sub} />
          </VStack>
          <VStack padding={{ top: 6 }}>
            <SecondRow item={snap?.second ?? null} color={BLUEPRINT.accent} />
          </VStack>
          <Spacer />
        </VStack>
        <VStack padding={{ top: 28 }}>
          <Spacer />
          <Link url={RUN_URL}>
            <BlueprintBadge size={64} />
          </Link>
          <Spacer />
        </VStack>
      </HStack>
    </ZStack>
  )
}

// -------------------------------------------------------------
// 霓虹风：近黑底 + 青→品红霓虹底线 + 辉光圆环下载钮
// -------------------------------------------------------------
const NEON = {
  bgTop: "#05050A",
  bgBottom: "#0B0B1A",
  ink: "#F2F5FF",
  sub: "rgba(242,245,255,0.50)",
  accent: "#00E5FF", // 霓虹青
  accent2: "#FF2E88", // 霓虹品红
  core: "#0B0B1A",
}

function NeonBackground({ family }: { family: "small" | "medium" }) {
  return (
    <ZStack>
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
        background={{
          gradient: [
            { color: NEON.bgTop, location: 0 },
            { color: NEON.bgBottom, location: 1 },
          ],
          startPoint: { x: 0, y: 0 },
          endPoint: { x: 1, y: 1 },
        } as any}
      >
        <Spacer />
      </VStack>
      {/* 底部霓虹渐变光带（青 -> 品红，合成波招牌） */}
      <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}>
        <Spacer />
        <RoundedRectangle
          cornerRadius={1.5}
          frame={{ maxWidth: "infinity", height: 3 } as never}
          fill={{
            gradient: [
              { color: NEON.accent, location: 0 },
              { color: NEON.accent2, location: 1 },
            ],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 0 },
          } as any}
          opacity={0.8}
        />
      </VStack>
      {family === "medium" ? (
        <VStack alignment="trailing" padding={14} frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}>
          <Text font="caption2" monospaced foregroundStyle="rgba(0,229,255,0.30)">
            NEON.DL // READY
          </Text>
        </VStack>
      ) : null}
    </ZStack>
  )
}

// 霓虹风下载钮：外层辉光 + 青色圆环 + 深色内芯 + 青色箭头
function NeonBadge({ size }: { size: number }) {
  return (
    <ZStack frame={{ width: size, height: size }}>
      <RoundedRectangle cornerRadius={(size + 10) / 2} fill={NEON.accent} opacity={0.18}
        frame={{ width: size + 10, height: size + 10 }} />
      <RoundedRectangle cornerRadius={size / 2} fill={NEON.accent} frame={{ width: size, height: size }} />
      <RoundedRectangle cornerRadius={(size - 5) / 2} fill={NEON.core} frame={{ width: size - 5, height: size - 5 }} />
      <Image systemName="arrow.down" font={size * 0.38} foregroundStyle={NEON.accent} />
    </ZStack>
  )
}

function NeonSmallView({ snap }: { snap: WidgetSnapshot | null }) {
  return (
    <ZStack>
      <NeonBackground family="small" />
      <VStack alignment="leading" spacing={3} padding={{ top: 12, bottom: 12, leading: 14, trailing: 14 }} widgetURL={RUN_URL}>
        <HStack spacing={6}>
          <Image systemName="play.rectangle.fill" font={13} foregroundStyle={NEON.accent} />
          <Text font="subheadline" fontWeight="bold" foregroundStyle={NEON.ink} monospaced>
            VIDEO DOWNLOADER
          </Text>
        </HStack>
        <LatestInfo item={snap?.latest ?? null} lines={2} accent={NEON.accent} ink={NEON.ink} sub={NEON.sub} />
        <Spacer />
        <NeonBadge size={30} />
      </VStack>
    </ZStack>
  )
}

function NeonMediumView({ snap }: { snap: WidgetSnapshot | null }) {
  return (
    <ZStack>
      <NeonBackground family="medium" />
      <HStack spacing={4} padding>
        <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" } as never} widgetURL={RUN_URL}>
          <HStack spacing={6}>
            <Image systemName="play.rectangle.fill" font={14} foregroundStyle={NEON.accent} />
            <Text font="headline" fontWeight="bold" foregroundStyle={NEON.ink} monospaced>
              VIDEO DOWNLOADER
            </Text>
          </HStack>
          <VStack padding={{ top: 12 }}>
            <LatestInfo item={snap?.latest ?? null} lines={2} accent={NEON.accent} ink={NEON.ink} sub={NEON.sub} />
          </VStack>
          <VStack padding={{ top: 6 }}>
            <SecondRow item={snap?.second ?? null} color={NEON.accent2} />
          </VStack>
          <Spacer />
        </VStack>
        <VStack padding={{ top: 28 }}>
          <Spacer />
          <Link url={RUN_URL}>
            <NeonBadge size={64} />
          </Link>
          <Spacer />
        </VStack>
      </HStack>
    </ZStack>
  )
}

function run() {
  const snap = getWidgetSnapshot()
  const medium = Widget.family === "systemMedium"
  const style = getWidgetStyle()
  const view = medium
    ? style === "poster" ? <PosterMediumView snap={snap} />
      : style === "blueprint" ? <BlueprintMediumView snap={snap} />
      : style === "neon" ? <NeonMediumView snap={snap} />
      : <MediumView snap={snap} />
    : style === "poster" ? <PosterSmallView snap={snap} />
      : style === "blueprint" ? <BlueprintSmallView snap={snap} />
      : style === "neon" ? <NeonSmallView snap={snap} />
      : <SmallView snap={snap} />
  Widget.present(view, {
    // 15 分钟重载兜底（iOS 按预算裁量）；主刷新靠 App 侧的 Widget.reloadAll()
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) },
  })
}

try {
  run()
} catch (e) {
  Widget.present(<Text padding>{String(e)}</Text>)
}
