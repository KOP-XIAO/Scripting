// tools/test-parse.cjs — 解析器离线测试（纯逻辑，不连网、不涉及真实行程数据）
// 用法（需要 esbuild）：
//   NODE_PATH=<含 esbuild 的 node_modules> node tools/test-parse.cjs
// 作用：把 services/parse.ts 现场打包成 CJS 后跑断言，覆盖火车票与机票两种截图文本。
// 说明：全部用例均为编造的假数据（G1234 / CA1234 / 张三 等），不含任何真实行程。
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

const out = path.join(os.tmpdir(), "trip-parse.bundle.cjs")
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "services", "parse.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: out,
})
const P = require(out)
assert.ok(fs.existsSync(out))

let n = 0
const ok = (msg) => console.log(`✓ ${++n}. ${msg}`)

// ============ 火车 ============
// R1：12306 行程详情截图（过/终 站点行 + 检票口 + 座位 + 乘车人）
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
  assert.strictEqual(t.mode, "rail")
  assert.strictEqual(t.code, "G1234")
  assert.strictEqual(t.carrier, "复兴号")
  assert.strictEqual(t.fromPlace, "北京南")
  assert.strictEqual(t.toPlace, "上海虹桥")
  assert.strictEqual(t.departTime, "08:32")
  assert.strictEqual(t.arriveTime, "08:50")
  assert.strictEqual(t.durationMin, 18)
  assert.strictEqual(t.gate, "6A")
  assert.strictEqual(t.seatCar, "8")
  assert.strictEqual(t.seatNo, "12A")
  assert.strictEqual(t.seatClass, "二等座")
  assert.strictEqual(t.passenger, "张三")
  assert.strictEqual(t.departDate, "2026-10-12")
  assert.strictEqual(P.seatText(t), "8车12A 二等座")
  assert.strictEqual(P.gateLabel(t.mode), "检票口")
  ok("火车：标准行程截图字段全部正确（车厢去零、检票口 6A）")
}

// R2：全角数字 / 半角冒号混排 + 箭头站点 + 小时级历时
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
  assert.strictEqual(t.mode, "rail")
  assert.strictEqual(t.code, "D2288")
  assert.strictEqual(t.departDate, "2026-11-07")
  assert.strictEqual(t.fromPlace, "北京南")
  assert.strictEqual(t.toPlace, "天津南")
  assert.strictEqual(t.gate, "14B")
  assert.strictEqual(t.seatCar, "5")
  assert.strictEqual(t.seatNo, "09C")
  assert.strictEqual(t.passenger, "李四")
  ok("火车：全角数字归一化 + 箭头站点 + 历时 70 分")
}

// R3：跨年车票（12 月看到 1 月的票 -> 次年）
{
  const t = P.parseTripText("G9999\n1月3日\n19:00\n19:40\n历时40分\n北京南 → 天津南", new Date("2026-12-20T10:00:00"))
  assert.strictEqual(t.departDate, "2027-01-03")
  ok("火车：跨年日期自动进位到下一年")
}

// R4：「过」「终」标记被 OCR 拆成两行（真机常见）
{
  const text = [
    "G5678",
    "复兴号",
    "08:00",
    "过",
    "北京南",
    "终",
    "上海虹桥",
    "检票口 3B",
    "5车06F 二等座",
  ].join("\n")
  const t = P.parseTripText(text, new Date("2026-10-01T09:00:00"))
  assert.strictEqual(t.fromPlace, "北京南")
  assert.strictEqual(t.toPlace, "上海虹桥")
  ok("火车：标记单独成行（过 / 终 换行）也能解析出站点")
}

// R5：标签式「出发站 / 到达站」
{
  const text = ["D3300", "出发站：北京南", "到达站：天津南", "07:00", "07:35", "检票口 A2", "3车08D 一等座"].join("\n")
  const t = P.parseTripText(text, new Date("2026-10-01T09:00:00"))
  assert.strictEqual(t.fromPlace, "北京南")
  assert.strictEqual(t.toPlace, "天津南")
  ok("火车：出发站/到达站 标签式写法可解析")
}

