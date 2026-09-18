// intent.tsx — 分享表单 / 快捷指令入口（无界面式，仿社区抖音下载器的实证模式）
// 配置：编辑器标题栏点项目名 → Intent Settings → 勾选 URLs 和 Text
// 之后在微信 / Safari / YouTube 等 App 里点分享 → Scripting → 本脚本即可。
// 全局对象（禁止从 scripting 导入）：Storage、Dialog、Pasteboard、FileManager

import { Intent, Script, Widget } from "scripting"
import { runDownload, detectKind, KIND_LABELS } from "./services/downloader"
import { getPreferences } from "./services/preferences"
import { initDatabase, findBySourceURL, insertHistory, updateHistoryNote } from "./services/history"
import { appendDebug } from "./services/debug"
import { postDownloadAction } from "./services/file-actions"
import { extractFirstURL } from "./utils/common"

function resolveInputURL(): string | null {
  if (Intent.urlsParameter?.length) {
    return Intent.urlsParameter[0]
  }
  if (Intent.textsParameter?.length) {
    for (const text of Intent.textsParameter) {
      const found = extractFirstURL(text)
      if (found) return found
    }
  }
  const shortcut = Intent.shortcutParameter
  if (shortcut && typeof shortcut.value === "string") {
    return extractFirstURL(shortcut.value)
  }
  return null
}

async function handleError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  appendDebug(`intent 失败: ${message}`)
  await Pasteboard.setString(message)
  await Dialog.alert({
    title: "下载失败",
    message: `${message}\n\n错误信息已复制到剪贴板。`,
    buttonLabel: "好",
  })
  Script.exit(Intent.text(`下载失败：${message}`))
}

async function run() {
  try {
    const url = resolveInputURL()
    if (!url) {
      throw new Error("未从分享内容中找到可用链接，请确认分享的是视频链接或包含 URL 的文本。")
    }

    const prefs = getPreferences()
    await initDatabase()
    const kind = detectKind(url)
    appendDebug(`intent 收到: ${url} (${KIND_LABELS[kind]})`)

    // 历史去重：文件还在本地，或已存入相册，都直接复用记录
    if (prefs.dedupe) {
      const dup = (await findBySourceURL(url)).filter(Boolean)[0]
      if (dup) {
        const fileExists = await FileManager.exists(dup.file_path)
        const inPhotos = dup.note.includes("相册")
        if (fileExists || inPhotos) {
          if (fileExists) {
            const action = await postDownloadAction(
              [{ path: dup.file_path, name: dup.file_name, bytes: dup.bytes_written, durationSec: dup.duration_sec }],
              prefs.defaultSaveMode,
            )
            if (action.savedToPhotos) await updateHistoryNote(dup.id, "已存入相册")
            Script.exit(
              Intent.json({
                ok: true,
                deduped: true,
                message: `已在历史中，未重复下载。${action.message}`,
                title: dup.title,
                localFilePath: dup.file_path,
              }),
            )
          } else {
            Script.exit(
              Intent.json({
                ok: true,
                deduped: true,
                message: `已在历史中且已存入相册（${dup.title}），未重复下载。`,
                title: dup.title,
              }),
            )
          }
          return
        }
      }
    }

    const logs: string[] = []
    const outcome = await runDownload(url, { prefs, onLog: (l) => logs.push(l) })

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
        resolution: f.height ? `${Math.min(f.width ?? 0, f.height)}p` : "",
        format: f.format ?? "",
        note: outcome.sourceLabel,
      })
      inserted.push(rec.id)
    }

    const action = await postDownloadAction(outcome.files, prefs.defaultSaveMode)
    if (action.savedToPhotos) {
      for (const id of inserted) await updateHistoryNote(id, "已存入相册")
    }
    // 历史已变，通知小组件重渲染
    try {
      Widget.reloadAll()
    } catch {}
    const message = action.message
    appendDebug(`intent 完成: ${outcome.title} -> ${message}`)

    if (outcome.files.length === 1) {
      // 单文件：直接输出文件，快捷指令可以继续处理（移动/转存/分享）
      Script.exit(Intent.file(outcome.files[0].path))
    } else {
      Script.exit(
        Intent.json({
          ok: true,
          kind: outcome.kind,
          title: outcome.title,
          files: outcome.files.map((f) => ({ path: f.path, name: f.name, bytes: f.bytes })),
          message,
          logs,
        }),
      )
    }
  } catch (error) {
    await handleError(error)
  }
}

run()
