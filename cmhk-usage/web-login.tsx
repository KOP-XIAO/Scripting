// web-login.tsx — 网页登录捕获 v5
// 目标只有一个：抓到用量 API 的真实响应（真机实证：页面会调
// /api/omni-channel-service-personal/rest/account-manager/cbs/usageQuery）。
// 手段：向页面注入 fetch/XHR 钩子，把接口响应正文经 messageHandler 回传。
// 钩子记录 url + method + 请求体，会话存好后，刷新时在页面上下文里重放 fetch
// （Cookie 由 WebView 自动携带，绕开一切会话问题）。

import { appendDebug, endWebLogin, getPassword, getPhone, getWebStartUrl, hasCredentials, isLoginRequest, isWebLoginBusy, readLoginPageUrl, saveCapture, saveCapturedBody, saveLoginRequest, saveMemberJson, saveNicknameJson, saveOverviewHtml, saveWebSession, tryBeginWebLogin } from "./cmhk"

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
    addScriptMessageHandler<P = any>(name: string, handler: (params?: P) => any): Promise<void>
    dispose(): void
  }
}

// 注入钩子：包裹 fetch 与 XHR，回传 { url, method, reqBody, body }
const INJECT_HOOK = `
(function () {
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
      if (typeof h.forEach === "function") { h.forEach(function (v, k) { out[k] = String(v) }); return out }
      if (Array.isArray(h)) { h.forEach(function (p) { if (p) out[String(p[0])] = String(p[1]) }); return out }
      Object.keys(h).forEach(function (k) { out[k] = String(h[k]) })
    } catch (e) {}
    return out
  }
  var of = window.fetch
  if (of) {
    window.fetch = function (input, init) {
      var url = (input && input.url) || String(input)
      var method = (init && init.method) || "GET"
      var reqBody = (init && init.body) ? String(init.body).slice(0, 2000) : ""
      var headers = hdrs((init && init.headers) || (input && input.headers))
      return of.apply(this, arguments).then(function (r) {
        try {
          var c = r.clone()
          c.text().then(function (t) {
            if (t && t.length > 2) send({ url: url, method: method, reqBody: reqBody, headers: headers, body: t.slice(0, 60000) })
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
        saveCapture(url, body)
        if (/memberLevel|wealth/i.test(url)) saveMemberJson(body)
        if (/getNickname/i.test(url)) saveNicknameJson(body)
        // 用量接口评分：cbs/usageQuery（数据最全：total/usage/margin）> indexUsageQuery > 其他。
        // v1.19.10 修：旧逻辑 /usageQuery/i 一律覆盖——indexUsageQuery 晚到会把会话
        // 从真身拽走，之后重放的是一个没有 total/usage 的残缺接口。
        const usageRank = (u: string) => (/cbs\/usageQuery/i.test(u) ? 3 : /usageQuery/i.test(u) ? 2 : 1)
        if (!best || usageRank(url) > usageRank(best.url)) {
          best = { url, method: String(msg?.method ?? "GET"), reqBody: String(msg?.reqBody ?? ""), body, headers: msg?.headers }
          appendDebug(`捕获 API: ${best.method} ${url.slice(0, 120)}`)
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
    cookie = await webView.evaluateJavaScript<string>("return document.cookie")
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
  return `
