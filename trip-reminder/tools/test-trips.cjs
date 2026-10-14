// Offline service regression tests; fixtures contain no real travel data.
// NODE_PATH=<node_modules containing esbuild> node tools/test-trips.cjs
const assert = require("node:assert/strict")
const path = require("node:path")
const Module = require("node:module")
const esbuild = require("esbuild")
const filename = path.join(__dirname, "trips-test.bundle.cjs")
const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, "../services/trips.ts")],
  bundle: true, platform: "node", format: "cjs", write: false,
})
const bundled = new Module(filename, module)
bundled.filename = filename
bundled.paths = module.paths
bundled._compile(result.outputFiles[0].text, filename)
const T = bundled.exports
let values, writes, reloads, failRead, failWrite
function reset(records = []) {
  values = new Map([["rail.trips", records]])
  writes = 0; reloads = 0; failRead = false; failWrite = ""
  global.Storage = {
    get(key) { if (failRead) throw Error("read failed"); return values.get(key) ?? null },
    set(key, value) {
      writes++
      if (failWrite === "throw") throw Error("write failed")
      if (failWrite === "false") return false
      values.set(key, value)
      return true
    },
  }
  global.Widget = { reloadAll() { reloads++ } }
}
const time = (s) => new Date(s).getTime()
const trip = (id, extra = {}) => ({
  id, mode: "rail", code: "G1234", departDate: "2026-10-12", departTime: "08:00",
  arriveTime: "10:00", durationMin: 120, seatCar: "08", seatNo: "12A", seatClass: "二等座",
  passenger: "测试", note: "keep note", createdAt: "2026-10-01T00:00:00.000Z", ...extra,
})
let count = 0
function test(name, run) { run(); console.log(`✓ ${++count}. ${name}`) }
test("arrival boundary, preserved fields, idempotence, no widget reload", () => {
  const original = trip("ended", { gate: "6A", custom: { keep: true } })
  reset([original])
  const end = time("2026-10-12T10:00:00")
  assert.equal(T.listTrips(end - 1)[0].archivedAt, undefined)
  assert.equal(writes, 0)
  const archived = T.listTrips(end)[0]
  assert.deepEqual(archived, { ...original, archivedAt: new Date(end).toISOString() })
  assert.equal(original.archivedAt, undefined)
  assert.equal(writes, 1)
  assert.equal(reloads, 0)
  assert.equal(T.listTrips(end + 1000)[0].archivedAt, archived.archivedAt)
  assert.equal(writes, 1)
})
test("overnight arrival and explicit multi-day duration", () => {
  reset([trip("overnight", { departTime: "23:30", arriveTime: "01:15", durationMin: 0 })])
  assert.equal(T.listTrips(time("2026-10-13T01:14:59"))[0].archivedAt, undefined)
  assert.ok(T.listTrips(time("2026-10-13T01:15:00"))[0].archivedAt)
  reset([trip("long", { departTime: "23:00", arriveTime: "01:00", durationMin: 1560 })])
  assert.equal(T.listTrips(time("2026-10-13T23:59:59"))[0].archivedAt, undefined)
  assert.ok(T.listTrips(time("2026-10-14T01:00:00"))[0].archivedAt)
})
test("unknown duration keeps trip until next local midnight", () => {
  for (const arriveTime of ["", "08:00", "99:99"]) {
    reset([trip("unknown", { arriveTime, durationMin: 0 })])
    assert.equal(T.listTrips(time("2026-10-12T23:59:59"))[0].archivedAt, undefined)
    assert.equal(T.nextTrip(time("2026-10-12T12:00:00")).id, "unknown")
    assert.ok(T.listTrips(time("2026-10-13T00:00:00"))[0].archivedAt)
  }
})
test("invalid and incomplete timestamps remain unarchived", () => {
  reset([
    trip("missing-date", { departDate: "" }), trip("missing-time", { departTime: "" }),
    trip("bad-date", { departDate: "2026-02-30" }), trip("bad-time", { departTime: "25:00" }),
    trip("bad-text", { departDate: "invalid" }),
  ])
  assert.ok(T.listTrips(time("2027-01-01T00:00:00")).every((t) => !t.archivedAt))
  assert.equal(T.nextTrip(time("2027-01-01T00:00:00")), null)
  assert.equal(writes, 0)
})
test("manual archives stay intact and nextTrip excludes ended trips", () => {
  const manual = trip("manual", { archivedAt: "2026-10-01T00:00:00.000Z" })
  reset([trip("future", { departTime: "14:00", arriveTime: "16:00" }), manual,
    trip("ended", { departTime: "06:00", arriveTime: "08:00" }), trip("ongoing")])
  const now = time("2026-10-12T09:00:00")
  assert.equal(T.nextTrip(now).id, "ongoing")
  assert.deepEqual(T.listTrips(now).find((t) => t.id === "manual"), manual)
  assert.equal(T.nextTrip(time("2026-10-12T11:00:00")).id, "future")
  assert.equal(T.nextTrip(time("2026-10-12T16:00:00")), null)
})
test("failed archive persistence still excludes ended trips and retries", () => {
  for (const failure of ["false", "throw"]) {
    const original = trip("ended")
    reset([original]); failWrite = failure
    const now = time("2026-10-12T10:00:00")
    assert.ok(T.listTrips(now)[0].archivedAt)
    assert.equal(original.archivedAt, undefined)
    assert.equal(T.nextTrip(now), null)
    assert.equal(writes, 2)
    failWrite = ""
    assert.ok(T.listTrips(now)[0].archivedAt)
    assert.equal(writes, 3)
    assert.equal(reloads, 0)
  }
  reset(); failRead = true
  assert.deepEqual(T.listTrips(), [])
  assert.equal(T.nextTrip(), null)
})
test("seat preference persists, reloads widgets, retains class and original fields", () => {
  reset()
  const rail = trip("seat")
  assert.equal(T.getHideSeatNumber(), false)
  assert.equal(T.displaySeat(rail), "08车12A 二等座")
  T.setHideSeatNumber(true)
  assert.equal(values.get("rail.hideSeatNumber"), true)
  assert.equal(T.getHideSeatNumber(), true)
  assert.equal(T.displaySeat(rail), "二等座")
  assert.equal(T.displaySeat({ ...rail, mode: "flight", seatClass: "经济舱" }), "经济舱")
  assert.equal(T.displaySeat({ ...rail, seatClass: "" }), "—")
  assert.equal(T.displaySeat(rail, false), "08车12A 二等座")
  assert.equal(rail.seatCar, "08"); assert.equal(rail.seatNo, "12A")
  T.setHideSeatNumber(false)
  assert.equal(T.getHideSeatNumber(), false)
  assert.equal(reloads, 2)
})
test("seat preference tolerates missing, malformed and failed storage", () => {
  reset(); values.set("rail.hideSeatNumber", "true")
  assert.equal(T.getHideSeatNumber(), false)
  failRead = true; assert.equal(T.getHideSeatNumber(), false)
  failRead = false
  for (const failure of ["false", "throw"]) {
    failWrite = failure
    T.setHideSeatNumber(true)
    assert.equal(T.getHideSeatNumber(), false)
    assert.equal(reloads, 0)
  }
})
console.log(`Passed ${count} trip-service checks.`)
