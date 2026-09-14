# 视频下载器 Lite（Video Downloader Lite）

iOS [Scripting App](https://scriptingapp.github.io) 脚本项目的**免费版适配**：与 `video-downloader`
功能一致，但完全不依赖 Pro 专属 API —— 下载历史用 JSON 文件存储（替代 Pro 的 SQLite），
m3u8 转码 mp4 属 Pro 能力，免费版会自动降级为保留 `.ts` 文件。

## 与 Pro 版的差异

| 能力 | Lite（本版本） | Pro 版 |
|---|---|---|
| 视频号 / m3u8 / 直链 / 平台解析下载 | ✅ 完全一致 | ✅ |
| 下载历史 | ✅ JSON 文件（上限 200 条） | ✅ SQLite |
| 历史去重、诊断中心、日志导出 | ✅ | ✅ |
| 分享表单 / 快捷指令入口 | ✅ | ✅ |
| m3u8 → mp4 转码 | ❌ 自动保留 .ts（可用 VLC 播放） | ✅ AVAssetExportSession |

## 支持范围

| 链接类型 | 支持情况 | 说明 |
|---|---|---|
| 微信视频号分享链接（`weixin.qq.com/sph/…`） | ✅ | 本地解析（元宝 Cookie 两步 HTTP，无需第三方服务），H.264/H.265 可选 |
| m3u8 | ✅ | 主列表自动选最高码率变体，逐分片下载拼接 |
| mp4/webm/mov 等直链 | ✅ | 直接下载，可设大小上限 |
| YouTube / B站 / X / 抖音等平台链接 | ⚙️ | 需在设置中配置 cobalt 兼容解析实例 |

## 文件结构

```text
video-downloader-lite/
├── script.json             # 元信息 + remoteResource 自动更新配置
├── index.tsx               # 主界面（下载 / 历史 / 设置 / 诊断中心）
├── intent.tsx              # 分享表单 & 快捷指令入口
├── services/
│   ├── downloader.ts       # 核心：类型识别 / 视频号解析 / cobalt / m3u8 拼接
│   ├── history.ts          # JSON 下载历史（Lite 与 Pro 版唯一实现差异）
│   ├── preferences.ts      # 偏好设置
│   ├── file-actions.ts     # 存相册 / 导出 / 分享
│   └── debug.ts            # 诊断日志与导出
└── utils/
    └── common.ts           # 工具函数
```

## 远程安装

```
https://raw.githubusercontent.com/KOP-XIAO/Scripting/main/video-downloader-lite.scripting
```

在 Scripting App 中选「导入远程脚本」粘贴即可；包内 `remoteResource` 已启用每日自动更新。

## 致谢

- 桌面版 skill：[tjxj/z-skills](https://github.com/tjxj/z-skills/tree/main/z-video-downloader)
- 视频号解析：本两步解析移植自 [ltaoo/wx_channels_download](https://github.com/ltaoo/wx_channels_download)（元宝 Cookie 本地解析，pkg/scraper/wxchannels/yuanbao.go）
- 平台解析思路：[imputnet/cobalt](https://github.com/imputnet/cobalt)
