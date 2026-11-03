// Offline synthetic-data tests; NODE_PATH=<node_modules with esbuild> node tools/test-statistics.cjs
const assert = require("node:assert/strict")
const path = require("node:path")
const Module = require("node:module")
const esbuild = require("esbuild")
const entry = path.join(__dirname, "../services/statistics.ts")
const bundle = esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false })
const compiled = new Module(entry, module)
compiled._compile(bundle.outputFiles[0].text, entry)
const { archiveStatistics, archiveInsights, archiveTrendBreakdown } = compiled.exports

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

test("insights return the exact empty contract with the original summary shape", () => {
  assert.deepEqual(archiveInsights([]), {
    summary: archiveStatistics([]), years: [], selectedYear: null, selectedMode: "all",
    months: [], routes: [], averageMinutes: null, longest: null, activeDays: 0,
    invalidDateCount: 0, missingRouteCount: 0,
  })
})

test("year and mode combinations keep all archived year choices stable", () => {
  const records = [
    trip({ id: "r24", departDate: "2024-02-29", archivedAt: "2026-01-02" }),
    trip({ id: "f25", mode: "flight", departDate: "2025-12-31" }),
    trip({ id: "r26", departDate: "2026-01-01" }),
    trip({ id: "unknown", mode: "legacy", departDate: "2025-06-01" }),
    trip({ id: "undated", departDate: "" }),
    trip({ id: "future", mode: "flight", departDate: "2099-04-03" }),
    trip({ id: "active", departDate: "2100-01-01", archivedAt: undefined }),
  ]
  for (const [filter, expectedTotal] of [
    [{}, 6], [{ mode: "all" }, 6], [{ mode: "rail" }, 3], [{ mode: "flight" }, 2],
    [{ year: 2025 }, 2], [{ year: 2025, mode: "rail" }, 0], [{ year: 2025, mode: "flight" }, 1],
    [{ year: 2024, mode: "rail" }, 1], [{ year: 2099, mode: "flight" }, 1], [{ year: 2050 }, 0],
  ]) {
    const insights = archiveInsights(records, filter)
    assert.equal(insights.summary.total, expectedTotal, JSON.stringify(filter))
    assert.deepEqual(insights.years, [2099, 2026, 2025, 2024])
    assert.equal(insights.selectedYear, filter.year ?? null)
    assert.equal(insights.selectedMode, filter.mode ?? "all")
  }
  assert.equal(archiveInsights(records, { year: 2024 }).summary.total, 1)
  assert.equal(archiveInsights(records, { year: 2026 }).summary.total, 1)
})

test("strict local calendar validation accepts leap days and rejects rollover or malformed dates", () => {
  const invalid = ["2025-02-29", "2024-02-30", "2026-04-31", "2026-00-10", "2026-13-01",
    "2026-01-00", "2026-01-32", "2026-1-01", " 2026-01-01", "2026-01-01T08:00:00", "", null, 20260101]
  const records = [trip({ departDate: "2024-02-29" }), trip({ departDate: "2000-02-29" }),
    trip({ departDate: "1900-02-29" }), ...invalid.map((departDate) => trip({ departDate }))]
  const insights = archiveInsights(records)
  assert.deepEqual(insights.years, [2024, 2000])
  assert.equal(insights.activeDays, 2)
  assert.equal(insights.invalidDateCount, invalid.length + 1)
  assert.equal(insights.summary.total, records.length)
  assert.equal(archiveInsights(records, { year: 2025 }).summary.total, 0)
  assert.equal(archiveInsights(records, { year: 2024 }).invalidDateCount, 0)
  assert.equal(archiveInsights([trip({ departDate: "0096-02-29" })], { year: 96 }).summary.total, 1)
})

