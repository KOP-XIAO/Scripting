# Scripting

我的 iOS [Scripting App](https://scripting.app) 脚本仓库。

## 项目

| 项目 | 说明 |
|------|------|
| [cmhk-usage](./cmhk-usage/) | CMHK（中国移动香港 / MyLink）话费、流量、通话、账单日展示 + 现代化主屏幕小组件 |

## 远程安装

每个项目是一个自包含文件夹（含 `script.json`）。任选其一：

1. **整仓克隆**：`git clone <本仓库>` 后，把对应项目文件夹导入 Scripting（iCloud 同步目录或 `scripting-cli` 实时同步）。
2. **单项目**：只取 `<项目名>/` 子文件夹的全部文件放入 Scripting 即可运行。

## 目录约定（本机）

```text
~/Documents/Scripting/<项目>/      # iOS 同步源（主目录）
~/Documents/GitHub/Scripting/<项目>/  # 本仓库（发布到远端）
~/Documents/Grok/Skills/<项目>/    # 项目备份区
```

更新流程：改主目录 → 运行 `sync.sh`（见下）→ commit & push。
