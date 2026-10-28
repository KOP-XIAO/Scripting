// web-login.tsx — 网页登录捕获 v5
// 目标只有一个：抓到用量 API 的真实响应（真机实证：页面会调
// /api/omni-channel-service-personal/rest/account-manager/cbs/usageQuery）。
// 手段：向页面注入 fetch/XHR 钩子，把接口响应正文经 messageHandler 回传。
// 钩子记录 url + method + 请求体，会话存好后，刷新时在页面上下文里重放 fetch
// （Cookie 由 WebView 自动携带，绕开一切会话问题）。

import { appendDebug, endWebLogin, getPassword, getPhone, getWebStartUrl, hasCredentials, isApiError, summaryHasUsage, isLoginRequest, isWebLoginBusy, readLoginPageUrl, saveCapture, saveCapturedBody, saveLoginRequest, saveMemberJson, saveNicknameJson, saveOverviewHtml, saveWebSession, tryBeginWebLogin } from "./cmhk"
import { withTimeout } from "./timeout"

// WebViewController 是全局对象（与 Dialog/Storage/Keychain 一样，不从 scripting 导入）
declare const WebViewController: {
  new (options?: { ephemeral?: boolean }): {
    shouldAllowRequest?: (request: {
      url: string
      method: string
      headers: Record<string, string>
      navigationType?: string
    }) => Promise<boolean>
    loadURL(url: string): Promise<boolean>
    present(options?: { fullscreen?: boolean; navigationTitle?: string }): Promise<void>
    evaluateJavaScript<T = any>(javascript: string): Promise<T>
    getHTML(): Promise<string | null>
    getCookies?(url: string): Promise<{ name: string; value: string }[]>
    addScriptMessageHandler<P = any>(name: string, handler: (params?: P) => any): Promise<void>
    dispose(): void
  }
}

