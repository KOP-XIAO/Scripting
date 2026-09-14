// app_intents.tsx — 小组件交互动作注册
// 依据官方 App Intent 文档：所有 App Intent 必须在此文件注册。
// 本 intent 只做一件事：让小组件立即重渲染（渲染时重新读取历史文件）。

import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

export const ReloadWidgetIntent = AppIntentManager.register({
  name: "ReloadWidgetIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_params: undefined) => {
    Widget.reloadAll()
  },
})