test("invalid dates are counted only within the selected mode and never included in year filters", () => {
  const records = [trip({ departDate: "bad" }), trip({ mode: "flight", departDate: undefined }),
    trip({ mode: "legacy", departDate: "2025-02-29" }), trip()]
  assert.equal(archiveInsights(records).invalidDateCount, 3)
  assert.equal(archiveInsights(records, { mode: "rail" }).invalidDateCount, 1)
  assert.equal(archiveInsights(records, { mode: "flight" }).invalidDateCount, 1)
  assert.equal(archiveInsights(records, { year: 2026 }).invalidDateCount, 0)
  assert.equal(archiveInsights(records, { year: 2026 }).summary.total, 1)
})

test("selected years provide all twelve months including empty and future manual archives", () => {
  const records = [trip({ departDate: "2099-01-01", durationMin: 30 }),
    trip({ mode: "flight", departDate: "2099-03-02", durationMin: 120 }),
    trip({ departDate: "2098-12-31", durationMin: 999 })]
  const insights = archiveInsights(records, { year: 2099 })
  assert.equal(insights.months.length, 12)
  assert.deepEqual(insights.months.map((m) => m.month), Array.from({ length: 12 }, (_, i) => `2099-${String(i + 1).padStart(2, "0")}`))
  assert.deepEqual(insights.months[0], { month: "2099-01", total: 1, rail: 1, flight: 0, totalMinutes: 30 })
  assert.deepEqual(insights.months[1], { month: "2099-02", total: 0, rail: 0, flight: 0, totalMinutes: 0 })
  assert.deepEqual(insights.months[2], { month: "2099-03", total: 1, rail: 0, flight: 1, totalMinutes: 120 })
  assert.equal(archiveInsights([], { year: 2050 }).months.length, 12)
})

test("all-years months form a continuous cross-year window while summary retains older and undated trips", () => {
  const records = [
    trip({ departDate: "2024-03-31", durationMin: 10 }),
    trip({ departDate: "2024-04-01", durationMin: 20 }),
    trip({ departDate: "2024-12-31", durationMin: 30 }),
    trip({ mode: "flight", departDate: "2025-03-01", durationMin: 40 }),
    trip({ departDate: "invalid", durationMin: 50 }),
  ]
  const insights = archiveInsights(records)
  assert.equal(insights.months.length, 12)
  assert.deepEqual(insights.months.map((m) => m.month), ["2024-04", "2024-05", "2024-06", "2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03"])
  assert.equal(insights.months.reduce((n, m) => n + m.total, 0), 3)
  assert.equal(insights.months.reduce((n, m) => n + m.totalMinutes, 0), 90)
  assert.equal(insights.summary.total, 5)
  assert.equal(insights.summary.totalMinutes, 150)
  assert.equal(archiveInsights(records, { mode: "rail" }).months.at(-1).month, "2024-12")
})

test("month windows use matching data and do not read the current clock", () => {
  const RealDate = global.Date
  global.Date = class extends RealDate {
    constructor(...args) {
      assert.ok(args.length > 0, "current date must not be read")
      super(...args)
    }
    static now() { throw new Error("current time must not be read") }
  }
  try {
    const insights = archiveInsights([trip({ departDate: "1998-01-05" })])
    assert.equal(insights.months[0].month, "1997-02")
    assert.equal(insights.months.at(-1).month, "1998-01")
    assert.deepEqual(archiveInsights([trip({ departDate: "1998-01-05" })], { trendMonths: 3 }).months.map(m => m.month), ["1997-11", "1997-12", "1998-01"])
    assert.deepEqual(archiveInsights([trip({ departDate: "bad" })]).months, [])
    assert.deepEqual(archiveInsights([trip()], { mode: "flight" }).months, [])
  } finally {
    global.Date = RealDate
  }
})

test("legacy unknown modes contribute to totals and months without entering typed buckets or routes", () => {
  const insights = archiveInsights([trip({ mode: "totalMinutes" }), trip({ mode: "legacy", departDate: "bad" })])
  assert.deepEqual([insights.summary.total, insights.summary.rail, insights.summary.flight, insights.summary.totalMinutes], [2, 0, 0, 120])
  assert.deepEqual(insights.months.at(-1), { month: "2026-01", total: 1, rail: 0, flight: 0, totalMinutes: 60 })
  assert.deepEqual(insights.routes, [])
  assert.equal(insights.missingRouteCount, 0)
  assert.equal(insights.activeDays, 1)
})

