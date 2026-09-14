// services/debug.ts — 诊断日志环形缓冲 + 诊断包导出
// Storage / FileManager 为全局对象，禁止从 scripting 导入

import { Path } from "scripting"
import { getPreferences } from "./preferences"
import { VERSION, todayStr } from "../utils/common"

const KEY_DEBUG = "vdl.debug"
const MAX_LINES = 120

export function appendDebug(line: string) {
  try {
    if (!getPreferences().debugLog) return
    const log = Storage.get<string[]>(KEY_DEBUG) ?? []
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, "0")
    const stamp = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    log.push(`[${stamp}] ${line}`.slice(0, 500))
    Storage.set(KEY_DEBUG, log.slice(-MAX_LINES))
  } catch {}
}

export function getDebugLog(): string[] {
  return Storage.get<string[]>(KEY_DEBUG) ?? []
}

export function clearDebugLog() {
  Storage.remove(KEY_DEBUG)
}

// 错误/失败行识别（诊断中心高亮与范围导出共用）
export const ERROR_LINE_RE = /失败|错误|error|HTTP \d|errCode|超时|timeout|abort/i

// 汇总设置快照（脱敏）与日志写成文本文件，返回路径供 ShareSheet 分享。
// opts.logs 可指定导出的日志子集（范围导出）；opts.label 进入文件名。
export async function exportDebugPackage(
  extra?: Record<string, unknown>,
  opts?: { logs?: string[]; label?: string },
): Promise<string> {
  const prefs = getPreferences()
  const masked = { ...prefs, cobaltApi: prefs.cobaltApi ? "<已配置>" : "<未配置>" }
  const logs = opts?.logs ?? getDebugLog()
  const lines = [
    `# Video Downloader 诊断包`,
    ``,
    `- 版本: ${VERSION}`,
    `- 导出时间: ${new Date().toISOString()}`,
    `- 日志范围: ${opts?.label ?? `全部（${logs.length} 条）`}`,
    `- 文档目录: ${FileManager.documentsDirectory}`,
    ``,
    `## 设置`,
    "```json",
    JSON.stringify(masked, null, 2),
    "```",
    ``,
    extra ? `## 附加上下文\n\`\`\`json\n${JSON.stringify(extra, null, 2)}\n\`\`\`\n` : "",
    `## 日志（${logs.length} 条）`,
    "```",
    ...logs,
    "```",
    ``,
  ]
  const dir = Path.join(FileManager.documentsDirectory, "Video", "Downloads")
  await FileManager.createDirectory(dir, true)
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  const path = Path.join(
    dir,
    `debug-${todayStr()}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.md`,
  )
  await FileManager.writeAsString(path, lines.join("\n"))
  return path
}