// 注入钩子：包裹 fetch 与 XHR，回传 { url, method, reqBody, body }
const INJECT_HOOK = String.raw`
return (function () {
  if (window.__cmhkHooked) return true
  window.__cmhkHooked = true
  function send(info) {
    try {
      window.webkit.messageHandlers.cmhkCapture.postMessage(info)
    } catch (e) {}
  }
  // v1.20.0 序列化请求头：Headers / 数组 / 普通对象三种形态
  function hdrs(h) {
    var out = {}
    try {
      if (!h) return out
      if (Array.isArray(h)) { h.forEach(function (p) { if (p) out[String(p[0])] = String(p[1]) }); return out }
      if (typeof h.forEach === "function") { h.forEach(function (v, k) { out[k] = String(v) }); return out }
      Object.keys(h).forEach(function (k) { out[k] = String(h[k]) })
    } catch (e) {}
    return out
  }
  var of = window.fetch
  if (of) {
    window.fetch = function (input, init) {
      var url = (input && input.url) || String(input)
      var method = (init && init.method) || (input && input.method) || "GET"
      var reqBody = (init && init.body != null) ? String(init.body).slice(0, 2000) : ""
      var bodyReady = Promise.resolve(reqBody)
      if ((!init || init.body == null) && input && typeof input.clone === "function" && !/^(GET|HEAD)$/i.test(method)) {
        try { bodyReady = input.clone().text().then(function (b) { return String(b).slice(0, 2000) }).catch(function () { return "" }) } catch (e) {}
      }
      var headers = hdrs((init && init.headers) || (input && input.headers))
      if (/\/single\/(accountLogin|oneClickLogin)(?:\?|$)/i.test(url)) {
        send({ url: url, method: method, reqBody: reqBody, headers: headers, body: "" })
      }
      return of.apply(this, arguments).then(function (r) {
        try {
          var c = r.clone()
          c.text().then(function (t) {
            if (t && t.length > 2) bodyReady.then(function (b) { send({ url: url, method: method, reqBody: b, headers: headers, body: t.slice(0, 60000) }) })
          }).catch(function () {})
        } catch (e) {}
        return r
      })
    }
  }
  var O = XMLHttpRequest.prototype.open
  var S = XMLHttpRequest.prototype.send
  var H = XMLHttpRequest.prototype.setRequestHeader
  // v1.20.0 XHR 请求头无法回读，包 setRequestHeader 现场记录
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { (this.__cmhkHeaders = this.__cmhkHeaders || {})[String(k)] = String(v) } catch (e) {}
    return H.apply(this, arguments)
  }
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__cmhkUrl = u
    this.__cmhkMethod = m
    return O.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function (b) {
    var xhr = this
    if (/\/single\/(accountLogin|oneClickLogin)(?:\?|$)/i.test(String(xhr.__cmhkUrl))) {
      send({ url: String(xhr.__cmhkUrl), method: xhr.__cmhkMethod || "GET", reqBody: b ? String(b).slice(0, 2000) : "", headers: xhr.__cmhkHeaders || {}, body: "" })
    }
    xhr.addEventListener("load", function () {
      try {
        send({ url: String(xhr.__cmhkUrl), method: xhr.__cmhkMethod || "GET", headers: xhr.__cmhkHeaders || {},
               reqBody: b ? String(b).slice(0, 2000) : "", body: String(xhr.responseText).slice(0, 60000) })
      } catch (e) {}
    })
    return S.apply(this, arguments)
  }
  // 原生表单提交（fetch/XHR 包不到的登录路径）：提交前抓 action+字段，密码即时打码
  document.addEventListener("submit", function (e) {
    try {
      var f = e.target
      if (!f || f.tagName !== "FORM") return
      var parts = []
      try {
        var fd = new FormData(f)
        fd.forEach(function (v, k) { parts.push(k + "=" + (/pass|pwd|secret/i.test(k) ? "***" : String(v))) })
      } catch (err) {}
      send({ url: String(f.action || location.href), method: String(f.method || "GET").toUpperCase(),
             reqBody: parts.join("&").slice(0, 2000), body: "" })
    } catch (err) {}
  }, true)
  return true
})()
`

// 判断是否为用量/账户类 JSON 响应
function looksLikeUsageJson(url: string, body: string): boolean {
  if (!body.startsWith("{") && !body.startsWith("[")) return false
  if (/usageQuery|usage|account|balance|quota|points|member|plan|bill|consumption|用量|账|賬/i.test(url)) return true
  return /"(margin|total|usage|unit|balance|points|tier|plan)"\s*:/.test(body)
}

// v1.19.15 防重入：真机故障——登录窗口半天不出现（页面加载完才上屏），用户连点，
// 每次点击都悄悄起一个登录流程，加载完一起弹窗（"连续跳出一堆网页"）。
export async function runWebLogin(): Promise<{ captured: boolean; url: string | null; body: string | null }> {
  if (!tryBeginWebLogin()) throw new Error("登录窗口已打开：请先完成登录或关闭当前窗口，再重新发起")
  try {
    return await runWebLoginInner()
  } finally {
    endWebLogin()
  }
}