// R6：真机实跑的 Vision 输出（12306 行程详情截图，已脱敏）。
// 关键陷阱：①「过」与站名拆行且站名带垃圾字符（深圳北，）②「终」徽章完全没识别出来
// ③检票口的信息图标被认成字母（检票口Q：）④站名尾部带「〉」
{
  const text = [
    "G7654",
    "复兴号",
    "08:32",
    "过",
    "深圳北，",
    "： 乘车人：李四",
    "检票口Q：11B检票口",
    "座位号：05车05B二等座",
    "10月12日（周一）",
    "历时18分",
    "3分后出发 请以实际",
    "08:50",
    "香港西九龙〉",
    "改签",
    "灵活行",
    "乘车码",
    "退票",
  ].join("\n")
  const candidates = [
    { content: "G7654", x: 0.12, y: 0.87, w: 0.16, h: 0.06 },
    { content: "复兴号", x: 0.3, y: 0.88, w: 0.07, h: 0.04 },
    { content: "08:32", x: 0.06, y: 0.68, w: 0.17, h: 0.08 },
    { content: "过", x: 0.06, y: 0.58, w: 0.03, h: 0.05 },
    { content: "深圳北，", x: 0.1, y: 0.58, w: 0.13, h: 0.06 },
    { content: "： 乘车人：李四", x: 0.06, y: 0.48, w: 0.29, h: 0.06 },
    { content: "检票口Q：11B检票口", x: 0.08, y: 0.34, w: 0.32, h: 0.05 },
    { content: "座位号：05车05B二等座", x: 0.08, y: 0.25, w: 0.38, h: 0.05 },
    { content: "10月12日（周一）", x: 0.38, y: 0.66, w: 0.23, h: 0.07 },
    { content: "历时18分", x: 0.44, y: 0.6, w: 0.12, h: 0.05 },
    { content: "3分后出发 请以实际", x: 0.58, y: 0.86, w: 0.33, h: 0.06 },
    { content: "08:50", x: 0.76, y: 0.68, w: 0.17, h: 0.08 },
    { content: "香港西九龙〉", x: 0.72, y: 0.58, w: 0.22, h: 0.05 },
    { content: "改签", x: 0.41, y: 0.08, w: 0.07, h: 0.06 },
    { content: "灵活行", x: 0.59, y: 0.08, w: 0.1, h: 0.06 },
    { content: "乘车码", x: 0.83, y: 0.23, w: 0.1, h: 0.05 },
    { content: "退票", x: 0.81, y: 0.08, w: 0.07, h: 0.05 },
  ]
  const t = P.parseTripText(text, new Date("2026-10-11T09:00:00"), "auto", candidates)
  assert.strictEqual(t.mode, "rail")
  assert.strictEqual(t.code, "G7654")
  assert.strictEqual(t.carrier, "复兴号")
  assert.strictEqual(t.fromPlace, "深圳北", "站名尾部垃圾字符应被清掉")
  assert.strictEqual(t.toPlace, "香港西九龙", "「终」徽章丢失时应用位置兜底拿到到达站")
  assert.strictEqual(t.gate, "11B", "检票口后的图标字母不应干扰")
  assert.strictEqual(t.seatCar, "5")
  assert.strictEqual(t.seatNo, "05B")
  assert.strictEqual(t.seatClass, "二等座")
  assert.strictEqual(t.passenger, "李四")
  assert.strictEqual(t.departDate, "2026-10-12")
  assert.strictEqual(t.departTime, "08:32")
  assert.strictEqual(t.arriveTime, "08:50")
  assert.strictEqual(t.durationMin, 18)
  ok("火车：真实 Vision 输出（拆行/垃圾字符/徽章丢失/图标污染）全部解析正确")
}

// ============ 航班 ============
// F1：航司 App 行程详情（航站楼 + 登机口 + 值机柜台 + 登机时间 + 舱位 + 行李转盘）
{
  const text = [
    "中国国际航空",
    "CA1234",
    "北京首都T3 → 上海虹桥T2",
    "2026-10-12",
    "08:00",
    "10:20",
    "飞行时间2小时20分",
    "登机口 C12",
    "登机时间 07:20",
    "值机柜台 H01-H10",
    "座位 32A 经济舱",
    "乘机人 王五",
    "行李转盘 6",
  ].join("\n")
  const t = P.parseTripText(text, new Date("2026-10-01T09:00:00"))
  assert.strictEqual(t.mode, "flight")
  assert.strictEqual(t.code, "CA1234")
  assert.strictEqual(t.carrier, "中国国际航空")
  assert.strictEqual(t.fromPlace, "北京首都T3")
  assert.strictEqual(t.toPlace, "上海虹桥T2")
  assert.strictEqual(t.terminal, "T3")
  assert.strictEqual(t.departTime, "08:00")
  assert.strictEqual(t.arriveTime, "10:20")
  assert.strictEqual(t.boardingTime, "07:20")
  assert.strictEqual(t.durationMin, 140)
  assert.strictEqual(t.gate, "C12")
  assert.strictEqual(t.checkIn, "H01-H10")
  assert.strictEqual(t.seatNo, "32A")
  assert.strictEqual(t.seatClass, "经济舱")
  assert.strictEqual(t.baggage, "6")
  assert.strictEqual(t.passenger, "王五")
  assert.strictEqual(P.seatText(t), "32A 经济舱")
  assert.strictEqual(P.gateLabel(t.mode), "登机口")
  ok("航班：登机口/登机时间/值机柜台/航站楼/舱位/行李转盘 全部正确，且登机时间未被误判为起飞时间")
}

