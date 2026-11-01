// NODE_PATH=<node_modules containing esbuild> node trip-reminder/tools/test-station-states.cjs
// Bundle and execute entirely in memory; fixtures are synthetic and never touch Storage on disk.
const assert = require("node:assert/strict")
const path = require("node:path")
const vm = require("node:vm")
const esbuild = require("esbuild")
const root = path.dirname(__dirname)
function load(file, globals = {}) {
  const {outputFiles} = esbuild.buildSync({entryPoints: [path.join(root, file)], bundle: true,
    format: "cjs", platform: "node", write: false})
  const module = {exports: {}}
  vm.runInNewContext(outputFiles[0].text, {module, exports: module.exports, ...globals}, {filename: file})
  return module.exports
}
const P = load("services/parse.ts")
const plain = (value) => JSON.parse(JSON.stringify(value))
const parse = (text, candidates = []) => P.parseTripText(text, new Date("2026-10-01T09:00:00"), "auto", candidates)
const state = P.railStationState
const ticket = "G1234\n乘车站：深圳北\n到达站：香港西九龙\n2026-10-12\n09:00\n09:18"
const stationNames = ["北京南", "天津南", "上海虹桥"]
const expected = ["origin", "intermediate", "terminal"]
const candidate = (content, x, y = 0.58, w = 0.18, h = 0.06) => ({content, x, y, w, h})
const timeBlocks = [candidate("09:00", 0.05, 0.68), candidate("09:18", 0.75, 0.68)]
let count = 0
function test(name, run) { run(); console.log(`✓ ${++count}. ${name}`) }

