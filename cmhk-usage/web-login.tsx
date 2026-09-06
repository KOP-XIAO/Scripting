// web-login.tsx — 网页登录捕获（推荐登录方式）
// 原理：打开 CMHK 官方网页，用户正常登录并打开用量页面；
// WebViewController.shouldAllowRequest 会拦截每一个请求，
// 我们把第一个携带鉴权（Authorization / Cookie）的请求完整记录下来
// （URL + 请求头），之后数据层直接重放该真实接口，绕开无文档的 REST 摸索。

import { WebViewController } from "scripting"
import { saveWebSession } from "./cmhk"

// CMHK 官网入口（登录后请手动打开「用量/Usage」页面再关闭窗口）
const CMHK_HOME = "https://www.hk.chinamobile.com/tc/"

export async function runWebLogin(): Promise<{ captured: boolean; url: string | null }> {
  const webView = new WebViewController() // 持久模式：与后续请求共享 cookie 容器

  let capturedUrl: string | null = null
  let capturedAuth: string | null = null
  let capturedCookie: string | null = null

  webView.shouldAllowRequest = async (request) => {
    try {
      const url: string = request.url ?? ""
      const headers: Record<string, string> = request.headers ?? {}
      const auth = headers["Authorization"] ?? headers["authorization"] ?? null
      const cookie = headers["Cookie"] ?? headers["cookie"] ?? null

      const isCmhk = /chinamobile|mylink|cmhk/i.test(url)
      // 第一个携带鉴权信息的 CMHK 相关请求即为捕获目标
      if (!capturedUrl && isCmhk && (auth || cookie)) {
        capturedUrl = url
        capturedAuth = auth
        capturedCookie = cookie
      }
    } catch {
      // 拦截器内部错误不影响页面加载
    }
    return true // 一律放行，只观察不拦截
  }

  await webView.loadURL(CMHK_HOME)
  await webView.present({ navigationTitle: "登录后打开「用量」页，再关闭本窗口" })
  webView.dispose()

  if (capturedUrl) {
    saveWebSession({
      url: capturedUrl,
      authorization: capturedAuth,
      cookie: capturedCookie,
    })
    return { captured: true, url: capturedUrl }
  }
  return { captured: false, url: null }
}