test("routes normalize exact endpoints, retain direction and mode, and track known durations", () => {
  const records = [
    trip({ fromPlace: " 过 北京南站 ", toPlace: "终·天津南站", durationMin: 40 }),
    trip({ id: "r2", fromPlace: "北京南", toPlace: "天津南", durationMin: 0, departTime: "", arriveTime: "" }),
    trip({ id: "reverse", fromPlace: "天津南站", toPlace: "北京南站", durationMin: 50 }),
    trip({ id: "flight", mode: "flight", fromPlace: " 北京南 ", toPlace: "天津南", durationMin: 60 }),
    trip({ id: "nearby", fromPlace: "北京站", toPlace: "天津南站", durationMin: 70 }),
    trip({ id: "terminal", mode: "flight", fromPlace: "北京南T3", toPlace: "天津南", durationMin: 80 }),
  ]
  const insights = archiveInsights(records)
  assert.equal(insights.routes.length, 5)
  assert.deepEqual(insights.routes[0], { mode: "rail", from: "北京南", to: "天津南", total: 2, totalMinutes: 40, knownDurationCount: 1 })
  assert.ok(insights.routes.some((r) => r.from === "天津南" && r.to === "北京南" && r.total === 1))
  assert.ok(insights.routes.some((r) => r.mode === "flight" && r.from === "北京南"))
  assert.ok(insights.routes.some((r) => r.from === "北京"))
  assert.ok(insights.routes.some((r) => r.from === "北京南T3"))
  assert.deepEqual(insights.routes, archiveInsights([...records].reverse()).routes)
})

test("route ties sort by from then to then mode independent of input order", () => {
  const records = [trip({ fromPlace: "B", toPlace: "A" }), trip({ fromPlace: "A", toPlace: "B" }),
    trip({ mode: "flight", fromPlace: "A", toPlace: "A" }), trip({ fromPlace: "A", toPlace: "A" })]
  const routes = archiveInsights(records).routes
  assert.deepEqual(routes.map((r) => `${r.from}:${r.to}:${r.mode}`), ["A:A:flight", "A:A:rail", "A:B:rail", "B:A:rail"])
  assert.deepEqual(routes, archiveInsights([...records].reverse()).routes)
})

test("missing routes count valid modes with either absent or placeholder endpoint once", () => {
  const insights = archiveInsights([
    trip({ fromPlace: "未知" }), trip({ toPlace: "—" }), trip({ fromPlace: null, toPlace: {} }),
    trip({ mode: "flight", fromPlace: "待补全", toPlace: "?" }),
    trip({ mode: "legacy", fromPlace: "", toPlace: "" }),
    trip({ fromPlace: "始兴站", toPlace: "到保站" }),
  ])
  assert.equal(insights.missingRouteCount, 4)
  assert.equal(insights.routes.length, 1)
  assert.deepEqual([insights.routes[0].from, insights.routes[0].to], ["始兴", "到保"])
})

test("longest and rounded average exclude unknown durations and break duration ties by id", () => {
  const records = [trip({ id: "z", durationMin: 61 }), trip({ id: "a", durationMin: 61, code: "G1" }),
    trip({ id: "short", durationMin: 60 }),
    trip({ id: "unknown", durationMin: 0, departTime: "", arriveTime: "" })]
  const insights = archiveInsights(records)
  assert.equal(insights.averageMinutes, 61)
  assert.deepEqual(insights.longest, { id: "a", code: "G1", from: "北京南", to: "天津南", minutes: 61 })
  assert.deepEqual(insights.longest, archiveInsights([...records].reverse()).longest)
  const unknown = archiveInsights([records.at(-1)])
  assert.equal(unknown.averageMinutes, null)
  assert.equal(unknown.longest, null)
})

