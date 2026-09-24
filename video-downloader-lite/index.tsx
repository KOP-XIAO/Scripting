// index.tsx — 视频下载器主程序（App 内页面）
// 结构：NavigationStack + List 分 Section；设置与诊断收进 NavigationLink 子页面。
// 生命周期：一次性页面 —— Navigation.present() 关闭后 Script.exit()。
//
// 注意：Dialog / Storage / FileManager / Photos / Pasteboard / ShareSheet /
//       DocumentPicker / Data 等均为全局对象，
//       不要从 "scripting" 导入（生产范本验证过，导入会静默拿到 undefined）。

import {
  Button,
  HStack,
  Image,
  Link,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  ProgressView,
  RoundedRectangle,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  Widget,
  ZStack,
  useEffect,
  useState,
} from "scripting"
import {
  runDownload,
  detectKind,
  testCobaltApi,
  KIND_LABELS,
  type DownloadOutcome,
  type DownloadedFile,
} from "./services/downloader"
import {
  getPreferences,
  persistPreferences,
  getYuanbaoCookie,
  setYuanbaoCookie,
  SAVE_MODE_LABELS,
  WX_CODEC_LABELS,
  type Preferences,
  type SaveMode,
  type WxCodec,
} from "./services/preferences"
import {
  initDatabase,
  listHistory,
  countHistory,
  findBySourceURL,
  insertHistory,
  updateHistoryNote,
  deleteHistoryRecord,
  clearHistoryRecords,
  ensureWidgetSnapshot,
  backfillMediaInfo,
  type HistoryRecord,
} from "./services/history"
import { appendDebug, getDebugLog, clearDebugLog, exportDebugPackage, ERROR_LINE_RE } from "./services/debug"
import { testYuanbaoCookie } from "./services/wxchannels"
import { listDownloadDirs, clearDownloadDirs, formatDirSize } from "./services/storage-man"
import {
  postDownloadAction,
  saveFilePathToPhotos,
  exportFilePathToFiles,
  shareFile,
  canSaveToPhotos,
} from "./services/file-actions"
import { resolutionLabel } from "./services/media-probe"
import { VERSION, extractFirstURL, formatBytes, formatDate, formatDuration, formatResolution, prettySource } from "./utils/common"
import { getTheme, getThemeKey, setThemeKey, THEMES, type ThemeKey } from "./services/theme"
import { BADGE_GLYPHS, getBadgeGlyph, setBadgeGlyph, type BadgeGlyph } from "./services/theme"

// Safari 为全局对象（禁止从 scripting 导入），用 Safari.openURL 打开链接


// -------------------------------------------------------------
// 撒花庆祝层：emoji 粒子（本运行时无旋转/物理动画 API，emoji 规避全部限制）
// -------------------------------------------------------------
const CONFETTI_EMOJI = ["🎉", "🎊", "✨", "⭐", "🟡", "🟢", "🟣", "🔵", "🟠"]

type ConfettiPiece = {
  emoji: string
  x: number
  y0: number
  y1: number
  drift: number
  size: number
  dur: number // 时长系数（小=快）
  phase: number
}

function newConfettiPieces(): ConfettiPiece[] {
  return Array.from({ length: 18 }, (_, i) => ({
    emoji: CONFETTI_EMOJI[i % CONFETTI_EMOJI.length],
    x: (Math.random() - 0.5) * 300,
    y0: -140 - Math.random() * 160,
    y1: 380 + Math.random() * 120,
    drift: (Math.random() - 0.5) * 60,
    size: 16 + Math.random() * 18,
    dur: 0.75 + Math.random() * 0.4,
    phase: Math.random() * Math.PI * 2,
  }))
}

// Animation 与 Storage/Dialog 一样是全局对象（文档全部裸用、从不 import）。
// 运行时探测：有 → 原生 60fps 插值；没有 → JS 驱动兜底（30fps）。
declare const Animation: any
const NativeAnim: any = typeof globalThis !== "undefined" ? (globalThis as any).Animation : undefined

// ---- 原生路径（60fps，SwiftUI 插值）----
function ConfettiNative() {
  const [pieces] = useState<ConfettiPiece[]>(newConfettiPieces)
  const [go, setGo] = useState(false)
  const [fade, setFade] = useState(1)
  const [textIn, setTextIn] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setGo(true), 40)
    const t2 = setTimeout(() => setTextIn(true), 400) // 文字延迟淡入
    const t3 = setTimeout(() => setFade(0), 1400)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [])

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
      opacity={fade}
      animation={{ animation: NativeAnim.easeOut(0.45), value: fade }}
    >
      {/* 中央卡片：spring 升起 + 整体渐入，不再生硬瞬移 */}
      <VStack
        spacing={8}
        offset={{ x: 0, y: go ? 0 : 36 }}
        opacity={go ? 1 : 0}
        animation={{ animation: NativeAnim.spring({ duration: 0.5, bounce: 0.45 }), value: go }}
      >
        <Text font={54}>🎉</Text>
        <Text
          font="title3"
          fontWeight="bold"
          foregroundStyle="#F0F3F6"
          opacity={textIn ? 1 : 0}
          animation={{ animation: NativeAnim.easeOut(0.35), value: textIn }}
        >
          下载完成
        </Text>
      </VStack>
      {pieces.map((p2, i) => (
        <Text
          key={i}
          font={p2.size}
          offset={{ x: go ? p2.x + p2.drift : p2.x, y: go ? p2.y1 : p2.y0 }}
          animation={{ animation: NativeAnim.easeIn(p2.dur), value: go }}
        >
          {p2.emoji}
        </Text>
      ))}
    </ZStack>
  )
}

