# 视频下载器（Video Downloader）

iOS [Scripting App](https://scriptingapp.github.io) 脚本项目：把桌面 skill
[z-video-downloader](https://github.com/tjxj/z-skills/tree/main/z-video-downloader) 的核心能力搬到 iOS。

## 支持范围

| 链接类型 | 支持情况 | 说明 |
|---|---|---|
| 微信视频号分享链接（`weixin.qq.com/sph/…`） | ✅ | 本地解析（元宝 Cookie 两步 HTTP，无需第三方服务），H.264/H.265 可选 |
| m3u8 | ✅ | 主列表自动选最高码率变体，逐分片下载拼接为 `.ts`/`.mp4`，可选转码 mp4 |
| mp4/webm/mov 等直链 | ✅ | 直接下载，可设大小上限 |
| YouTube / B站 / X / 抖音等平台链接 | ⚙️ | 需在设置中配置 cobalt 兼容解析实例（自建最稳） |

## 功能

- 主界面：粘贴/输入链接 → 下载 → 存相册 / 分享 / 导出到文件
- 分享表单入口：在任意 App 里分享链接给 Scripting 即可下载（Intent Settings 勾选 URLs/Text）
- 下载历史：SQLite 存储，支持再保存/导出/删除/去重跳过
- 设置：解析实例、默认保存动作、视频号编码偏好、m3u8 转码、大小上限、历史去重、诊断日志
- 诊断中心：日志查看、诊断包导出分享（排查问题用）

## 文件结构

```text
video-downloader/
├── script.json             # 元信息 + remoteResource 自动更新配置
├── index.tsx               # 主界面（下载 / 历史 / 设置 / 诊断中心）
├── intent.tsx              # 分享表单 & 快捷指令入口
├── services/
│   ├── downloader.ts       # 核心：类型识别 / 视频号解析 / cobalt / m3u8 拼接
│   ├── history.ts          # SQLite 下载历史
│   ├── preferences.ts      # 偏好设置
│   ├── file-actions.ts     # 存相册 / 导出 / 分享
│   └── debug.ts            # 诊断日志与导出
└── utils/
    └── common.ts           # 工具函数
```

输出目录：`App 文档目录/Video/Downloads/YYYY-MM-DD-标题/`，每次下载含 `download-report.md`。

## 快速入口

- **主屏幕小组件**（v1.2.0+）：在 Scripting 脚本设置里启用小组件后，长按主屏幕添加。
  显示最近下载（标题/大小/时长），点按任意位置（medium 右侧有独立「＋ 下载」按钮）
  跳回主界面并自动填入剪贴板链接。
- **快捷指令**：新建快捷指令 → 添加 Scripting 的「Run Script in App」动作 →
  选择本脚本、输入选「剪贴板」，可放到主屏幕/控制中心；分享表单入口则由脚本原生支持
  （Intent Settings 已声明 URLs/Text），无需快捷指令。

## 远程安装

```
https://raw.githubusercontent.com/KOP-XIAO/Scripting/main/video-downloader.scripting
```

在 Scripting App 中选「导入远程脚本」粘贴即可；包内 `remoteResource` 已启用每日自动更新。

## 致谢

- 桌面版 skill：[tjxj/z-skills](https://github.com/tjxj/z-skills/tree/main/z-video-downloader)
- 视频号解析：本两步解析移植自 [ltaoo/wx_channels_download](https://github.com/ltaoo/wx_channels_download)（元宝 Cookie 本地解析，pkg/scraper/wxchannels/yuanbao.go）
- 平台解析思路：[imputnet/cobalt](https://github.com/imputnet/cobalt)
- 架构参考（社区实证模式）：ScriptingApp/Community-Scripts 的「抖音分享下载」