async function runWebLoginInner(): Promise<{ captured: boolean; url: string | null; body: string | null }> {
  appendDebug("web-login: 开始")
  const webView = new WebViewController()

  let best: { url: string; method: string; reqBody: string; body: string; headers?: Record<string, string> } | null = null
  let cookie: string | null = null
  let pageUrl: string | null = null

  await webView.addScriptMessageHandler<any>("cmhkCapture", (msg) => {
    try {
      const url = String(msg?.url ?? "")
      const body = String(msg?.body ?? "")
      const method = String(msg?.method ?? "")
      if (!url) return null
      // 登录报文（含原生表单提交，body 可为空）：打码后入校准环
      if (isLoginRequest(url, method)) {
        saveLoginRequest(url, method, String(msg?.reqBody ?? ""), body)
        appendDebug(`捕获登录报文: ${method} ${url.slice(0, 100)}（密码已打码）`)
      }
      if (!body) return null
      if (looksLikeUsageJson(url, body)) {
        const json = JSON.parse(body)
        if (isApiError(json)) return null
        saveCapture(url, body)
        if (/memberLevel|wealth/i.test(url)) saveMemberJson(body)
        if (/getNickname/i.test(url)) saveNicknameJson(body)
        if (/cbs\/usageQuery(?:\?|$)/i.test(url) && summaryHasUsage(json)) {
          best = { url, method: String(msg?.method ?? "GET"), reqBody: String(msg?.reqBody ?? ""), body, headers: msg?.headers }
          appendDebug("捕获本次有效用量响应")
        }
      }
    } catch { /* 忽略 */ }
    return null
  })

  let closed = false
  let overviewSaved = false
  // v1.19.15 核心修复：先上屏，再加载。原先 present() 写在 await loadURL() 之后——
  // CMHK 页面（含瑞数 WAF 挑战）加载完成前窗口根本不出现，用户面对的是纯空白等待期，
  // 误以为点击无效而连点，堆积出多个登录流程。现在窗口立即弹出，页面在里面加载。
  const presentP = webView
    .present({ navigationTitle: "登录后进入「用量查询」和「我的账户/首页」，再关闭本窗口" })
    .then(() => { closed = true })
    .catch(() => { closed = true })

  const startUrl = getWebStartUrl()
  appendDebug(`起始页: ${startUrl}`)
  // 不 await：加载快慢不再阻塞窗口出现（加载失败也让窗口留着，用户可重试导航）
  void webView.loadURL(startUrl).catch((e) => appendDebug(`起始页加载失败: ${String(e).slice(0, 80)}`))

  // 轮询直到窗口关闭：用量 API 与账户概览页分别独立捕获
  while (!closed) {
    await new Promise((r) => setTimeout(r, 1200))
    try {
      await webView.evaluateJavaScript(INJECT_HOOK)
      const url = await webView.evaluateJavaScript<string>("return location.href")
      if (!url) continue
      if (/usage|用量/i.test(url)) pageUrl = url
      // 账户概览页（会员/积分/应缴/套餐）独立探测并只存一次
      if (!overviewSaved) {
        const probe2 = await webView.evaluateJavaScript<string>(
          `return (function(){ try { var t = document.body.innerText; return JSON.stringify({ has: /應繳金額|我的積分|我的會籍|我的服務計劃/.test(t) }) } catch(e){ return JSON.stringify({has:false}) } })()`
        ).catch(() => "{}")
        if ((JSON.parse(probe2) || {}).has) {
          const html = await webView.getHTML()
          if (html && /應繳金額|我的積分|我的會籍|我的服務計劃/.test(html)) {
            saveCapture(url + " [账户概览]", html)
            saveOverviewHtml(html)
            overviewSaved = true
            appendDebug("捕获账户概览页 HTML（已持久化）")
          }
        }
      }
    } catch { /* 导航途中失败正常 */ }
  }

  if (!closed) await presentP
  try {
    const apiUrl = best?.url?.startsWith("http") ? best.url : `https://www.hk.chinamobile.com${best?.url ?? "/"}`
    cookie = (await withTimeout(readSessionCookie(webView, apiUrl), 2000, "读取会话")).value
  } catch { /* 拿不到就算了 */ }
  const finalPage = await webView.evaluateJavaScript<string>("return location.href").catch(() => null)
  if (finalPage) pageUrl = finalPage
  webView.dispose()
  appendDebug(`窗口关闭。API捕获=${best ? "有" : "无"} 用量页=${pageUrl ?? "未知"}`)

  if (best) {
    saveWebSession({
      url: best.url,
      method: best.method,
      reqBody: best.reqBody,
      pageUrl: pageUrl ?? undefined,
      at: Date.now(),
      cookie,
      headers: best.headers,
    })
    return { captured: true, url: best.url, body: best.body }
  }
  return { captured: false, url: null, body: null }
}

