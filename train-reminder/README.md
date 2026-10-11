# 高铁提醒（Train Reminder）

iOS [Scripting App](https://scriptingapp.github.io) 脚本：把高铁行程放到主屏幕小组件上——
车次、出发/到达站、发车时间倒计时、检票口、座位号、乘车人。

## 数据来源与隐私

- **录入**：在 App 里选一张 12306 行程截图 → **本机 Vision 框架**识别 → 自动填表 → 你核对后保存；
  也可以相机扫描或纯手填。
- **隐私**：脚本**不含任何网络请求**，行程只写入本机 Storage（`rail.*` 键）。
  截图在识别后即丢弃，不落盘、不上传，也不会同步到代码仓库或任何第三方位置。
  仓库里只有代码，测试用例全部是编造的假数据。
- 小组件默认显示乘车人姓名，可在设置里关闭（主屏幕可能被旁人看到）。

## 文件结构

```text
train-reminder/
├── script.json          # 元信息 + remoteResource 自动更新
├── index.tsx            # 主界面：下一班 / 识别录入 / 行程列表 / 设置 / 关于
├── widget.tsx           # 主屏幕小组件（中号为主，小号兜底）
├── services/
│   ├── parse.ts         # 12306 文本 → 结构化行程（纯函数，可离线测试）
│   ├── ocr.ts           # 相册选图 + Vision 本机识别
│   ├── trips.ts         # 本机存储与「下一班」选择
│   └── theme.ts         # 车票白 / 夜行蓝 两套配色
├── utils/common.ts      # 版本号
└── tools/test-parse.cjs # 解析器离线断言（假数据）
```

## 使用

1. 在 12306 里截一张行程详情图（或把电子票截图存到相册）。
2. 打开脚本 → **从截图识别** → 核对字段（识别错就手改）→ **保存行程**。
3. 长按主屏幕 → 添加 Scripting 小组件 → 选 **中号** 与本脚本。

## 远程安装

```
https://raw.githubusercontent.com/KOP-XIAO/Scripting/main/train-reminder.scripting
```

包内 `remoteResource` 已启用每日自动更新。

## 开发

```bash
# 在本地开发目录改完后，同步到仓库并打包（与其它项目同一套流程）
bash ~/Documents/Scripting/sync.sh train-reminder

# 解析器离线测试（需要 esbuild）
NODE_PATH=<含 esbuild 的 node_modules> node tools/test-parse.cjs
```
