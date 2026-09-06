// web-login.tsx — 网页登录捕获 v5
// 目标只有一个：抓到用量 API 的真实响应（真机实证：页面会调
// /api/omni-channel-service-personal/rest/account-manager/cbs/usageQuery）。
// 手段：向页面注入 fetch/XHR 钩子，把接口响应正文经 messageHandler 回传。
// 钩子记录 url + method + 请求体，会话存好后，刷新时在页面上下文里重放 fetch
// （Cookie 由 WebView 自动携带，绕开一切会话问题）。

import { appendDebug, getWebStartUrl, saveCapture, saveMemberJson, saveNicknameJson, saveOverviewHtml, saveWebSession } from "./cmhk"

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
  var of = window.fetch
  if (of) {
    window.fetch = function (input, init) {
      var url = (input && input.url) || String(input)
      var method = (init && init.method) || "GET"
      var reqBody = (init && init.body) ? String(init.body).slice(0, 2000) : ""
      return of.apply(this, arguments).then(function (r) {
        try {
          var c = r.clone()
          c.text().then(function (t) {
            if (t && t.length > 2) send({ url: url, method: method, reqBody: reqBody, body: t.slice(0, 60000) })
          }).catch(function () {})
        } catch (e) {}
        return r
      })
    }
  }
  var O = XMLHttpRequest.prototype.open
  var S = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__cmhkUrl = u
    this.__cmhkMethod = m
    return O.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function (b) {
    var xhr = this
    xhr.addEventListener("load", function () {
      try {
        send({ url: String(xhr.__cmhkUrl), method: xhr.__cmhkMethod || "GET",
               reqBody: b ? String(b).slice(0, 2000) : "", body: String(xhr.responseText).slice(0, 60000) })
      } catch (e) {}
    })
    return S.apply(this, arguments)
  }
  return true
})()
`

// 判断是否为用量/账户类 JSON 响应
function looksLikeUsageJson(url: string, body: string): boolean {
  if (!body.startsWith("{") && !body.startsWith("[")) return false
  if (/usageQuery|usage|account|balance|quota|points|member|plan|bill|consumption|用量|账|賬/i.test(url)) return true
  return /"(margin|total|usage|unit|balance|points|tier|plan)"\s*:/.test(body)
}

export async function runWebLogin(): Promise<{ captured: boolean; url: string | null; body: string | null }> {
  appendDebug("web-login: 开始")
  const webView = new WebViewController()

  let best: { url: string; method: string; reqBody: string; body: string } | null = null
  let cookie: string | null = null
  let pageUrl: string | null = null

  await webView.addScriptMessageHandler<any>("cmhkCapture", (msg) => {
    try {
      const url = String(msg?.url ?? "")
      const body = String(msg?.body ?? "")
      if (!url || !body) return null
      if (looksLikeUsageJson(url, body)) {
        saveCapture(url, body)
        if (/memberLevel|wealth/i.test(url)) saveMemberJson(body)
        if (/getNickname/i.test(url)) saveNicknameJson(body)
        // 首个命中即最佳；usageQuery 优先
        if (!best || /usageQuery/i.test(url)) {
          best = { url, method: String(msg?.method ?? "GET"), reqBody: String(msg?.reqBody ?? ""), body }
          appendDebug(`捕获 API: ${best.method} ${url.slice(0, 120)}`)
        }
      }
    } catch { /* 忽略 */ }
    return null
  })

  await webView.loadURL(getWebStartUrl())
  appendDebug(`起始页: ${getWebStartUrl()}`)

  let closed = false
  let overviewSaved = false
  const presentP = webView
    .present({ navigationTitle: "登录后进入「用量查询」和「我的账户/首页」，再关闭本窗口" })
    .then(() => { closed = true })
    .catch(() => { closed = true })

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
      cookie,
    })
    return { captured: true, url: best.url, body: best.body }
  }
  return { captured: false, url: null, body: null }
}
