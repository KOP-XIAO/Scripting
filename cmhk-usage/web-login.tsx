// web-login.tsx — 网页登录捕获（推荐登录方式）v2
// 原理：打开 CMHK 官网，用户登录并进入「用量查询」页面。
// 通过 addScriptMessageHandler + 注入的 fetch/XHR 钩子，页面里每个接口的
// 响应内容都会回传给脚本（shouldAllowRequest 看不到 Cookie/响应体，注入才行）。
// 捕获到用量数据后：记录真实接口 URL + 页面 Cookie，之后数据层直接重放。

import { getWebStartUrl, saveWebSession } from "./cmhk"

// WebViewController 是全局对象（与 Dialog/Storage/Keychain 一样，不从 scripting 导入）
declare const WebViewController: {
  new (options?: { ephemeral?: boolean }): {
    shouldAllowRequest?: (request: {
      url: string
      method: string
      headers: Record<string, string>
    }) => Promise<boolean>
    loadURL(url: string): Promise<boolean>
    present(options?: { fullscreen?: boolean; navigationTitle?: string }): Promise<void>
    evaluateJavaScript<T = any>(javascript: string): Promise<T>
    addScriptMessageHandler<P = any>(name: string, handler: (params?: P) => any): Promise<void>
    dispose(): void
  }
}

// 注入页面的钩子：包裹 fetch 与 XHR，把接口响应回传给脚本
const INJECT_HOOK = `
(function () {
  if (window.__cmhkHooked) return true
  window.__cmhkHooked = true
  function send(url, body) {
    try {
      if (!url || typeof body !== "string" || body.length < 2) return
      window.webkit.messageHandlers.cmhkCapture.postMessage({
        url: String(url),
        body: body.slice(0, 60000)
      })
    } catch (e) {}
  }
  var of = window.fetch
  if (of) {
    window.fetch = function () {
      var args = arguments
      return of.apply(this, args).then(function (r) {
        try {
          var c = r.clone()
          c.text().then(function (t) {
            send((args[0] && args[0].url) || String(args[0]), t)
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
    return O.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function () {
    var xhr = this
    xhr.addEventListener("load", function () {
      try { send(xhr.__cmhkUrl, xhr.responseText) } catch (e) {}
    })
    return S.apply(this, arguments)
  }
  return true
})()
`

// 判断一个响应是否像「用量/余额」数据
function looksLikeUsage(url: string, body: string): boolean {
  if (/usage|quota|remain|balance|flow|datausage|用量|流量|余额/i.test(url)) return true
  // JSON 且含数值型用量字段
  return /"(data|usage|quota|remain|balance|flow)[A-Za-z]*"\s*:\s*"?[0-9]/i.test(body)
}

export async function runWebLogin(): Promise<{ captured: boolean; url: string | null; body: string | null }> {
  const webView = new WebViewController() // 持久模式：cookie 在会话期内共享

  let capturedUrl: string | null = null
  let capturedBody: string | null = null
  let cookie: string | null = null

  // 页面接口响应经此回传
  await webView.addScriptMessageHandler<{ url?: string; body?: string }>("cmhkCapture", (msg) => {
    const url = msg?.url ?? ""
    const body = msg?.body ?? ""
    if (!capturedBody && looksLikeUsage(url, body)) {
      capturedUrl = url
      capturedBody = body
    }
    return null
  })

  await webView.loadURL(getWebStartUrl())

  let closed = false
  const presentP = webView
    .present({ navigationTitle: "登录后打开「用量查询」，再关闭本窗口" })
    .then(() => { closed = true })
    .catch(() => { closed = true })

  // 页面每次导航后都要重新注入（钩子在页面级生命周期）
  while (!closed && !capturedBody) {
    await new Promise((r) => setTimeout(r, 1500))
    try {
      await webView.evaluateJavaScript(INJECT_HOOK)
      // 捕获到数据后顺带记下当前页面 cookie
      if (capturedBody && !cookie) {
        cookie = await webView.evaluateJavaScript<string>("return document.cookie").catch(() => null)
      }
    } catch {
      // 页面导航途中注入失败属正常，下一轮重试
    }
  }

  if (!closed) await presentP
  webView.dispose()

  if (capturedUrl && capturedBody) {
    saveWebSession({
      url: capturedUrl,
      authorization: null,
      cookie,
    })
    return { captured: true, url: capturedUrl, body: capturedBody }
  }
  return { captured: false, url: null, body: null }
}
