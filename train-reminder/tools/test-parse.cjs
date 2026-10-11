// tools/test-parse.cjs — 解析器离线测试（纯逻辑，不连网、不涉及真实行程数据）
// 用法（需要 esbuild）：
//   NODE_PATH=<含 esbuild 的 node_modules> node tools/test-parse.cjs
// 作用：把 services/parse.ts 现场打包成 CJS 后跑断言，验证 12306 文本 -> 结构化行程。
const assert = require("assert")
const path = require("path")
const fs = require("fs")
const os = require("os")

const ROOT = path.dirname(__dirname)
let esbuild
try {
  esbuild = require("esbuild")
} catch {
  console.error("需要 esbuild：NODE_PATH=<含 esbuild 的 node_modules> node tools/test-parse.cjs")
  process.exit(1)
}

const out = path.join(os.tmpdir(), "train-parse.bundle.cjs")
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "services", "parse.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: out,
})
const P = require(out)
assert.ok(fs.existsSync(out))

// -------------------------------------------------------------
// 全部为编造数据，不包含任何真实行程
// -------------------------------------------------------------
let n = 0
const ok = (msg) => console.log(`✓ ${++n}. ${msg}`)

// C1：12306 行程详情截图（过/终 站点行 + 检票口 + 座位 + 乘车人）
{
  const text = [
    "G1234",
    "复兴号",
    "5分后出发 请以实际",
    "08:32",
    "10月12日(周一)",
    "08:50",
    "历时18分",
    "过 北京南",
    "终 上海虹桥",
    "乘车人：张三",
    "检票口：6A检票口",
    "座位号：08车12A二等座",
    "改签 灵活行 退票",
  ].join("\n")
  const t = P.parseTripText(text, new Date("2026-10-01T09:00:00"))
  assert.strictEqual(t.trainNo, "G1234")
  assert.strictEqual(t.trainType, "复兴号")
  assert.strictEqual(t.fromStation, "北京南")
  assert.strictEqual(t.toStation, "上海虹桥")
  assert.strictEqual(t.departTime, "08:32")
  assert.strictEqual(t.arriveTime, "08:50")
  assert.strictEqual(t.durationMin, 18)
  assert.strictEqual(t.gate, "6A")
  assert.strictEqual(t.seatCar, "8")
  assert.strictEqual(t.seatNo, "12A")
  assert.strictEqual(t.seatClass, "二等座")
  assert.strictEqual(t.passenger, "张三")
  assert.strictEqual(t.departDate, "2026-10-12")
  ok("标准行程截图字段全部解析正确（含 05车 -> 5 去零、检票口 6A）")
}

// C2：全角数字 / 半角冒号混排，站点用箭头分隔
{
  const text = [
    "D2288 和谐号",
    "２０２６-１１-０７",
    "07:05",
    "08:15",
    "历时70分",
    "北京南 → 天津南",
    "检票口:14B",
    "座位号:5车09C一等座",
    "乘车人:李四",
  ].join("\n")
  const t = P.parseTripText(text, new Date("2026-10-01T09:00:00"))
  assert.strictEqual(t.trainNo, "D2288")
  assert.strictEqual(t.departDate, "2026-11-07")
  assert.strictEqual(t.fromStation, "北京南")
  assert.strictEqual(t.toStation, "天津南")
  assert.strictEqual(t.departTime, "07:05")
  assert.strictEqual(t.arriveTime, "08:15")
  assert.strictEqual(t.durationMin, 70)
  assert.strictEqual(t.gate, "14B")
  assert.strictEqual(t.seatCar, "5")
  assert.strictEqual(t.seatNo, "09C")
  assert.strictEqual(t.seatClass, "一等座")
  assert.strictEqual(t.passenger, "李四")
  ok("全角数字归一化 + 箭头站点 + 历时 70 分")
}

// C3：跨年车票（12 月看到 1 月的票 -> 次年）
{
  const t = P.parseTripText("G9999\n1月3日\n19:00\n19:40\n历时40分\n北京南 → 天津", new Date("2026-12-20T10:00:00"))
  assert.strictEqual(t.departDate, "2027-01-03")
  ok("跨年日期自动进位到下一年")
}

// C4：只有时长小时写法 + 行程状态
{
  const trip = { departDate: "2026-10-12", departTime: "08:32", durationMin: 80 }
  assert.strictEqual(
    P.countdownText(trip, new Date("2026-10-12T08:00:00").getTime()),
    "32 分钟后发车",
  )
  assert.strictEqual(
    P.countdownText(trip, new Date("2026-10-12T06:00:00").getTime()),
    "2 小时 32 分后发车",
  )
  assert.strictEqual(
    P.countdownText(trip, new Date("2026-10-12T08:40:00").getTime()),
    "行程中",
  )
  assert.strictEqual(
    P.countdownText(trip, new Date("2026-10-12T10:30:00").getTime()),
    "行程已结束",
  )
  ok("倒计时/行程中/已结束 文案正确")
}

// C5：展示辅助
{
  assert.strictEqual(P.monthDayText("2026-10-12"), "10月12日")
  assert.strictEqual(P.weekdayText("2026-10-12"), "周一")
  assert.strictEqual(P.seatText({ seatCar: "5", seatNo: "12A", seatClass: "二等座" }), "5车12A 二等座")
  assert.strictEqual(P.routeText({ fromStation: "北京南", toStation: "上海虹桥" }), "北京南 → 上海虹桥")
  assert.strictEqual(P.countdownText({ departDate: "", departTime: "", durationMin: 0 }), "待补全时间")
  ok("日期/星期/座位/区间/缺字段兜底文案正确")
}

// C6：识别不到字段时不炸（返回空值而非抛错）
{
  const t = P.parseTripText("随便一段无关文字\n没有车次也没有时间")
  assert.strictEqual(t.trainNo, "")
  assert.strictEqual(t.departTime, "")
  assert.strictEqual(t.departDate, "")
  ok("无有效字段时安全返回空值")
}

console.log(`\n全部通过：${n} 组断言`)
