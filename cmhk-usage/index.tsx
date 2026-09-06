// index.tsx — CMHK Usage 主程序（App 内页面）
// 职责：账户设置（Keychain 存凭据）、网页登录捕获、手动刷新、缓存数据面板、小组件预览、连接诊断。
// 生命周期：一次性页面 —— Navigation.present() 关闭后 Script.exit()。
//
// 注意：Dialog / Storage / Keychain / WebViewController 为全局对象，
// 不要从 "scripting" 导入（生产范本验证过，导入不存在于模块导出会静默失效）。

import {
  Button,
  HStack,
  Image,
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
  clearDebugLog,
  clearManualEndpoint,
  daysUntilCycleEnd,
  readCaptures,
  readDebugLog,
  saveCapturedBody,
  clearWebSession,
  connectionTest,
  diagnose,
  dataRemainingRatio,
  daysUntilBillDay,
  fmtGB,
  fmtMin,
  fmtMoney,
  fmtUpdatedAt,
  friendlyError,
  getPhone,
  getWebStartUrl,
  hasCredentials,
  hasManualEndpoint,
  hasWebSession,
  isDemoMode,
  readCache,
  readManualEndpoint,
  refreshUsage,
  setDemoMode,
  setWebStartUrl,
  saveCredentials,
  saveManualEndpoint,
  UsageData,
} from "./cmhk"
import { runWebLogin } from "./web-login"
import { theme } from "./theme"

declare const ShareSheet: { present(items: any[]): Promise<boolean> }

declare const Dialog: {
  alert(options: { message: string; title?: string; buttonLabel?: string }): Promise<void>
  confirm(options: { message: string; title?: string; cancelLabel?: string; confirmLabel?: string }): Promise<boolean>
}