test("insights reuse duration fallback including overnight and explicit multi-day trips", () => {
  const insights = archiveInsights([
    trip({ id: "night", durationMin: NaN, departTime: "23:40", arriveTime: "00:20" }),
    trip({ id: "multi", durationMin: 2955 }),
    trip({ id: "bad", durationMin: Infinity, departTime: {}, arriveTime: [] }),
  ])
  assert.equal(insights.summary.totalMinutes, 2995)
  assert.equal(insights.longest.minutes, 2955)
  assert.equal(insights.averageMinutes, 1498)
  assert.equal(insights.routes[0].totalMinutes, 2995)
  assert.equal(insights.routes[0].knownDurationCount, 2)
})

test("active days count unique strict departure dates within the filter", () => {
  const records = [trip(), trip({ mode: "flight" }), trip({ departDate: "2026-01-02" }),
    trip({ mode: "flight", departDate: "2025-01-01" }), trip({ departDate: "2026-02-30" })]
  assert.equal(archiveInsights(records).activeDays, 3)
  assert.equal(archiveInsights(records, { year: 2026 }).activeDays, 2)
  assert.equal(archiveInsights(records, { year: 2026, mode: "flight" }).activeDays, 1)
})

test("insights tolerate partial malformed legacy fields including longest labels", () => {
  const records = [{ archivedAt: "yes" },
    { archivedAt: "yes", mode: "rail", fromPlace: {}, toPlace: null, departDate: [] },
    { archivedAt: "yes", mode: "flight", durationMin: "60", departTime: 42, arriveTime: {}, departDate: {} },
    { archivedAt: "yes", durationMin: 90, id: {}, code: 12, fromPlace: false, toPlace: [] }]
  const insights = archiveInsights(records)
  assert.equal(insights.summary.total, 4)
  assert.equal(insights.invalidDateCount, 4)
  assert.equal(insights.missingRouteCount, 2)
  assert.deepEqual(insights.longest, { id: "", code: "", from: "", to: "", minutes: 90 })
  assert.equal(insights.averageMinutes, 90)
  assert.deepEqual(insights.months, [])
})

test("insights preserve frozen inputs and recompute after edits and deletions without retained output state", () => {
  const original = Object.freeze(trip())
  const records = Object.freeze([original, original])
  const first = archiveInsights(records)
  assert.equal(first.summary.total, 2)
  assert.equal(first.routes[0].total, 2)
  const edited = archiveInsights([{ ...original, durationMin: 120, fromPlace: "上海虹桥", departDate: "2027-02-01" }])
  assert.equal(edited.summary.totalMinutes, 120)
  assert.deepEqual(edited.years, [2027])
  assert.equal(edited.longest.from, "上海虹桥")
  assert.equal(edited.months.at(-1).month, "2027-02")
  first.routes[0].total = 999
  first.months.at(-1).total = 999
  first.longest.minutes = 999
  first.summary.places[0].total = 999
  assert.equal(archiveInsights(records).routes[0].total, 2)
  assert.equal(archiveInsights(records).months.at(-1).total, 2)
  assert.equal(archiveInsights(records).longest.minutes, 60)
  assert.deepEqual(archiveInsights([]), {
    summary: archiveStatistics([]), years: [], selectedYear: null, selectedMode: "all",
    months: [], routes: [], averageMinutes: null, longest: null, activeDays: 0,
    invalidDateCount: 0, missingRouteCount: 0,
  })
})

test("three-month windows cross years and preserve every non-chart insight", () => {
  const records = [trip({ departDate: "2024-10-01" }), trip({ departDate: "2024-12-01" }),
    trip({ mode: "flight", departDate: "2025-01-01" }), trip({ departDate: "bad" })]
  const original = archiveInsights(records)
  const recent = archiveInsights(records, { trendMonths: 3 })
  assert.deepEqual(recent.months.map(m => [m.month, m.total]), [["2024-11", 0], ["2024-12", 1], ["2025-01", 1]])
  assert.deepEqual({ ...recent, months: original.months }, original)
  assert.deepEqual(archiveInsights(records, { trendMonths: 12 }), original)
})

