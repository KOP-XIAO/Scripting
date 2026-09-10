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

export const VERSION = "1.19.11"  // 与 script.json 同步
import { parseUsageText, parseUsageQueryJson, parseAccountInfoJson, parseWealthJson, parseNicknameJson, parseMembershipJson, ParsedUsage } from "./usage-parser"

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
  membershipTier: string | null  // 我的會籍（白金/金…）
  points: number | null          // 我的積分
  nickname: string | null        // 昵称（getNickname）
  userName: string | null         // 账户真实姓名（queryAccountInfo.userName）
  buckets?: { name: string; totalGB: number | null; remainingGB: number | null; expiry: string | null }[]
  nickname: string | null        // 昵称
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
const KEY_OVERVIEW_HTML = "cmhk.overview.html" // 账户概览页 HTML（持久，供会员/积分/应缴）
const KEY_PROFILE = "cmhk.profile" // 解析出的档案（nickname/会籍/积分/姓名），防捕获环被挤掉
const KEY_MEMBER_JSON = "cmhk.member.json" // memberLevelRightBaseInfo / wealth 原始 JSON（持久）
const KEY_NICKNAME_JSON = "cmhk.nickname.json" // getNickname 原始 JSON（持久）
const KEY_LOGIN_REQUESTS = "cmhk.login.requests" // 登录报文捕获环（密码打码）：为自动登录校准积累配方

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

// WebViewController 是全局对象（不从 scripting 导入）
declare const WebViewController: {
  new (options?: { ephemeral?: boolean }): {
    loadURL(url: string): Promise<boolean>
    waitForLoad(): Promise<boolean>
    getHTML(): Promise<string | null>
    evaluateJavaScript<T = any>(javascript: string): Promise<T>
    addScriptMessageHandler<P = any>(name: string, handler: (params?: P) => any): Promise<void>
    dispose(): void
  }
}

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
export type WebSession = {
  url: string                    // 捕获到的用量 API 地址
  method?: string                // GET/POST
  reqBody?: string               // 请求体（若有）
  pageUrl?: string               // 当时所在页面（页内 fetch 的上下文）
  at?: number                    // 会话捕获时间（epoch ms，v1.19.10+；旧会话无此字段）
  authorization: string | null
  cookie: string | null
}

const KC_WEB_METHOD = "cmhk.web.method"
const KC_WEB_AT = "cmhk.web.at"
const KC_WEB_REQBODY = "cmhk.web.reqbody"
const KC_WEB_PAGEURL = "cmhk.web.pageurl"

