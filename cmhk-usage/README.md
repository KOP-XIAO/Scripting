# CMHK Usage — Scripting App 脚本

在 iOS **Scripting** App 内展示中国移动香港（CMHK / MyLink）账户的话费余额、流量、通话与账单日，并提供现代化视觉的主屏幕小组件。

## 文件结构

```text
cmhk-usage/
├── script.json       # 项目元信息（name/icon/color/version）
├── index.tsx         # App 内页面：账户设置、刷新、诊断、预览
├── widget.tsx        # 主屏幕小组件（systemSmall / systemMedium）
├── app_intents.tsx   # 小组件「刷新」按钮的 AppIntent
├── cmhk.ts           # 数据层：登录、抓取、归一化、缓存（唯一需要校准的文件）
└── theme.ts          # 视觉主题（深色卡片 + 渐变流量环）
```

## 功能

- **小组件**：渐变流量环（剩余百分比）、话费余额、通话分钟、账单日倒计时、更新时间、手动刷新按钮（medium）。
- **App 内页**：单账户登录（手机号 + MyLink 密码）、数据总览卡片、演示模式、连接诊断、小组件预览。
- **数据策略**：抓取成功写缓存；失败自动回退缓存并标记「缓存数据」；小组件每 30 分钟自动更新。

## ⚠️ 首次使用必须做的事（一次性校准）

CMHK MyLink **没有公开 API 文档**，本脚本的数据层按 MyLink App 常见接口形态预留了校准点：

1. 打开 App 内「CMHK Usage」，输入手机号和 MyLink 密码（仅存系统 Keychain）。
2. 点「立即刷新」。如果失败，点「连接诊断」查看接口实际返回的字段名。
3. 打开 `cmhk.ts` 顶部的 **校准区**（`CMHK.baseUrl / paths / fieldMap`），把字段路径改成诊断里看到的实际字段名。
4. 再次刷新即可。UI、缓存、小组件逻辑无需任何改动。

> 如果 MyLink 接口形态与你账户不符（如储值卡），用抓包工具（如 Stream）抓一次 MyLink App 的「登录」和「用量」请求，按实际 URL 与字段改校准区即可。
> 不想先配账户：打开「演示模式」可立即看到完整 UI 效果。

## 权限与安全

- 凭据只存 iOS 系统 Keychain（按脚本隔离），永不写入日志/缓存文件。
- 全部接口均为**只读**（登录 + 查询），不对账户做任何写操作。
- 手机号在界面上默认打码显示。

## 安装到 iOS

方式任选：

1. **iCloud**：Scripting 开启 iCloud 同步后，把 `cmhk-usage` 文件夹放入 iCloud Drive 的 Scripting 目录。
2. **scripting-cli**（桌面实时同步调试）：见 Scripting 官方 Desktop CLI 文档。

添加小组件：主屏幕添加 Scripting 小组件 → 长按编辑 → 选择「CMHK Usage」。预览效果可先在 App 内点「预览小组件」。

## 已知边界

- 小组件渲染后进程即销毁，交互仅限「刷新」按钮（AppIntent）。
- 小组件有约 30MB 内存上限，本组件只用矢量图形与文字，远低于上限。
- 接口频率请保持克制（默认 30 分钟自动刷新 + 手动刷新）。