test("three-month windows anchor within the chosen mode and clip at the selected year", () => {
  const records = [trip({ departDate: "2024-12-01" }), trip({ departDate: "2025-01-01" }),
    trip({ mode: "flight", departDate: "2025-02-01" }), trip({ mode: "flight", departDate: "2025-05-01" })]
  assert.deepEqual(archiveInsights(records, { trendMonths: 3, mode: "rail" }).months.map(m => m.month), ["2024-11", "2024-12", "2025-01"])
  const january = archiveInsights(records, { trendMonths: 3, year: 2025, mode: "rail" })
  assert.deepEqual(january.months.map(m => [m.month, m.total]), [["2025-01", 1]])
  const february = archiveInsights(records.slice(0, 3), { trendMonths: 3, year: 2025 })
  assert.deepEqual(february.months.map(m => [m.month, m.total]), [["2025-01", 1], ["2025-02", 1]])
  assert.deepEqual(archiveInsights(records, { trendMonths: 3, year: 2025, mode: "flight" }).months.map(m => m.month), ["2025-03", "2025-04", "2025-05"])
})

test("three-month windows are empty without matching valid dates and clamp year zero", () => {
  for (const [records, filter] of [[[], {}], [[trip({ departDate: "bad" })], {}], [[trip()], { year: 2050 }], [[trip()], { mode: "flight" }]]) {
    assert.deepEqual(archiveInsights(records, { ...filter, trendMonths: 3 }).months, [])
  }
  assert.deepEqual(archiveInsights([trip({ departDate: "0000-01-01" })], { trendMonths: 3 }).months.map(m => m.month), ["0000-01"])
})

test("breakdown dimensions use actual endpoints and code, retaining exact station and mode identities", () => {
  const records = [
    trip({ fromPlace: " 过 北京南站 ", toPlace: "终·天津南站", code: " g 1234 " }),
    trip({ fromPlace: "北京南", toPlace: "天津南", code: "G1234" }),
    trip({ mode: "flight", fromPlace: " 北京南 ", toPlace: "过海国际机场T3", code: " ca 1234 " }),
    trip({ fromPlace: "始兴站", toPlace: "到保站", code: "D1" }),
    trip({ archivedAt: undefined, fromPlace: "忽略", toPlace: "忽略", code: "IGNORE" }),
  ]
  const departure = archiveTrendBreakdown(records)
  assert.equal(departure.dimension, "departure")
  assert.deepEqual(departure.series, [
    { key: "rail:北京南", label: "北京南 · 火车", total: 2 },
    { key: "flight:北京南", label: "北京南 · 航班", total: 1 },
    { key: "rail:始兴", label: "始兴 · 火车", total: 1 },
  ])
  assert.deepEqual(archiveTrendBreakdown(records, {}, "arrival").series, [
    { key: "rail:天津南", label: "天津南 · 火车", total: 2 },
    { key: "rail:到保", label: "到保 · 火车", total: 1 },
    { key: "flight:过海国际机场T3", label: "过海国际机场T3 · 航班", total: 1 },
  ])
  assert.deepEqual(archiveTrendBreakdown(records, {}, "code").series, [
    { key: "rail:G1234", label: "G1234 · 火车", total: 2 },
    { key: "flight:CA1234", label: "CA1234 · 航班", total: 1 },
    { key: "rail:D1", label: "D1 · 火车", total: 1 },
  ])
  const sameCode = archiveTrendBreakdown([trip({ code: " g1 " }), trip({ mode: "flight", code: "G1" })], {}, "code")
  assert.deepEqual(sameCode.series.map(s => s.key), ["flight:G1", "rail:G1"])
  assert.deepEqual(departure, archiveTrendBreakdown([...records].reverse()))
})