// F2：纯登机牌极简文本 + 数字开头航司码（3U）
{
  const text = ["3U8888", "成都天府T2 - 北京大兴", "2026-11-20", "09:30", "12:05", "登机口 B07", "座位 5C 公务舱"].join("\n")
  const t = P.parseTripText(text, new Date("2026-10-01T09:00:00"))
  assert.strictEqual(t.mode, "flight")
  assert.strictEqual(t.code, "3U8888")
  assert.strictEqual(t.fromPlace, "成都天府T2")
  assert.strictEqual(t.toPlace, "北京大兴")
  assert.strictEqual(t.terminal, "T2")
  assert.strictEqual(t.gate, "B07")
  assert.strictEqual(t.seatNo, "5C")
  assert.strictEqual(t.seatClass, "公务舱")
  ok("航班：数字开头航司码 3U8888 + 短横线区间 + 无登机时间")
}

// F3：显式指定模式（手填时用户切换类型）覆盖自动判别
{
  const t = P.parseTripText("CA1234 08:00 10:20 北京首都T3 上海虹桥T2", new Date("2026-10-01T09:00:00"), "rail")
  assert.strictEqual(t.mode, "rail")
  ok("模式提示参数可覆盖自动判别（同一段文本按火车解析）")
}

// ============ 通用 ============
// G1：倒计时文案分级（长时段必须压缩，否则小组件会被截断）
{
  const trip = { departDate: "2026-10-12", departTime: "08:32", durationMin: 80 }
  const at = (s) => new Date(s).getTime()
  assert.strictEqual(P.countdownText(trip, at("2026-10-12T08:00:00")), "32分钟后出发")
  assert.strictEqual(P.countdownText(trip, at("2026-10-12T06:00:00")), "2小时32分后出发")
  assert.strictEqual(P.countdownText(trip, at("2026-10-11T18:10:00")), "14小时后出发", "10~20 小时只报到小时")
  assert.strictEqual(P.countdownText(trip, at("2026-10-11T06:00:00")), "明天出发", "20~36 小时说「明天」")
  assert.strictEqual(P.countdownText(trip, at("2026-10-10T08:00:00")), "2 天后出发", "更远按天数")
  assert.strictEqual(P.countdownText(trip, at("2026-10-12T08:40:00")), "行程中")
  assert.strictEqual(P.countdownText(trip, at("2026-10-12T10:30:00")), "行程已结束")
  ok("倒计时分级文案正确（短时精确 / 长时压缩 / 行程中 / 已结束）")
}

// G3：识别后缺失字段自检（用于提示用户手动补全）
{
  const t = P.parseTripText("G1234\n08:32\n08:50", new Date("2026-10-01T09:00:00"))
  const miss = P.missingFields(t)
  assert.ok(miss.includes("出发车站"), "应提示缺出发车站，实际：" + miss.join("/"))
  assert.ok(miss.includes("到达车站"), "应提示缺到达车站")
  assert.ok(miss.includes("座位号"))
  const full = P.parseTripText(
    "G1234\n过 北京南\n终 上海虹桥\n08:32\n08:50\n检票口 6A\n5车12A 二等座",
    new Date("2026-10-01T09:00:00"),
  )
  assert.deepStrictEqual(P.missingFields(full), [])
  ok("缺失字段自检可用（字段齐全时为空）")
}

// G2：展示辅助与缺字段兜底
{
  assert.strictEqual(P.monthDayText("2026-10-12"), "10月12日")
  assert.strictEqual(P.weekdayText("2026-10-12"), "周一")
  assert.strictEqual(P.routeText({ fromPlace: "北京南", toPlace: "上海虹桥" }), "北京南 → 上海虹桥")
  assert.strictEqual(P.countdownText({ departDate: "", departTime: "", durationMin: 0 }), "待补全时间")
  assert.strictEqual(P.modeLabel("flight"), "航班")
  assert.strictEqual(P.carrierLabel("airport" === "x" ? "flight" : "rail"), "车型")
  const empty = P.parseTripText("随便一段无关文字\n没有号码也没有时间")
  assert.strictEqual(empty.code, "")
  assert.strictEqual(empty.departTime, "")
  assert.strictEqual(empty.departDate, "")
  ok("日期/星期/区间/空值兜底都正常")
}

console.log(`\n全部通过：${n} 组断言`)