test("explicit main badges retain all three states across joined, spaced, punctuated and split lines", () => {
  for (const route of [
    "起北京南\n过天津南\n终上海虹桥", "起 北京南\n过 天津南\n终 上海虹桥",
    "起·北京南\n过：天津南\n终、上海虹桥", "起\n北京南\n过\n天津南\n终\n上海虹桥",
    "始 北京南\n过 天津南\n终 上海虹桥", "始\n北京南\n过\n天津南\n终\n上海虹桥",
    "起北京南 过天津南 终上海虹桥",
  ]) {
    const trip = parse(`G1234\n${route}\n09:00\n10:00`)
    assert.deepEqual(stationNames.map((name) => state(trip, name)), expected, route)
    assert.equal(trip.fromPlace, "北京南")
    assert.equal(trip.toPlace, "上海虹桥")
    assert.equal(trip.railStationStates.code, "G1234")
  }
})
test("arrows preserve states without changing passenger route priority", () => {
  for (const separator of ["→", "->", "—", "~", "至", "-"]) {
    for (const [a, b, first, last] of [["起", "过", "origin", "intermediate"], ["过", "终", "intermediate", "terminal"]]) {
      for (const space of ["", " ", "\n"]) {
        const trip = parse(`G1234\n${a}${space}深圳北 ${separator} ${b}${space}香港西九龙\n09:00\n09:18`)
        assert.equal(trip.fromPlace, "深圳北")
        assert.equal(trip.toPlace, "香港西九龙")
        assert.equal(state(trip, "深圳北"), first)
        assert.equal(state(trip, "香港西九龙"), last)
      }
    }
  }
  const explicit = parse(`${ticket}\n起北京南 → 终上海虹桥`)
  assert.equal(explicit.fromPlace, "深圳北")
  assert.equal(explicit.toPlace, "香港西九龙")
  assert.equal(state(explicit, "深圳北"), undefined)
  assert.equal(state(explicit, "北京南"), "origin")
})
test("labeled station badges retain states; only train endpoint labels imply endpoints", () => {
  for (const route of [
    "乘车站：起深圳北\n到达站：终香港西九龙",
    "出发站：起 深圳北\n到达站：终 香港西九龙",
    "乘车站\n起\n深圳北\n到达站\n终\n香港西九龙",
  ]) {
    const trip = parse(`G1234\n${route}`)
    assert.equal(state(trip, "深圳北"), "origin", route)
    assert.equal(state(trip, "香港西九龙"), "terminal", route)
  }
  for (const labels of ["始发站：北京南\n终到站：上海虹桥", "始发站\n北京南\n终到站\n上海虹桥", "始发站 北京南 终到站 上海虹桥"]) {
    const trip = parse(`${ticket}\n${labels}`)
    assert.equal(state(trip, "北京南"), "origin", labels)
    assert.equal(state(trip, "上海虹桥"), "terminal", labels)
    assert.equal(trip.fromPlace, "深圳北")
    assert.equal(trip.toPlace, "香港西九龙")
  }
  for (const labels of ["出发站 北京南\n到达站 上海虹桥", "发 北京南\n到 上海虹桥", "发\n北京南\n到\n上海虹桥"]) {
    const trip = parse(`G1234\n${labels}`)
    assert.equal(trip.railStationStates, undefined, labels)
  }
})
test("train endpoint facts require label boundaries and ignore negated mentions", () => {
  const negatives = ["非始发站：深圳北\n不是终到站：香港西九龙", "说明：非始发站：深圳北；不是终到站：香港西九龙"]
  for (const negation of ["非", "不是", "不 是", "并非", "并 非"]) {
    for (const space of [" ", "  ", "\t", "\n"]) {
      negatives.push(`${negation}${space}始发站：深圳北\n${negation}${space}终到站：香港西九龙`)
    }
  }
  for (const labels of negatives) {
    const trip = parse(`${ticket}\n${labels}`)
    assert.equal(trip.railStationStates, undefined, labels)
    assert.equal(state(trip, "深圳北"), undefined)
    assert.equal(state(trip, "香港西九龙"), undefined)
  }
  const mixed = parse(`${ticket}\n非 始发站：深圳北\n终到站：上海虹桥`)
  assert.equal(state(mixed, "深圳北"), undefined)
  assert.equal(state(mixed, "上海虹桥"), "terminal")
  for (const separator of [" ", "\n", "；", ";", "，", ",", "|"]) {
    const trip = parse(`${ticket}\n始发站：北京南${separator}终到站：上海虹桥`)
    assert.equal(state(trip, "北京南"), "origin")
    assert.equal(state(trip, "上海虹桥"), "terminal")
  }
})
test("passenger interval can be intermediate at both ends", () => {
  for (const route of ["过深圳北 → 过香港西九龙", "乘车站：过深圳北\n到达站：过香港西九龙", "过\n深圳北\n过\n香港西九龙"]) {
    const trip = parse(`G1234\n${route}\n09:00\n09:18`)
    assert.equal(trip.fromPlace, "深圳北")
    assert.equal(trip.toPlace, "香港西九龙")
    assert.equal(state(trip, trip.fromPlace), "intermediate")
    assert.equal(state(trip, trip.toPlace), "intermediate")
  }
})
test("bounded positional blocks accept joined, spaced, punctuated and separate badges", () => {
  for (const separator of ["", " ", "：", "split"]) {
    const blocks = [...timeBlocks]
    for (const [i, badge] of ["起", "过", "终"].entries()) {
      const x = 0.10 + i * 0.30
      if (separator === "split") {
        blocks.push(candidate(badge, x - 0.05, 0.58, 0.03))
        blocks.push(candidate(stationNames[i], x))
      } else blocks.push(candidate(`${badge}${separator}${stationNames[i]}`, x))
    }
    const before = JSON.stringify(blocks)
    const trip = parse("G1234\n09:00\n09:18", blocks)
    assert.deepEqual(stationNames.map((name) => state(trip, name)), expected, separator)
    assert.equal(trip.fromPlace, "北京南")
    assert.equal(trip.toPlace, "上海虹桥")
    assert.equal(JSON.stringify(blocks), before)
    const complete = parse(`${ticket}\n北京南 → 上海虹桥`, blocks)
    assert.deepEqual(stationNames.map((name) => state(complete, name)), expected)
    assert.equal(complete.fromPlace, "深圳北")
  }
})
test("candidate badges must share the station row and remain adjacent", () => {
  const trip = parse(ticket, [...timeBlocks,
    candidate("北京南", 0.10), candidate("上海虹桥", 0.70),
    candidate("起", 0.02, 0.30, 0.03), candidate("终", 0.30, 0.58, 0.03),
    candidate("过天津南", 0.40, 0.10), candidate("起售规则", 0), candidate("终止售票", 0.90),
  ])
  assert.equal(trip.railStationStates, undefined)
  assert.equal(parse(ticket, [candidate("起北京南", 0.10), candidate("终上海虹桥", 0.70)]).railStationStates, undefined)
})
test("timetable badge evidence survives row capture, dwell values, suffixes and midnight", () => {
  for (const table of [
    "1 起北京南站 -- 23:00\n2 过天津南站 23:58 00:02 4分\n3 终上海虹桥站 01:20 --",
    "起 北京南站 -- 23:00\n过 天津南站 23:58 00:02 停留4分\n终 上海虹桥站 01:20 --",
    "起·北京南站 -- 23:00\n过：天津南站 23:58 00:02 4分\n终、上海虹桥站 01:20 --",
    "起\n北京南站\n--\n23:00\n过\n天津南站\n23:58\n00:02\n4分\n终\n上海虹桥站\n01:20\n--",
  ]) {
    const trip = parse(`${ticket}\n时刻表\n${table}`)
    assert.deepEqual(plain(trip.railStops.map((stop) => stop.state)), expected, table)
    assert.deepEqual(stationNames.map((name) => state(trip, name)), expected)
    assert.deepEqual(plain(trip.railStops[1]), {station: "天津南站", arrival: "23:58", departure: "00:02", stopMinutes: 4, state: "intermediate", dayOffset: 0})
    assert.equal(trip.railStops[2].dayOffset, 1)
    assert.equal(trip.fromPlace, "深圳北")
    assert.equal(trip.toPlace, "香港西九龙")
    assert.equal(trip.departTime, "09:00")
    assert.equal(trip.arriveTime, "09:18")
  }
})
test("explicit timetable 始发/终到 slots yield states, missing clocks and boundaries do not", () => {
  const trip = parse(`${ticket}\n时刻表\n北京南 始发 09:00\n天津南 09:08 09:10\n上海虹桥 09:18 终到`)
  assert.equal(state(trip, "北京南"), "origin")
  assert.equal(state(trip, "天津南"), undefined)
  assert.equal(state(trip, "上海虹桥"), "terminal")
  assert.equal(trip.railStops[1].state, undefined)
  for (const table of ["深圳北 -- 09:00\n福田 09:08 09:10\n香港西九龙 09:18 --", "深圳北 09:00 09:00\n香港西九龙 09:18 09:18"]) {
    const cropped = parse(`${ticket}\n时刻表\n${table}`)
    assert.equal(cropped.railStationStates, undefined)
    assert.ok(cropped.railStops.every((stop) => stop.state === undefined))
    assert.equal(state(cropped, "深圳北"), undefined)
    assert.equal(state(cropped, "香港西九龙"), undefined)
  }
})
test("table-only data retains facts without inventing a passenger segment", () => {
  const trip = parse("G1234\n时刻表\n起北京南 -- 09:00\n过天津南 09:08 09:10\n终上海虹桥 09:18 --", [
    ...timeBlocks, candidate("起北京南", 0.10), candidate("终上海虹桥", 0.70),
  ])
  assert.equal(trip.fromPlace, "")
  assert.equal(trip.toPlace, "")
  assert.equal(trip.departTime, "")
  assert.equal(trip.arriveTime, "")
  assert.deepEqual(stationNames.map((name) => state(trip, name)), expected)
  assert.deepEqual(plain(P.railJourneyStops(trip)), [])
})
test("conflicting main, candidate, table and same-row facts stay unknown", () => {
  const cases = [
    parse(`${ticket}\n起深圳北\n过深圳北`),
    parse(`${ticket}\n起深圳北\n时刻表\n过深圳北站 -- 09:00\n香港西九龙 09:18 --`),
    parse(`${ticket}\n起深圳北`, [...timeBlocks, candidate("过深圳北", 0.10)]),
    parse(`${ticket}\n时刻表\n起深圳北 -- 终到\n香港西九龙 09:18 --`),
    parse(`${ticket}\n始发站：过深圳北`),
    parse(`${ticket}\n时刻表\n起深圳北 -- 09:00\n过深圳北站 09:02 09:03`),
  ]
  for (const trip of cases) assert.equal(state(trip, "深圳北站"), undefined)
  assert.equal(cases[3].railStops[0].state, undefined)
  const duplicate = parse(`${ticket}\n过深圳北\n过深圳北站`)
  assert.equal(state(duplicate, "深圳北"), "intermediate")
})
test("lookup requires rail mode and matching train code, then matches station identity", () => {
  const trip = parse(`${ticket}\n起深圳北\n终香港西九龙`)
  const before = JSON.stringify(trip)
  for (const station of ["深圳北", "深圳北站", "过深圳北站", "起 深圳北站"]) assert.equal(state(trip, station), "origin")
  assert.equal(state({...trip, code: "G5678"}, "深圳北"), undefined)
  assert.equal(state({...trip, code: "g1234"}, "深圳北"), undefined)
  assert.equal(state({...trip, mode: "flight"}, "深圳北"), undefined)
  assert.equal(state({...trip, mode: undefined}, "深圳北"), undefined)
  assert.equal(state({...trip, fromPlace: "福田"}, "福田"), undefined)
  assert.equal(state({...trip, fromPlace: "香港西九龙"}, "香港西九龙"), "terminal")
  assert.equal(state(trip, "深圳"), undefined)
  assert.equal(state(trip, ""), undefined)
  assert.equal(JSON.stringify(trip), before)
  const old = {mode: "rail", code: "G1234", fromPlace: "起深圳北", toPlace: "终香港西九龙",
    railStops: [{station: "深圳北", state: "origin"}]}
  assert.equal(state(old, "深圳北"), undefined)
  assert.equal(parse(ticket).railStationStates, undefined)
})
test("malformed optional Storage metadata cannot throw or return an invalid badge", () => {
  const base = {mode: "rail", code: "G1234"}
  for (const railStationStates of [undefined, null, "broken", {},
    ...[undefined, null, "broken", {}, [null], [1], ["深圳北"],
      [{station: null, state: "origin"}], [{station: 12, state: "origin"}],
      [{station: "深圳北"}], [{station: "深圳北", state: "unknown"}],
      [{station: "深圳北", state: null}],
    ].map((stations) => ({code: "G1234", stations})),
  ]) assert.equal(state({...base, railStationStates}, "深圳北"), undefined)
  const mixed = {code: "G1234", stations: [null, {station: 12}, {station: "深圳北", state: "intermediate"}]}
  assert.equal(state({...base, railStationStates: mixed}, "深圳北"), "intermediate")
  mixed.stations.push({station: "深圳北站", state: "unknown"})
  assert.equal(state({...base, railStationStates: mixed}, "深圳北"), undefined)
})
test("bare 始兴 发耳 到保 remain names across main, candidate and table sources", () => {
  for (const station of ["始兴", "发耳", "到保"]) {
    const trip = parse(`G1234\n${station}站 → 香港西九龙\n09:00\n09:18\n时刻表\n${station}站 -- 09:00\n香港西九龙 09:18 --`)
    assert.equal(trip.fromPlace, station)
    assert.equal(trip.railStops[0].station, `${station}站`)
    assert.equal(trip.railStationStates, undefined)
    assert.equal(state(trip, station), undefined)
    const blocks = [...timeBlocks, candidate(station, 0.10), candidate("香港西九龙", 0.70)]
    const positional = parse("G1234\n09:00\n09:18", blocks)
    assert.equal(positional.fromPlace, station)
    assert.equal(positional.railStationStates, undefined)
    const marked = parse(`G1234\n起${station} → 终香港西九龙`)
    assert.equal(marked.fromPlace, station)
    assert.equal(state(marked, station), "origin")
  }
})
test("non-station labels and damaged table rows never become state facts", () => {
  const trip = parse(`${ticket}\n起售规则\n终止检票\n起\n售规则\n过售票信息\n时刻表\n起售规则 08:00 08:01\n终止售票 08:02 08:03\n起北京南 29:00 09:00\n终上海虹桥 10:00 ???`)
  assert.equal(trip.railStationStates, undefined)
  assert.equal(trip.railStops, undefined)
  const flight = parse("CA1234\n起航机场 → 终航机场\n09:00\n10:20\n时刻表\n起北京南 -- 09:00\n终上海虹桥 10:20 --")
  assert.equal(flight.mode, "flight")
  assert.equal(flight.railStationStates, undefined)
  assert.equal(flight.railStops, undefined)
  assert.equal(flight.fromPlace, "起航机场")
})
test("spread saves, upserts and archive retain metadata and original raw OCR notes", () => {
  const stored = new Map()
  const T = load("services/trips.ts", {
    Storage: {get: (key) => stored.has(key) ? plain(stored.get(key)) : undefined,
      set: (key, value) => { stored.set(key, plain(value)); return true }},
    Widget: {reloadAll() {}},
  })
  const raw = `${ticket}\n过深圳北\n过香港西九龙`
  const record = {...parse(raw), id: "synthetic", note: raw, createdAt: "2026-10-01T00:00:00Z"}
  const facts = plain(record.railStationStates)
  T.upsertTrip(record)
  T.upsertTrip({...record, gate: "3B"})
  T.archiveTrip(record.id)
  const saved = T.listTrips().find((trip) => trip.id === record.id)
  assert.deepEqual(plain(saved.railStationStates), facts)
  assert.equal(saved.note, raw)
  assert.equal(record.note, raw)
  assert.equal(P.normalizeOCR(raw), raw.replace(/：/g, ":"))
  assert.equal(state(saved, "深圳北"), "intermediate")
})
console.log(`Station state assertions passed: ${count} groups`)
