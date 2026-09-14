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
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  ProgressView,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
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
  type HistoryRecord,
} from "./services/history"
import { appendDebug, getDebugLog, clearDebugLog, exportDebugPackage } from "./services/debug"
import {
  postDownloadAction,
  saveFilePathToPhotos,
  exportFilePathToFiles,
  shareFile,
  canSaveToPhotos,
} from "./services/file-actions"
import { VERSION, extractFirstURL, formatBytes, formatDate, formatDuration } from "./utils/common"

declare const openURL: (url: string) => Promise<boolean>

// -------------------------------------------------------------
// 历史记录行：标题单行截断 + 元信息行（类型 · 大小 · 时长 · 日期）
// -------------------------------------------------------------
function HistoryRow(props: { item: HistoryRecord; onChanged: () => Promise<void> }) {
  const { item, onChanged } = props

  const openActions = async () => {
    const exists = await FileManager.exists(item.file_path)
    const inPhotos = item.note.includes("相册")
    // 文件不在本地时，隐藏需要文件的动作
    const fileActions = exists
      ? [
          ...(canSaveToPhotos(item.file_name) ? [{ label: "保存到相册" }] : []),
          { label: "导出到文件" },
          { label: "分享文件" },
        ]
      : []
    const actions = [
      ...fileActions,
      { label: "打开原始链接" },
      { label: "复制原始链接" },
      ...(exists
        ? [{ label: "删除记录和文件", destructive: true }]
        : [{ label: "删除记录", destructive: true }]),
    ]
    const result = await Dialog.actionSheet({
      title: item.title || item.file_name,
      message: `${formatDate(item.created_at)} · ${formatBytes(item.bytes_written)}${
        inPhotos ? " · 已存入相册" : exists ? "" : " · 文件已不存在"
      }`,
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
      if (label === "打开原始链接") await openURL(item.source_url)
      if (label === "复制原始链接") await Pasteboard.setString(item.source_url)
      if (label === "删除记录") await deleteHistoryRecord(item.id)
      if (label === "删除记录和文件") await deleteHistoryRecord(item.id, true)
      await onChanged()
    } catch (e) {
      await Dialog.alert({ title: "操作失败", message: String(e) })
    }
  }

  const meta = [
    KIND_LABELS[item.kind as keyof typeof KIND_LABELS] ?? item.kind,
    formatBytes(item.bytes_written),
    formatDuration(item.duration_sec ?? 0),
    formatDate(item.created_at),
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <VStack alignment="leading" spacing={4}>
      <Text font="headline" lineLimit={1} onTapGesture={() => void openActions()}>
        {item.title || item.file_name}
      </Text>
      <HStack spacing={6}>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {meta}
        </Text>
        {item.note.includes("相册") ? (
          <Text font="caption2" foregroundStyle="systemGreen">
            已存相册
          </Text>
        ) : null}
      </HStack>
    </VStack>
  )
}

// -------------------------------------------------------------
// 设置页
// -------------------------------------------------------------
function SettingsPage(props: { prefs: Preferences; onSave: (p: Preferences) => void }) {
  const { prefs, onSave } = props
  const [draft, setDraft] = useState<Preferences>({ ...prefs })
  const [cookieDraft, setCookieDraft] = useState<string>(getYuanbaoCookie())
  const update = (patch: Partial<Preferences>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    onSave(next)
  }

  const chooseSaveMode = async () => {
    const modes: SaveMode[] = ["ask", "photos", "files", "keep"]
    const idx = await Dialog.actionSheet({
      title: "下载完成后的默认动作",
      actions: modes.map((m) => ({ label: SAVE_MODE_LABELS[m] })),
      cancelButton: true,
    })
    if (idx >= 0) update({ defaultSaveMode: modes[idx] })
  }

  const chooseWxCodec = async () => {
    const codecs: WxCodec[] = ["h264", "h265", "both"]
    const idx = await Dialog.actionSheet({
      title: "视频号编码偏好",
      message: "视频号解析会同时返回 H.264 / H.265 两种地址。",
      actions: codecs.map((c) => ({ label: WX_CODEC_LABELS[c] })),
      cancelButton: true,
    })
    if (idx >= 0) update({ wxCodec: codecs[idx] })
  }

  return (
    <List navigationTitle="设置" navigationBarTitleDisplayMode="inline">
      <Section
        header={<Text>视频号解析</Text>}
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
          prompt="pgv_pvid=...; pac_uid=...（可留空尝试在线服务）"
        />
        <Text font="caption" foregroundStyle={cookieDraft.trim() ? "systemGreen" : "secondaryLabel"}>
          {cookieDraft.trim() ? "✓ 已配置，视频号将走本地解析" : "未配置：视频号走在线服务（可能不可用）"}
        </Text>
      </Section>

      <Section
        header={<Text>平台解析</Text>}
        footer={
          <Text font="caption" foregroundStyle="secondaryLabel">
            用于 YouTube、B站、X、抖音等平台链接。填自建或信任的 cobalt 兼容实例地址，脚本向其
            POST /api/json 换取直链。留空则平台链接不可用。
          </Text>
        }
      >
        <TextField
          title="解析实例"
          value={draft.cobaltApi}
          onChanged={(v) => update({ cobaltApi: v })}
          prompt="https://cobalt.example.com"
        />
      </Section>

      <Section title="下载行为">
        <Button title={`默认动作：${SAVE_MODE_LABELS[draft.defaultSaveMode]}`} action={() => void chooseSaveMode()} />
        <Button title={`视频号编码：${WX_CODEC_LABELS[draft.wxCodec]}`} action={() => void chooseWxCodec()} />
        <Toggle
          title="m3u8 下载后转码为 mp4（较慢）"
          value={draft.transcodeTsToMp4}
          onChanged={(v) => update({ transcodeTsToMp4: v })}
        />
        <Toggle
          title="历史去重（同链接跳过下载）"
          value={draft.dedupe}
          onChanged={(v) => update({ dedupe: v })}
        />
        <TextField
          title="大小上限 MB（0 = 不限）"
          value={String(draft.maxMB)}
          onChanged={(v) => update({ maxMB: Math.max(0, Number(v) || 0) })}
        />
      </Section>

      <Section
        title="诊断"
        footer={
          <Text font="caption" foregroundStyle="secondaryLabel">
            开启后下载过程会写入诊断日志，可在「诊断中心」查看与导出。
          </Text>
        }
      >
        <Toggle title="记录诊断日志" value={draft.debugLog} onChanged={(v) => update({ debugLog: v })} />
      </Section>
    </List>
  )
}

// -------------------------------------------------------------
// 诊断中心
// -------------------------------------------------------------
function DiagnosticsPage() {
  const [logs, setLogs] = useState<string[]>(getDebugLog())
  const [historyCount, setHistoryCount] = useState(0)

  useEffect(() => {
    void countHistory().then(setHistoryCount).catch(() => {})
  }, [])

  const doExport = async () => {
    try {
      const path = await exportDebugPackage({ historyCount })
      await ShareSheet.present([path])
    } catch (e) {
      await Dialog.alert({ title: "导出失败", message: String(e) })
    }
  }

  return (
    <List navigationTitle="诊断中心" navigationBarTitleDisplayMode="inline">
      <Section title="概览">
        <Text>版本：{VERSION}</Text>
        <Text>历史记录：{historyCount} 条</Text>
        <Text>诊断日志：{logs.length} 条</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
          下载目录：{FileManager.documentsDirectory}/Video/Downloads
        </Text>
      </Section>

      <Section title="操作">
        <Button title="导出诊断包并分享" action={() => void doExport()} />
        <Button
          title="清空诊断日志"
          role="destructive"
          action={() => {
            clearDebugLog()
            setLogs([])
          }}
        />
      </Section>

      <Section title="最近日志">
        {logs.length === 0 ? (
          <Text foregroundStyle="secondaryLabel">暂无日志。</Text>
        ) : (
          logs
            .slice(-40)
            .reverse()
            .map((l, i) => (
              <Text key={i} font="caption" foregroundStyle="secondaryLabel">
                {l}
              </Text>
            ))
        )}
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

  const refreshHistory = async () => setHistory(await listHistory(50))

  useEffect(() => {
    void initDatabase().then(refreshHistory)
    // 小组件/快捷指令跳转进入时（scripting://run_single/<name>?autopaste=1）自动读剪贴板
    const qp = Script.queryParameters
    if (qp && String(qp.autopaste) === "1") {
      void (async () => {
        const text = await Pasteboard.getString()
        const found = text ? extractFirstURL(text) : null
        if (found) {
          setInputURL(found)
          setStatus("已填入剪贴板链接，点击「开始下载」")
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

  const handleDownload = async () => {
    if (loading) return
    const url = extractFirstURL(inputURL) ?? ""
    if (!url) {
      await Dialog.alert({ message: "请先输入有效的视频链接" })
      return
    }
    setLoading(true)
    setLogs([])
    setLastFiles([])
    setProgress(null)

    const log = (line: string) => setLogs((prev) => [...prev, line])
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
      <List
        navigationTitle="视频下载器"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}
      >
        <Section
          header={<Text>下载链接</Text>}
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              支持：微信视频号分享链接 / m3u8 / mp4 直链 / 平台链接（需解析实例）。
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
          <HStack>
            <Button title="从剪贴板粘贴" action={() => void pasteFromClipboard()} />
            <Spacer />
            <Button title={loading ? "下载中…" : "开始下载"} action={() => void handleDownload()} />
          </HStack>
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
          <Section title="本次日志">
            {logs.map((l, i) => (
              <Text key={i} font="caption" foregroundStyle="secondaryLabel">
                {l}
              </Text>
            ))}
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
              点击记录可打开更多操作。下载先写入 App 文档目录 Video/Downloads；选择「保存到相册」后本地副本会自动移除，不再重复占用空间。
            </Text>
          }
        >
          {history.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">还没有下载历史。</Text>
          ) : (
            history.slice(0, 30).map((item) => (
              <HistoryRow key={item.id} item={item} onChanged={refreshHistory} />
            ))
          )}
        </Section>

        <Section title="更多">
          <NavigationLink destination={<SettingsPage prefs={prefs} onSave={savePrefs} />}>
            <Text>设置</Text>
          </NavigationLink>
          <NavigationLink destination={<DiagnosticsPage />}>
            <Text>诊断中心</Text>
          </NavigationLink>
          <Button title="清空历史记录" role="destructive" action={() => void handleClearHistory()} />
        </Section>

        <Section
          footer={
            <Text font="caption" foregroundStyle="tertiaryLabel">
              v{VERSION} · 视频号解析服务由 sph.litao.workers.dev 提供 · 移植自 z-video-downloader skill
            </Text>
          }
        >
          <Text>{""}</Text>
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({ element: <View /> })
  Script.exit()
}

run()