export function saveWebSession(s: WebSession): boolean {
  const ok =
    Keychain.set(KC_WEB_URL, s.url) &&
    Keychain.set(KC_WEB_AUTH, s.authorization ?? "") &&
    Keychain.set(KC_WEB_COOKIE, s.cookie ?? "") &&
    Keychain.set(KC_WEB_METHOD, s.method ?? "GET") &&
    Keychain.set(KC_WEB_REQBODY, s.reqBody ?? "") &&
    Keychain.set(KC_WEB_PAGEURL, s.pageUrl ?? "") &&
    Keychain.set(KC_WEB_AT, s.at != null ? String(s.at) : "")
  return ok
}
export function readWebSession(): WebSession | null {
  const url = Keychain.get(KC_WEB_URL)
  if (!url) return null
  const atRaw = Keychain.get(KC_WEB_AT)
  return {
    url,
    at: atRaw ? Number(atRaw) : undefined,
    method: Keychain.get(KC_WEB_METHOD) || "GET",
    reqBody: Keychain.get(KC_WEB_REQBODY) || "",
    pageUrl: Keychain.get(KC_WEB_PAGEURL) || undefined,
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
  Keychain.remove(KC_WEB_METHOD)
  Keychain.remove(KC_WEB_REQBODY)
  Keychain.remove(KC_WEB_PAGEURL)
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

// ---- 调试日志（诊断页可见） ----
const KEY_DEBUG = "cmhk.debuglog"
export function appendDebug(line: string) {
  const log = Storage.get<string[]>(KEY_DEBUG) ?? []
  const t = new Date()
  const hh = String(t.getHours()).padStart(2, "0")
  const mm = String(t.getMinutes()).padStart(2, "0")
  const ss = String(t.getSeconds()).padStart(2, "0")
  log.push(`${hh}:${mm}:${ss} ${line}`)
  Storage.set(KEY_DEBUG, log.slice(-60))
}
export function readDebugLog(): string[] {
  return Storage.get<string[]>(KEY_DEBUG) ?? []
}
export function clearDebugLog() {
  Storage.remove(KEY_DEBUG)
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

// ---- 登录报文捕获环（密码打码）：下次网页登录时顺带校准"自动登录"配方 ----
export type LoginRequest = { url: string; method: string; reqBody: string; body: string; at: number }
export function maskSecrets(s: string): string {
  return s
    .replace(/"([^"]*(?:password|passwd|pwd|secret)[^"]*)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
    .replace(/([^=&\s]*(?:password|passwd|pwd|secret)[^=&\s]*)=([^&]*)/gi, "$1=***")
}
export function isLoginRequest(url: string, method: string): boolean {
  return method.toUpperCase() === "POST" && /login|signin|sign-in|auth|sso|password/i.test(url)
}
export function saveLoginRequest(url: string, method: string, reqBody: string, body: string) {
  const list = Storage.get<LoginRequest[]>(KEY_LOGIN_REQUESTS) ?? []
  list.unshift({ url, method: method.toUpperCase(), reqBody: maskSecrets(reqBody).slice(0, 2000), body: body.slice(0, 2000), at: Date.now() })
  Storage.set(KEY_LOGIN_REQUESTS, list.slice(0, 8))
}
export function readLoginRequests(): LoginRequest[] {
  return Storage.get<LoginRequest[]>(KEY_LOGIN_REQUESTS) ?? []
}

// ---- 首次捕获的用量 body（来自 web-login 注入钩子） ----
export function saveCapturedBody(body: string) {
  Storage.set(KEY_WEB_BODY, body.slice(0, 60000))
  Storage.set(KEY_WEB_BODY_AT, Date.now()) // v1.19.10：快照时间，供回退判定
}
export function readCapturedBody(): string | null {
  return Storage.get<string>(KEY_WEB_BODY)
}
const KEY_WEB_BODY_AT = "cmhk.web.body.at"
function readCapturedBodyAt(): number | null {
  const v = Storage.get<number>(KEY_WEB_BODY_AT)
  return typeof v === "number" ? v : null
}

// v1.19.10：缓存是否"确实更新"到值得拒绝登录快照——时间戳判定。
// 旧逻辑只看 stale 标志：上次成功刷新写入的缓存永远"非 stale"，会话过期几天后
// 连重新登录拿到的新鲜快照都被拒（数据永久冻结在最后一次成功刷新）。
// 规则：stale 缓存永远让路；缓存时间未知宁可接受快照；超过2小时不算"较新"；
// 双方时间已知时精确比较；快照时间未知时只保护2小时内的缓存。
function cacheBeatsSnapshot(cur: UsageData | null, snapAt: number | null): boolean {
  if (!cur || cur.stale === true) return false
  const t = typeof cur.fetchedAt === "number" ? cur.fetchedAt : Date.parse(String(cur.fetchedAt ?? ""))
  if (!Number.isFinite(t)) return false
  if (Date.now() - t > 2 * 3600_000) return false
  if (snapAt != null && Number.isFinite(snapAt) && snapAt > 0) return t >= snapAt // 平局保缓存：同样新鲜时不无谓打快取标
  return true
}

function cacheAgeDesc(cur: UsageData | null): string {
  const t = typeof cur?.fetchedAt === "number" ? cur.fetchedAt : Date.parse(String(cur?.fetchedAt ?? ""))
  if (!Number.isFinite(t)) return ""
  const min = Math.round((Date.now() - t) / 60000)
  return min < 60 ? `(${min}分钟前)` : `(${Math.round(min / 60)}小时前)`
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

// ---- 刷新报告：每次刷新记录路径/发起方/结果/数值是否变化（App 内展示） ----
const KEY_REPORT = "cmhk.refresh.report"
export type RefreshReport = {
  at: number             // 完成时间戳 ms
  path: string           // 手动接口 / 直连重放 / WebView 重放 / 登录时快取 / 捕获环快取 / 密码接口 / 演示数据 / 刷新失败
  via: string            // 发起方：app / app-auto / widget / intent
  ok: boolean            // 是否拉到了新响应（非快取回退）
  stale: boolean         // 数据是否为快取
  changed: boolean | null // 与上一次缓存相比数值是否变化（null = 无旧缓存可比较）
}
export function readRefreshReport(): RefreshReport | null {
  return Storage.get<RefreshReport>(KEY_REPORT)
}
function saveReport(path: string, via: string, ok: boolean, stale: boolean, changed: boolean | null) {
  Storage.set(KEY_REPORT, { at: Date.now(), path, via, ok, stale, changed })
}
function usageSignature(d: UsageData): string {
  return JSON.stringify([
    d.dataRemainingGB, d.dataTotalGB, d.billAmountHKD, d.balanceHKD,
    d.voiceRemainingMin, d.points,
    (d.buckets ?? []).map((b) => [b.name, b.remainingGB, b.totalGB]),
  ])
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
    roamDataTotalGB: null,
    roamDataRemainingGB: null,
    roamExpiry: null,
    voiceTotalMin: 600,
    voiceRemainingMin: 200,
    voiceUnlimited: false,
    smsRemaining: 500,
    billDay: 6,
    cycleEndDate: null,
    membershipTier: "白金",
    points: 4006,
    nickname: "KOP-Shawn",
    userName: "XIAO SONGWEN",
    buckets: [
      { name: "套餐內數據", totalGB: 60, remainingGB: 18.6, expiry: null },
      { name: "額外贈送數據", totalGB: 60, remainingGB: 60, expiry: "2026-10-06" },
    ],
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

// 会话 URL 解析：捕获的 API 地址可能是相对路径，补官网 origin
function resolveSessionUrl(s: WebSession): { apiUrl: string; pageUrl: string } {
  return {
    apiUrl: s.url.startsWith("http")
      ? s.url
      : `https://www.hk.chinamobile.com${s.url.startsWith("/") ? "" : "/"}${s.url}`,
    pageUrl: s.pageUrl && s.pageUrl.startsWith("http")
      ? s.pageUrl
      : "https://www.hk.chinamobile.com/tc/",
  }
}

// 直连重放快路径：手动拼 Cookie/Authorization 头直接 fetch，不创建 WebView。
// 适用 widget / AppIntent 等受限上下文（时间与内存预算紧）。
// 局限：document.cookie 看不到 httpOnly Cookie，若 CMHK 会话依赖它则此处
// 失败，返回 null，由调用方回退完整链路（无头 WebView 页内重放）。
// ---- 响应内容校验（v1.19.9） ----
// 背景：会话/WAF 令牌过期后，服务器以 HTTP 200 + 业务错误 JSON 响应（如
// {"code":"999999","message":"用戶未登錄"}）。v1.19.8 及之前把它当"成功"，解析不出
// 用量字段后又从捕获环/profile 拼回旧数据——表现为"重放成功"但数值永远是旧的，
// 且错误 JSON 短路了本可以拿到新数据的 WebView 页内重放。
export function isApiError(obj: any): boolean {
  if (typeof obj !== "object" || obj === null) return false
  const s = JSON.stringify(obj)
  if (s.length > 4000) return false // 真实用量响应很大；错误响应都很短
  const msg = String(obj.message ?? obj.msg ?? obj.errorMsg ?? obj.error ?? "")
  if (/未登錄|未登录|not\s*login|please\s*login|會話|会话|過期|过期|expired|無效|无效|invalid|token|denied|unauthorized|禁止/i.test(msg)) return true
  const code = String(obj.code ?? obj.errorCode ?? obj.respCode ?? obj.resultCode ?? obj.status ?? "")
  if (code && !["0", "00", "000", "0000", "000000", "200", "success", "true", "ok"].includes(code.toLowerCase())) {
    // 非成功码且响应里没有任何用量特征字段 → 业务错误
    if (!/remainingGB|totalGB|usage|lastUpdateDate|offerInfo|remainFee|balance/i.test(s)) return true
  }
  return false
}

// 直连/页内重放响应必须真的含用量数据，否则视为未命中（交给下层回退链）
export function summaryHasUsage(v: any): boolean {
  if (typeof v !== "object" || v === null) return false
  if (Object.keys(parseUsageQueryJson(v)).length > 0) return true
  const s = JSON.stringify(v)
  return /remainingGB|totalGB|lastUpdateDate|offerInfo|remainFee|"usage"\s*:/i.test(s)
}

async function fetchDirectWithSession(s: WebSession): Promise<any | null> {
  const { apiUrl } = resolveSessionUrl(s)
  const headers: Record<string, string> = { "Accept": "application/json" }
  if (s.authorization) headers["Authorization"] = s.authorization
  if (s.cookie) headers["Cookie"] = s.cookie
  const method = (s.method ?? "GET").toUpperCase()
  const hasBody = method !== "GET" && !!s.reqBody
  if (hasBody) headers["Content-Type"] = "application/json"
  const init: Record<string, any> = { method, headers }
  if (hasBody) init.body = s.reqBody
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error("直连超时")), 5000))
  const res = (await Promise.race([fetch(apiUrl, init), timer])) as any
  if (!res || !res.ok) {
    appendDebug(`直连未命中: ${res ? `HTTP ${res.status}` : "无响应"}`)
    return null
  }
  try {
    const j = await res.json() // HTML / 非 JSON 响应会抛错 → 视为未命中
    if (isApiError(j)) {
      appendDebug(`直连未命中: 错误响应 ${JSON.stringify(j).slice(0, 120)}`)
      return null // HTTP 200 + 业务错误 JSON → 视为未命中
    }
    return j
  } catch {
    appendDebug("直连未命中: 非JSON响应")
    return null
  }
}

// 网页会话刷新：无头 WebView 打开官网页面，在页面上下文里重放用量 API。
// Cookie 由 WebView 自动携带（含 httpOnly 会话 Cookie），无需手动拼头。
// v1.19.2：结果改经 messageHandler 回传（与网页登录捕获同机制，真机已验证）——
// 不再依赖 evaluateJavaScript 对 Promise 返回值的处理（官方文档只有同步示例，从未承诺）；
// POST 补 Content-Type（与直连路径一致）；检查 HTTP 状态；失败原因可诊断。
async function fetchWithWebSession(): Promise<any> {
  const s = readWebSession()
  if (!s) throw new Error("无网页会话")

  const { apiUrl, pageUrl } = resolveSessionUrl(s)

  const wv = new WebViewController()
  try {
    // 每一步都加超时保护：无头 WebView 在受限上下文中可能加载卡死
    const withTimeout = <T,>(pr: Promise<T>, ms: number, label: string): Promise<T> =>
      Promise.race([pr, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`超时: ${label}`)), ms))])

    // 结果通道：页内 fetch 完成后 postMessage 回传（登录捕获同款，已真机验证）
    let result: { ok?: boolean; status?: number; text?: string } | null = null
    await wv.addScriptMessageHandler<any>("cmhkReplay", (msg) => {
      result = msg ?? null
      return null
    })

    await withTimeout(wv.loadURL(pageUrl), 20000, "打开页面")
    await withTimeout(wv.waitForLoad(), 15000, "等待页面加载").catch(() => { /* 加载不完全也继续尝试 */ })
    await new Promise((r) => setTimeout(r, 1200)) // 等残余 JS 跑完

    const method = (s.method ?? "GET").toUpperCase()
    const hasBody = method !== "GET" && !!s.reqBody
    const headersJs = hasBody
      ? `{ "Accept": "application/json", "Content-Type": "application/json" }`
      : `{ "Accept": "application/json" }`
    const bodyJs = hasBody ? `, body: ${JSON.stringify(s.reqBody)}` : ""
    // v1.19.11：瑞数 WAF 令牌（XGiOG2f705）单次/短效——携带登录时的旧令牌重放会被拒。
    // 剥掉旧令牌，让页面自带的 WAF fetch 钩子为本次请求现铸新令牌（真机日志证实旧令牌立即失效）。
    const replayUrl = apiUrl.replace(/[?&]XGiOG2f705=[^&]*/i, "").replace(/\?$/, "")
    if (replayUrl !== apiUrl) appendDebug("页内重放: 已剥离旧WAF令牌")
    const script = [
      "(function(){",
      "  try {",
      `    fetch(${JSON.stringify(replayUrl)}, { method: ${JSON.stringify(method)}, credentials: "include", headers: ${headersJs}${bodyJs} })`,
      "      .then(function(r){ return r.text().then(function(t){ return { ok: r.ok, status: r.status, text: t } }) })",
      "      .then(function(v){ window.webkit.messageHandlers.cmhkReplay.postMessage(v) })",
      "      .catch(function(e){ window.webkit.messageHandlers.cmhkReplay.postMessage({ ok: false, status: 0, text: \"FETCHERR:\" + String((e && e.message) || e) }) })",
      "  } catch (e) {",
      "    window.webkit.messageHandlers.cmhkReplay.postMessage({ ok: false, status: 0, text: \"JSERR:\" + String((e && e.message) || e) })",
      "  }",
      "  return true",
      "})()",
    ].join("\n")
    await withTimeout(wv.evaluateJavaScript<boolean>(script), 5000, "发起页内请求") // 只等脚本启动，不等 fetch
    // 轮询等待页内结果（最多 12 秒）
    const deadline = Date.now() + 12000
    while (result == null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400))
    }
    if (result == null) throw new Error("页内请求超时（结果未回传）")
    if (result.ok === false) {
      const rt = String(result.text ?? "")
      throw new Error(/^FETCHERR:|^JSERR:/.test(rt) ? rt : `页内请求失败 HTTP ${result.status ?? "?"}`)
    }
    const text = String(result.text ?? "")
    if (!text) throw new Error("页内请求返回为空")
    if (/^\s*<(!DOCTYPE|html)/i.test(text)) {
      throw new Error("网页会话已过期，请重新「网页登录」")
    }
    let j: any
    try { j = JSON.parse(text) } catch { return text }
    if (isApiError(j)) {
      // v1.19.11：区分真会话过期与 WAF/接口错误——不再一律宣称"会话过期"
      // （v1.19.9 的误标导致登录后立刻弹"重新登录"，用户被无意义打扰）
      const sn = JSON.stringify(j).slice(0, 150)
      throw new Error(/未登錄|未登录|過期|过期/.test(sn)
        ? `网页会话已过期（${sn}）`
        : `页内请求错误响应（${sn}）`)
    }
    return j
  } finally {
    wv.dispose()
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
// opts.directOnly：只走轻量路径（手动接口 / 直连重放），不创建 WebView。
//   供 widget 进程与 AppIntent 快路径使用：命中返回新数据（已写缓存），未命中返回 null。
export async function refreshUsage(opts?: { directOnly?: boolean; via?: string }): Promise<UsageData | null> {
  const directOnly = opts?.directOnly === true
  const via = opts?.via ?? "app"
  let fromCaptured = false // 本次数据是否来自登录时捕获的旧 body（诚实标记 stale）
  let pathLabel = ""      // 本次数据来源（写入刷新报告）
  try {
    if (isDemoMode()) {
      if (directOnly) return null
      const d = demoData()
      writeCache(d)
      saveReport("演示数据", via, true, false, null)
      return d
    }
    // 轻量模式只认手动接口与网页会话直连，其余直接让调用方回退缓存
    if (directOnly && !readManualEndpoint() && !hasWebSession()) return null
    let summary: any
    const manual = readManualEndpoint()
    if (manual) {
      // 手动接口：抓包粘贴的真实用量接口（最优先）
      summary = await fetchJson(manual.url, { headers: manual.headers }, directOnly ? 5000 : 12000)
      appendDebug("刷新: 手动接口")
      pathLabel = "手动接口"
    } else if (hasWebSession()) {
      // 快路径：直连重放（不依赖 WebView，widget/AppIntent 上下文友好）
      let direct: any = null
      try { direct = await fetchDirectWithSession(readWebSession()!) } catch { direct = null }
      const directOk = direct != null && summaryHasUsage(direct)
      if (direct != null && !directOk) appendDebug("刷新: 直连响应无用量数据，视为未命中")
      if (directOk) {
        summary = direct
        appendDebug("刷新: 直连重放成功")
        pathLabel = "直连重放"
      } else if (directOnly) {
        return null
      } else {
        // 网页会话：无头 WebView 页内重放（Cookie 自动携带）；失败退回登录时捕获的内容
        try {
          summary = await fetchWithWebSession()
          if (!summaryHasUsage(summary)) throw new Error("页内响应无用量数据")
          pathLabel = "WebView 重放"
          appendDebug("刷新: WebView 重放成功")
        } catch (e) {
          const reason = String((e as any)?.message ?? e)
          const hm = /HTTP (\d+)/.exec(reason)
          const shortReason = hm ? `·HTTP${hm[1]}` : /已过期/.test(reason) ? "·会话过期" : /无用量数据/.test(reason) ? "·空数据" : /错误响应/.test(reason) ? "·错误响应" : /超时/.test(reason) ? "·超时" : "·请求失败"
          appendDebug(`刷新: WebView 重放失败 ${reason.slice(0, 120)}`)
          const body = readCapturedBody()
          if (body) {
            // 保留更新的缓存：仅当缓存真的更新（时间戳判定，v1.19.10）
            const cur = readCache()
            const snapAt = readWebSession()?.at ?? readCapturedBodyAt()
            if (cacheBeatsSnapshot(cur, snapAt)) {
              appendDebug("刷新: 快照回退被拒（现有缓存更新，保留）")
              saveReport(`刷新失败·保留较新缓存${cacheAgeDesc(cur)}${shortReason}`, via, false, false, false)
              return cur
            }
            try { summary = JSON.parse(body) } catch { summary = body }
            fromCaptured = true
            pathLabel = `登录时快取${shortReason}`
            appendDebug("刷新: 回退登录时捕获 body（已标记快取）")
          } else {
            throw e
          }
        }
      }
    } else if (readCaptures().length) {
      // 无会话但有历史捕获：现有缓存更新时保留，否则用最近一次捕获内容
      const cur = readCache()
      if (cacheBeatsSnapshot(cur, readCaptures()[0]?.at ?? null)) {
        saveReport(`刷新失败·保留较新缓存${cacheAgeDesc(cur)}`, via, false, false, false)
        return cur
      }
      summary = readCaptures()[0].body
      fromCaptured = true
      pathLabel = "捕获环快取"
      appendDebug("刷新: 回退捕获环（已标记快取）")
    } else if (hasCredentials()) {
      summary = await authedGet(CMHK.paths.usageSummary)
      pathLabel = "密码接口"
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
    // 精确结构：usageQuery 接口 JSON（本次刷新或捕获环里的均可）
    let jq: ParsedUsage = {}
    const tryJson = (v: any): ParsedUsage => {
      if (typeof v !== "object" || v === null) return {}
      const r = parseUsageQueryJson(v)
      return Object.keys(r).length ? r : {}
    }
    jq = tryJson(summary)
    if (!Object.keys(jq).length) {
      for (const c of readCaptures()) {
        try {
          const r = tryJson(JSON.parse(c.body))
          if (Object.keys(r).length) { jq = r; break }
        } catch { /* 非 JSON 跳过 */ }
      }
    }
    // 文本兜底：本次响应（JSON/HTML）拍平提取
    const parsed0: ParsedUsage = parseUsageText(typeof summary === "string" ? summary : JSON.stringify(summary))
    let parsed: ParsedUsage = { ...parsed0, ...jq }
    // 持久化档案（上次解析出的昵称/会籍/积分/姓名）作为保底
    const prof = Storage.get<{ nickname?: string; membershipTier?: string; points?: number; userName?: string; planName?: string }>(KEY_PROFILE)
    if (prof) {
      if (parsed.nickname == null && prof.nickname) parsed.nickname = prof.nickname
      if (parsed.membershipTier == null && prof.membershipTier) parsed.membershipTier = prof.membershipTier
      if (parsed.points == null && prof.points != null) parsed.points = prof.points
      if (parsed.userName == null && prof.userName) parsed.userName = prof.userName
      if (parsed.planName == null && prof.planName) parsed.planName = prof.planName
    }
    // 捕获环里所有 JSON 逐个补充（余额/套餐/会籍/积分/用量）
    for (const c of readCaptures()) {
      if (!c.body.startsWith("{") && !c.body.startsWith("[")) continue
      try {
        const o = JSON.parse(c.body)
        const acco = parseAccountInfoJson(o)
        if (parsed.billAmountHKD == null && acco.billAmountHKD != null) parsed.billAmountHKD = acco.billAmountHKD
        if (parsed.planName == null && acco.planName) parsed.planName = acco.planName
        if (parsed.accountNumber == null && acco.accountNumber) parsed.accountNumber = acco.accountNumber
        if (parsed.userName == null && acco.userName) parsed.userName = acco.userName
        const w = parseWealthJson(o)
        if (parsed.membershipTier == null && w.membershipTier) parsed.membershipTier = w.membershipTier
        if (parsed.points == null && w.points != null) parsed.points = w.points
        const nick = parseNicknameJson(o)
        if (parsed.nickname == null && nick) parsed.nickname = nick
        const q = parseUsageQueryJson(o)
        if (parsed.dataRemainingGB == null && q.dataRemainingGB != null) parsed.dataRemainingGB = q.dataRemainingGB
        if (parsed.dataTotalGB == null && q.dataTotalGB != null) parsed.dataTotalGB = q.dataTotalGB
        if (parsed.voiceRemainingMin == null && q.voiceRemainingMin != null) parsed.voiceRemainingMin = q.voiceRemainingMin
        if (parsed.voiceUnlimited == null && q.voiceUnlimited != null) parsed.voiceUnlimited = q.voiceUnlimited
        if ((parsed.buckets ?? []).length === 0 && q.buckets) parsed.buckets = q.buckets
      } catch { /* 非 JSON 跳过 */ }
    }
    // 持久化会员/昵称 JSON（memberLevelRightBaseInfo/wealth/getNickname）
    const mj = readMemberJson()
    if (mj && (parsed.membershipTier == null || parsed.points == null)) {
      try {
        const mo = JSON.parse(mj)
        const mm = parseMembershipJson(mo)
        if (parsed.membershipTier == null && mm.membershipTier) parsed.membershipTier = mm.membershipTier
        const wm = parseWealthJson(mo)
        if (parsed.membershipTier == null && wm.membershipTier && !/^\d+$/.test(wm.membershipTier)) parsed.membershipTier = wm.membershipTier
        if (parsed.points == null && wm.points != null) parsed.points = wm.points
      } catch { /* 忽略 */ }
    }
    const nj = readNicknameJson()
    if (parsed.nickname == null && nj) {
      try { const n = parseNicknameJson(JSON.parse(nj)); if (n) parsed.nickname = n } catch { /* 忽略 */ }
    }
    // 再用捕获环 + 持久化概览页 HTML 补会员/积分/应缴金额/套餐名
    if (parsed.membershipTier == null || parsed.points == null || parsed.billAmountHKD == null || parsed.planName == null) {
      const ovh = readOverviewHtml()
      if (ovh) {
        const extra = parseUsageText(ovh)
        if (parsed.membershipTier == null && extra.membershipTier) parsed.membershipTier = extra.membershipTier
        if (parsed.points == null && extra.points != null) parsed.points = extra.points
        if (parsed.billAmountHKD == null && extra.billAmountHKD != null) parsed.billAmountHKD = extra.billAmountHKD
        if (parsed.planName == null && extra.planName) parsed.planName = extra.planName
      }
      for (const c of readCaptures()) {
        if (!c.body.startsWith("<")) continue
        const extra = parseUsageText(c.body)
        if (parsed.membershipTier == null && extra.membershipTier) parsed.membershipTier = extra.membershipTier
        if (parsed.points == null && extra.points != null) parsed.points = extra.points
        if (parsed.billAmountHKD == null && extra.billAmountHKD != null) parsed.billAmountHKD = extra.billAmountHKD
        if (parsed.planName == null && extra.planName) parsed.planName = extra.planName
      }
    }
    // 会员代码→等级名（对 profile/解析链任何来源的纯数字代码统一映射）
    if (parsed.membershipTier && /^\d+$/.test(parsed.membershipTier)) {
      const tierMap: Record<string, string> = { "10002": "白金", "10001": "金", "10003": "铂金", "10004": "钻石" }
      const mapped = tierMap[parsed.membershipTier]
      if (mapped) { parsed.membershipTier = mapped; appendDebug(`会员代码${parsed.membershipTier}->${mapped}`) }
    }
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
      membershipTier: parsed.membershipTier ?? null,
      points: parsed.points ?? null,
      nickname: parsed.nickname ?? null,
      userName: parsed.userName ?? null,
      buckets: (parsed.buckets ?? []).map((b) => ({
        name: b.name,
        totalGB: b.totalGB ?? null,
        remainingGB: b.remainingGB ?? null,
        expiry: b.expiry ?? null,
      })),
      billDay: toNum(getPath(summary, fm.billDay)) ?? auto.billDay ?? null,
      cycleEndDate: getPath(summary, fm.cycleEndDate) ?? (parsed.buckets?.[0]?.expiry ?? null),
      fetchedAt: Date.now(),
      stale: fromCaptured ? true : undefined,
    }
    const prevCache = readCache()
    const changed = prevCache ? usageSignature(prevCache) !== usageSignature(data) : null
    writeCache(data)
    saveReport(pathLabel || "刷新", via, !fromCaptured, fromCaptured, changed)
    // 持久化档案，避免捕获环被挤掉后昵称/会籍/积分丢失
    Storage.set(KEY_PROFILE, {
      nickname: data.nickname,
      membershipTier: data.membershipTier,
      points: data.points,
      userName: data.userName,
      planName: data.planName,
    })
    return data
  } catch (e) {
    if (directOnly) return null
    const cached = readCache()
    if (cached) {
      saveReport("刷新失败·网络或会话异常", via, false, true, false)
      return { ...cached, stale: true }
    }
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
  return v.toFixed(1)
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

// 周期剩余天数：主桶 expiry（如 2026-10-06）距今的天数
export function daysUntilCycleEnd(d: UsageData): number | null {
  const src = d.cycleEndDate ?? d.buckets?.[0]?.expiry ?? d.roamExpiry
  if (!src) return null
  const t = new Date(src.replace(/-/g, "/")).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.ceil((t - Date.now()) / 86400000))
}

// 账户概览页 HTML 持久存取（会员/积分/应缴的来源之一）
export function saveOverviewHtml(html: string) { Storage.set(KEY_OVERVIEW_HTML, html.slice(0, 600000)) }
export function readOverviewHtml(): string | null { return Storage.get<string>(KEY_OVERVIEW_HTML) }

export function saveMemberJson(body: string) { Storage.set(KEY_MEMBER_JSON, body) }
export function readMemberJson(): string | null { return Storage.get<string>(KEY_MEMBER_JSON) }
export function saveNicknameJson(body: string) { Storage.set(KEY_NICKNAME_JSON, body) }
export function readNicknameJson(): string | null { return Storage.get<string>(KEY_NICKNAME_JSON) }