// ===== v1.20.0 无头自动重登 =====
// 背景（真机诊断）：网页会话寿命约 2~5.5 小时，每天需手动重登数次。
// 原理：不模拟 REST——诊断包证明 accountLogin 的 userName/password 是页面 JS 加密后的
// 密文（且带会话派生 verifyCode），逆向加密脆弱且无必要。改为在真实 WebView 里填表提交，
// 让页面自己的 JS 完成加密；提交后复用同款捕获钩子截获 usageQuery，保存新会话。
// 安全闸：① 仅上层在"会话真死"证据确凿时触发；② 每页最多提交一次（__cmhkAutoSubmitted）；
// ③ 检测到可见验证码立即放弃，交回手动登录；④ accountLogin 返回非 000000（密码错/风控）
// 立即中止，不重复尝试；⑤ 用户在登录窗口操作时让路。

const USAGE_PAGE_URL = "https://www.hk.chinamobile.com/tc/home/my-zone/menu/usage-query"

// 填表并提交（只执行一次）：返回 clicked / captcha / no-form / no-button / already-submitted
function buildFillLoginJs(phone: string, password: string): string {
  return String.raw`
return (function () {
  if (/^about:(blank|srcdoc)(?:[?#]|$)/i.test(location.href)) return "loading"
  if (!/^https:\/\/(?:[a-z0-9-]+\.)*hk\.chinamobile\.com(?::\d+)?(?:\/|$)/i.test(location.href)) return "untrusted-page"
  if (window.__cmhkAutoSubmitted) return "already-submitted"
  function vis(el) { return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0))) }
  function text(el) { return String(el.textContent || el.value || "").replace(/\s+/g, " ").trim() }
  function disabled(el) { return !!(el.disabled || el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled")) }
  var inputs = Array.prototype.slice.call(document.querySelectorAll("input"))
  var pwd = inputs.find(function (el) { return vis(el) && el.type.toLowerCase() === "password" })
  try {
    window.webkit.messageHandlers.cmhkCapture.postMessage({ kind: "loginForm", inputCount: inputs.length,
      passwordCount: inputs.filter(function (el) { return el.type.toLowerCase() === "password" }).length,
      visiblePasswordCount: inputs.filter(function (el) { return vis(el) && el.type.toLowerCase() === "password" }).length })
  } catch (e) {}
  if (!pwd) {
    if (!window.__cmhkPasswordModeSelected) {
      var tabs = document.querySelectorAll('[role="tab"], button, a, span, div')
      for (var i = 0; i < tabs.length; i++) {
        var tab = tabs[i]
        if (vis(tab) && !disabled(tab) && /^(?:(?:帳戶|賬戶|账户|帳號|账号)?(?:密碼|密码)(?:登錄|登录|登入)?|password(?: login)?|log in with password)$/i.test(text(tab))) {
          window.__cmhkPasswordModeSelected = true
          tab.click()
          return "switching-mode"
        }
      }
    }
    return "no-form"
  }
  var scope = pwd.closest("form") || document
  var candidates = Array.prototype.slice.call(scope.querySelectorAll("input"))
  var phoneEl = candidates.find(function (el) {
    if (el === pwd || !vis(el) || !/^(text|tel|number|email)?$/i.test(el.type || "")) return false
    return /手機|手机|號碼|号码|phone|mobile|msisdn|賬戶|账户|account|用戶名|用户名/i.test([el.placeholder, el.name, el.id, el.getAttribute("aria-label")].join(" "))
  })
  if (!phoneEl) {
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i]
      if (el === pwd) break
      if (vis(el) && /^(text|tel|number|email)?$/i.test(el.type || "")) phoneEl = el
    }
  }
  if (!phoneEl) return "no-form"
  var caps = scope.querySelectorAll('img[src*="captcha"], img[src*="vcode"], canvas[class*="captcha"], div[class*="verify-slider"], input[name*="captcha"], input[autocomplete="one-time-code"], input[placeholder*="驗證碼"], input[placeholder*="验证码"]')
  for (var i = 0; i < caps.length; i++) if (vis(caps[i])) return "captcha"
  var checks = scope.querySelectorAll('input[type="checkbox"]')
  for (var i = 0; i < checks.length; i++) if (vis(checks[i]) && checks[i].required && !checks[i].checked) return "terms-required"
  function setVal(el, v) {
    el.focus()
    var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
    if (d && d.set) d.set.call(el, v); else el.value = v
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    el.blur()
  }
  if (!window.__cmhkAutoFilled || phoneEl.value !== ${JSON.stringify(phone)} || pwd.value !== ${JSON.stringify(password)}) {
    setVal(phoneEl, ${JSON.stringify(phone)})
    setVal(pwd, ${JSON.stringify(password)})
    window.__cmhkAutoFilled = true
    return "filled"
  }
  var btns = scope.querySelectorAll('button, [role="button"], input[type="submit"], a')
  var waiting = false
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i]
    if (!vis(b) || b.getAttribute("role") === "tab" || !/^(登錄|登录|登入|log in|sign in)$/i.test(text(b))) continue
    if (b.tagName === "A" && b.getAttribute("href") && !/^(#|javascript:)/i.test(b.getAttribute("href"))) continue
    if (disabled(b)) { waiting = true; continue }
    window.__cmhkAutoSubmitted = true
    b.click()
    return "clicked"
  }
  return waiting ? "waiting-enabled" : "no-button"
})()
`
}

