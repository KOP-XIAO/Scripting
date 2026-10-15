// Offline assertions; Node 24+ supplies TypeScript stripping, no installation needed.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const root = path.dirname(__dirname)
const oldExtension = require.extensions[".ts"]
require.extensions[".ts"] = (mod, filename) => {
  let source = Module.stripTypeScriptTypes(fs.readFileSync(filename, "utf8"))
  const names = []
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g, (_, imports, file) =>
    `const {${imports}} = require(${JSON.stringify(file + ".ts")})`)
  source = source.replace(/export\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g, (_, exports, file) =>
    `Object.assign(module.exports, require(${JSON.stringify(file + ".ts")}))`)
  source = source.replace(/export\s+(function|const|let)\s+(\w+)/g, (_, kind, name) => {
    names.push(name)
    return `${kind} ${name}`
  })
  mod._compile(source + `\nObject.assign(module.exports, {${names.join(",")}})`, filename)
}
const P = require(path.join(root, "services/parse.ts"))
const parse = (text, candidates = []) => P.parseTripText(text, new Date("2026-10-01T09:00:00"), "auto", candidates)
const stations = (stops) => stops.map((stop) => stop.station)
const ticket = "G1234\n乘车站：始兴站\n到达站：广州南站\n2026-10-12\n23:40\n01:20\n检票口 3B"
const rows = "北京南 始发 21:00\n始兴 23:38 23:40 停留2分\n韶关 00:10 00:10 0分\n广州南 01:20 01:25 5分\n深圳北 02:00 终到"
let count = 0
function test(name, run) { run(); console.log(`✓ ${++count}. ${name}`) }

test("all section markers; table before and after ticket; no ticket contamination", () => {
  for (const marker of ["经停站", "经停信息", "列车时刻表", "时刻表"]) {
    for (const text of [`${marker}\n站名 到达时间 出发时间 停留\n${rows}\n${ticket}`, `${ticket}\n${marker}\n${rows}`]) {
      const trip = parse(text)
      assert.equal(trip.fromPlace, "始兴")
      assert.equal(trip.toPlace, "广州南")
      assert.equal(trip.departTime, "23:40")
      assert.equal(trip.arriveTime, "01:20")
      assert.equal(trip.railStops.length, 5)
      assert.deepEqual(stations(P.railJourneyStops(trip)), ["始兴", "韶关", "广州南"])
    }
  }
})
test("split rows, repeated identical times, missing times and midnight", () => {
  const trip = parse("经停信息\n站名\n到达\n出发\n停留\n北京南\n--\n23:00\n始兴\n23:58\n00:02\n停留\n4分\n广州南\n01:20\n01:20\n0分\n深圳北\n02:00\n--")
  assert.deepEqual(trip.railStops, [
    {station: "北京南", arrival: "", departure: "23:00", dayOffset: 0},
    {station: "始兴", arrival: "23:58", departure: "00:02", stopMinutes: 4, dayOffset: 0},
    {station: "广州南", arrival: "01:20", departure: "01:20", stopMinutes: 0, dayOffset: 1},
    {station: "深圳北", arrival: "02:00", departure: "", dayOffset: 1},
  ])
  assert.equal(trip.fromPlace, "")
  assert.equal(trip.toPlace, "")
  assert.equal(trip.departTime, "")
  assert.equal(trip.arriveTime, "")
  assert.deepEqual(P.railJourneyStops(trip), [])
})
test("recrop after endpoint edits without changing the full recognized table", () => {
  const trip = parse(`${ticket}\n时刻表\n${rows}`)
  const full = JSON.stringify(trip.railStops)
  assert.deepEqual(stations(P.railJourneyStops({...trip, fromPlace: "韶关站", toPlace: "深圳北站"})), ["韶关", "广州南", "深圳北"])
  for (const [fromPlace, toPlace] of [["未知站", "广州南"], ["始兴", "未知站"], ["广州南", "始兴"], ["", ""], ["南", "深圳北"], ["始兴", "始兴"]]) {
    assert.deepEqual(P.railJourneyStops({...trip, fromPlace, toPlace}), [])
  }
  assert.deepEqual(P.railJourneyStops({...trip, mode: "flight"}), [])
  assert.equal(JSON.stringify(trip.railStops), full)
})
test("arrow and explicit segment beat train endpoint badges", () => {
  for (const route of ["始兴站 → 广州南站", "乘车站\n始兴站\n到达站\n广州南站"]) {
    const trip = parse(`G1234\n始 北京南\n终 深圳北\n${route}\n23:40\n01:20\n时刻表\n${rows}`)
    assert.equal(trip.fromPlace, "始兴")
    assert.equal(trip.toPlace, "广州南")
  }
})
test("unmarked text never creates railStops; legacy records crop to empty", () => {
  assert.equal(parse(rows).railStops, undefined)
  assert.deepEqual(P.railJourneyStops({fromPlace: "北京南", toPlace: "天津南"}), [])
  assert.equal(parse("G1234\n始兴 → 广州南\n09:00\n10:00").fromPlace, "始兴")
})
test("table-only candidates cannot supply an invented user segment", () => {
  const trip = parse(`时刻表\n${rows}`, [
    {content: "21:00", x: 0, y: 0.1, w: 0.1, h: 0.02},
    {content: "北京南", x: 0, y: 0.2, w: 0.1, h: 0.02},
    {content: "深圳北", x: 0.8, y: 0.2, w: 0.1, h: 0.02},
  ])
  assert.equal(trip.fromPlace, "")
  assert.equal(trip.toPlace, "")
})

