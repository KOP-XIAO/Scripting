# 行程提醒（Trip Reminder）

> ⚠️ **重要**：本项目原名 `train-reminder`（高铁提醒，v1.0.0）。如果设备上装有旧的
> 「Train Reminder / 高铁提醒」，请**先删除它**（它的远程更新地址已失效，永远不会再更新），
> 只保留本「Trip Reminder / 行程提醒」。


iOS [Scripting App](https://scriptingapp.github.io) 脚本：把**火车**与**航班**行程放到主屏幕小组件上——
车次/航班号、出发到达、出发时间倒计时、检票口/登机口、座位号、登机时间、乘客姓名。

## 数据来源与隐私

- **录入**：在 App 里选一张 12306 行程截图或航司行程/登机牌截图 → **本机 Vision 框架**识别
  → 自动判别火车/航班并填表 → 你核对后保存；也支持相机扫描与纯手填。
- **隐私**：脚本**不含任何网络请求**，行程只写入本机 Storage（`rail.*` 键）。
  截图在识别后即丢弃，不落盘、不上传，也不会同步到代码仓库或任何第三方位置。
  仓库里只有代码，测试用例全部是编造的假数据。
- 小组件默认显示乘客姓名，可在设置里关闭（主屏幕可能被旁人看到）。

## 支持字段

| 通用 | 火车专属 | 航班专属 |
|---|---|---|
| 号码、承运方/车型、出发到达、日期、出发/到达时间、历时、闸口、座位、乘客、备注 | 检票口、车厢、座别（二等座…） | 登机口、航站楼、登机时间、值机柜台、舱位（经济舱…）、行李转盘 |

## 文件结构

```text
trip-reminder/
├── script.json          # 元信息 + remoteResource 自动更新
├── index.tsx            # 主界面：下一段行程 / 识别录入 / 行程列表 / 设置 / 关于
├── widget.tsx           # 主屏幕小组件（中号为主，小号兜底）
├── services/
│   ├── parse.ts         # 截图文本 → 结构化行程（火车/航班判别，纯函数可离线测试）
│   ├── ocr.ts           # 相册选图 + Vision 本机识别
│   ├── trips.ts         # 本机存储与「下一班」选择（火车航班混排）
│   └── theme.ts         # 车票白 / 夜行蓝 两套配色
├── utils/common.ts      # 版本号
└── tools/test-parse.cjs # 解析器离线断言（假数据，8 组）
```

## 使用

1. 截一张 12306 行程详情图，或航司 App 的行程/登机牌截图。
2. 打开脚本 → **从截图识别** → 核对（识别错就手改，类型会自动判别也可手动切换）→ **保存行程**。
3. 长按主屏幕 → 添加 Scripting 小组件 → 选 **中号** 与本脚本。

## 远程安装

```
https://raw.githubusercontent.com/KOP-XIAO/Scripting/main/trip-reminder.scripting
```

包内 `remoteResource` 已启用每日自动更新。

## 开发

```bash
# 改完后同步到仓库并打包（与其它项目同一套流程）
bash ~/Documents/Scripting/sync.sh trip-reminder

# 解析器离线测试（需要 esbuild）
NODE_PATH=<含 esbuild 的 node_modules> node tools/test-parse.cjs
```
