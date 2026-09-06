// cmhk.ts — CMHK（中国移动香港 / MyLink）用量数据层
// index.tsx / widget.tsx / app_intents.tsx 共用；所有原始 API 调用都收在这里。
//
// ⚠️ 重要说明（请务必阅读）：
// CMHK MyLink 没有公开 API 文档。下面的 ENDPOINTS 与 FIELD_MAP 是按 MyLink
// App（com.ChinaMobile）常见接口形态整理的「校准点」：首次使用请打开
// index.tsx 里的「连接诊断」，对照返回的原始 JSON 字段名，把 FIELD_MAP 里
// 的路径调成你账户实际返回的字段即可，UI 与缓存逻辑无需改动。
// 全程只读接口，不写任何账户数据。

export type UsageData = {
  planName: string | null        // 套餐名
  phoneNumber: string | null     // 手机号
  balanceHKD: number | null      // 话费余额（港元）
  dataTotalGB: number | null     // 流量总量 GB
  dataRemainingGB: number | null // 剩余流量 GB
  voiceTotalMin: number | null   // 通话总量（分钟）
  voiceRemainingMin: number | null
  billDay: number | null         // 每月账单/结算日（1-31）
  cycleEndDate: string | null    // 本周期结束日 ISO（若能取到）
  fetchedAt: number              // 抓取时间戳 ms
  stale?: boolean                // 是否为失败后的缓存数据
}

const CACHE_KEY = "cmhk.usage.cache"
const KC_TOKEN = "cmhk.mylink.token"
const KC_PHONE = "cmhk.account.phone"
const KC_PASSWORD = "cmhk.account.password"
const DEMO_FLAG = "cmhk.demo"

// ---------- 校准区（按需修改） ----------
export const CMHK = {
  // MyLink App 接口基址（如抓包结果不同，改这一处即可）
  baseUrl: "https://app.mylink.com.hk/mylink-api",
  paths: {
    // 登录：POST { msisdn, password } -> { token }
    login: "/auth/login",
    // 用量总览：GET，Header 带 Authorization: Bearer <token>
    usageSummary: "/usage/summary",
    // 账户余额：GET
    balance: "/account/balance",
  },
  // 响应字段映射：值为「点分路径」，用 getPath() 取值
  fieldMap: {
    planName: "data.planName",
    balanceHKD: "data.balance",
    dataTotalGB: "data.dataTotal",
    dataRemainingGB: "data.dataRemaining",
    voiceTotalMin: "data.voiceTotal",
    voiceRemainingMin: "data.voiceRemaining",
    billDay: "data.billDay",
    cycleEndDate: "data.cycleEndDate",
  },
}
// ---------- 校准区结束 ----------

declare const Storage: {
  get<T>(key: string): T | null
  set<T>(key: string, value: T): boolean
  remove(key: string): void
}
declare const Keychain: {
  set(key: string, value: string): void
  get(key: string): string | null
  remove(key: string): void
}

// ---- 凭据（Keychain，安全边界：永不写入 Storage / 日志） ----
export function saveCredentials(phone: string, password: string) {
  Keychain.set(KC_PHONE, phone)
  Keychain.set(KC_PASSWORD, password)
}
export function getPhone(): string | null {
  return Keychain.get(KC_PHONE)
}
export function hasCredentials(): boolean {
  return !!(Keychain.get(KC_PHONE) && Keychain.get(KC_PASSWORD))
}
export function clearCredentials() {
  Keychain.remove(KC_TOKEN)
  Keychain.remove(KC_PHONE)
  Keychain.remove(KC_PASSWORD)
}

// ---- 缓存（Storage 私有域） ----
export function readCache(): UsageData | null {
  return Storage.get<UsageData>(CACHE_KEY)
}
function writeCache(data: UsageData) {
  Storage.set(CACHE_KEY, data)
}

// ---- 演示模式：先看 UI，后接真实数据 ----
export function isDemoMode(): boolean {
  return Storage.get<boolean>(DEMO_FLAG) === true
}
export function setDemoMode(on: boolean) {
  Storage.set(DEMO_FLAG, on)
}
export function demoData(): UsageData {
  return {
    planName: "5G 大湾区服务计划",
    phoneNumber: "9***1234",
    balanceHKD: 86.5,
    dataTotalGB: 30,
    dataRemainingGB: 18.6,
    voiceTotalMin: 3000,
    voiceRemainingMin: 2140,
    billDay: 1,
    cycleEndDate: null,
    fetchedAt: Date.now(),
  }
}

