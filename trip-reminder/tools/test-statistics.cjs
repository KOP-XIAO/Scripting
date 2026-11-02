// Offline synthetic-data tests; NODE_PATH=<node_modules with esbuild> node tools/test-statistics.cjs
const assert = require("node:assert/strict")
const path = require("node:path")
const Module = require("node:module")
const esbuild = require("esbuild")
const entry = path.join(__dirname, "../services/statistics.ts")
const bundle = esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false })
const compiled = new Module(entry, module)
compiled._compile(bundle.outputFiles[0].text, entry)
const { archiveStatistics } = compiled.exports

let count = 0
function test(name, run) {
  run()
  console.log(`✓ ${++count}. ${name}`)
}
function trip(overrides = {}) {
  return {
    id: "t1", mode: "rail", code: "G1234", carrier: "", fromPlace: "北京南", toPlace: "天津南",
    departDate: "2026-01-01", departTime: "08:00", arriveTime: "09:00", durationMin: 60,
    gate: "", terminal: "", checkIn: "", boardingTime: "", baggage: "", seatCar: "", seatNo: "",
    seatClass: "", passenger: "", note: "", createdAt: "2026-01-01T00:00:00Z",
    archivedAt: "2026-01-02T00:00:00Z", ...overrides,
  }
}

test("empty input returns exact zero counts and an empty ranking", () => {
  assert.deepEqual(archiveStatistics([]), {
    total: 0, rail: 0, flight: 0, totalMinutes: 0, knownDurationCount: 0,
    unknownDurationCount: 0, places: [], uniquePlaceCount: 0,
  })
})

test("only archivedAt determines inclusion, including future archived trips", () => {
  const stats = archiveStatistics([
    trip(), trip({ id: "t2", mode: "flight", departDate: "2099-01-01", durationMin: 120 }),
    trip({ id: "t3", archivedAt: undefined, departDate: "2000-01-01", durationMin: 9999 }),
    trip({ id: "t4", archivedAt: "", durationMin: 9999 }),
  ])
  assert.deepEqual([stats.total, stats.rail, stats.flight, stats.totalMinutes], [2, 1, 1, 180])
  assert.deepEqual([stats.knownDurationCount, stats.unknownDurationCount], [2, 0])
})

test("shared duration helper supplies overnight time and preserves explicit multi-day travel", () => {
  const stats = archiveStatistics([
    trip({ durationMin: 0, departTime: "23:40", arriveTime: "00:20" }),
    trip({ id: "t2", durationMin: 2 * 1440 + 75, departTime: "08:00", arriveTime: "09:15" }),
  ])
  assert.equal(stats.totalMinutes, 2995)
  assert.equal(stats.knownDurationCount, 2)
})

test("missing, invalid and equal clocks stay unknown without invented zero-minute trips", () => {
  const records = [
    trip({ durationMin: 0, departTime: "", arriveTime: "" }),
    trip({ durationMin: NaN, departTime: "25:00" }),
    trip({ durationMin: Infinity, arriveTime: "08:99" }),
    trip({ durationMin: -10, arriveTime: "08:00" }),
    trip({ durationMin: "broken", arriveTime: "not a time" }),
  ]
  const stats = archiveStatistics(records)
  assert.deepEqual([stats.totalMinutes, stats.knownDurationCount, stats.unknownDurationCount], [0, 0, 5])
  assert.equal(stats.knownDurationCount + stats.unknownDurationCount, stats.total)
})

test("invalid explicit durations fall back to valid clock differences", () => {
  const stats = archiveStatistics([NaN, Infinity, -1, "broken"].map((durationMin) => trip({ durationMin })))
  assert.equal(stats.totalMinutes, 240)
  assert.equal(stats.knownDurationCount, 4)
  assert.equal(stats.unknownDurationCount, 0)
})

test("rail aliases merge while both endpoint appearances increment their own direction", () => {
  const stats = archiveStatistics([
    trip({ fromPlace: " 过 北京南站 ", toPlace: "终·天津南站" }),
    trip({ id: "t2", fromPlace: "天津南", toPlace: "北京南" }),
    trip({ id: "t3", fromPlace: "北京南站", toPlace: "北京南" }),
  ])
  assert.deepEqual(stats.places, [
    { mode: "rail", name: "北京南", departures: 2, arrivals: 2, total: 4 },
    { mode: "rail", name: "天津南", departures: 1, arrivals: 1, total: 2 },
  ])
  assert.equal(stats.uniquePlaceCount, 2)
})

