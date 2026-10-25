import { Button, HStack, Image, List, NavigationLink, Section, Spacer, Text, VStack, useEffect, useState } from "scripting"
import { getTaskLogs, subscribeTaskLogs, taskLogText, isTaskActive, MAX_TASKS, MAX_TASK_LINES, type TaskLog } from "../services/task-log"
import { ERROR_LINE_RE, exportDebugPackage } from "../services/debug"
import { formatDate } from "../utils/common"
import { getTheme } from "../services/theme"

const LABELS = { running: "未完成", success: "完成", failed: "失败", skipped: "已跳过", cancelled: "已取消" }
function taskStatus(task: TaskLog) {
  return task.status === "running" && isTaskActive(task.id) ? "进行中" : LABELS[task.status]
}
function useTaskLogs() {
  const [tasks, setTasks] = useState(getTaskLogs)
  const reload = () => setTasks(getTaskLogs())
  useEffect(() => subscribeTaskLogs(reload), [])
  return { tasks, reload }
}
async function exportTask(task: TaskLog) {
  try {
    const path = await exportDebugPackage({ taskId: task.id }, { logs: taskLogText(task), label: `任务-${task.id}` })
    await ShareSheet.present([path])
  } catch (e) {
    await Dialog.alert({ title: "导出失败", message: String(e) })
  }
}
function TaskDetail({ task }: { task: TaskLog }) {
  const { tasks, reload } = useTaskLogs()
  const current = tasks.find(t => t.id === task.id) ?? task
  return <List navigationTitle="任务日志" navigationBarTitleDisplayMode="inline" onAppear={reload}>
    <Section title={current.title}>
      <Text>{`${taskStatus(current)} · ${current.message}`}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{formatDate(current.startedAt)}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{current.entry === "app" ? "应用内下载" : "分享 / 快捷指令"}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{current.url}</Text>
      <Button title="导出此任务日志" action={() => void exportTask(current)} />
    </Section>
    <Section title="执行步骤" footer={<Text font="caption" foregroundStyle="secondaryLabel">{`每个任务保留最近 ${MAX_TASK_LINES} 行；未完成表示任务未留下最终结果。`}</Text>}>
      {current.lines.length === 0 ? <Text foregroundStyle="secondaryLabel">准备下载…</Text> : (
        <VStack alignment="leading" spacing={5} padding={10} background="#0D1117"
          clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}>
          <HStack><Text font="caption2" monospaced foregroundStyle={getTheme().accent}>任务执行日志</Text><Spacer /></HStack>
          {current.lines.map((line, i) => <Text key={i} font="caption2" monospaced
            foregroundStyle={ERROR_LINE_RE.test(line) ? "#F85149" : "#E6E9EC"}>{line}</Text>)}
        </VStack>
      )}
    </Section>
  </List>
}
export function TaskLogsSection({ limit = MAX_TASKS }: { limit?: number }) {
  const { tasks, reload } = useTaskLogs()
  return <Section title="任务日志" onAppear={reload}
    footer={<Text font="caption" foregroundStyle="secondaryLabel">{`每次下载一条记录，点开查看执行步骤。保留最近 ${MAX_TASKS} 个任务。`}</Text>}>
    {tasks.length === 0 ? <Text foregroundStyle="secondaryLabel">还没有任务日志；旧诊断日志保留在系统诊断中。</Text> : tasks.slice(0, limit).map(task => (
      <NavigationLink key={task.id} destination={<TaskDetail task={task} />}>
        <HStack spacing={10}>
          <Image systemName={task.status === "failed" ? "exclamationmark.circle" : task.status === "success" ? "checkmark.circle" : "doc.text"}
            foregroundStyle={task.status === "failed" ? "systemRed" : getTheme().accent} />
          <VStack alignment="leading" spacing={4}>
            <HStack><Text font="subheadline" fontWeight="medium" lineLimit={1}>{task.title}</Text><Spacer />
              <Text font="caption" foregroundStyle={task.status === "failed" ? "systemRed" : "secondaryLabel"}>{taskStatus(task)}</Text></HStack>
            <Text font="caption2" foregroundStyle="secondaryLabel">{`${formatDate(task.startedAt)} · ${task.entry === "app" ? "应用内" : "分享/快捷指令"}`}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{task.message}</Text>
          </VStack>
        </HStack>
      </NavigationLink>
    ))}
  </Section>
}