function ConfettiJS() {
  const [pieces] = useState<ConfettiPiece[]>(newConfettiPieces)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t0 = Date.now()
    const timer = setInterval(() => setTick(Date.now() - t0), 33)
    return () => clearInterval(timer)
  }, [])

  const LIFE = 1.55
  const t = tick / 1000
  const fade = t > LIFE ? Math.max(0, 1 - (t - LIFE) / 0.35) : 1

  // 卡片：与粒子同一时钟——easeOutCubic 从下方升起 + 正弦轻摆 + 回弹过冲
  const cardRise = Math.min(1, t / 0.45)
  const cardEased = 1 - Math.pow(1 - cardRise, 3)
  const cardY = (1 - cardEased) * 46 - Math.sin(Math.min(1, t / 0.45) * Math.PI) * 7
  const cardX = Math.sin(t * 2.2) * 5 * (t < 1.1 ? 1 : Math.max(0, 1.5 - t))
  const textOpacity = Math.max(0, Math.min(1, (t - 0.28) / 0.3))

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never} opacity={fade}>
      {/* 中央卡片：升起 + 轻摆，文字稍后淡入 */}
      <VStack spacing={8} offset={{ x: cardX, y: cardY }}>
        <Text font={54}>🎉</Text>
        <Text font="title3" fontWeight="bold" foregroundStyle="#F0F3F6" opacity={textOpacity}>
          下载完成
        </Text>
      </VStack>
      {/* 粒子：easeIn(t²) 加速下落 + 正弦漂移（各自相位） */}
      {pieces.map((p2, i) => {
        const pt = Math.min(1, (t / 1.2) * (1 / p2.dur))
        const eased = pt * pt
        const y = p2.y0 + (p2.y1 - p2.y0) * eased
        const x = p2.x + Math.sin(pt * Math.PI + p2.phase) * p2.drift
        return (
          <Text key={i} font={p2.size} offset={{ x, y }}>
            {p2.emoji}
          </Text>
        )
      })}
    </ZStack>
  )
}

function ConfettiOverlay() {
  return NativeAnim ? <ConfettiNative /> : <ConfettiJS />
}

// 终端风 ASCII 进度条
function asciiBar(done: number, total: number, width = 40): string {
  const ratio = Math.max(0, Math.min(1, total > 0 ? done / total : 0))
  const filled = Math.round(ratio * width)
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${Math.round(ratio * 100)}%`
}


// 视频缩略图：AVAsset 抽首帧附近帧（本地文件才有）
function VideoThumb({ path, durationSec }: { path: string; durationSec?: number }) {
  const [img, setImg] = useState<any>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if (typeof AVAsset === "undefined" || typeof MediaTime === "undefined") return
        if (!(await FileManager.exists(path))) return
        const asset = new AVAsset(path)
        const sec = durationSec && durationSec > 2 ? Math.max(0.1, durationSec * 0.1) : 0.1
        const r = await asset.generateImage(MediaTime.make({ seconds: sec, preferredTimescale: 600 }), {
          maximumSize: { width: 320, height: 180 },
        })
        asset.dispose()
        if (alive) setImg(r.image)
      } catch {}
    })()
    return () => {
      alive = false
    }
  }, [path])

  if (img) {
    return <Image image={img} resizable={true} scaleToFill={true} frame={{ width: 78, height: 50 }} />
  }
  return (
    <ZStack frame={{ width: 78, height: 50 }}>
      <RoundedRectangle cornerRadius={6} fill="#1C1C22" />
      <Image systemName="play.rectangle" font={14} foregroundStyle="#3A3A44" />
    </ZStack>
  )
}

// -------------------------------------------------------------
// 历史记录行：编号 + 标题 + 元信息，点按弹操作面板（Dialog.actionSheet——
// 本运行时实证可靠的交互；自定义容器内嵌 Button 的 flatMap/嵌套方案均已否决）
// -------------------------------------------------------------
function HistoryRow(props: { item: HistoryRecord; index: number; onChanged: () => Promise<void> }) {
  const { item, index, onChanged } = props

  const openActions = async () => {
    const exists = await FileManager.exists(item.file_path)
    const inPhotos = item.note.includes("相册")
    const actions = [
      ...(exists && canSaveToPhotos(item.file_name) ? [{ label: "保存到相册" }] : []),
      ...(exists ? [{ label: "导出到文件" }, { label: "分享文件" }] : []),
      { label: "打开原始链接" },
      { label: "复制原始链接" },
      { label: exists ? "删除记录和文件" : "删除记录", destructive: true },
    ]
    const result = await Dialog.actionSheet({
      title: item.title || item.file_name,
      message: `${formatDate(item.created_at)} · ${formatBytes(item.bytes_written)}${
        item.duration_sec ? ` · ${formatDuration(item.duration_sec)}` : ""
      }${inPhotos ? " · 已存入相册" : exists ? "" : " · 文件已不存在"}`,
      actions,
      cancelButton: true,
    })
    if (result == null || result < 0) return
    try {
      const label = actions[result].label
      if (label === "保存到相册") {
        await saveFilePathToPhotos(item.file_path, item.file_name)
        await updateHistoryNote(item.id, "已存入相册")
      }
      if (label === "导出到文件") await exportFilePathToFiles(item.file_path, item.file_name)
      if (label === "分享文件") await shareFile(item.file_path)
      if (label === "打开原始链接") await Safari.openURL(item.source_url)
      if (label === "复制原始链接") await Pasteboard.setString(item.source_url)
      if (label === "删除记录") await deleteHistoryRecord(item.id)
      if (label === "删除记录和文件") await deleteHistoryRecord(item.id, true)
      await onChanged()
    } catch (e) {
      await Dialog.alert({ title: "操作失败", message: String(e) })
    }
  }

  // 来源显示：优先 note 里的来源标签（腾讯云点播 等），否则 kind+站点名
  const noteSource = item.note.split("·").filter((x) => x && !x.includes("相册")).join("·")
  const sourceText =
    noteSource ||
    (item.kind === "platform"
      ? `平台·${prettySource(item.source_url)}`
      : KIND_LABELS[item.kind as keyof typeof KIND_LABELS] ?? item.kind)
  // 两行元信息：第一行 来源 | 日期时间（竖隔线分隔），第二行 大小·时长·清晰度·格式
  const metaLine1 = [sourceText, formatDate(item.created_at)].filter(Boolean).join("  |  ")
  const metaLine2 = [
    formatBytes(item.bytes_written),
    formatDuration(item.duration_sec ?? 0),
    item.resolution ? `${formatResolution(item.resolution)} ${item.format ?? ""}`.trim() : "",
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <HStack spacing={8} frame={{ maxWidth: "infinity" } as never} onTapGesture={() => void openActions()}>
      <VStack alignment="leading" spacing={2}>
        <Text font="caption" monospaced foregroundStyle="tertiaryLabel">
          {`#${String(index + 1).padStart(2, "0")}`}
        </Text>
        <VideoThumb path={item.file_path} durationSec={item.duration_sec} />
      </VStack>
      <VStack alignment="leading" spacing={3}>
        <Text font="subheadline" fontWeight="medium" lineLimit={2}>
          {item.title || item.file_name}
        </Text>
        <HStack spacing={6}>
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
            {metaLine1}
          </Text>
          {item.note.includes("相册") ? (
            <Text font="caption2" foregroundStyle="systemGreen">
              已存相册
            </Text>
          ) : null}
        </HStack>
        <Text font="caption2" monospaced foregroundStyle="tertiaryLabel" lineLimit={1}>
          {metaLine2}
        </Text>
      </VStack>
      <Spacer />
      <Image systemName="ellipsis.circle" font={12} foregroundStyle="tertiaryLabel" />
    </HStack>
  )
}

