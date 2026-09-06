# Scripting

我的 iOS [Scripting App](https://scripting.app) 脚本仓库。

## 项目

| 项目 | 说明 |
|------|------|
| [cmhk-usage](./cmhk-usage/) | CMHK（中国移动香港 / MyLink）话费、流量、通话、账单日展示 + 现代化主屏幕小组件 |

## 远程安装

每个项目是一个自包含文件夹（含 `script.json`），仓库根目录另附打包好的 **`.scripting` 安装包**：

| 项目 | 直接安装 / 远程导入地址 |
|------|------|
| cmhk-usage | `https://raw.githubusercontent.com/KOP-XIAO/Scripting/main/cmhk-usage.scripting` |

在 Scripting App 中选「**导入远程脚本**」并粘贴上述地址即可。包内 `remoteResource` 已指向该地址并启用每日自动更新（86400s）。

> 注意：导入用的是 `.scripting` 包文件的 raw 链接，**不是** `…/tree/main/…` 源码目录链接（后者会导入失败）。

也可整仓克隆后把项目文件夹导入 Scripting（iCloud 同步目录或 `scripting-cli` 实时同步）。

## 目录约定（本机）

```text
~/Documents/Scripting/<项目>/      # iOS 同步源（主目录）
~/Documents/GitHub/Scripting/<项目>/  # 本仓库（发布到远端）
```

更新流程：改主目录 → 运行 `sync.sh`（见下）→ commit & push。
