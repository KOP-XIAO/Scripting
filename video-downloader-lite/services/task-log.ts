// 每次发起下载对应一条记录；独立于系统诊断缓冲，按任务 id 隔离。
import { newId, hostOf } from "../utils/common"

export type TaskStatus = "running" | "success" | "failed" | "skipped" | "cancelled"
export type TaskLog = {
  id: string
  url: string
  title: string
  entry: "app" | "intent"
  startedAt: string
  endedAt?: string
  status: TaskStatus
  message: string
  lines: string[]
}
const KEY = "vdl.taskLogs"
export const MAX_TASKS = 30
export const MAX_TASK_LINES = 120
const listeners = new Set<() => void>()
const activeTasks = new Set<string>()
export function isTaskActive(id: string) { return activeTasks.has(id) }

export function getTaskLogs(): TaskLog[] {
  try {
    const saved = Storage.get<TaskLog[]>(KEY)
    return Array.isArray(saved) ? saved : []
  } catch { return [] }
}
function write(tasks: TaskLog[]) {
  try { Storage.set(KEY, tasks.slice(0, MAX_TASKS)) } catch { return }
  listeners.forEach(fn => { try { fn() } catch {} })
}
export function subscribeTaskLogs(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export function clearTaskLogs() { write([]) }

export function beginTaskLog(url: string, entry: TaskLog["entry"]): string {
  const task: TaskLog = {
    id: newId(), url, title: hostOf(url) || "下载任务", entry,
    startedAt: new Date().toISOString(), status: "running", message: "准备下载", lines: [],
  }
  activeTasks.add(task.id)
  write([task, ...getTaskLogs()])
  return task.id
}
export function appendTaskLog(id: string, line: string) {
  const stamp = new Date().toLocaleTimeString()
  write(getTaskLogs().map(task => task.id === id
    ? { ...task, message: line.slice(0, 180), lines: [...task.lines, `[${stamp}] ${line}`.slice(0, 1000)].slice(-MAX_TASK_LINES) }
    : task))
}
export function titleTaskLog(id: string, title: string) {
  if (!title.trim()) return
  write(getTaskLogs().map(task => task.id === id ? { ...task, title } : task))
}
export function finishTaskLog(id: string, status: Exclude<TaskStatus, "running">, message: string) {
  activeTasks.delete(id)
  write(getTaskLogs().map(task => task.id === id
    ? { ...task, status, message, endedAt: new Date().toISOString() }
    : task))
}
export function taskLogText(task: TaskLog): string[] {
  return [
    `任务：${task.title}`, `任务编号：${task.id}`, `链接：${task.url}`,
    `入口：${task.entry === "app" ? "应用内" : "分享/快捷指令"}`,
    `开始：${task.startedAt}`, `结束：${task.endedAt ?? "未结束"}`,
    `结果：${task.status} · ${task.message}`, "", ...task.lines,
  ]
}