// ---- 网络 ----
function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj)
}
function toNum(v: any): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function fetchJson(url: string, init: Record<string, any>, timeoutMs = 12000): Promise<any> {
  const req = fetch(url, init)
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("请求超时")), timeoutMs)
  )
  const res = (await Promise.race([req, timer])) as any
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function login(): Promise<string> {
  const phone = Keychain.get(KC_PHONE)
  const password = Keychain.get(KC_PASSWORD)
  if (!phone || !password) throw new Error("未设置账户")
  const json = await fetchJson(`${CMHK.baseUrl}${CMHK.paths.login}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msisdn: phone, password }),
  })
  const token = json?.data?.token ?? json?.token
  if (!token) throw new Error("登录响应中没有 token（请用连接诊断校准字段）")
  Keychain.set(KC_TOKEN, String(token))
  return String(token)
}

async function authedGet(path: string): Promise<any> {
  let token = Keychain.get(KC_TOKEN)
  if (!token) token = await login()
  try {
    return await fetchJson(`${CMHK.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (e: any) {
    if (/HTTP 401|HTTP 403/.test(String(e?.message))) {
      // token 失效：重新登录后重试一次
      token = await login()
      return await fetchJson(`${CMHK.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    }
    throw e
  }
}

// ---- 对外主入口：抓取并归一化（失败时回退缓存并标记 stale） ----
export async function refreshUsage(): Promise<UsageData> {
  if (isDemoMode()) {
    const d = demoData()
    writeCache(d)
    return d
  }
  try {
    const summary = await authedGet(CMHK.paths.usageSummary)
    let balanceHKD: number | null = null
    try {
      const bal = await authedGet(CMHK.paths.balance)
      balanceHKD = toNum(getPath(bal, "data.balance") ?? getPath(bal, "data.remainFee"))
    } catch { /* 余额接口失败不阻塞主数据 */ }

    const fm = CMHK.fieldMap
    const data: UsageData = {
      planName: getPath(summary, fm.planName) ?? null,
      phoneNumber: maskPhone(getPhone()),
      balanceHKD,
      dataTotalGB: toNum(getPath(summary, fm.dataTotalGB)),
      dataRemainingGB: toNum(getPath(summary, fm.dataRemainingGB)),
      voiceTotalMin: toNum(getPath(summary, fm.voiceTotalMin)),
      voiceRemainingMin: toNum(getPath(summary, fm.voiceRemainingMin)),
      billDay: toNum(getPath(summary, fm.billDay)),
      cycleEndDate: getPath(summary, fm.cycleEndDate) ?? null,
      fetchedAt: Date.now(),
    }
    writeCache(data)
    return data
  } catch (e) {
    const cached = readCache()
    if (cached) return { ...cached, stale: true }
    throw e
  }
}

// 诊断用：返回原始 JSON 的顶层键，帮助校准 FIELD_MAP
export async function diagnose(): Promise<{ usageKeys: string[]; balanceKeys: string[] }> {
  const summary = await authedGet(CMHK.paths.usageSummary)
  const bal = await authedGet(CMHK.paths.balance).catch(() => null)
  const topKeys = (o: any) => (o && typeof o === "object" ? Object.keys(o).slice(0, 30) : [])
  return {
    usageKeys: topKeys(summary?.data ?? summary),
    balanceKeys: topKeys(bal?.data ?? bal),
  }
}

// ---- 展示辅助 ----
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null
  return phone.length >= 4 ? `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : phone
}

export function dataRemainingRatio(d: UsageData): number | null {
  if (d.dataTotalGB == null || d.dataRemainingGB == null || d.dataTotalGB <= 0) return null
  return Math.max(0, Math.min(1, d.dataRemainingGB / d.dataTotalGB))
}

export function daysUntilBillDay(d: UsageData): number | null {
  if (d.cycleEndDate) {
    const end = new Date(d.cycleEndDate).getTime()
    if (Number.isFinite(end)) return Math.max(0, Math.ceil((end - Date.now()) / 86400000))
  }
  if (d.billDay == null || d.billDay < 1 || d.billDay > 31) return null
  const now = new Date()
  let year = now.getFullYear()
  let month = now.getMonth()
  const lastDay = new Date(year, month + 1, 0).getDate()
  const day = Math.min(d.billDay, lastDay)
  let target = new Date(year, month, day)
  if (target.getTime() <= now.getTime()) {
    month += 1
    if (month > 11) { month = 0; year += 1 }
    const lastDayNext = new Date(year, month + 1, 0).getDate()
    target = new Date(year, month, Math.min(d.billDay, lastDayNext))
  }
  return Math.ceil((target.getTime() - now.getTime()) / 86400000)
}

export function fmtGB(v: number | null): string {
  if (v == null) return "--"
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1)
}
export function fmtMoney(v: number | null): string {
  if (v == null) return "--"
  return v.toFixed(2)
}
export function fmtMin(v: number | null): string {
  if (v == null) return "--"
  return String(Math.round(v))
}
export function fmtUpdatedAt(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}
