// app_intents.tsx — 小组件交互动作注册
// 依据官方 App Intent 文档：所有 App Intent 必须在此文件注册；
// 每个用到的 Scripting API 都要显式 import；Storage 为全局对象无需 import。

import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { appendDebug, refreshUsage } from "./cmhk"

// 小组件上的「刷新」按钮：先试直连快路径（不依赖 WebView，AppIntent 扩展
// 进程友好），未命中再走完整刷新链（无头 WebView 页内重放）。
// 全程写调试日志；失败静默（widget 渲染缓存数据并显示「快取」标记）。
export const RefreshIntent = AppIntentManager.register({
  name: "RefreshIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_params: undefined) => {
    appendDebug("Intent: 刷新按钮触发")
    try {
      const direct = await refreshUsage({ directOnly: true })
      if (direct) {
        appendDebug(`Intent: 直连刷新成功，剩餘 ${direct.dataRemainingGB ?? "?"}GB`)
      } else {
        appendDebug("Intent: 直连未命中，改走完整刷新链")
        await refreshUsage()
      }
    } catch (e: any) {
      appendDebug(`Intent: 刷新失败 ${String(e?.message ?? e).slice(0, 100)}`)
    }
    Widget.reloadAll()
  },
})
