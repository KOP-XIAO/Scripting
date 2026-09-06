// cmhk.ts — CMHK（中国移动香港 / MyLink）用量数据层
// index.tsx / widget.tsx / app_intents.tsx / web-login.tsx 共用。
//
// 认证优先级：
//   1. 网页会话（推荐）：web-login.tsx 里用户在官方网页登录后，
//      自动捕获带鉴权的请求（URL + Authorization/Cookie 头），之后直接重放。
//   2. 密码登录：走下方校准区的 REST 端点（MyLink 无公开 API 文档，需校准）。
//
// ⚠️ 校准说明：MyLink 没有公开 API 文档。网页会话方式通常开箱即用
// （捕获到的就是真实用量接口）；密码方式请用「连接诊断」对照实际返回字段，
// 修改下方 CMHK.paths / CMHK.fieldMap 即可。全程只读接口，不写账户数据。

import { fetch } from "scripting"
import { parseUsageText, ParsedUsage } from "./usage-parser"

export type UsageData = {
  planName: string | null        // 套餐名（如 5G一咭三地計劃60GB）
  phoneNumber: string | null     // 手机号
  accountNumber: string | null   // 主賬號
  balanceHKD: number | null      // 话费余额（储值卡形态，港元）
  billAmountHKD: number | null   // 應繳金額（上台账户形态，港元）
  dataTotalGB: number | null     // 服務計劃數據总量 GB
  dataRemainingGB: number | null // 服務計劃數據剩余 GB
  roamDataTotalGB: number | null // 漫遊數據总量 GB
  roamDataRemainingGB: number | null
  roamExpiry: string | null      // 漫遊失效日期
  voiceTotalMin: number | null   // 通话总量（分钟）
  voiceRemainingMin: number | null
  voiceUnlimited: boolean        // 無限通話
  smsRemaining: number | null    // 短訊剩余（條）
  billDay: number | null         // 每月账单/结算日（1-31）
  cycleEndDate: string | null    // 本周期结束日 ISO（若能取到）
  fetchedAt: number              // 抓取时间戳 ms
  stale?: boolean                // 是否为失败后的缓存数据
}

const CACHE_KEY = "cmhk.usage.cache"
const DEMO_FLAG = "cmhk.demo"
const KEY_MANUAL_URL = "cmhk.manual.url"
const KEY_MANUAL_HEADERS = "cmhk.manual.headers"
const KEY_WEB_START_URL = "cmhk.web.starturl"
const KEY_WEB_BODY = "cmhk.web.body"
const KEY_CAPTURES = "cmhk.captures" // 捕获环：最近 5 个疑似用量接口

// Keychain 键（全局 Keychain，脚本级隔离）
const KC_TOKEN = "cmhk.mylink.token"
const KC_PHONE = "cmhk.account.phone"
const KC_PASSWORD = "cmhk.account.password"
const KC_WEB_URL = "cmhk.web.url"
const KC_WEB_AUTH = "cmhk.web.authorization"
const KC_WEB_COOKIE = "cmhk.web.cookie"