function Page() {
  const dismiss = Navigation.useDismiss()

  const [phone, setPhone] = useState(getPhone() ?? "")
  const [password, setPassword] = useState("")
  const [demo, setDemo] = useState(isDemoMode())
  const [data, setData] = useState<UsageData | null>(readCache())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [webSession, setWebSession] = useState(hasWebSession())
  const [manualUrl, setManualUrl] = useState(readManualEndpoint()?.url ?? "")
  const [manualHeaders, setManualHeaders] = useState("")
  const [webStartUrl, setWebStartUrlState] = useState(getWebStartUrl())
  const [showCaptures, setShowCaptures] = useState(false)

  async function showError(title: string, e: any) {
    await Dialog.alert({ title, message: friendlyError(e) })
  }

  async function handleSave() {
    try {
      if (!phone.trim() || !password) {
        await Dialog.alert({ title: "信息不完整", message: "请输入手机号和 MyLink 密码。" })
        return
      }
      const ok = await Dialog.confirm({
        title: "保存凭据",
        message: "手机号与密码将仅保存在本机系统钥匙串（Keychain）中，仅用于登录 CMHK 接口，不会上传或写入任何日志。是否继续？",
        confirmLabel: "保存",
      })
      if (!ok) return
      if (!saveCredentials(phone.trim(), password)) {
        throw new Error("Keychain 写入失败")
      }
      setPassword("")
      setStatus("凭据已保存到 Keychain")
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  async function handleWebLogin() {
    setBusy(true)
    setStatus(null)
    try {
      const r = await runWebLogin()
      if (r.captured) {
        if (r.body) saveCapturedBody(r.body)
        setWebSession(true)
        setStatus("已捕获用量接口，正在拉取数据…")
        await handleRefresh()
      } else {
        setStatus("未捕获到用量数据：请确认登录后打开过「用量查询」页面，再关闭窗口")
      }
    } catch (e) {
      await showError("网页登录失败", e)
    } finally {
      setBusy(false)
    }
  }

  async function handleRefresh() {
    setBusy(true)
    setStatus(null)
    try {
      const d = await refreshUsage()
      setData(d)
      Widget.reloadUserWidgets()
      setStatus(d.stale ? "网络异常，已显示上次缓存数据" : "已刷新")
    } catch (e) {
      await showError("刷新失败", e)
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
    } catch (e) {
      await showError("诊断失败", e)
    } finally {
      setBusy(false)
    }
  }

  async function handleClear() {
    const ok = await Dialog.confirm({
      title: "清除账户",
      message: "将删除 Keychain 中的手机号、密码、登录令牌与网页会话。确定吗？",
      confirmLabel: "清除",
    })
    if (ok) {
      clearCredentials()
      clearWebSession()
      setWebSession(false)
      setPhone("")
      setStatus("已清除账户信息")
    }
  }

  async function handlePreview() {
    await Widget.preview({ family: "systemMedium" })
  }

  async function handleSaveManual() {
    try {
      if (!manualUrl.trim()) throw new Error("请粘贴接口 URL")
      saveManualEndpoint(manualUrl, manualHeaders.trim() || "{}")
      setStatus("手动接口已保存，点「刷新」验证")
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  async function handleClearManual() {
    clearManualEndpoint()
    setManualUrl("")
    setManualHeaders("")
    setStatus("已清除手动接口配置")
  }

  async function handleExport() {
    try {
      const log = readDebugLog().join("\n")
      const captures = readCaptures().map((c, i) => {
        const kind = c.body.startsWith("{") || c.body.startsWith("[") ? "JSON" : "HTML"
        return `\n===== 捕获 ${i + 1} (${kind}) ${new Date(c.at).toLocaleString()} =====\nURL: ${c.url}\n${c.body}`
      }).join("")
      const cache = data ? JSON.stringify({ ...data, fetchedAt: new Date(data.fetchedAt).toLocaleString() }, null, 2) : "(无)"
      const text = `CMHK Usage 诊断包\n版本: ${"1.9.0"}\n生成: ${new Date().toLocaleString()}\n\n===== 调试日志 =====\n${log}\n\n===== 当前缓存(已解析) =====\n${cache}\n${captures}`
      const ok = await ShareSheet.present([text])
      if (!ok) setStatus("已取消导出")
    } catch (e) {
      await showError("导出失败", e)
    }
  }

  async function handleConnTest() {
    setBusy(true)
    try {
      const r = await connectionTest()
      await Dialog.alert({ title: "连接测试", message: r })
    } catch (e) {
      await showError("连接测试失败", e)
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveStartUrl() {
    setWebStartUrl(webStartUrl)
    setStatus("网页登录起始页已保存")
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
                <Text font="caption2" foregroundStyle={theme.textTertiary}>
                  {data.billAmountHKD != null ? "代缴话费" : "话费余额"}
                </Text>
                <Text font="headline" foregroundStyle={data.billAmountHKD != null && data.billAmountHKD < 0 ? "#FF6B5E" : theme.textPrimary}>
                  HK$ {fmtMoney(Math.abs(data.billAmountHKD ?? data.balanceHKD ?? 0))}
                  {data.billAmountHKD != null && data.billAmountHKD < 0 ? " 欠费" : ""}
                </Text>
              </VStack>
              <VStack alignment="leading" spacing={2}>
                <Text font="caption2" foregroundStyle={theme.textTertiary}>通话剩余</Text>
                <Text font="headline" foregroundStyle={theme.textPrimary}>
                  {data.voiceUnlimited ? "无限" : `${fmtMin(data.voiceRemainingMin)} 分钟`}
                </Text>
              </VStack>
              <VStack alignment="leading" spacing={2}>
                <Text font="caption2" foregroundStyle={theme.textTertiary}>账单日</Text>
                <Text font="headline" foregroundStyle={theme.textPrimary}>
                  {(() => { const n = daysUntilCycleEnd(data); return n != null ? `剩 ${n} 天` : (data.billDay != null ? `每月 ${data.billDay} 日` : "--") })()}
                </Text>
              </VStack>
            </HStack>
            {(data.buckets ?? []).map((b, i) => (
              <HStack key={i} spacing={6}>
                <Image systemName={i === 0 ? "arrow.down.circle.fill" : "gift"} foregroundStyle={i === 0 ? theme.accentGreen : "#FFD66E"} frame={{ width: 13, height: 13 }} />
                <Text font="caption" foregroundStyle={theme.textSecondary} lineLimit={1}>{b.name}</Text>
                <Spacer />
                <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.textPrimary}>
                  {fmtGB(b.remainingGB)} <Text font="caption2" foregroundStyle={theme.textTertiary}>/ {fmtGB(b.totalGB)} GB</Text>
                </Text>
                {b.expiry && <Text font="caption2" foregroundStyle={theme.textTertiary}>{b.expiry}止</Text>}
              </HStack>
            ))}
            {(data.membershipTier || data.points != null) && (
              <Text font="caption" foregroundStyle={theme.textSecondary}>
                {data.membershipTier ? `${data.membershipTier}會籍` : ""}
                {data.points != null ? ` · 積分 ${data.points}` : ""}
              </Text>
            )}
            <Text font="caption2" foregroundStyle={theme.textTertiary}>
              更新于 {fmtUpdatedAt(data.fetchedAt)}
            </Text>
          </VStack>
        )}

        {/* 登录 */}
        <Text font="headline">登录</Text>
        <Button title={webSession ? "重新网页登录（已保存会话）" : "网页登录 CMHK（推荐）"} action={handleWebLogin} />
        <Text font="caption" foregroundStyle="secondary">
          在打开的官网页面中登录并进入「用量查询」页面，脚本会自动捕获数据接口。
        </Text>

        {/* 密码方式（备选） */}
        <Text font="headline">或：账户密码（备选，需校准接口）</Text>
        <TextField title="手机号" value={phone} onChanged={setPhone} prompt="CMHK 手机号" />
        <SecureField title="MyLink 密码" value={password} onChanged={setPassword} prompt={hasCredentials() ? "已保存（输入可覆盖）" : "MyLink 登录密码"} />
        <HStack spacing={12}>
          <Button title="保存凭据" action={handleSave} />
          <Button title="清除账户" action={handleClear} />
        </HStack>

        {/* 手动接口配置（抓包兜底） */}
        <Text font="headline">手动配置接口（抓包兜底）</Text>
        <TextField title="接口 URL" value={manualUrl} onChanged={setManualUrl} prompt="粘贴用量接口完整 URL" />
        <TextField title="请求头" value={manualHeaders} onChanged={setManualHeaders} prompt='{"Authorization":"Bearer ..."}（可留空）' axis="vertical" />
        <HStack spacing={12}>
          <Button title="保存接口" action={handleSaveManual} />
          <Button title="清除" action={handleClearManual} />
        </HStack>

        {/* 网页登录起始页 */}
        <Text font="headline">网页登录起始页</Text>
        <TextField title="起始页 URL" value={webStartUrl} onChanged={setWebStartUrlState} prompt="https://www.hk.chinamobile.com/tc/" />
        <Button title="保存起始页" action={handleSaveStartUrl} />

        {/* 操作 */}
        <Text font="headline">操作</Text>
        <Button title="导出诊断包（发给我分析）" action={handleExport} />
        <Button title="连接测试（诊断网络/TLS）" action={handleConnTest} />
        <Toggle title="演示模式（用示例数据展示 UI）" value={demo} onChanged={(v: boolean) => { setDemo(v); setDemoMode(v) }} />
        <Button title="立即刷新并更新小组件" action={handleRefresh} />
        <Button title="预览小组件（systemMedium）" action={handlePreview} />
        <Button title="连接诊断（查看接口返回字段）" action={handleDiagnose} />

        {/* 诊断 */}
        <Text font="headline">诊断</Text>
        <Button title={showCaptures ? "收起捕获数据" : `查看捕获数据（${readCaptures().length} 条）`} action={() => setShowCaptures(!showCaptures)} />
        <HStack spacing={12}>
          <Button title="清空日志" action={() => { clearDebugLog(); setShowCaptures(false) }} />
        </HStack>
        {readDebugLog().length > 0 && (
          <VStack alignment="leading" spacing={2} padding={8} background="rgba(0,0,0,0.04)" cornerRadius={8}>
            <Text font="caption2" fontWeight="medium">调试日志</Text>
            <Text font="caption2" foregroundStyle="secondary" monospaced lineLimit={40}>
              {readDebugLog().join("\n")}
            </Text>
          </VStack>
        )}
        {showCaptures && (
          <VStack spacing={8} alignment="leading">
            {readCaptures().length === 0 && (
              <Text font="caption" foregroundStyle="secondary">暂无捕获。请先「网页登录」并进入「用量查询」页。</Text>
            )}
            {readCaptures().map((c, i) => (
              <VStack key={i} alignment="leading" spacing={2} padding={8} background="rgba(0,0,0,0.04)" cornerRadius={8}>
                <Text font="caption2" fontWeight="medium" monospaced>{c.url.slice(0, 120)}</Text>
                <Text font="caption2" foregroundStyle="secondary" monospaced lineLimit={8}>
                  {c.body.slice(0, 400)}
                </Text>
              </VStack>
            ))}
          </VStack>
        )}

        {status && <Text font="caption" foregroundStyle="secondary">{status}</Text>}

        <Text font="caption" foregroundStyle="secondary">
          数据来源：CMHK 官方网页会话 / MyLink 只读接口。凭据与会话仅存本机 Keychain，不写日志。
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