test("breakdown retains top four plus other and unknown with exact month and series sums", () => {
  const records = ["A", "A", "A", "B", "B", "C", "D", "E", "F"].map((fromPlace, i) =>
    trip({ fromPlace, departDate: i % 2 ? "2026-01-01" : "2025-12-01" }))
  records.push(trip({ fromPlace: "未知" }), trip({ mode: "legacy", fromPlace: "A" }),
    trip({ mode: "totalMinutes", fromPlace: "B" }), trip({ fromPlace: {} }),
    trip({ departDate: "2026-02-30", fromPlace: "INVALID" }))
  const result = archiveTrendBreakdown(records, { trendMonths: 3 })
  assert.deepEqual(result.series, [
    { key: "rail:A", label: "A · 火车", total: 3 },
    { key: "rail:B", label: "B · 火车", total: 2 },
    { key: "rail:C", label: "C · 火车", total: 1 },
    { key: "rail:D", label: "D · 火车", total: 1 },
    { key: "other", label: "其他", total: 2 },
    { key: "unknown", label: "未填出发站", total: 4 },
  ])
  assert.deepEqual(result, archiveTrendBreakdown([...records].reverse(), { trendMonths: 3 }))
  assert.deepEqual(result.months.map(m => [m.month, m.total]), archiveInsights(records, { trendMonths: 3 }).months.map(m => [m.month, m.total]))
  for (const month of result.months) {
    assert.equal(month.segments.reduce((sum, segment) => sum + segment.count, 0), month.total)
    assert.deepEqual(month.segments.map(s => s.key), result.series.filter(s => month.segments.some(segment => segment.key === s.key)).map(s => s.key))
  }
  for (const series of result.series) {
    assert.equal(result.months.reduce((sum, month) => sum + (month.segments.find(s => s.key === series.key)?.count ?? 0), 0), series.total)
  }
  assert.deepEqual(result.months[0], { month: "2025-11", total: 0, segments: [] })
  assert.ok(!archiveTrendBreakdown(records.slice(0, 7)).series.some(s => s.key === "other"))
})

test("unknown fields and legacy modes always have a dedicated dimension-specific bucket", () => {
  const records = [trip({ fromPlace: "—", toPlace: "未知", code: "?" }),
    trip({ fromPlace: null, toPlace: {}, code: 42 }),
    trip({ mode: "legacy", fromPlace: "北京南", toPlace: "天津南", code: "G1234" })]
  for (const [dimension, label] of [["departure", "未填出发站"], ["arrival", "未填到达站"], ["code", "未填车次或航班号"]]) {
    const result = archiveTrendBreakdown(records, {}, dimension)
    assert.deepEqual(result.series, [{ key: "unknown", label, total: 3 }])
    assert.deepEqual(result.months.at(-1).segments, [{ key: "unknown", count: 3 }])
    assert.equal(archiveTrendBreakdown(records, { mode: "rail" }, dimension).series[0].total, 2)
  }
})

test("breakdown windows match insights across year, mode, three and twelve months without changing summary", () => {
  const records = [trip({ departDate: "2024-10-01", fromPlace: "OLD" }),
    trip({ departDate: "2024-12-01", fromPlace: "DEC" }),
    trip({ departDate: "2025-01-01", fromPlace: "JAN" }),
    trip({ mode: "flight", departDate: "2025-02-01", fromPlace: "FEB" }),
    trip({ mode: "flight", departDate: "2025-05-01", fromPlace: "MAY" }),
    trip({ departDate: "bad", fromPlace: "UNDATED" })]
  const baseline = archiveInsights(records)
  for (const year of [undefined, 2024, 2025, 2050]) {
    for (const mode of ["all", "rail", "flight"]) {
      for (const trendMonths of [3, 12]) {
        const filter = { year, mode, trendMonths }
        const insights = archiveInsights(records, filter)
        for (const dimension of ["departure", "arrival", "code"]) {
          const result = archiveTrendBreakdown(records, filter, dimension)
          assert.deepEqual(result.months.map(m => [m.month, m.total]), insights.months.map(m => [m.month, m.total]))
          assert.equal(result.series.reduce((sum, s) => sum + s.total, 0), insights.months.reduce((sum, m) => sum + m.total, 0))
        }
        assert.deepEqual(insights.summary, archiveInsights(records, { year, mode }).summary)
      }
    }
  }
  assert.deepEqual(archiveInsights(records), baseline)
  assert.deepEqual(archiveTrendBreakdown(records), archiveTrendBreakdown(records, { trendMonths: 12 }))
  assert.deepEqual(archiveTrendBreakdown(records, { trendMonths: 3 }).months.map(m => m.month), ["2025-03", "2025-04", "2025-05"])
  assert.deepEqual(archiveTrendBreakdown(records, { year: 2025, mode: "rail", trendMonths: 3 }).months.map(m => m.month), ["2025-01"])
  assert.deepEqual(archiveTrendBreakdown(records, { trendMonths: 3 }).series.map(s => s.key), ["flight:MAY"])
})