test("damaged and incomplete rows cannot leak times or invent stops", () => {
  const trip = parse("时刻表\n站名 到达 出发\n无法识别 ??? 05:00\n残缺站\n06:00\n始兴 23:38 23:40\n广州南 01:20 01:20")
  assert.deepEqual(stations(trip.railStops), ["始兴", "广州南"])
  assert.equal(trip.departTime, "")
  assert.equal(trip.arriveTime, "")
  assert.equal(trip.fromPlace, "")
  assert.equal(trip.toPlace, "")
})
test("numbered rows and suffix matching preserve full station names", () => {
  const trip = parse("时刻表\n1 北京南站 -- 21:00\n2 始兴站 23:38 23:40 2分钟\n3 广州南站 01:20 终到\n乘车站 始兴站\n到达站 广州南站\n23:40\n01:20")
  assert.deepEqual(stations(trip.railStops), ["北京南站", "始兴站", "广州南站"])
  assert.deepEqual(stations(P.railJourneyStops(trip)), ["始兴站", "广州南站"])
  assert.equal(trip.departTime, "23:40")
  assert.equal(trip.arriveTime, "01:20")
})
test("all rows on one line remain distinct and retain repeated clocks", () => {
  const trip = parse("时刻表 北京南 始发 23:00 始兴 23:50 23:50 广州南 00:30 终到")
  assert.deepEqual(stations(trip.railStops), ["北京南", "始兴", "广州南"])
  assert.equal(trip.railStops[1].arrival, "23:50")
  assert.equal(trip.railStops[1].departure, "23:50")
  assert.equal(trip.railStops[2].dayOffset, 1)
})

test("screenshot headers accept 发车 and 开车; bare dwell stays unknown", () => {
  for (const departure of ["发车", "开车"]) {
    for (const header of [`站名 到达 ${departure} 停留`, `站名\n到达\n${departure}\n停留`]) {
      const trip = parse(`时刻表\n${header}\n始兴 23:38 23:40 2\n广州南 01:20 01:25 5`)
      assert.deepEqual(stations(trip.railStops), ["始兴", "广州南"])
      assert.equal(trip.railStops[0].stopMinutes, undefined)
      assert.equal(trip.railStops[1].stopMinutes, undefined)
      assert.equal(trip.departTime, "")
      assert.equal(trip.arriveTime, "")
    }
  }
})

// Run existing expectations using an in-memory esbuild substitute, without temp files.
if (process.argv.includes("--legacy")) {
  const load = Module._load, exists = fs.existsSync, bundles = new Map()
  Module._load = function(request, parent, isMain) {
    if (bundles.has(request)) return bundles.get(request)
    if (request === "esbuild") return {buildSync(options) {
      bundles.set(options.outfile, require(options.entryPoints[0]))
    }}
    return load.call(this, request, parent, isMain)
  }
  fs.existsSync = (file) => bundles.has(file) || exists(file)
  try { require("./test-parse.cjs") } finally { Module._load = load; fs.existsSync = exists }
}
if (oldExtension) require.extensions[".ts"] = oldExtension
else delete require.extensions[".ts"]
console.log(`Rail timetable assertions passed: ${count} groups`)
