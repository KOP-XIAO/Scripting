// web-login.tsx — 网页登录捕获 v3
// CMHK 官网是 SSR（服务端渲染）站点：用量数据直接嵌在页面 HTML 里，
// 不经过 fetch/XHR，注入钩子看不到——所以改为直接抓页面 HTML。
//
// 流程：打开官网 → 用户登录并进入「用量查询」页 → 轮询检测页面文本是否
// 出现用量标记（餘量/已用/用量）→ 出现即抓取整页 HTML + 页面地址 +
// document.cookie → 存入捕获环并设为会话。
// 之后刷新由数据层用无头 WebView 重载该页完成（共享 Cookie 存储）。

import { getWebStartUrl, saveCapture, saveWebSession } from "./cmhk"

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
    getHTML(): Promise<string | null>
    dispose(): void
  }
}

// 页面文本探针：返回 { url, hasUsage }
const PROBE = `
return (function () {
  try {
    var t = document.body ? document.body.innerText : ""
    return JSON.stringify({
      url: location.href,
      hasUsage: /餘量|已用|用量查询|用量查詢/.test(t)
    })
  } catch (e) {
    return JSON.stringify({ url: "", hasUsage: false })
  }
})()
`

export async function runWebLogin(): Promise<{ captured: boolean; url: string | null; body: string | null }> {
  const webView = new WebViewController() // 持久模式：与后续无头刷新共享 Cookie 存储

  let capturedUrl: string | null = null
  let capturedHtml: string | null = null
  let cookie: string | null = null

  await webView.loadURL(getWebStartUrl())

  let closed = false
  const presentP = webView
    .present({ navigationTitle: "登录后打开「用量查询」，再关闭本窗口" })
    .then(() => { closed = true })
    .catch(() => { closed = true })

  // 轮询：检测当前页是否是用量页；是则抓整页 HTML
  while (!closed && !capturedHtml) {
    await new Promise((r) => setTimeout(r, 1500))
    try {
      const raw = await webView.evaluateJavaScript<string>(PROBE)
      const probe = JSON.parse(raw || "{}")
      if (probe.hasUsage && probe.url) {
        const html = await webView.getHTML()
        if (html && /餘量|已用|用量/.test(html)) {
          capturedUrl = probe.url
          capturedHtml = html
          cookie = await webView.evaluateJavaScript<string>("return document.cookie").catch(() => null)
        }
      }
    } catch {
      // 页面导航途中探测失败属正常，下一轮重试
    }
  }

  if (!closed) await presentP
  webView.dispose()

  if (capturedUrl && capturedHtml) {
    saveCapture(capturedUrl, capturedHtml)
    saveWebSession({
      url: capturedUrl,
      authorization: null,
      cookie,
    })
    return { captured: true, url: capturedUrl, body: capturedHtml }
  }
  return { captured: false, url: null, body: null }
}