test("rail marker normalization preserves true station names", () => {
  const stats = archiveStatistics([
    trip({ fromPlace: "始兴站", toPlace: "发耳" }),
    trip({ id: "t2", fromPlace: "到保站", toPlace: "起·北京南站" }),
  ])
  assert.deepEqual(stats.places.map((p) => p.name).sort(), ["始兴", "发耳", "到保", "北京南"].sort())
})

test("airports are trimmed exactly and retain Chinese names, markers and terminal suffixes", () => {
  const stats = archiveStatistics([
    trip({ mode: "flight", fromPlace: " 过海国际机场T3 ", toPlace: "航空站" }),
  ])
  assert.deepEqual(stats.places.map((p) => p.name).sort(), ["过海国际机场T3", "航空站"].sort())
})

test("unknown endpoints are skipped and timetable intermediate stops are not counted", () => {
  const stats = archiveStatistics([
    trip({ fromPlace: " ", toPlace: "—", railStops: [{ station: "中间站", arrival: "08:30", departure: "08:31" }] }),
    trip({ id: "t2", fromPlace: "未知", toPlace: "待补全" }),
    trip({ id: "t3", fromPlace: "未识别", toPlace: "?" }),
  ])
  assert.equal(stats.total, 3)
  assert.equal(stats.uniquePlaceCount, 0)
  assert.deepEqual(stats.places, [])
})

test("same rail and flight names remain separate and ties sort independently of input order", () => {
  const records = [
    trip({ fromPlace: "北京南", toPlace: "天津南" }),
    trip({ id: "t2", mode: "flight", fromPlace: "北京南", toPlace: "天津南" }),
  ]
  const forward = archiveStatistics(records)
  assert.deepEqual(forward, archiveStatistics([...records].reverse()))
  assert.equal(forward.uniquePlaceCount, 4)
  assert.deepEqual(forward.places.map((p) => `${p.name}:${p.mode}`), [
    "北京南:flight", "北京南:rail", "天津南:flight", "天津南:rail",
  ])
})

test("edits and deletions recompute totals and ranking without retained state", () => {
  const original = trip()
  const first = archiveStatistics([original])
  const edited = archiveStatistics([{ ...original, durationMin: 120, fromPlace: "上海虹桥" }])
  assert.equal(first.totalMinutes, 60)
  assert.equal(edited.totalMinutes, 120)
  assert.ok(!edited.places.some((p) => p.name === "北京南"))
  assert.ok(edited.places.some((p) => p.name === "上海虹桥"))
  assert.equal(archiveStatistics([]).total, 0)
  edited.places[0].total = 999
  assert.equal(archiveStatistics([original]).places[0].total, 1)
})

test("inputs remain unchanged and records are not silently deduplicated", () => {
  const records = Object.freeze([Object.freeze(trip()), Object.freeze(trip())])
  const stats = archiveStatistics(records)
  assert.equal(stats.total, 2)
  assert.equal(stats.totalMinutes, 120)
  assert.ok(stats.places.every((p) => p.total === 2))
})

test("partial legacy records tolerate missing and malformed fields at the statistics boundary", () => {
  const records = [
    { archivedAt: "2026-01-02" },
    { archivedAt: "2026-01-02", mode: "rail", departTime: null, arriveTime: 123, fromPlace: {}, toPlace: null },
    { archivedAt: "2026-01-02", mode: "flight", durationMin: "60", departTime: {}, arriveTime: [], fromPlace: 123 },
    { archivedAt: "2026-01-02", mode: "totalMinutes", fromPlace: "北京南", toPlace: "天津南" },
  ]
  let stats
  assert.doesNotThrow(() => { stats = archiveStatistics(records) })
  assert.deepEqual(stats, {
    total: 4, rail: 1, flight: 1, totalMinutes: 0, knownDurationCount: 0,
    unknownDurationCount: 4, places: [], uniquePlaceCount: 0,
  })
})

console.log(`Archive statistics: ${count} tests passed`)