// -------------------------------------------------------------
// 设置页
// -------------------------------------------------------------
function SettingsPage(props: { prefs: Preferences; onSave: (p: Preferences) => void }) {
  const { prefs, onSave } = props
  const [draft, setDraft] = useState<Preferences>({ ...prefs })
  const [cookieDraft, setCookieDraft] = useState<string>(getYuanbaoCookie())
  const [themeKey, setThemeKeyLocal] = useState<ThemeKey>(getThemeKey())
  const [badgeGlyph, setBadgeGlyphLocal] = useState<BadgeGlyph>(getBadgeGlyph())

  return (
    <List navigationTitle="设置" navigationBarTitleDisplayMode="inline">
      <Section
        header={
          <HStack spacing={6}>
            <Image systemName="bubble.left.and.bubble.right" font={11} foregroundStyle="secondaryLabel" />
            <Text>视频号解析</Text>
          </HStack>
        }
        footer={
          <Text font="caption" foregroundStyle="secondaryLabel">
            上游在线解析服务已停服。填入元宝 Cookie 后改用本地两步解析（不走第三方服务）：
            电脑浏览器登录 yuanbao.tencent.com → 开发者工具 → Network 任选一个请求 →
            复制其 Cookie 请求头整串粘贴到这里。Cookie 保存在系统钥匙串，仅本机使用。
          </Text>
        }
      >
        <TextField
          title="元宝 Cookie"
          value={cookieDraft}
          onChanged={(v) => {
            setCookieDraft(v)
            setYuanbaoCookie(v)
          }}
          prompt="pgv_pvid=...; hy_token=...（可留空尝试在线服务）"
        />
        <HStack>
          <Text font="caption" foregroundStyle={cookieDraft.trim() ? "systemGreen" : "secondaryLabel"}>
            {cookieDraft.trim() ? "✓ 已配置，视频号将走本地解析" : "未配置：视频号走在线服务（可能不可用）"}
          </Text>
          <Spacer />
          {cookieDraft.trim() ? (
            <Button
              title="清除"
              role="destructive"
              action={() => {
                setCookieDraft("")
                setYuanbaoCookie("")
              }}
            />
          ) : null}
          <Button
            title="测试"
            action={async () => {
              const r = await testYuanbaoCookie(cookieDraft)
              await Dialog.alert({ title: "Cookie 测试", message: r })
            }}
          />
        </HStack>
      </Section>

      <Section
        header={
          <HStack spacing={6}>
            <Image systemName="globe" font={11} foregroundStyle="secondaryLabel" />
            <Text>平台解析</Text>
          </HStack>
        }
        footer={
          <Text font="caption" foregroundStyle="secondaryLabel">
            用于 YouTube、Instagram、B站、X、抖音等平台链接。填自建或信任的 cobalt 兼容实例地址，
            脚本向其 POST 换取直链（自动兼容新版 / 与旧版 /api/json 端点）。留空则平台链接不可用。
          </Text>
        }
      >
        <TextField
          title="解析实例"
          value={draft.cobaltApi}
          onChanged={(v) => update({ cobaltApi: v })}
          prompt="https://cobalt.example.com"
        />
        <HStack>
          <Spacer />
          <Button
            title="测试连接"
            action={async () => {
              const r = await testCobaltApi(draft.cobaltApi)
              await Dialog.alert({ title: "实例测试", message: r })
            }}
          />
        </HStack>
      </Section>

      <Section
        header={
          <HStack spacing={6}>
            <Image systemName="paintpalette" font={11} foregroundStyle="secondaryLabel" />
            <Text>外观主题与徽章</Text>
          </HStack>
        }
        footer={
          <Text font="caption" foregroundStyle="secondaryLabel">
            影响小组件背景与按钮配色、日志终端的点缀色；切换后小组件立即换肤。
          </Text>
        }
      >
        {(() => {
          // 色板网格：点色块即选中，点击区域=视觉区域，无热区歧义
          const keys = Object.keys(THEMES) as ThemeKey[]
          const rows: ThemeKey[][] = [keys.slice(0, 5), keys.slice(5)]
          return rows.map((row, ri) => (
            <HStack key={`theme-${ri}`} spacing={0}>
              {row.flatMap((k, i) => {
                const t = THEMES[k]
                const selected = k === themeKey
                const chip = (
                  <Button
                    key={k}
                    buttonStyle="plain"
                    action={() => {
                      setThemeKeyLocal(k)
                      setThemeKey(k) // 内部会 Widget.reloadAll()，小组件立即换肤
                    }}
                  >
                    <ZStack frame={{ width: 44, height: 44 }}>
                      {/* 底层：主题背景色（渐变浅端） */}
                      <RoundedRectangle frame={{ width: 44, height: 44 }} cornerRadius={10} fill={t.bgBottom} />
                      {/* 中层：渐变深端的小角块，示意渐变方向 */}
                      <RoundedRectangle
                        frame={{ width: 22, height: 22 }}
                        cornerRadius={7}
                        fill={t.bgTop}
                        offset={{ x: -8, y: -8 }}
                      />
                      {/* 前景：强调色圆点 */}
                      <RoundedRectangle frame={{ width: 16, height: 16 }} cornerRadius={8} fill={t.accent} offset={{ x: 6, y: 6 }} />
                      {/* 选中态：右上角主题色勾 */}
                      {selected ? (
                        <Image
                          systemName="checkmark.circle.fill"
                          font={14}
                          foregroundStyle={t.accent}
                          offset={{ x: 16, y: -16 }}
                        />
                      ) : null}
                    </ZStack>
                  </Button>
                )
                // 芯片之间用 Spacer 均分，让每行铺满整个宽度
                return i === 0 ? [chip] : [<Spacer key={`sp-${k}`} />, chip]
              })}
            </HStack>
          ))
        })()}
        {/* 入口徽章款式：与主题色板同款结构（Button 直接挂 HStack，实证可点） */}
        {(() => {
          const keys = BADGE_GLYPHS.map((b) => b.key)
          const rows: BadgeGlyph[][] = [keys.slice(0, 3), keys.slice(3)]
          return rows.map((row, ri) => (
            <HStack key={`badge-${ri}`} spacing={0}>
              {row.flatMap((g, i) => {
                const selected = g === badgeGlyph
                const cell = (
                  <Button
                    key={g}
                    buttonStyle="plain"
                    action={() => {
                      setBadgeGlyphLocal(g)
                      setBadgeGlyph(g) // 内部会 Widget.reloadAll()
                    }}
                  >
                    <VStack spacing={4}>
                      <ZStack frame={{ width: 64, height: 64 }}>
                        <Image
                          filePath={`${Script.directory}/assets/widget-badge-${g}-${themeKey}.png`}
                          resizable={true}
                          scaleToFit={true}
                          renderingMode="original"
                          frame={{ width: 64, height: 64 }}
                        />
                        {/* 预览与实物一致：右下角标 */}
                        <Image
                          systemName="hand.tap.fill"
                          font={18}
                          foregroundStyle={THEMES[themeKey].accent}
                          offset={{ x: 24, y: 24 }}
                        />
                      </ZStack>
                      <Text
                        font="caption2"
                        foregroundStyle={selected ? THEMES[themeKey].accent : "secondaryLabel"}
                      >
                        {selected
                          ? `● ${BADGE_GLYPHS.find((b) => b.key === g)!.label}`
                          : BADGE_GLYPHS.find((b) => b.key === g)!.label}
                      </Text>
                    </VStack>
                  </Button>
                )
                return i === 0 ? [cell] : [<Spacer key={`sp2-${g}`} />, cell]
              })}
            </HStack>
          ))
        })()}
        <HStack spacing={6}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            当前主题
          </Text>
          <RoundedRectangle frame={{ width: 10, height: 10 }} cornerRadius={5} fill={THEMES[themeKey].accent} />
          <Text font="caption" foregroundStyle="secondaryLabel">
            {THEMES[themeKey].label}
          </Text>
        </HStack>
      </Section>

      <Section
        header={
          <HStack spacing={6}>
            <Image systemName="arrow.down.to.line" font={11} foregroundStyle="secondaryLabel" />
            <Text>下载行为</Text>
          </HStack>
        }
      >
        <Button title={`默认动作：${SAVE_MODE_LABELS[draft.defaultSaveMode]}`} action={() => void chooseSaveMode()} />
        <Button title={`视频号编码：${WX_CODEC_LABELS[draft.wxCodec]}`} action={() => void chooseWxCodec()} />
        <Toggle
          title="m3u8 下载后转码为 mp4（Pro 专属，免费版自动保留 .ts）"
          value={draft.transcodeTsToMp4}
          onChanged={(v) => update({ transcodeTsToMp4: v })}
        />
        <Toggle
          title="小组件进入后自动开始下载"
          value={draft.autoStartOnEntry}
          onChanged={(v) => update({ autoStartOnEntry: v })}
        />
        <Toggle
          title="保存到相册时归入「Video Downloader」相簿"
          value={draft.photoAlbum}
          onChanged={(v) => update({ photoAlbum: v })}
        />
        <Toggle
          title="历史去重（同链接跳过下载）"
          value={draft.dedupe}
          onChanged={(v) => update({ dedupe: v })}
        />
        <Toggle
          title="多路清晰度时让我选择"
          value={draft.askQuality}
          onChanged={(v) => update({ askQuality: v })}
        />
        <VStack alignment="leading" spacing={2}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            大小上限 MB（0 = 不限）
          </Text>
          <TextField
            value={String(draft.maxMB)}
            onChanged={(v) => update({ maxMB: Math.max(0, Number(v) || 0) })}
            prompt="0"
          />
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            文件命名模板（可用 {"{title} {label} {date}"}）
          </Text>
          <TextField
            value={draft.nameTemplate}
            onChanged={(v) => update({ nameTemplate: v })}
            prompt="{title}"
          />
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            历史记录上限（超出连记录带本地文件一起删）
          </Text>
          <TextField
            value={String(draft.maxHistoryRecords)}
            onChanged={(v) => update({ maxHistoryRecords: Math.max(10, Number(v) || 200) })}
            prompt="200"
          />
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            自动清理多少天前的本地下载文件（0 = 不清理；不动相册与历史记录）
          </Text>
          <TextField
            value={String(draft.autoCleanDays)}
            onChanged={(v) => update({ autoCleanDays: Math.max(0, Number(v) || 0) })}
            prompt="0"
          />
        </VStack>
      </Section>

      <Section
        header={
          <HStack spacing={6}>
            <Image systemName="stethoscope" font={11} foregroundStyle="secondaryLabel" />
            <Text>诊断</Text>
          </HStack>
        }
        footer={
          <Text font="caption" foregroundStyle="secondaryLabel">
            开启后下载过程会写入诊断日志，可在首页「诊断中心」查看与导出。
          </Text>
        }
      >
        <Toggle title="记录诊断日志" value={draft.debugLog} onChanged={(v) => update({ debugLog: v })} />
      </Section>

      <Section
        header={
          <HStack spacing={6}>
            <Image systemName="info.circle" font={11} foregroundStyle="secondaryLabel" />
            <Text>关于</Text>
          </HStack>
        }
      >
        <HStack>
          <Text>版本</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel" monospaced>
            v{VERSION}
          </Text>
        </HStack>
        <Link url="https://github.com/KOP-XIAO/Scripting">
          <HStack spacing={4}>
            <Text>源码仓库</Text>
            <Image systemName="arrow.up.right" font={10} foregroundStyle="secondaryLabel" />
          </HStack>
        </Link>
        <Text font="caption" foregroundStyle="secondaryLabel">
          视频号本地解析移植自 ltaoo/wx_channels_download；平台解析兼容 cobalt API。
        </Text>
      </Section>
    </List>
  )
}