// ---------- 校准区（密码 REST 方式按需修改） ----------
export const CMHK = {
  // MyLink App 接口基址（如抓包结果不同，改这一处即可）
  baseUrl: "https://app.mylink.com.hk/mylink-api",
  paths: {
    login: "/auth/login",          // POST { msisdn, password } -> { token }
    usageSummary: "/usage/summary", // GET，Authorization: Bearer <token>
    balance: "/account/balance",    // GET
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
  set(key: string, value: string): boolean
  get(key: string): string | null
  remove(key: string): void
}

// ---- 凭据（Keychain，安全边界：永不写入 Storage / 日志） ----
export function saveCredentials(phone: string, password: string): boolean {
  return Keychain.set(KC_PHONE, phone) && Keychain.set(KC_PASSWORD, password)
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

// ---- 网页会话（web-login.tsx 捕获） ----
export type WebSession = { url: string; authorization: string | null; cookie: string | null }

export function saveWebSession(s: WebSession): boolean {
  const ok =
    Keychain.set(KC_WEB_URL, s.url) &&
    Keychain.set(KC_WEB_AUTH, s.authorization ?? "") &&
    Keychain.set(KC_WEB_COOKIE, s.cookie ?? "")
  return ok
}
export function readWebSession(): WebSession | null {
  const url = Keychain.get(KC_WEB_URL)
  if (!url) return null
  return {
    url,
    authorization: Keychain.get(KC_WEB_AUTH) || null,
    cookie: Keychain.get(KC_WEB_COOKIE) || null,
  }
}
export function hasWebSession(): boolean {
  return !!Keychain.get(KC_WEB_URL)
}
export function clearWebSession() {
  Keychain.remove(KC_WEB_URL)
  Keychain.remove(KC_WEB_AUTH)
  Keychain.remove(KC_WEB_COOKIE)
}

// ---- 手动接口配置（抓包粘贴：终极兜底路径） ----
export type ManualEndpoint = { url: string; headers: Record<string, string> }

export function saveManualEndpoint(url: string, headersJson: string): void {
  const headers = JSON.parse(headersJson)
  if (typeof headers !== "object" || headers === null) throw new Error("请求头不是合法 JSON")
  Storage.set(KEY_MANUAL_URL, url.trim())
  Storage.set(KEY_MANUAL_HEADERS, headers)
}
export function readManualEndpoint(): ManualEndpoint | null {
  const url = Storage.get<string>(KEY_MANUAL_URL)
  const headers = Storage.get<Record<string, string>>(KEY_MANUAL_HEADERS)
  if (!url || !headers) return null
  return { url, headers }
}
export function hasManualEndpoint(): boolean {
  return !!readManualEndpoint()
}
export function clearManualEndpoint() {
  Storage.remove(KEY_MANUAL_URL)
  Storage.remove(KEY_MANUAL_HEADERS)
}

// ---- 网页登录起始页（可在 App 内修改） ----
export const DEFAULT_WEB_START_URL = "https://www.hk.chinamobile.com/tc/"
export function getWebStartUrl(): string {
  return Storage.get<string>(KEY_WEB_START_URL) || DEFAULT_WEB_START_URL
}
export function setWebStartUrl(url: string) {
  Storage.set(KEY_WEB_START_URL, url.trim())
}

// ---- 捕获环：web-login 期间所有疑似用量接口（供诊断与解析） ----
export type Capture = { url: string; body: string; at: number }
export function saveCapture(url: string, body: string) {
  const list = Storage.get<Capture[]>(KEY_CAPTURES) ?? []
  list.unshift({ url, body: body.slice(0, 60000), at: Date.now() })
  Storage.set(KEY_CAPTURES, list.slice(0, 5))
}
export function readCaptures(): Capture[] {
  return Storage.get<Capture[]>(KEY_CAPTURES) ?? []
}

// ---- 首次捕获的用量 body（来自 web-login 注入钩子） ----
export function saveCapturedBody(body: string) {
  Storage.set(KEY_WEB_BODY, body.slice(0, 60000))
}
export function readCapturedBody(): string | null {
  return Storage.get<string>(KEY_WEB_BODY)
}

// 启发式字段识别：fieldMap 全部落空时，在 JSON 树里按字段名猜测用量数据
function autoMap(json: any): Partial<UsageData> {
  const flat: Record<string, any> = {}
  const walk = (o: any) => {
    if (o == null) return
    if (Array.isArray(o)) { o.forEach(walk); return }
    if (typeof o === "object") { Object.entries(o).forEach(([k, v]) => { flat[k.toLowerCase()] = v; walk(v) }) }
  }
  walk(json)

  const pickNum = (re: RegExp): number | null => {
    for (const k of Object.keys(flat)) {
      if (re.test(k)) {
        const n = toNum(flat[k])
        if (n != null) return n
      }
    }
    return null
  }
  const pickStr = (re: RegExp): string | null => {
    for (const k of Object.keys(flat)) {
      if (re.test(k) && typeof flat[k] === "string") return flat[k]
    }
    return null
  }
  // 流量单位猜测：>1e6 视为字节，>1e4 视为 MB，否则视为 GB
  const toGB = (n: number | null): number | null => {
    if (n == null) return null
    if (n > 1e6) return +(n / 1e9).toFixed(2)
    if (n > 1e4) return +(n / 1024).toFixed(2)
    return n
  }

  const dataRemainingGB = toGB(pickNum(/(data|flow|gprs).*(remain|left|usable|balanc)|(remain|left).*(data|flow|gprs)/i))
  const dataTotalGB = toGB(pickNum(/(data|flow|gprs).*(total|quota|allot|entitle)/i))
  const balanceHKD = pickNum(/balance|余额|结余|remain.*fee/i)
  const voiceRemainingMin = pickNum(/(voice|call|min).*(remain|left|usable)/i)
  const billDay = pickNum(/bill.*day|cycle.*day|settle/i)
  const planName = pickStr(/plan.*name|offering|套餐/i)

  return { dataRemainingGB, dataTotalGB, balanceHKD, voiceRemainingMin, billDay, planName }
}

// ---- 友好错误映射：把 TLS/网络错误翻译成人话 ----
export function friendlyError(e: any): string {
  const msg = String(e?.message ?? e)
  if (/TLS|SSL|证书|certificate|secure connection|NSURLError -12|NSURLError -10/i.test(msg)) {
    return `TLS/安全连接失败：${msg}\n\n建议排查：① 是否开了代理/VPN（QuantumultX 等）的 MITM 而未信任其证书 → 临时关闭再试；② 切换 Wi-Fi/蜂窝网络；③ 确认能正常打开 hk.chinamobile.com`
  }
  if (/无法连接|could not connect|timed out|超时|offline|NSURLError -1009|NSURLError -1001/i.test(msg)) {
    return `网络不可达：${msg}\n\n建议排查：① 网络连接；② 代理/VPN 是否拦截了该域名；③ 稍后重试`
  }
  return msg
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
    planName: "5G一咭三地計劃60GB",
    phoneNumber: "****8892",
    accountNumber: "56088892",
    balanceHKD: null,
    billAmountHKD: 0,
    dataTotalGB: 60,
    dataRemainingGB: 18.6,
    roamDataTotalGB: 60,
    roamDataRemainingGB: 60,
    roamExpiry: "2026-10-06",
    voiceTotalMin: 600,
    voiceRemainingMin: 200,
    voiceUnlimited: false,
    smsRemaining: 500,
    billDay: 6,
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

// 网页会话重放：直接请求捕获到的真实接口
async function fetchWithWebSession(): Promise<any> {
  const s = readWebSession()
  if (!s) throw new Error("无网页会话")
  const headers: Record<string, string> = {}
  if (s.authorization) headers["Authorization"] = s.authorization
  if (s.cookie) headers["Cookie"] = s.cookie
  try {
    const req = fetch(s.url, { headers })
    const timer = new Promise((_, reject) => setTimeout(() => reject(new Error("请求超时")), 12000))
    const res = (await Promise.race([req, timer])) as any
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    try { return JSON.parse(text) } catch { return text }
  } catch (e: any) {
    if (/HTTP 401|HTTP 403/.test(String(e?.message))) {
      throw new Error("网页会话已过期，请重新「网页登录」")
    }
    throw e
  }
}

// 密码 REST 方式（校准区）
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
    let summary: any
    const manual = readManualEndpoint()
    if (manual) {
      // 手动接口：抓包粘贴的真实用量接口（最优先）
      summary = await fetchJson(manual.url, { headers: manual.headers })
    } else if (hasWebSession()) {
      // 网页会话：重放捕获到的真实接口；失败则退回登录时捕获的内容
      try {
        summary = await fetchWithWebSession()
      } catch (e) {
        const body = readCapturedBody()
        if (body) {
          try { summary = JSON.parse(body) } catch { summary = body }
        } else {
          throw e
        }
      }
    } else if (readCaptures().length) {
      // 无会话但有历史捕获：直接用最近一次捕获内容
      summary = readCaptures()[0].body
    } else if (hasCredentials()) {
      summary = await authedGet(CMHK.paths.usageSummary)
    } else {
      throw new Error("尚未登录：请先「网页登录」，或在「手动配置接口」粘贴抓包结果")
    }

    let balanceHKD: number | null = null
    try {
      const bal = hasWebSession() || manual
        ? summary // 会话/手动方式暂用同一响应取余额字段
        : await authedGet(CMHK.paths.balance)
      balanceHKD = toNum(getPath(bal, CMHK.fieldMap.balanceHKD) ?? getPath(bal, "data.remainFee"))
    } catch { /* 余额字段失败不阻塞主数据 */ }

    const fm = CMHK.fieldMap
    const auto = autoMap(summary)
    // 终极兜底：把响应（JSON 或 HTML）拍平成文本，按中文界面真实字段形态提取
    const parsed: ParsedUsage = parseUsageText(typeof summary === "string" ? summary : JSON.stringify(summary))
    const data: UsageData = {
      planName: getPath(summary, fm.planName) ?? auto.planName ?? parsed.planName ?? null,
      phoneNumber: maskPhone(getPhone()),
      accountNumber: parsed.accountNumber ?? null,
      balanceHKD: balanceHKD ?? auto.balanceHKD ?? parsed.balanceHKD ?? null,
      billAmountHKD: parsed.billAmountHKD ?? null,
      dataTotalGB: toNum(getPath(summary, fm.dataTotalGB)) ?? auto.dataTotalGB ?? parsed.dataTotalGB ?? null,
      dataRemainingGB: toNum(getPath(summary, fm.dataRemainingGB)) ?? auto.dataRemainingGB ?? parsed.dataRemainingGB ?? null,
      roamDataTotalGB: parsed.roamDataTotalGB ?? null,
      roamDataRemainingGB: parsed.roamDataRemainingGB ?? null,
      roamExpiry: parsed.roamExpiry ?? null,
      voiceTotalMin: toNum(getPath(summary, fm.voiceTotalMin)) ?? parsed.voiceTotalMin ?? null,
      voiceRemainingMin: toNum(getPath(summary, fm.voiceRemainingMin)) ?? auto.voiceRemainingMin ?? parsed.voiceRemainingMin ?? null,
      voiceUnlimited: parsed.voiceUnlimited ?? false,
      smsRemaining: parsed.smsRemaining ?? null,
      billDay: toNum(getPath(summary, fm.billDay)) ?? auto.billDay ?? null,
      cycleEndDate: getPath(summary, fm.cycleEndDate) ?? null,
      fetchedAt: Date.now(),
    }
    writeCache(data)
    return data
  } catch (e) {
    const cached = readCache()
    if (cached) return { ...cached, stale: true }
    throw new Error(friendlyError(e))
  }
}

// 连接测试：逐个探测关键主机，输出干净的结果
export async function connectionTest(): Promise<string> {
  const targets = [
    { name: "CMHK 官网", url: DEFAULT_WEB_START_URL },
    { name: "GitHub 更新源", url: "https://raw.githubusercontent.com" },
  ]
  const lines: string[] = []
  for (const t of targets) {
    try {
      const res = (await fetch(t.url, { method: "HEAD" })) as any
      lines.push(`✓ ${t.name}：可达（HTTP ${res.status}）`)
    } catch (e: any) {
      lines.push(`✗ ${t.name}：${friendlyError(e).split("\n")[0]}`)
    }
  }
  return lines.join("\n")
}

// 诊断用：返回原始 JSON 的顶层键，帮助校准 FIELD_MAP
export async function diagnose(): Promise<{ usageKeys: string[]; balanceKeys: string[] }> {
  const summary = hasWebSession()
    ? await fetchWithWebSession()
    : await authedGet(CMHK.paths.usageSummary)
  let bal: any = null
  if (!hasWebSession()) {
    bal = await authedGet(CMHK.paths.balance).catch(() => null)
  }
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
