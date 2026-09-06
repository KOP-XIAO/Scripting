// index.tsx — CMHK Usage 主程序（App 内页面）
// 职责：账户设置（Keychain 存凭据）、手动刷新、缓存数据面板、小组件预览、连接诊断。
// 生命周期：一次性页面 —— Navigation.present() 关闭后 Script.exit()。

import {
  Button,
  Dialog,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Script,
  SecureField,
  Spacer,
  Text,
  TextField,
  Toggle,
  useState,
  VStack,
  Widget,
} from "scripting"
import {
  clearCredentials,
  diagnose,
  dataRemainingRatio,
  daysUntilBillDay,
  fmtGB,
  fmtMin,
  fmtMoney,
  fmtUpdatedAt,
  getPhone,
  hasCredentials,
  isDemoMode,
  readCache,
  refreshUsage,
  setDemoMode,
  saveCredentials,
  UsageData,
} from "./cmhk"
import { theme } from "./theme"

function Page() {
  const dismiss = Navigation.useDismiss()

  const [phone, setPhone] = useState(getPhone() ?? "")
  const [password, setPassword] = useState("")
  const [demo, setDemo] = useState(isDemoMode())
  const [data, setData] = useState<UsageData | null>(readCache())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function handleSave() {
    if (!phone.trim() || !password) {
      await Dialog.alert({ title: "信息不完整", message: "请输入手机号和 MyLink 密码。" })
      return
    }
    const ok = await Dialog.confirm({
      title: "保存凭据",
      message: "手机号与密码将仅保存在本机系统钥匙串（Keychain）中，仅用于登录 CMHK MyLink 接口，不会上传或写入任何日志。是否继续？",
      confirmLabel: "保存",
    })
    if (!ok) return
    saveCredentials(phone.trim(), password)
    setPassword("")
    setStatus("凭据已保存到 Keychain")
  }

  async function handleRefresh() {
    setBusy(true)
    setStatus(null)
    try {
      const d = await refreshUsage()
      setData(d)
      Widget.reloadUserWidgets()
      setStatus(d.stale ? "网络异常，已显示上次缓存数据" : "已刷新")
    } catch (e: any) {
      setStatus(`刷新失败：${e?.message ?? e}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleDiagnose() {
    setBusy(true)
    try {
      const r = await diagnose()
      await Dialog.alert({
        title: "连接诊断（用于校准字段映射）",
        message:
          `usage 顶层字段:\n${r.usageKeys.join(", ") || "(无)"}\n\nbalance 顶层字段:\n${r.balanceKeys.join(", ") || "(无)"}`,
      })
    } catch (e: any) {
      await Dialog.alert({ title: "诊断失败", message: String(e?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  async function handleClear() {
    const ok = await Dialog.confirm({
      title: "清除账户",
      message: "将删除 Keychain 中的手机号、密码与登录令牌。确定吗？",
      confirmLabel: "清除",
    })
    if (ok) {
      clearCredentials()
      setPhone("")
      setStatus("已清除账户信息")
    }
  }

  async function handlePreview() {
    await Widget.preview({ family: "systemMedium" })
  }

  const ratio = data ? dataRemainingRatio(data) : null
  const billDays = data ? daysUntilBillDay(data) : null

  return (
    <NavigationStack>
      <List
        navigationTitle="CMHK 用量"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={() => dismiss()} />,
          confirmationAction: busy
            ? <Text font="caption" foregroundStyle="secondary">处理中…</Text>
            : <Button title="刷新" action={handleRefresh} />,
        }}
      >
        {/* 数据总览 */}
        {data && (
          <VStack spacing={6} padding={12} background={theme.cardBackground as any} cornerRadius={16}>
            <HStack>
              <Text font="caption" fontWeight="medium" foregroundStyle={theme.textSecondary}>
                {data.planName ?? "CMHK"} {data.phoneNumber ? `· ${data.phoneNumber}` : ""}
              </Text>
              <Spacer />
              {data.stale && (
                <Text font="caption2" foregroundStyle="#FFD66E">缓存数据</Text>
              )}
            </HStack>
            <HStack spacing={12} alignment="lastTextBaseline">
              <Text font="largeTitle" fontWeight="bold" foregroundStyle={theme.textPrimary}>
                {fmtGB(data.dataRemainingGB)}
              </Text>
              <Text font="caption" foregroundStyle={theme.textTertiary}>
                GB 剩余 / 共 {fmtGB(data.dataTotalGB)} GB{ratio != null ? `（剩 ${Math.round(ratio * 100)}%）` : ""}
              </Text>
            </HStack>
            <HStack spacing={16}>
              <VStack alignment="leading" spacing={2}>
                <Text font="caption2" foregroundStyle={theme.textTertiary}>话费余额</Text>
                <Text font="headline" foregroundStyle={theme.textPrimary}>HK$ {fmtMoney(data.balanceHKD)}</Text>
              </VStack>
              <VStack alignment="leading" spacing={2}>
                <Text font="caption2" foregroundStyle={theme.textTertiary}>通话剩余</Text>
                <Text font="headline" foregroundStyle={theme.textPrimary}>{fmtMin(data.voiceRemainingMin)} 分钟</Text>
              </VStack>
              <VStack alignment="leading" spacing={2}>
                <Text font="caption2" foregroundStyle={theme.textTertiary}>账单日</Text>
                <Text font="headline" foregroundStyle={theme.textPrimary}>
                  {billDays != null ? `${billDays} 天后` : data.billDay != null ? `每月 ${data.billDay} 日` : "--"}
                </Text>
              </VStack>
            </HStack>
            <Text font="caption2" foregroundStyle={theme.textTertiary}>
              更新于 {fmtUpdatedAt(data.fetchedAt)}
            </Text>
          </VStack>
        )}

        {/* 账户设置 */}
        <Text font="headline">账户（单账户）</Text>
        <TextField title="手机号" value={phone} onChanged={setPhone} prompt="CMHK 手机号" />
        <SecureField title="MyLink 密码" value={password} onChanged={setPassword} prompt={hasCredentials() ? "已保存（输入可覆盖）" : "MyLink 登录密码"} />
        <HStack spacing={12}>
          <Button title="保存凭据" action={handleSave} />
          <Button title="清除账户" action={handleClear} />
        </HStack>

        {/* 操作 */}
        <Text font="headline">操作</Text>
        <Toggle title="演示模式（用示例数据展示 UI）" value={demo} onChanged={(v: boolean) => { setDemo(v); setDemoMode(v) }} />
        <Button title="立即刷新并更新小组件" action={handleRefresh} />
        <Button title="预览小组件（systemMedium）" action={handlePreview} />
        <Button title="连接诊断（查看接口返回字段）" action={handleDiagnose} />

        {status && <Text font="caption" foregroundStyle="secondary">{status}</Text>}

        <Text font="caption" foregroundStyle="secondary">
          数据来源：CMHK MyLink 只读接口。凭据仅存本机 Keychain。若刷新失败，请先用「连接诊断」核对字段映射（见 cmhk.ts 顶部校准区）。
        </Text>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<Page />)
  Script.exit()
}

run()