// -------------------------------------------------------------
// 诊断中心（终端风日志 + 范围导出）
// -------------------------------------------------------------
function DiagnosticsPage() {
  const [logs, setLogs] = useState<string[]>(getDebugLog())
  const [historyCount, setHistoryCount] = useState(0)
  const [dirs, setDirs] = useState<{ name: string; bytes: number }[]>([])
  const [totalBytes, setTotalBytes] = useState(0)

  const reloadDirs = () =>
    listDownloadDirs().then((r) => {
      setDirs(r.dirs.map((d) => ({ name: d.name, bytes: d.bytes })))
      setTotalBytes(r.totalBytes)
    })

  useEffect(() => {
    void countHistory().then(setHistoryCount).catch(() => {})
    void reloadDirs().catch(() => {})
  }, [])

  const doExport = async () => {
    // 范围选择：全部 / 最近 50 / 最近 20 / 仅错误
    const idx = await Dialog.actionSheet({
      title: "导出范围",
      message: `当前共 ${logs.length} 条诊断日志`,
      actions: [
        { label: `全部日志（${logs.length} 条）` },
        { label: "最近 50 条" },
        { label: "最近 20 条" },
        { label: "仅错误与失败" },
      ],
      cancelButton: true,
    })
    if (idx == null || idx < 0) return
    const picked: { logs: string[]; label: string } =
      idx === 0
        ? { logs, label: `全部（${logs.length} 条）` }
        : idx === 1
          ? { logs: logs.slice(-50), label: "最近 50 条" }
          : idx === 2
            ? { logs: logs.slice(-20), label: "最近 20 条" }
            : { logs: logs.filter((l) => ERROR_LINE_RE.test(l)), label: "仅错误与失败" }
    try {
      const path = await exportDebugPackage({ historyCount }, picked)
      await ShareSheet.present([path])
    } catch (e) {
      await Dialog.alert({ title: "导出失败", message: String(e) })
    }
  }

  const shown = logs.slice(-40).reverse()

  return (
    <List navigationTitle="诊断中心" navigationBarTitleDisplayMode="inline">
      <Section title="概览">
        <HStack>
          <Text>版本</Text>
          <Spacer />
          <Text monospaced foregroundStyle="secondaryLabel">
            v{VERSION}
          </Text>
        </HStack>
        <HStack>
          <Text>历史记录</Text>
          <Spacer />
          <Text monospaced foregroundStyle="secondaryLabel">
            {historyCount}
          </Text>
        </HStack>
        <HStack>
          <Text>诊断日志</Text>
          <Spacer />
          <Text monospaced foregroundStyle="secondaryLabel">
            {logs.length}
          </Text>
        </HStack>
        {(() => {
          const bf = Storage.get<{ at: string; need: number; fixed: number; skippedNoFile: number }>(
            "vdl.lastBackfill",
          )
          return (
            <HStack>
              <Text>上次回填</Text>
              <Spacer />
              <Text monospaced foregroundStyle="secondaryLabel">
                {bf
                  ? `需补 ${bf.need} · 已补 ${bf.fixed} · 无本地文件 ${bf.skippedNoFile}`
                  : "未运行过（本次打开后会自动执行）"}
              </Text>
            </HStack>
          )
        })()}
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
          下载目录：{FileManager.documentsDirectory}/Video/Downloads
        </Text>
      </Section>

      <Section title="存储管理">
        <HStack>
          <Text>下载目录占用</Text>
          <Spacer />
          <Text monospaced foregroundStyle="secondaryLabel">
            {formatBytes(totalBytes)}
          </Text>
        </HStack>
        {dirs.slice(0, 5).map((d) => (
          <HStack key={d.name}>
            <Text font="caption" lineLimit={1}>
              {d.name}
            </Text>
            <Spacer />
            <Text font="caption" monospaced foregroundStyle="secondaryLabel">
              {formatBytes(d.bytes)}
            </Text>
          </HStack>
        ))}
        <Button
          title="清空下载目录"
          role="destructive"
          action={async () => {
            const ok = await Dialog.confirm({
              title: "清空下载目录",
              message: "删除所有本地下载文件（历史记录保留，会显示文件已不存在）。",
              confirmLabel: "清空",
            })
            if (ok) await clearDownloadDirs().then(() => reloadDirs())
          }}
        />
      </Section>

      <Section title="操作">
        <Button title="导出诊断包（可选范围）" action={() => void doExport()} />
        <Button
          title="导出设置到剪贴板"
          action={async () => {
            const prefs = getPreferences()
            const { cobaltApi, ...rest } = { ...prefs } as any
            const out = { ...rest, cobaltApi: prefs.cobaltApi ? "<已配置>" : "" }
            await Pasteboard.setString(JSON.stringify(out, null, 2))
            await Dialog.alert({ message: "设置 JSON 已复制（不含 Cookie）。粘贴回任何文本处即可备份。" })
          }}
        />
        <Button
          title="从剪贴板导入设置"
          action={async () => {
            const text = (await Pasteboard.getString()) ?? ""
            try {
              const data = JSON.parse(text)
              if (typeof data !== "object" || !data) throw new Error("not json")
              const merged = { ...getPreferences(), ...data }
              persistPreferences(merged)
              await Dialog.alert({ message: "设置已导入。返回设置页查看生效。" })
            } catch {
              await Dialog.alert({ message: "剪贴板里不是有效的设置 JSON" })
            }
          }}
        />
        <Button
          title="清空诊断日志"
          role="destructive"
          action={() => {
            clearDebugLog()
            setLogs([])
          }}
        />
      </Section>

      <Section
        header={
          <HStack spacing={6}>
            <Image systemName="terminal" font={11} foregroundStyle="secondaryLabel" />
            <Text>日志终端</Text>
          </HStack>
        }
        footer={
          <Text font="caption" foregroundStyle="secondaryLabel">
            红色为错误/失败行；导出时可只选这部分。此处显示最近 40 条。
          </Text>
        }
      >
        {shown.length === 0 ? (
          <Text foregroundStyle="secondaryLabel">暂无日志。</Text>
        ) : (
          <ZStack>
            <RoundedRectangle cornerRadius={10} fill="#0D1117" />
            <VStack alignment="leading" spacing={3} padding={10}>
              <Text font="caption2" monospaced foregroundStyle={getTheme().accent}>
                vdl@ios:~$ diag --tail 40
              </Text>
              {shown.map((l, i) => (
                <Text
                  key={i}
                  font="caption2"
                  monospaced
                  foregroundStyle={ERROR_LINE_RE.test(l) ? "#F85149" : "#3FB950"}
                  lineLimit={2}
                >
                  {l}
                </Text>
              ))}
            </VStack>
          </ZStack>
        )}
      </Section>
    </List>
  )
}

