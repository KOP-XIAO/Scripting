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
  type HistoryRecord,
} from "./services/history"
import { appendDebug, getDebugLog, clearDebugLog, exportDebugPackage, ERROR_LINE_RE } from "./services/debug"
import {
  postDownloadAction,
  saveFilePathToPhotos,
  exportFilePathToFiles,
  shareFile,
  canSaveToPhotos,
} from "./services/file-actions"
import { VERSION, extractFirstURL, formatBytes, formatDate, formatDuration, prettySource } from "./utils/common"
import { getTheme, getThemeKey, setThemeKey, THEMES, type ThemeKey } from "./services/theme"

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
  dur: number
}

function newConfettiPieces(): ConfettiPiece[] {
  return Array.from({ length: 18 }, (_, i) => ({
    emoji: CONFETTI_EMOJI[i % CONFETTI_EMOJI.length],
    x: (Math.random() - 0.5) * 300,
    y0: -140 - Math.random() * 160,
    y1: 380 + Math.random() * 120,
    drift: (Math.random() - 0.5) * 60,
    size: 16 + Math.random() * 18,
    dur: 1.0 + Math.random() * 0.5,
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

  useEffect(() => {
    const t1 = setTimeout(() => setGo(true), 40)
    const t2 = setTimeout(() => setFade(0), 1350)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never}
      opacity={fade}
      animation={{ animation: NativeAnim.easeOut(0.45), value: fade }}
    >
      <VStack
        spacing={8}
        offset={{ x: 0, y: go ? 0 : 30 }}
        animation={{ animation: NativeAnim.spring({ duration: 0.45, bounce: 0.4 }), value: go }}
      >
        <Text font={54}>🎉</Text>
        <Text font="title3" fontWeight="bold" foregroundStyle="#F0F3F6">
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

// ---- JS 兜底路径（30fps，easeIn(t²)）----
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
  const pop = Math.min(1, t / 0.25)
  const popEased = 1 - Math.pow(1 - pop, 3)
  const overshoot = pop < 1 ? Math.sin(pop * Math.PI) * 8 : 0

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never} opacity={fade}>
      <VStack spacing={8} offset={{ x: 0, y: (1 - popEased) * 24 - overshoot }}>
        <Text font={54}>🎉</Text>
        <Text font="title3" fontWeight="bold" foregroundStyle="#F0F3F6">
          下载完成
        </Text>
      </VStack>
      {pieces.map((p2, i) => {
        const pt = Math.min(1, (t / 1.2) * (1 / (p2.dur * 0.85)))
        const eased = pt * pt
        const y = p2.y0 + (p2.y1 - p2.y0) * eased
        const x = p2.x + Math.sin(pt * Math.PI) * p2.drift
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

// -------------------------------------------------------------
// 历史记录：摘要行（点击展开详情）+ 详情卡（纯信息展示）
// 操作按钮不放行内——该运行时中嵌套在自定义容器里的 Button 热区会串扰；
// 它们由父级 renderHistoryActionRows 作为 Section 直属行渲染（与设置页按钮同级，实证可靠）
// -------------------------------------------------------------
function HistoryRow(props: {
  item: HistoryRecord
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const { item, index, expanded } = props
  const [fileExists, setFileExists] = useState<boolean | null>(null)

  useEffect(() => {
    if (expanded && fileExists === null) {
      void FileManager.exists(item.file_path).then(setFileExists).catch(() => setFileExists(false))
    }
  }, [expanded])

  const inPhotos = item.note.includes("相册")
  const noteSource = item.note.split("·").filter((x) => x && !x.includes("相册")).join("·")
  const sourceText =
    noteSource ||
    (item.kind === "platform"
      ? `平台·${prettySource(item.source_url)}`
      : KIND_LABELS[item.kind as keyof typeof KIND_LABELS] ?? item.kind)
  const meta = [sourceText, formatBytes(item.bytes_written), formatDuration(item.duration_sec ?? 0), formatDate(item.created_at)]
    .filter(Boolean)
    .join(" · ")

  return (
    <VStack alignment="leading" spacing={6}>
      {/* 摘要行：编号 + 标题 + 元信息 + 展开指示 */}
      <HStack spacing={8} frame={{ maxWidth: "infinity" } as never} onTapGesture={props.onToggle}>
        <Text font="caption" monospaced foregroundStyle="tertiaryLabel">
          {`#${String(index + 1).padStart(2, "0")}`}
        </Text>
        <VStack alignment="leading" spacing={3}>
          <Text font="subheadline" fontWeight="medium" lineLimit={1}>
            {item.title || item.file_name}
          </Text>
          <HStack spacing={6}>
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {meta}
            </Text>
            {inPhotos ? (
              <Text font="caption2" foregroundStyle="systemGreen">
                已存相册
              </Text>
            ) : null}
          </HStack>
        </VStack>
        <Spacer />
        <Image
          systemName={expanded ? "chevron.up" : "chevron.down"}
          font={10}
          foregroundStyle="tertiaryLabel"
        />
      </HStack>

      {/* 详情卡：纯信息（按钮在 Section 直属行） */}
      {expanded ? (
        <VStack alignment="leading" spacing={3} padding={{ leading: 26 }}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            {`来源 ${sourceText} · 大小 ${formatBytes(item.bytes_written)}${
              item.duration_sec ? ` · 时长 ${formatDuration(item.duration_sec)}` : ""
            } · ${formatDate(item.created_at)}`}
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel">
            {`状态 ${inPhotos ? "已存入相册（本地副本已移除）" : fileExists ? "文件在本地" : "文件已不存在"}`}
          </Text>
          <Text font="caption2" monospaced foregroundStyle="tertiaryLabel" lineLimit={1}>
            {item.source_url}
          </Text>
        </VStack>
      ) : null}
    </VStack>
  )
}

// 展开项的操作按钮：Section 直属行（与设置页按钮同层级，热区可靠）
function renderHistoryActionRows(
  item: HistoryRecord,
  fileExistsHint: boolean,
  onChanged: () => Promise<void>,
) {
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await onChanged()
    } catch (e) {
      await Dialog.alert({ title: "操作失败", message: String(e) })
    }
  }
  const rows = []
  if (fileExistsHint && canSaveToPhotos(item.file_name)) {
    rows.push(
      <Button
        key={`${item.id}-photos`}
        title="保存到相册"
        action={() =>
          run(async () => {
            await saveFilePathToPhotos(item.file_path, item.file_name)
            await updateHistoryNote(item.id, "已存入相册")
          })
        }
      />,
    )
  }
  if (fileExistsHint) {
    rows.push(
      <Button
        key={`${item.id}-export`}
        title="导出到文件"
        action={() => run(() => exportFilePathToFiles(item.file_path, item.file_name))}
      />,
      <Button key={`${item.id}-share`} title="分享文件" action={() => run(() => shareFile(item.file_path))} />,
    )
  }
  rows.push(
    <Button
      key={`${item.id}-open`}
      title="打开原始链接"
      action={() => run(() => Safari.openURL(item.source_url))}
    />,
    <Button
      key={`${item.id}-copy`}
      title="复制原始链接"
      action={() => run(() => Pasteboard.setString(item.source_url))}
    />,
    <Button
      key={`${item.id}-del`}
      title="删除记录"
      role="destructive"
      action={() =>
        run(async () => {
          const ok = await Dialog.confirm({
            title: "删除记录",
            message: fileExistsHint ? "将同时删除已下载的文件。" : "删除这条历史记录？",
            confirmLabel: fileExistsHint ? "删除文件和记录" : "删除",
            cancelLabel: "取消",
          })
          if (ok) await deleteHistoryRecord(item.id, !!fileExistsHint)
        })
      }
    />,
  )
  return rows
}

// -------------------------------------------------------------
// 全部历史页
// -------------------------------------------------------------
function HistoryPage(props: { history: HistoryRecord[]; onChanged: () => Promise<void> }) {
  const { history, onChanged } = props
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedFileExists, setExpandedFileExists] = useState(false)

  const toggleExpand = async (item: HistoryRecord) => {
    if (expandedId === item.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(item.id)
    setExpandedFileExists(await FileManager.exists(item.file_path))
  }

  return (
    <List navigationTitle="全部下载历史" navigationBarTitleDisplayMode="inline">
      <Section
        footer={
          <Text font="caption" foregroundStyle="secondaryLabel">
            点按记录展开详情与操作；共 {history.length} 条。
          </Text>
        }
      >
        {history.flatMap((item, i) => {
          const expanded = expandedId === item.id
          const rows = [
            <HistoryRow
              key={item.id}
              item={item}
              index={i}
              expanded={expanded}
              onToggle={() => void toggleExpand(item)}
            />,
          ]
          if (expanded) {
            rows.push(...renderHistoryActionRows(item, expandedFileExists, onChanged))
          }
          return rows
        })}
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
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedFileExists, setExpandedFileExists] = useState(false)

  const toggleExpand = async (item: HistoryRecord) => {
    if (expandedId === item.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(item.id)
    setExpandedFileExists(await FileManager.exists(item.file_path))
  }

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
      .then(refreshHistory)
      .then(() => ensureWidgetSnapshot()) // 老版本升级：回填小组件快照
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

  const pasteFromClipboard = async () => {
    const text = await Pasteboard.getString()
    const found = text ? extractFirstURL(text) : null
    if (found) setInputURL(found)
    else await Dialog.alert({ message: "剪贴板里没有找到 http(s) 链接" })
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
        navigationTitle="视频下载器 Lite"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          bottomBar: (
            <Button
              title={loading ? "下载中…" : "⬇  开始下载"}
              disabled={loading}
              action={() => void handleDownload()}
            />
          ),
        }}
      >
        <Section
          header={<Text>下载链接</Text>}
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              支持：微信视频号分享链接 / 抖音（无水印）/ m3u8 / mp4 直链 / 平台链接（需解析实例）。
              当前识别：{kindHint}
            </Text>
          }
        >
          <TextField
            title="视频链接"
            value={inputURL}
            onChanged={setInputURL}
            prompt="粘贴或输入链接"
          />
          <Button title="从剪贴板粘贴" action={() => void pasteFromClipboard()} />
        </Section>

        <Section title="状态">
          {loading && progress ? (
            <VStack alignment="leading" spacing={8}>
              <ProgressView value={progress.done / Math.max(progress.total, 1)} total={1} />
              <Text font="caption">
                分片 {progress.done}/{progress.total}
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
            history.slice(0, 5).flatMap((item, i) => {
              const expanded = expandedId === item.id
              const rows = [
                <HistoryRow
                  key={item.id}
                  item={item}
                  index={i}
                  expanded={expanded}
                  onToggle={() => void toggleExpand(item)}
                />,
              ]
              if (expanded) {
                rows.push(...renderHistoryActionRows(item, expandedFileExists, refreshHistory))
              }
              return rows
            })
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