test("breakdown empty and strict date windows preserve zero months and never read the current clock", () => {
  const RealDate = global.Date
  global.Date = class extends RealDate {
    constructor(...args) { assert.ok(args.length > 0); super(...args) }
    static now() { throw new Error("current time must not be read") }
  }
  try {
    assert.deepEqual(archiveTrendBreakdown([]), { dimension: "departure", months: [], series: [] })
    for (const records of [[], [trip({ departDate: "2025-02-29" })], [trip({ departDate: null })], [trip({ departDate: "2026-1-01" })]]) {
      assert.deepEqual(archiveTrendBreakdown(records).series, [])
      assert.deepEqual(archiveTrendBreakdown(records).months, [])
      assert.deepEqual(archiveTrendBreakdown(records, { year: 2050, trendMonths: 3 }).months, [])
    }
    const emptyYear = archiveTrendBreakdown([], { year: 2050 })
    assert.equal(emptyYear.months.length, 12)
    assert.ok(emptyYear.months.every(m => m.total === 0 && m.segments.length === 0))
    assert.deepEqual(emptyYear.series, [])
    for (const departDate of ["0096-02-29", "0000-01-01", "2024-02-29"]) {
      const records = [trip({ departDate })]
      assert.deepEqual(archiveTrendBreakdown(records, { trendMonths: 3 }).months.map(m => [m.month, m.total]), archiveInsights(records, { trendMonths: 3 }).months.map(m => [m.month, m.total]))
    }
  } finally { global.Date = RealDate }
})

test("breakdown recomputes edits deletions and latest month without mutating or retaining state", () => {
  const original = Object.freeze(trip())
  const latest = Object.freeze(trip({ departDate: "2026-05-01", fromPlace: "上海虹桥", code: "D2" }))
  const records = Object.freeze([original, original, latest])
  const before = JSON.stringify(records)
  const first = archiveTrendBreakdown(records, { trendMonths: 3 })
  assert.equal(first.months.at(-1).month, "2026-05")
  assert.deepEqual(first.series.map(s => s.key), ["rail:上海虹桥"])
  const deleted = archiveTrendBreakdown(records.slice(0, 2), { trendMonths: 3 })
  assert.equal(deleted.months.at(-1).month, "2026-01")
  assert.equal(deleted.series[0].total, 2)
  const edited = archiveTrendBreakdown([{ ...original, fromPlace: "南京南", departDate: "2027-02-01", code: "D3" }])
  assert.equal(edited.series[0].key, "rail:南京南")
  assert.equal(edited.months.at(-1).month, "2027-02")
  first.series[0].total = 999
  first.months.at(-1).segments[0].count = 999
  first.months.at(-1).total = 999
  assert.equal(archiveTrendBreakdown(records, { trendMonths: 3 }).series[0].total, 1)
  assert.equal(archiveTrendBreakdown(records, { trendMonths: 3 }).months.at(-1).segments[0].count, 1)
  assert.equal(JSON.stringify(records), before)
  assert.deepEqual(archiveTrendBreakdown([]).series, [])
})

console.log(`Archive statistics: ${count} tests passed`)