// -------------------------------------------------------------
// 全部历史页
// -------------------------------------------------------------
function HistoryPage(props: { history: HistoryRecord[]; onChanged: () => Promise<void> }) {
  const { history, onChanged } = props
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const filtered = q
    ? history.filter((r) => (r.title + r.file_name + r.note + r.kind).toLowerCase().includes(q))
    : history

  return (
    <List navigationTitle="全部下载历史" navigationBarTitleDisplayMode="inline">
      <Section>
        <TextField title="搜索（标题/来源/格式）" value={query} onChanged={setQuery} prompt="输入关键词过滤" />
      </Section>
      <Section
        footer={
          <Text font="caption" foregroundStyle="secondaryLabel">
            点按记录打开操作面板；{q ? `筛选出 ${filtered.length} / ${history.length} 条` : `共 ${history.length} 条`}
          </Text>
        }
      >
        {filtered.map((item, i) => (
          <HistoryRow key={item.id} item={item} index={i} onChanged={onChanged} />
        ))}
      </Section>
    </List>
  )
}

// -------------------------------------------------------------
// 主页面
// -------------------------------------------------------------
function View() {
  const dismiss = Navigation.useDismiss()
  const [prefs, setPrefs] = useState<Preferences>(getPreferences())
  const [inputURL, setInputURL] = useState("")
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [status, setStatus] = useState("就绪")
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [lastFiles, setLastFiles] = useState<DownloadedFile[]>([])
  const [celebrate, setCelebrate] = useState(false)

  const fireConfetti = () => {
    setCelebrate(true)
    setTimeout(() => setCelebrate(false), 1900) // 1.9s 自动消失
  }

  const refreshHistory = async () => {
    setHistory(await listHistory(50))
    // 历史变化后主动通知主屏幕小组件重渲染
    try {
      Widget.reloadAll()
    } catch {}
  }

  useEffect(() => {
    void initDatabase()
      .then(() => backfillMediaInfo()) // 老记录回填时长/清晰度（文件还在本地的话）
      .then(async () => {
        // 自动清理 N 天前的本地下载目录
        const days = getPreferences().autoCleanDays
        if (days > 0) {
          const n = await autoCleanDownloads(days)
          if (n > 0) appendDebug(`自动清理：删除 ${n} 个过期下载目录`)
        }
      })
      .then(refreshHistory)
      .then(() => ensureWidgetSnapshot()) // 重算小组件快照
    // 小组件/快捷指令跳转进入时（scripting://run_single/<name>?autopaste=1）自动读剪贴板
    const qp = Script.queryParameters
    if (qp && String(qp.autopaste) === "1") {
      void (async () => {
        const text = await Pasteboard.getString()
        const found = text ? extractFirstURL(text) : null
        if (found) {
          setInputURL(found)
          if (getPreferences().autoStartOnEntry) {
            setStatus("已填入剪贴板链接，自动开始下载…")
            void handleDownload(found)
          } else {
            setStatus("已填入剪贴板链接，点击底部「开始下载」")
          }
        }
      })()
    }
  }, [])

  const savePrefs = (p: Preferences) => {
    setPrefs(p)
    persistPreferences(p)
  }


  // 底部按钮：剪贴板有链接 → 填入并开始；否则用输入框已有内容；都没有才提示
  const pasteAndDownload = async () => {
    if (loading) return
    const text = await Pasteboard.getString()
    const found = text ? extractFirstURL(text) : null
    if (found) {
      setInputURL(found)
      void handleDownload(found)
      return
    }
    if (extractFirstURL(inputURL)) {
      void handleDownload()
      return
    }
    await Dialog.alert({ message: "剪贴板和输入框里都没有 http(s) 链接" })
  }

  const handleDownload = async (directUrl?: string) => {
    if (loading) return
    const url = directUrl ?? extractFirstURL(inputURL) ?? ""
    if (!url) {
      await Dialog.alert({ message: "请先输入有效的视频链接" })
      return
    }
    setLoading(true)
    setLogs([])
    setLastFiles([])
    setProgress(null)

    const log = (line: string) => {
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, "0")
      setLogs((prev) => [...prev, `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}] ${line}`])
    }
    try {
      // 历史去重：文件还在本地，或已标记"已存入相册"，都视为已下载
      if (prefs.dedupe) {
        const dup = (await findBySourceURL(url)).filter(Boolean)[0]
        if (dup) {
          const fileExists = await FileManager.exists(dup.file_path)
          const inPhotos = dup.note.includes("相册")
          if (fileExists || inPhotos) {
            setStatus(
              `已在历史中（${formatDate(dup.created_at)}${inPhotos && !fileExists ? "，已存入相册" : ""}），跳过重复下载`,
            )
            if (fileExists) {
              setLastFiles([
                { path: dup.file_path, name: dup.file_name, bytes: dup.bytes_written, durationSec: dup.duration_sec },
              ])
            }
            setLoading(false)
            return
          }
        }
      }

      setStatus("正在下载…")
      const outcome: DownloadOutcome = await runDownload(url, {
        prefs,
        onLog: log,
        onProgress: (done, total) => setProgress({ done, total }),
        onChooseVariants: prefs.askQuality
          ? async (videos, title) => {
              const idx = await Dialog.actionSheet({
                title: "选择清晰度/编码",
                message: title,
                actions: videos.map((v) => ({ label: v.label || v.ext })),
                cancelButton: true,
              })
              return idx == null || idx < 0 ? [] : [videos[idx]]
            }
          : undefined,
      })

      const inserted: string[] = []
      for (const f of outcome.files) {
        const rec = await insertHistory({
          sourceURL: url,
          kind: outcome.kind,
          title: outcome.title,
          filePath: f.path,
          fileName: f.name,
          bytesWritten: f.bytes,
          durationSec: f.durationSec,
          resolution: f.height ? resolutionLabel(f.width ?? 0, f.height) : "",
          format: f.format ?? "",
          note: outcome.sourceLabel,
        })
        inserted.push(rec.id)
      }
      await refreshHistory()
      setLastFiles(outcome.files)

      const action = await postDownloadAction(outcome.files, prefs.defaultSaveMode)
      // 移入相册后本地副本已不存在，标记历史记录避免误导
      if (action.savedToPhotos) {
        for (const id of inserted) await updateHistoryNote(id, "已存入相册")
        await refreshHistory()
        setLastFiles([])
      }
      setStatus(action.message)
      appendDebug(`下载完成: ${outcome.title} (${outcome.files.length} 个文件) -> ${action.message}`)
      fireConfetti()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setStatus(`失败：${message}`)
      appendDebug(`下载失败: ${message}`)
      await Dialog.alert({ title: "下载失败", message })
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const handleClearHistory = async () => {
    const ok = await Dialog.confirm({
      title: "清空历史记录",
      message: "只删除记录，不删除已下载的视频文件。",
      confirmLabel: "清空",
    })
    if (ok) {
      await clearHistoryRecords()
      await refreshHistory()
    }
  }

  const kindHint = extractFirstURL(inputURL) ? KIND_LABELS[detectKind(extractFirstURL(inputURL)!)] : "-"

  return (
    <NavigationStack>
      <ZStack>
      <List
        navigationTitle={`视频下载器 Lite | v${VERSION}`}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          bottomBar: (
            <Button
              title={loading ? "下载中…" : "⬇  粘贴并下载"}
              disabled={loading}
              action={() => void pasteAndDownload()}
            />
          ),
        }}
      >
        <Section
          header={<Text>下载链接</Text>}
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              支持：视频号 / 抖音 / m3u8 / 直链 / 平台链接。复制链接后点底部「粘贴并下载」一键开始；
              在其它 App 里也可直接分享到本脚本。当前识别：{kindHint}　·　v{VERSION}
            </Text>
          }
        >
          <TextField
            title="视频链接"
            value={inputURL}
            onChanged={setInputURL}
            prompt="粘贴或输入链接（也可手动编辑）"
          />
        </Section>

        <Section title="状态">
          {loading && progress ? (
            <VStack alignment="leading" spacing={4}>
              {/* 终端风 ASCII 进度条：[██████░░░░] 63% */}
              <Text font="caption" monospaced foregroundStyle={getTheme().accent}>
                {asciiBar(progress.done, progress.total)}
              </Text>
              <Text font="caption2" monospaced foregroundStyle="secondaryLabel">
                {`分片 ${progress.done}/${progress.total}`}
              </Text>
            </VStack>
          ) : (
            <Text foregroundStyle={status.startsWith("失败") ? "systemRed" : "secondaryLabel"}>
              {status}
            </Text>
          )}
        </Section>

        {logs.length > 0 ? (
          <Section
            header={
              <HStack spacing={6}>
                <Image systemName="terminal" font={11} foregroundStyle="secondaryLabel" />
                <Text>实时日志</Text>
              </HStack>
            }
          >
            {/* 终端风日志卡：深色底 + 等宽绿字，提示符用主题色 */}
            <ZStack>
              <RoundedRectangle cornerRadius={10} fill="#0D1117" />
              <VStack alignment="leading" spacing={3} padding={10}>
                <Text font="caption2" monospaced foregroundStyle={getTheme().accent}>
                  vdl@ios:~$ run
                </Text>
                {logs.map((l, i) => (
                  <Text key={i} font="caption2" monospaced foregroundStyle="#3FB950" lineLimit={2}>
                    {"▸ " + l}
                  </Text>
                ))}
                {loading ? (
                  <Text font="caption2" monospaced foregroundStyle={getTheme().accent}>
                    {"▌"}
                  </Text>
                ) : null}
              </VStack>
            </ZStack>
          </Section>
        ) : null}

        {lastFiles.length > 0 ? (
          <Section title="本次文件">
            {lastFiles.map((f) => (
              <VStack key={f.path} alignment="leading" spacing={4}>
                <Text font="headline" lineLimit={1}>
                  {f.name}
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {formatBytes(f.bytes)}
                  {canSaveToPhotos(f.name) ? "" : " · 非相册格式"}
                </Text>
                <HStack>
                  {canSaveToPhotos(f.name) ? (
                    <Button
                      title="存相册"
                      action={() =>
                        void saveFilePathToPhotos(f.path, f.name).catch(async (e) => {
                          await Dialog.alert({ title: "保存失败", message: String(e) })
                        })
                      }
                    />
                  ) : null}
                  <Button title="分享" action={() => void shareFile(f.path)} />
                  <Button
                    title="导出到文件"
                    action={() =>
                      void exportFilePathToFiles(f.path, f.name).catch(async (e) => {
                        await Dialog.alert({ title: "导出失败", message: String(e) })
                      })
                    }
                  />
                </HStack>
              </VStack>
            ))}
          </Section>
        ) : null}

        <Section
          header={<Text>{`下载历史 (${history.length})`}</Text>}
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              仅显示最近 5 条，点按记录展开详情与操作。下载先写入 App 文档目录 Video/Downloads；选择「保存到相册」后本地副本会自动移除，不再重复占用空间。
            </Text>
          }
        >
          {history.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">还没有下载历史。</Text>
          ) : (
            history.slice(0, 5).map((item, i) => (
              <HistoryRow key={item.id} item={item} index={i} onChanged={refreshHistory} />
            ))
          )}
          {history.length > 5 ? (
            <NavigationLink destination={<HistoryPage history={history} onChanged={refreshHistory} />}>
              <Text>{`查看全部 ${history.length} 条`}</Text>
            </NavigationLink>
          ) : null}
        </Section>

        <Section
          title="更多"
          footer={
            <Text font="caption" foregroundStyle="tertiaryLabel">
              v{VERSION} · 视频号本地解析移植自 ltaoo/wx_channels_download · 平台解析兼容 cobalt API
            </Text>
          }
        >
          <NavigationLink destination={<SettingsPage prefs={prefs} onSave={savePrefs} />}>
            <Text>设置</Text>
          </NavigationLink>
          <NavigationLink destination={<DiagnosticsPage />}>
            <Text>诊断中心</Text>
          </NavigationLink>
          <Button title="清空历史记录" role="destructive" action={() => void handleClearHistory()} />
        </Section>
      </List>
      {celebrate ? <ConfettiOverlay /> : null}
      </ZStack>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({ element: <View /> })
  Script.exit()
}

run()