(function () {
  if (window.__cmhkAutoSubmitted) return "already-submitted"
  function vis(el) { return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0))) }
  var inputs = Array.prototype.slice.call(document.querySelectorAll("input"))
  var pwd = null
  for (var i = 0; i < inputs.length; i++) {
    if (vis(inputs[i]) && (inputs[i].type || "").toLowerCase() === "password") { pwd = inputs[i]; break }
  }
  var phoneEl = null
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i]
    if (el === pwd || !vis(el)) continue
    var t = (el.type || "").toLowerCase()
    if (t !== "text" && t !== "tel" && t !== "number" && t !== "") continue
    var hint = [el.placeholder, el.name, el.id, el.getAttribute("aria-label")].join(" ")
    if (/手機|手机|號碼|号码|phone|mobile|msisdn|賬戶|账户|account|用戶名|用户名/i.test(hint)) { phoneEl = el; break }
  }
  if (!phoneEl) {
    // 兜底：密码框之前的最后一个可见文本输入
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i]
      if (el === pwd) break
      var t = (el.type || "").toLowerCase()
      if (vis(el) && (t === "text" || t === "tel" || t === "number" || t === "")) phoneEl = el
    }
  }
  if (!pwd || !phoneEl) return "no-form"
  // 可见验证码（图/滑块/输入框）→ 放弃自动，交回手动
  var caps = document.querySelectorAll('img[src*="captcha"], img[src*="verify"], img[src*="vcode"], canvas[class*="captcha"], div[class*="verify-slider"], input[name*="captcha"], input[placeholder*="驗證碼"], input[placeholder*="验证码"]')
  for (var i = 0; i < caps.length; i++) { if (vis(caps[i])) return "captcha" }
  function setVal(el, v) {
    el.focus()
    var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")
    if (d && d.set) d.set.call(el, v); else el.value = v
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    el.blur()
  }
  setVal(phoneEl, ${JSON.stringify(phone)})
  setVal(pwd, ${JSON.stringify(password)})
  var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], input[type="submit"], a'))
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i]
    if (!vis(b)) continue
    var txt = ((b.textContent || "") + " " + (b.value || "")).trim()
    if (/登錄|登录|登入|log\s*in|sign\s*in/i.test(txt)) {
      window.__cmhkAutoSubmitted = true
      b.click()
      return "clicked"
    }
  }
  return "no-button"
})()
`
}

// 无头自动重登：成功返回最新 usageQuery JSON；失败返回原因（上层照旧走快照回退+手动提示）
export async function autoRelogin(): Promise<{ summary: any | null; reason?: string }> {
  if (!hasCredentials()) return { summary: null, reason: "未保存凭据" }
  if (isWebLoginBusy()) return { summary: null, reason: "手动登录窗口进行中" }
  const phone = getPhone()!
  const password = getPassword()!
  appendDebug("自动重登: 开始（无头 WebView 填表）")
  const wv = new WebViewController()
  let best: { url: string; method: string; reqBody: string; body: string; headers?: Record<string, string> } | null = null
  let submitAt = 0
  let loginOk = false
  let loginRejected: string | null = null
  try {
    await wv.addScriptMessageHandler<any>("cmhkCapture", (msg) => {
      try {
        const url = String(msg?.url ?? "")
        const body = String(msg?.body ?? "")
        const method = String(msg?.method ?? "")
        if (!url) return null
        if (isLoginRequest(url, method)) saveLoginRequest(url, method, String(msg?.reqBody ?? ""), body)
        if (!body) return null
        // 登录成功信号：提交后 queryLoginInfo 返回 000000（诊断包实证：未登录时返回 999999 用戶未登錄）
        if (submitAt > 0 && /\/single\/queryLoginInfo/i.test(url) && body.includes('"code":"000000"')) loginOk = true
        if (/\/single\/accountLogin/i.test(url) && !body.includes('"code":"000000"')) loginRejected = body.slice(0, 120)
        if (looksLikeUsageJson(url, body)) {
          saveCapture(url, body)
          if (/memberLevel|wealth/i.test(url)) saveMemberJson(body)
          if (/getNickname/i.test(url)) saveNicknameJson(body)
          const usageRank = (u: string) => (/cbs\/usageQuery/i.test(u) ? 3 : /usageQuery/i.test(u) ? 2 : 1)
          if (!best || usageRank(url) > usageRank(best.url)) {
            best = { url, method, reqBody: String(msg?.reqBody ?? ""), body, headers: msg?.headers }
          }
        }
      } catch { /* 忽略 */ }
      return null
    })

    const startUrl = readLoginPageUrl() ?? USAGE_PAGE_URL
    let loadErr: string | null = null
    void wv.loadURL(startUrl).catch((e) => { loadErr = String(e) })
    let navigatedToUsage = /usage/i.test(startUrl) // 起点即用量页则无需再导航
    const deadline = Date.now() + 45000
    let noFormRounds = 0
    while (Date.now() < deadline) {
      if (isWebLoginBusy()) return { summary: null, reason: "手动登录窗口优先" }
      await wv.evaluateJavaScript(INJECT_HOOK).catch(() => false)
      if (best) break
      if (loginRejected) return { summary: null, reason: `登录被拒：${loginRejected}` }
      if (loadErr) return { summary: null, reason: `页面加载失败：${loadErr.slice(0, 60)}` }
      if (loginOk && !navigatedToUsage) {
        navigatedToUsage = true
        void wv.loadURL(USAGE_PAGE_URL).catch(() => {})
      }
      if (submitAt === 0) {
        const r = await wv.evaluateJavaScript<string>(buildFillLoginJs(phone, password)).catch(() => "error")
        if (r === "captcha") { appendDebug("自动重登: 检测到验证码，放弃自动"); return { summary: null, reason: "出现验证码，需手动登录" } }
        if (r === "clicked") { submitAt = Date.now(); appendDebug("自动重登: 已填表并提交") }
        else if (r === "no-form" || r === "no-button") {
          noFormRounds++
          if (noFormRounds > 15) return { summary: null, reason: "未找到登录表单（页面结构可能已改版）" }
        }
      }
      await new Promise((r2) => setTimeout(r2, 900))
    }
    if (!best) return { summary: null, reason: submitAt > 0 ? "已提交但未捕获到用量数据" : "超时（未完成登录）" }
    const cookie = await wv.evaluateJavaScript<string>("return document.cookie").catch(() => null)
    saveWebSession({
      url: best.url, method: best.method, reqBody: best.reqBody,
      pageUrl: USAGE_PAGE_URL, at: Date.now(), authorization: null,
      cookie: cookie ?? null, headers: best.headers,
    })
    saveCapturedBody(best.body)
    appendDebug("自动重登: 成功，新会话已保存")
    return { summary: JSON.parse(best.body) }
  } finally {
    wv.dispose()
  }
}
