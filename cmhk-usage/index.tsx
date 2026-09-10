// index.tsx — CMHK Usage 主程序（App 内页面）
// 职责：数据总览与刷新、网页登录捕获、高级设置（密码/手动接口/起始页）、诊断中心。
// 结构：主页面按 Section 分块；低频/高级内容收进 NavigationLink 子页面。
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
  NavigationLink,
  NavigationStack,
  Script,
  Section,
  SecureField,
  Spacer,
  Text,
  TextField,
  Toggle,
  useEffect,
  useState,
  VStack,
  Widget,
} from "scripting"
import {
  VERSION,
  clearCredentials,
  clearDebugLog,
  clearManualEndpoint,
  clearWebSession,
  connectionTest,
  dataRemainingRatio,
  daysUntilCycleEnd,
  diagnose,
  fmtGB,
  fmtMin,
  fmtMoney,
  fmtUpdatedAt,
  friendlyError,
  getPhone,
  getWebStartUrl,
  hasCredentials,
  hasWebSession,
  isDemoMode,
  readCache,
  readCaptures,
  readDebugLog,
  readLoginRequests,
  readManualEndpoint,
  readRefreshReport,
  refreshUsage,
  saveCapturedBody,
  saveCredentials,
  saveManualEndpoint,
  setDemoMode,
  setWebStartUrl,
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
        title: "保存憑據",
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
      const d = await refreshUsage({ via: "app" })
      if (!d) return
      setData(d)
      Widget.reloadUserWidgets()
      const r = readRefreshReport()
      if (d.stale) {
        // v1.19.11：快照若带来了新数值（刚登录完的常见情形），明确告知"已更新"而非"失败"
        setStatus(r?.changed === true
          ? `数据已更新（${r?.path ?? "快照"}）· 实时重放暂不可用`
          : `刷新未成功（${r?.path ?? "会话失效"}）· 已显示缓存。建议重新「網頁登入」`)
        // 仅当会话真死且数据没有更新时才弹窗直达登录（v1.19.9 登录后立刻弹窗误扰）
        if (/过期|過期/.test(r?.path ?? "") && r?.changed !== true) {
          const go = await Dialog.confirm({
            title: "會話已過期",
            message: "直連與網頁重放均已失效，需重新登入才能取得最新流量/話費數據。現在去登入？",
            confirmLabel: "去登入",
          })
          if (go) await handleWebLogin()
        }
      } else {
        const chg = r?.changed === false ? "数值无变化（运营商侧可能有延迟）" : r?.changed ? "数值有更新" : "完成"
        setStatus(`已刷新 · ${r?.path ?? "成功"} · ${chg}`)
      }
    } catch (e) {
      await showError("刷新失败", e)
    } finally {
      setBusy(false)
    }
  }

  // 静默自动刷新：失败不弹窗，仅更新状态行
  async function handleRefreshSilent() {
    try {
      const d = await refreshUsage({ via: "app-auto" })
      if (!d) return
      setData(d)
      Widget.reloadUserWidgets()
      const r = readRefreshReport()
      setStatus(d.stale
        ? `自动刷新未成功（${r?.path ?? "会话失效"}）：建议重新「網頁登入」`
        : `已自动刷新 · ${r?.path ?? ""}${r?.changed === false ? " · 数值无变化" : ""}`)
    } catch { /* 静默失败不打扰 */ }
  }

  // 打开页面即自动刷新一次；页面存活期间每 30 分钟续刷
  useEffect(() => {
    if (!isDemoMode()) handleRefreshSilent()
    const t = setInterval(() => { if (!isDemoMode()) handleRefreshSilent() }, 30 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

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
      title: "清除帳戶",
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

  async function handleReset() {
    const ok = await Dialog.confirm({
      title: "重置",
      message: "将清除缓存、捕获环、网页会话、凭据与调试日志，回到全新状态。确定吗？",
      confirmLabel: "重置",
    })
    if (ok) {
      try {
        clearCredentials(); clearWebSession(); clearManualEndpoint();
        clearDebugLog();
        // 清 Storage 私有域
        for (const k of requireStorageKeys()) {
          Storage.remove(k)
        }
      } catch { /* 部分清理失败不影响 */ }
      setData(null); setPhone(""); setPassword(""); setWebSession(false)
      setManualUrl(""); setManualHeaders(""); setWebStartUrlState(getWebStartUrl())
      setStatus("已重置，请重新「网页登录」")
    }
  }

  // 列出本项目用到的 Storage 键（用于清空）
  function requireStorageKeys(): string[] {
    return [
      "cmhk.usage.cache", "cmhk.demo", "cmhk.manual.url", "cmhk.manual.headers",
      "cmhk.web.starturl", "cmhk.web.body", "cmhk.captures", "cmhk.debuglog",
      "cmhk.overview.html", "cmhk.member.json", "cmhk.nickname.json", "cmhk.profile",
      "cmhk.refresh.report",
    ]
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
      const V = VERSION
      const report = readRefreshReport()
      const reportLine = report
        ? `路径: ${report.path} · 发起: ${report.via} · 拉取${report.ok ? "成功" : "失败"} · 数值${report.changed === false ? "无变化" : report.changed ? "有更新" : "首次"}`
        : "(无)"
      const loginReqs = readLoginRequests().map((r, i) =>
        `\n===== 登录报文 ${i + 1} ${new Date(r.at).toLocaleString()} =====\n${r.method} ${r.url}\n请求(密码已打码): ${r.reqBody.slice(0, 400)}\n响应: ${r.body.slice(0, 300)}`
      ).join("")
      const text = `CMHK Usage 诊断包\n版本: ${V}\n生成: ${new Date().toLocaleString()}\n\n===== 最近刷新 =====\n${reportLine}\n\n===== 调试日志 =====\n${log}\n\n===== 当前缓存(已解析) =====\n${cache}\n${captures}\n\n===== 登录报文(密码已打码) =====${loginReqs || "\n(无)"}`
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
  const report = readRefreshReport()

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
        {/* ===== 数据 ===== */}
        <Section header={<Text>數據</Text>}>
          <Text font="caption2" foregroundStyle={theme.textSecondary}>
            脚本版本 {VERSION} · {data ? (data.stale ? "缓存数据（快取）" : "数据已就绪") : "等待登录/刷新"}
          </Text>
          {data && (
            <VStack spacing={6} padding={12} background={theme.cardBackground as any} cornerRadius={16}>
              <HStack>
                <Text font="caption" fontWeight="medium" foregroundStyle={theme.textSecondary}>
                  {data.nickname || data.userName || data.phoneNumber || data.accountNumber || "CMHK"} {data.phoneNumber ? ` · ${data.phoneNumber}` : ""} {data.planName ? `· ${data.planName}` : ""}
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
                    {data.billAmountHKD != null ? "代繳話費" : "話費餘額"}
                  </Text>
                  <Text font="headline" foregroundStyle={data.billAmountHKD != null && data.billAmountHKD < 0 ? "#FF6B5E" : theme.textPrimary}>
                    HK$ {fmtMoney(Math.abs(data.billAmountHKD ?? data.balanceHKD ?? 0))}
                    {data.billAmountHKD != null && data.billAmountHKD < 0 ? " 欠费" : ""}
                  </Text>
                </VStack>
                <VStack alignment="leading" spacing={2}>
                  <Text font="caption2" foregroundStyle={theme.textTertiary}>通話剩餘</Text>
                  <Text font="headline" foregroundStyle={theme.textPrimary}>
                    {data.voiceUnlimited ? (data.voiceRemainingMin != null ? `${fmtMin(data.voiceRemainingMin)} 分钟·∞` : "无限通话") : `${fmtMin(data.voiceRemainingMin)} 分钟`}
                  </Text>
                </VStack>
                <VStack alignment="leading" spacing={2}>
                  <Text font="caption2" foregroundStyle={theme.textTertiary}>帳單日</Text>
                  <Text font="headline" foregroundStyle={theme.textPrimary}>
                    {(() => { const n = daysUntilCycleEnd(data); return n != null ? `剩 ${n} 天` : (data.billDay != null ? `每月 ${data.billDay} 日` : "--") })()}
                  </Text>
                </VStack>
              </HStack>
              {(data.buckets ?? []).map((b, i) => (
                <HStack key={i} spacing={6}>
                  <Image systemName={i === 0 ? "arrow.down.circle.fill" : "gift"} resizable={true} foregroundStyle={i === 0 ? theme.accentGreen : "#FFD66E"} frame={{ width: 13, height: 13 }} />
                  <Text font="caption" foregroundStyle={theme.textSecondary} lineLimit={1}>{b.name}</Text>
                  <Spacer />
                  <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.textPrimary}>
                    {fmtGB(b.remainingGB)} / {fmtGB(b.totalGB)} GB
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
                {report ? ` · 来源 ${report.path}（${report.via}）${report.changed === false ? " · 数值无变化" : ""}` : ""}
              </Text>
            </VStack>
          )}
          <Button title="立即刷新並更新小組件" action={handleRefresh} />
          {status && <Text font="caption" foregroundStyle="secondary">{status}</Text>}
        </Section>

        {/* ===== 登入 ===== */}
        <Section header={<Text>登入</Text>}>
          <Button title={webSession ? "重新網頁登入（已保存會話）" : "網頁登入 CMHK（推薦）"} action={handleWebLogin} />
          <Text font="caption" foregroundStyle="secondary">
            在打开的官网页面中登录并进入「用量查询」页面，脚本会自动捕获数据接口。
          </Text>
        </Section>

        {/* ===== 進階設定 ===== */}
        <Section header={<Text>進階設定</Text>}>
          <NavigationLink
            destination={
              <PasswordPage
                phone={phone} password={password}
                setPhone={setPhone} setPassword={setPassword}
                onSave={handleSave} onClear={handleClear} onReset={handleReset}
                status={status}
              />
            }
          >
            <VStack alignment="leading" spacing={2}>
              <Text>賬戶密碼（備選）</Text>
              <Text font="caption2" foregroundStyle="secondary">Keychain 憑據 · 清除帳戶 / 重置</Text>
            </VStack>
          </NavigationLink>
          <NavigationLink
            destination={
              <ManualEndpointPage
                manualUrl={manualUrl} manualHeaders={manualHeaders}
                setManualUrl={setManualUrl} setManualHeaders={setManualHeaders}
                onSave={handleSaveManual} onClear={handleClearManual}
                status={status}
              />
            }
          >
            <VStack alignment="leading" spacing={2}>
              <Text>手動配置接口</Text>
              <Text font="caption2" foregroundStyle="secondary">抓包兜底：粘贴用量接口 URL 与请求头</Text>
            </VStack>
          </NavigationLink>
          <NavigationLink
            destination={
              <StartUrlPage
                webStartUrl={webStartUrl}
                onChangeText={setWebStartUrlState}
                onSave={handleSaveStartUrl}
                status={status}
              />
            }
          >
            <VStack alignment="leading" spacing={2}>
              <Text>網頁登入起始頁</Text>
              <Text font="caption2" foregroundStyle="secondary">自定义网页登录打开的页面</Text>
            </VStack>
          </NavigationLink>
        </Section>

        {/* ===== 工具 ===== */}
        <Section header={<Text>工具</Text>}>
          <Toggle title="演示模式（用示例数据展示 UI）" value={demo} onChanged={(v: boolean) => { setDemo(v); setDemoMode(v) }} />
          <Button title="預覽小組件（systemMedium）" action={handlePreview} />
        </Section>

        {/* ===== 診斷 ===== */}
        <Section header={<Text>診斷</Text>}>
          <NavigationLink
            destination={
              <DiagnosticsPage
                onExport={handleExport} onConnTest={handleConnTest} onDiagnose={handleDiagnose}
                status={status}
              />
            }
          >
            <VStack alignment="leading" spacing={2}>
              <Text>診斷中心</Text>
              <Text font="caption2" foregroundStyle="secondary">刷新报告 · 链路说明 · 日志 · 捕获 · 导出</Text>
            </VStack>
          </NavigationLink>
        </Section>

        {/* ===== 關於 ===== */}
        <Section header={<Text>關於</Text>}>
          <Text font="caption" foregroundStyle="secondary">
            数据来源：CMHK 官方网页会话 / MyLink 只读接口。凭据与会话仅存本机 Keychain，不写日志。
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}

// ===== 子页面：账户密码（备选）与危险操作 =====
function PasswordPage(props: {
  phone: string
  password: string
  setPhone: (v: string) => void
  setPassword: (v: string) => void
  onSave: () => void
  onClear: () => void
  onReset: () => void
  status: string | null
}) {
  return (
    <List navigationTitle="賬戶密碼（備選）">
      <Section header={<Text>憑據（僅存本機 Keychain）</Text>}>
        <TextField title="手機號" value={props.phone} onChanged={props.setPhone} prompt="CMHK 手機號" />
        <SecureField title="MyLink 密碼" value={props.password} onChanged={props.setPassword}
          prompt={hasCredentials() ? "已保存（輸入可覆蓋）" : "MyLink 登錄密碼"} />
        <Button title="保存憑據" action={props.onSave} />
      </Section>
      <Section header={<Text>危險操作</Text>}>
        <Button title="清除帳戶（刪除手機號/密碼/會話）" action={props.onClear} />
        <Button title="重置（清除全部本地數據並重新開始）" action={props.onReset} />
      </Section>
      <Section header={<Text>說明</Text>}>
        <Text font="caption2" foregroundStyle="secondary">
          密碼方式走 MyLink REST 接口（無公開文檔，字段需校準），建議優先使用主頁的「網頁登入」。
        </Text>
        {props.status && <Text font="caption" foregroundStyle="secondary">{props.status}</Text>}
      </Section>
    </List>
  )
}

// ===== 子页面：手动配置接口（抓包兜底） =====
function ManualEndpointPage(props: {
  manualUrl: string
  manualHeaders: string
  setManualUrl: (v: string) => void
  setManualHeaders: (v: string) => void
  onSave: () => void
  onClear: () => void
  status: string | null
}) {
  return (
    <List navigationTitle="手動配置接口">
      <Section header={<Text>抓包兜底</Text>}>
        <TextField title="接口 URL" value={props.manualUrl} onChanged={props.setManualUrl} prompt="粘貼用量接口完整 URL" />
        <TextField title="請求頭 JSON" value={props.manualHeaders} onChanged={props.setManualHeaders}
          prompt='{"Authorization":"Bearer ..."}（可留空）' axis="vertical" />
        <HStack spacing={12}>
          <Button title="保存接口" action={props.onSave} />
          <Button title="清除" action={props.onClear} />
        </HStack>
      </Section>
      <Section header={<Text>說明</Text>}>
        <Text font="caption2" foregroundStyle="secondary">
          小組件無法創建網頁視圖，只能直連請求；若官網會話依賴 httpOnly Cookie，直連會失敗。
          配置此接口（如帶 Authorization 頭的抓包結果）後，小組件也能直接刷新。
        </Text>
        {props.status && <Text font="caption" foregroundStyle="secondary">{props.status}</Text>}
      </Section>
    </List>
  )
}

// ===== 子页面：网页登录起始页 =====
function StartUrlPage(props: {
  webStartUrl: string
  onChangeText: (v: string) => void
  onSave: () => void
  status: string | null
}) {
  return (
    <List navigationTitle="網頁登入起始頁">
      <Section header={<Text>起始頁</Text>}>
        <TextField title="起始頁 URL" value={props.webStartUrl} onChanged={props.onChangeText} prompt="https://www.hk.chinamobile.com/tc/" />
        <Button title="保存起始頁" action={props.onSave} />
      </Section>
      {props.status && <Text font="caption" foregroundStyle="secondary">{props.status}</Text>}
    </List>
  )
}

// ===== 子页面：诊断中心 =====
function DiagnosticsPage(props: {
  onExport: () => void
  onConnTest: () => void
  onDiagnose: () => void
  status: string | null
}) {
  const [log, setLog] = useState(readDebugLog())
  const [captures, setCaptures] = useState(readCaptures())
  const [showCaptures, setShowCaptures] = useState(false)
  const report = readRefreshReport()
  return (
    <List navigationTitle="診斷中心">
      <Section header={<Text>刷新報告</Text>}>
        <VStack alignment="leading" spacing={4}>
          <Text font="caption">
            {report
              ? `最近一次：${new Date(report.at).toLocaleTimeString()} · ${report.path}（${report.via}） · 拉取${report.ok ? "成功" : "失败"} · 数值${report.changed === false ? "无变化" : report.changed ? "有更新" : "首次"}`
              : "尚无刷新记录"}
          </Text>
          <Text font="caption2" foregroundStyle="secondary">
            刷新链路：手动接口 → 直连重放 → 无头 WebView 重放 → 登录时快取。小組件（系統每 30 分鐘重載）只能走直連/手動接口——若官網會話依賴 httpOnly Cookie，直連會失敗，組件會顯示緩存，直到 App 打開後完成一次完整刷新。
          </Text>
        </VStack>
      </Section>
      <Section header={<Text>導出</Text>}>
        <Button title="導出診斷包（發給開發者分析）" action={props.onExport} />
      </Section>
      <Section header={<Text>網絡</Text>}>
        <Button title="連接測試（診斷網絡/TLS）" action={props.onConnTest} />
        <Button title="連接診斷（查看接口返回字段）" action={props.onDiagnose} />
      </Section>
      <Section header={<Text>調試日誌</Text>}>
        <Button title="清空日誌" action={() => { clearDebugLog(); setLog([]); setShowCaptures(false) }} />
        {log.length > 0 ? (
          <VStack alignment="leading" spacing={2} padding={8} background="rgba(0,0,0,0.04)" cornerRadius={8}>
            <Text font="caption2" fontWeight="medium">調試日誌</Text>
            <Text font="caption2" foregroundStyle="secondary" monospaced lineLimit={40}>
              {log.join("\n")}
            </Text>
          </VStack>
        ) : (
          <Text font="caption2" foregroundStyle="secondary">暫無日誌。</Text>
        )}
      </Section>
      <Section header={<Text>捕獲數據</Text>}>
        <Button
          title={showCaptures ? "收起捕獲數據" : `查看捕獲數據（${captures.length} 條）`}
          action={() => setShowCaptures(!showCaptures)}
        />
        {showCaptures && (
          <VStack spacing={8} alignment="leading">
            {captures.length === 0 && (
              <Text font="caption" foregroundStyle="secondary">暫無捕獲。請先「網頁登入」並進入「用量查詢」頁。</Text>
            )}
            {captures.map((c, i) => (
              <VStack key={i} alignment="leading" spacing={2} padding={8} background="rgba(0,0,0,0.04)" cornerRadius={8}>
                <Text font="caption2" fontWeight="medium" monospaced>{c.url.slice(0, 120)}</Text>
                <Text font="caption2" foregroundStyle="secondary" monospaced lineLimit={8}>
                  {c.body.slice(0, 400)}
                </Text>
              </VStack>
            ))}
          </VStack>
        )}
        {props.status && <Text font="caption" foregroundStyle="secondary">{props.status}</Text>}
      </Section>
    </List>
  )
}

async function run() {
  await Navigation.present(<Page />)
  Script.exit()
}

run()