export type AutoLoginReport = {
  startedAt: number
  finishedAt?: number
  fresh: boolean
  stage: string
  submitted: boolean
  loginConfirmed: boolean
  usageCaptured: boolean
  hookInstalled?: boolean
  form?: { inputCount: number; passwordCount: number; visiblePasswordCount: number }
  cookieSource?: "native" | "document"
  reason?: string
}
const KEY_AUTO_LOGIN_REPORT = "cmhk.login.autoReport"
export function readAutoLoginReport(): AutoLoginReport | null {
  return Storage.get<AutoLoginReport>(KEY_AUTO_LOGIN_REPORT)
}

// Newer Scripting versions expose HttpOnly cookies; older versions retain document.cookie fallback.
async function readSessionCookie(wv: InstanceType<typeof WebViewController>, apiUrl: string) {
  if (typeof wv.getCookies === "function") {
    const cookies = await wv.getCookies(apiUrl)
    return { value: cookies.map((c) => `${c.name}=${c.value}`).join("; "), source: "native" as const }
  }
  return { value: await wv.evaluateJavaScript<string>("return document.cookie"), source: "document" as const }
}

// 无头自动重登：成功返回最新 usageQuery JSON；失败返回原因（上层照旧走快照回退+手动提示）
export async function autoRelogin(opts?: { fresh?: boolean }): Promise<{ summary: any | null; reason?: string }> {
  const report: AutoLoginReport = {
    startedAt: Date.now(), fresh: opts?.fresh === true, stage: "准备",
    submitted: false, loginConfirmed: false, usageCaptured: false,
  }
  const phase = (stage: string) => {
    if (report.stage !== stage) appendDebug(`自动重登: ${stage}`)
    report.stage = stage
    Storage.set(KEY_AUTO_LOGIN_REPORT, { ...report })
  }
  const fail = (reason: string) => {
    report.reason = reason
    report.finishedAt = Date.now()
    phase("未完成")
    return { summary: null, reason }
  }
  if (!hasCredentials()) return fail("未保存凭据，请先在「自动登录凭据」中保存手机号和密码")
  if (isWebLoginBusy()) return fail("手动登录窗口进行中")
  const phone = getPhone()!
  const password = getPassword()!
  const wv = new WebViewController(opts?.fresh ? { ephemeral: true } : undefined)
  let best: { url: string; method: string; reqBody: string; body: string; headers?: Record<string, string> } | null = null
  let clicked = false
  let loginAccepted = false
  let confirmationSeen = false
  let pendingUsage: { url: string; method: string; reqBody: string; body: string; headers?: Record<string, string> } | null = null
  let loginRejected: string | null = null
  let active = true
  const deadline = report.startedAt + 15000
  const step = <T,>(operation: Promise<T>, label: string) =>
    withTimeout(operation, Math.max(1, Math.min(2000, deadline - Date.now())), `自动重登·${label}`)
  try {
    phase(opts?.fresh ? "独立会话验证" : "开始（无头 WebView 填表）")
    await step(wv.addScriptMessageHandler<any>("cmhkCapture", (msg) => {
      if (!active) return null
      try {
        if (msg?.kind === "loginForm") {
          const count = (n: any) => Number.isInteger(n) && n >= 0 && n < 1000 ? n : 0
          report.form = { inputCount: count(msg.inputCount), passwordCount: count(msg.passwordCount), visiblePasswordCount: count(msg.visiblePasswordCount) }
          Storage.set(KEY_AUTO_LOGIN_REPORT, { ...report })
          return null
        }
        const url = String(msg?.url ?? "")
        const body = String(msg?.body ?? "")
        const method = String(msg?.method ?? "")
        const absoluteUrl = url.startsWith("/") && !url.startsWith("//") ? `https://www.hk.chinamobile.com${url}` : url
        if (!/^https:\/\/(?:[a-z0-9-]+\.)*hk\.chinamobile\.com(?::\d+)?(?:\/|$)/i.test(absoluteUrl)) return null
        if (isLoginRequest(url, method)) saveLoginRequest(url, method, String(msg?.reqBody ?? ""), body)
        const isAuthRequest = /\/single\/(accountLogin|oneClickLogin)(?:\?|$)/i.test(url) && method.toUpperCase() === "POST"
        if (isAuthRequest && !report.submitted) { report.submitted = true; phase("已观察到登录请求") }
        if (!body) return null
        const json = JSON.parse(body)
        if (isAuthRequest) {
          if (String(json.code) !== "000000") loginRejected = `登录被拒（返回码 ${String(json.code).replace(/[^a-z0-9_-]/gi, "").slice(0, 20)}）`
          else { loginAccepted = true; phase("登录请求已接受") }
        }
        if (report.submitted && /\/single\/(queryLoginInfo|successLogin)(?:\?|$)/i.test(url) && String(json.code) === "000000") confirmationSeen = true
        if (loginAccepted && confirmationSeen && !report.loginConfirmed) {
          report.loginConfirmed = true
          phase("登录已确认，等待用量")
        }
        if (isApiError(json)) return null
        if (/cbs\/usageQuery(?:\?|$)/i.test(url) && summaryHasUsage(json)) {
          // Keep post-confirmation usage while a slower auth-response clone is still pending.
          if (!opts?.fresh || (report.submitted && confirmationSeen)) {
            pendingUsage = { url, method, reqBody: String(msg?.reqBody ?? ""), body, headers: msg?.headers }
          }
        } else if (/queryAccountInfo|getNickname|memberLevelRightBaseInfo|wealth|iddAndExtraUsage/i.test(url)) {
          saveCapture(url, body)
          if (/memberLevel|wealth/i.test(url)) saveMemberJson(body)
          if (/getNickname/i.test(url)) saveNicknameJson(body)
        }
        if (pendingUsage && (!opts?.fresh || report.loginConfirmed)) {
          best = pendingUsage
          report.usageCaptured = true
        }
      } catch { /* 非 JSON 与导航中的消息不作为成功证据 */ }
      return null
    }), "建立捕获通道")

    const savedUrl = opts?.fresh ? null : readLoginPageUrl()
    const startUrl = savedUrl && /^https:\/\/(?:[a-z0-9-]+\.)*hk\.chinamobile\.com(?::\d+)?(?:\/|$)/i.test(savedUrl) ? savedUrl : USAGE_PAGE_URL
    let loadErr = false
    void wv.loadURL(startUrl).catch(() => { loadErr = true })
    let navigatedToUsage = false
    let lastProgressAt = report.startedAt
    let lastFillState = "未找到登录表单"
    while (Date.now() < deadline) {
      if (isWebLoginBusy()) return fail("手动登录窗口优先")
      const installed = await step(wv.evaluateJavaScript(INJECT_HOOK).catch(() => false), "注入钩子")
      if (installed === true && !report.hookInstalled) { report.hookInstalled = true; phase("捕获通道已启用") }
      if (loginRejected) return fail(loginRejected)
      if (best) break
      if (loadErr) return fail("登录页面加载失败")
      if (report.loginConfirmed && !navigatedToUsage) {
        navigatedToUsage = true
        void wv.loadURL(USAGE_PAGE_URL).catch(() => { loadErr = true })
      }
      if (!clicked && !loginAccepted) {
        const r = await step(wv.evaluateJavaScript<string>(buildFillLoginJs(phone, password)).catch(() => "error"), "填表提交")
        if (r === "captcha") return fail("出现验证码，需手动登录")
        if (r === "terms-required") return fail("登录页需要确认条款，请先手动确认")
        if (r === "untrusted-page") return fail("当前页面不属于 CMHK，未填写凭据")
        const states: Record<string, string> = {
          loading: "正在加载登录页", "switching-mode": "正在切换密码登录", filled: "已填写，等待页面校验", clicked: "已点击登录，等待登录请求",
          "waiting-enabled": "登录按钮尚未启用", "no-form": "未找到登录表单", "no-button": "未找到登录按钮",
        }
        lastFillState = states[r] ?? "填表脚本未返回有效状态"
        phase(lastFillState)
        if (r === "loading" || r === "switching-mode" || r === "filled") lastProgressAt = Date.now()
        if (r === "clicked") clicked = true
        else if (Date.now() - lastProgressAt >= 6000) return fail(`${lastFillState}，请手动网页登录`)
      }
      await new Promise((r) => setTimeout(r, Math.max(0, Math.min(900, deadline - Date.now()))))
    }
    if (!best) return fail(!report.submitted && clicked ? "点击登录后未观察到登录请求" : report.submitted ? "登录请求后未取得已认证用量" : `${lastFillState}，未完成自动登录`)
    const captured = best
    const apiUrl = captured.url.startsWith("http") ? captured.url : `https://www.hk.chinamobile.com${captured.url}`
    const cookie = await step(readSessionCookie(wv, apiUrl), "读取会话")
    if (loginRejected) return fail(loginRejected)
    if (isWebLoginBusy()) return fail("手动登录窗口优先")
    active = false
    report.cookieSource = cookie.source
    saveWebSession({
      url: captured.url, method: captured.method, reqBody: captured.reqBody,
      pageUrl: USAGE_PAGE_URL, at: Date.now(), authorization: null,
      cookie: cookie.value ?? null, headers: captured.headers,
    })
    saveCapture(captured.url, captured.body)
    saveCapturedBody(captured.body)
    phase(report.loginConfirmed ? "自动登录成功并取得用量" : "现有会话取得新用量")
    return { summary: JSON.parse(captured.body) }
  } catch (e) {
    const message = String((e as any)?.message ?? e)
    return fail(/^自动重登·(建立捕获通道|注入钩子|填表提交|读取会话)超时$/.test(message) ? message : "自动登录网页操作失败")
  } finally {
    active = false
    report.finishedAt = Date.now()
    Storage.set(KEY_AUTO_LOGIN_REPORT, { ...report })
    wv.dispose()
  }
}
