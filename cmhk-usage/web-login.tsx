// web-login.tsx — 网页登录捕获 v4（双保险）
// 保险一：轮询期间 evaluateJavaScript 探测页面文本标记（餘量/已用/用量）→ 抓 getHTML()。
// 保险二：shouldAllowRequest 记录所有导航 URL，命中用量页特征 → 关窗后无头 WebView
//         重载该页抓 HTML（不依赖 present 期间的 evaluateJavaScript）。
// 全程写调试日志（Storage cmhk.debuglog），App 诊断页可见。

import { appendDebug, getWebStartUrl, saveCapture, saveWebSession } from "./cmhk"

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
    waitForLoad(): Promise<boolean>
    present(options?: { fullscreen?: boolean; navigationTitle?: string }): Promise<void>
    evaluateJavaScript<T = any>(javascript: string): Promise<T>
    getHTML(): Promise<string | null>
    dispose(): void
  }
}

// 页面文本探针
const PROBE = `return (function () {
  try {
    var t = document.body ? document.body.innerText : ""
    return JSON.stringify({
      url: location.href,
      hasUsage: /餘量|已用|用量查询|用量查詢/.test(t)
    })
  } catch (e) {
    return JSON.stringify({ url: "", hasUsage: false })
  }
})()`

const USAGE_URL_RE = /usage|用量|查詢|查询|enquiry|consumption/i

export async function runWebLogin(): Promise<{ captured: boolean; url: string | null; body: string | null }> {
  appendDebug("web-login: 开始")
  const webView = new WebViewController()

  let capturedUrl: string | null = null
  let capturedHtml: string | null = null
  let cookie: string | null = null
  let usagePageUrl: string | null = null
  const seenUrls: string[] = []

  // 保险二：盯导航 URL
  webView.shouldAllowRequest = async (request) => {
    try {
      const url = request.url ?? ""
      if (url && seenUrls.length < 50 && !seenUrls.includes(url)) seenUrls.push(url)
      if (!usagePageUrl && USAGE_URL_RE.test(url)) {
        usagePageUrl = url
        appendDebug(`命中用量页 URL: ${url.slice(0, 120)}`)
      }
    } catch { /* 观察失败不影响 */ }
    return true
  }

  await webView.loadURL(getWebStartUrl())
  appendDebug(`起始页: ${getWebStartUrl()}`)

  let closed = false
  const presentP = webView
    .present({ navigationTitle: "登录后打开「用量查询」，再关闭本窗口" })
    .then(() => { closed = true })
    .catch(() => { closed = true })

  // 保险一：轮询探测（若 evaluateJavaScript 在展示期间可用则更快拿到）
  let evalOk: boolean | null = null
  while (!closed && !capturedHtml) {
    await new Promise((r) => setTimeout(r, 1500))
    try {
      const raw = await webView.evaluateJavaScript<string>(PROBE)
      if (evalOk === null) {
        evalOk = true
        appendDebug("evaluateJavaScript 可用")
      }
      const probe = JSON.parse(raw || "{}")
      if (probe.hasUsage && probe.url) {
        const html = await webView.getHTML()
        if (html && /餘量|已用|用量/.test(html)) {
          capturedUrl = probe.url
          capturedHtml = html
          appendDebug(`轮询捕获成功: ${capturedUrl.slice(0, 120)}, HTML ${html.length} 字符`)
          try {
            cookie = await webView.evaluateJavaScript<string>("return document.cookie")
          } catch { /* cookie 拿不到就算了 */ }
        }
      }
    } catch (e: any) {
      if (evalOk === null) {
        evalOk = false
        appendDebug(`evaluateJavaScript 在展示期间不可用: ${String(e?.message ?? e).slice(0, 100)}`)
      }
    }
  }

  if (!closed) await presentP
  webView.dispose()
  appendDebug(`窗口关闭。命中URL=${usagePageUrl ?? "无"} 轮询捕获=${capturedHtml ? "有" : "无"}`)

  // 保险二落地：关窗后无头重载用量页
  if (!capturedHtml && usagePageUrl) {
    try {
      const wv2 = new WebViewController()
      await wv2.loadURL(usagePageUrl)
      await wv2.waitForLoad()
      const html = await wv2.getHTML()
      wv2.dispose()
      if (html && /餘量|已用|用量/.test(html)) {
        capturedUrl = usagePageUrl
        capturedHtml = html
        appendDebug(`无头重载捕获成功: HTML ${html.length} 字符`)
      } else {
        appendDebug(`无头重载内容无用量标记（${html?.length ?? 0} 字符）`)
      }
    } catch (e: any) {
      appendDebug(`无头重载失败: ${String(e?.message ?? e).slice(0, 120)}`)
    }
  }

  if (!capturedUrl && !capturedHtml) {
    appendDebug(`捕获失败。期间见过 ${seenUrls.length} 个URL: ${seenUrls.slice(0, 8).join(" | ").slice(0, 400)}`)
  }

  if (capturedUrl && capturedHtml) {
    saveCapture(capturedUrl, capturedHtml)
    saveWebSession({ url: capturedUrl, authorization: null, cookie })
    return { captured: true, url: capturedUrl, body: capturedHtml }
  }
  return { captured: false, url: null, body: null }
}
