// app_intents.tsx — 小组件交互动作注册
// 依据官方 AppIntent 文档：所有 App Intent 必须在此文件注册；
// 每个用到的 Scripting API 都要显式 import；Storage 为全局对象无需 import。

import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { refreshUsage } from "./cmhk"

// 小组件上的「刷新」按钮：重新抓取并刷新所有小组件时间线
export const RefreshIntent = AppIntentManager.register({
  name: "RefreshIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_params: undefined) => {
    try {
      await refreshUsage()
    } catch {
      // 刷新失败静默处理：widget 会渲染缓存数据并显示 stale 标记
    }
    Widget.reloadAll()
  },
})
