// Offline layout checks with fictional journeys; no native iOS rendering.
// NODE_PATH=<node_modules containing esbuild> node tools/test-widget-stops.cjs
const assert = require("node:assert/strict")
const path = require("node:path")
const vm = require("node:vm")
const esbuild = require("esbuild")
const root = path.join(__dirname, "..")
const jsx = (type, props, ...children) => ({ type, props: { ...props, children } })
const ui = new Proxy({}, { get: (_, name) => name })
const context = {
  module: { exports: {} }, jsx, console,
  require(name) { assert.equal(name, "scripting"); return ui },
  Storage: { get() { return null } },
}
vm.createContext(context)
const code = esbuild.buildSync({
  entryPoints: [path.join(root, "components/trip-widget.tsx")],
  bundle: true, platform: "node", format: "cjs", external: ["scripting"], write: false,
  jsxFactory: "jsx", jsxFragment: '"Fragment"',
}).outputFiles[0].text
vm.runInContext(code, context)
const { TripWidget, TripWidgetPreview, TripBadge } = context.module.exports
const theme = { ink: "#173E35", sub: "#294A3E", accent: "#14654E", accentSoft: "rgba(20, 101, 78, 0.12)", badgeInk: "#FFFFFF", warn: "#854019", cardTop: "#DCEFE9", cardBottom: "#BFDCD2" }
const stations = ["区间外甲", "上车站", "中间甲", "中间乙", "下车站", "区间外乙"]
const trip = {
  id: "fictional", mode: "rail", code: "G1234", departDate: "2099-06-18", departTime: "09:00", arriveTime: "11:00", durationMin: 120,
  fromPlace: "上车站", toPlace: "下车站", seatCar: "05", seatNo: "08F", passenger: "虚构乘客", gate: "A1", seatClass: "二等座",
  railStops: stations.map(station => ({ station, arrival: "10:00", departure: "10:02" })),
}
const base = { trip, theme, width: 338, height: 158, now: new Date("2099-06-18T07:30:00").getTime(), hideSeatNumber: false }
function expand(node) {
  if (Array.isArray(node)) return node.map(expand)
  if (!node || typeof node !== "object") return node
  if (typeof node.type === "function") return expand(node.type(node.props))
  if (node.type === "GeometryReader") return expand(node.props.children[0]({ size: { width: 338, height: 158 } }))
  return { ...node, props: { ...node.props, children: expand(node.props.children) } }
}
function nodes(node, match, out = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, match, out))
  else if (node && typeof node === "object") { if (match(node)) out.push(node); nodes(node.props.children, match, out) }
  return out
}
const text = node => nodes(node, n => n.type === "Text").map(n => n.props.children.flat(Infinity).join(""))
const summary = node => nodes(node, n => n.type === "Text" && n.props.children.flat(Infinity).join("").startsWith("已识别经停"))
const render = extra => expand(TripWidget({ ...base, ...extra }))
let count = 0
function test(name, run) { run(); console.log(`PASS ${++count}: ${name}`) }
test("only intermediate stops in passenger route; original table retained", () => {
  const before = JSON.stringify(trip)
  const tree = render()
  assert.equal(summary(tree).length, 1)
  assert.equal(summary(tree)[0].props.children[0], "已识别经停 2 站 · 中间甲 · 中间乙")
  assert.equal(text(tree).some(t => /区间外/.test(t)), false)
  assert.equal(JSON.stringify(trip), before)
  const changed = render({ trip: { ...trip, fromPlace: "中间甲" } })
  assert.equal(summary(changed)[0].props.children[0], "已识别经停 1 站 · 中间乙")
})
test("long names remain single line; fixed rows fit minimum content height", () => {
  const long = { ...trip, railStops: [trip.railStops[1], ...Array.from({ length: 12 }, (_, i) => ({ station: `虚构很长的中间站名${i}`, arrival: "", departure: "" })), trip.railStops[4]] }
  const tree = render({ trip: long, width: 212, height: 124 })
  const label = summary(tree)[0]
  assert.equal(label.props.lineLimit, 1)
  assert.equal(label.props.font, 11)
  assert.ok(label.props.children[0].startsWith("已识别经停 12 站"))
  const body = nodes(tree, n => n.type === "VStack" && n.props.frame?.width === 200 && n.props.frame?.height === 112)[0]
  assert.ok(body)
  const fixedHeight = body.props.children.flat().reduce((sum, n) => sum + (n?.props?.frame?.height ?? 0), 0)
  assert.equal(fixedHeight, 112)
  assert.equal(nodes(tree, n => n.type === "HStack" && n.props.frame?.height === 34).length, 1)
})
test("missing, unmatched, reversed and adjacent endpoints never imply direct service", () => {
  for (const fields of [{ railStops: [] }, { fromPlace: "未匹配" }, { toPlace: "未匹配" }, { fromPlace: "下车站", toPlace: "上车站" }, { fromPlace: "上车站", toPlace: "中间甲" }]) {
    const tree = render({ trip: { ...trip, ...fields } })
    assert.equal(summary(tree).length, 0)
    assert.equal(text(tree).some(t => /直达/.test(t)), false)
    assert.equal(nodes(tree, n => n.type === "HStack" && n.props.frame?.height === 48).length, 1)
  }
})
test("flight retains boarding information; privacy hides seat and passenger", () => {
  const flight = render({ trip: { ...trip, mode: "flight", boardingTime: "08:30" } })
  assert.equal(summary(flight).length, 0)
  assert.ok(text(flight).includes("登机 08:30"))
  const hidden = render({ hideSeatNumber: true })
  assert.ok(text(hidden).includes("已隐藏"))
  assert.equal(text(hidden).some(t => /08F|虚构乘客/.test(t)), false)
  assert.equal(summary(hidden).length, 1)
})
test("compact dimensions hide summary at either size threshold", () => {
  assert.equal(summary(render({ width: 211, height: 124 })).length, 0)
  assert.equal(summary(render({ width: 212, height: 123 })).length, 0)
  assert.equal(summary(render({ width: 212, height: 124 })).length, 1)
})
test("preview and widget share summary; overnight, empty and run URL remain valid", () => {
  const overnight = { ...trip, departTime: "23:00", arriveTime: "01:00", railStops: trip.railStops.map((s, i) => ({ ...s, dayOffset: i > 1 ? 1 : 0 })) }
  const widget = render({ trip: overnight, widgetURL: "scripting://run" })
  const preview = expand(TripWidgetPreview({ ...base, trip: overnight }))
  assert.deepEqual(summary(preview).map(n => n.props.children[0]), summary(widget).map(n => n.props.children[0]))
  assert.equal(widget.props.widgetURL, "scripting://run")
  assert.equal(summary(render({ trip: null })).length, 0)
  assert.ok(text(render({ trip: null })).includes("暂无行程"))
})
test("today badge switches at local midnight and preserves rounded versus monospaced styling", () => {
  const midnight = new Date(2099, 5, 18).getTime()
  for (const [now, expected] of [[midnight - 1, false], [midnight, true], [new Date(2099, 5, 18, 23, 59, 59).getTime(), true], [new Date(2099, 5, 19).getTime(), false]]) {
    const badge = expand(TripBadge({ trip, theme, now }))
    assert.equal(badge.props.background, expected ? theme.accent : theme.accentSoft)
    assert.equal(badge.props.foregroundStyle, expected ? theme.badgeInk : theme.ink)
    assert.equal(badge.props.fontDesign, expected ? "rounded" : "monospaced")
    assert.equal(badge.props.fontWeight, expected ? "bold" : "semibold")
    assert.equal(text(render({ now })).some(value => value.startsWith("今天 ·")), expected)
  }
  for (const [date, now, expected] of [
    ["2028-02-29", new Date(2028, 1, 29).getTime(), true],
    ["2100-01-01", new Date(2099, 11, 31, 23, 59, 59).getTime(), false],
    ["2100-01-01", new Date(2100, 0, 1).getTime(), true],
    ["", midnight, false], ["2099-02-30", midnight, false], ["NaN-NaN-NaN", NaN, false],
  ]) {
    const badge = expand(TripBadge({ trip: { ...trip, departDate: date }, theme, now }))
    assert.equal(badge.props.background, expected ? theme.accent : theme.accentSoft)
  }
  const flight = render({ trip: { ...trip, mode: "flight", departTime: "" }, now: midnight })
  assert.ok(text(flight).some(value => value.startsWith("今天 ·")))
})
test("centered duration and lower arrow sit between symmetric time/place columns", () => {
  for (const [width, height] of [[338, 158], [212, 124]]) {
    const current = { ...trip, fromPlace: "虚构很长的出发车站名称", toPlace: "虚构很长的到达车站名称" }
    const tree = render({ trip: current, width, height })
    assert.equal(nodes(tree, n => n.type === "Image" && n.props.systemName === "arrowtriangle.right.fill").length, 1)
    assert.equal(nodes(tree, n => n.type === "Image" && n.props.systemName === "arrow.right.circle.fill").length, 0)
    const contentWidth = width - (height >= 150 ? 28 : 12)
    const route = nodes(tree, n => n.type === "HStack" && n.props.frame?.height === 40 && n.props.frame?.width === contentWidth)[0]
    assert.ok(route)
    const columns = route.props.children.flat()
    assert.equal(columns.length, 3)
    assert.equal(columns[0].props.frame.width, columns[2].props.frame.width)
    assert.equal(columns.reduce((sum, col) => sum + col.props.frame.width, 2 * route.props.spacing), contentWidth)
    assert.ok(text(columns[0]).includes(current.departTime) && text(columns[0]).includes(current.fromPlace))
    assert.ok(text(columns[2]).includes(current.arriveTime) && text(columns[2]).includes(current.toPlace))
    assert.equal(nodes(columns[0], n => n.type === "Image").length, 0)
    assert.equal(nodes(columns[2], n => n.type === "Image").length, 0)
    assert.ok(nodes(columns[0], n => n.type === "Text").every(n => n.props.lineLimit === 1))
    assert.ok(nodes(columns[2], n => n.type === "Text").every(n => n.props.lineLimit === 1))
    assert.equal(columns[1].props.alignment, "center")
    assert.equal(columns[1].props.children[0].type, "Text")
    assert.equal(columns[1].props.children[1].type, "HStack")
  }
})
test("short, hour-long, overnight and missing durations keep text and proportional arrow centered", () => {
  for (const [width, height] of [[338, 158], [300, 150], [212, 124]]) {
    const arrows = []
    for (const durationMin of [18, 60, 84, 754, 1559, 60000, 0]) {
      const current = { ...trip, durationMin, ...(durationMin ? {} : { departTime: "", arriveTime: "" }) }
      const tree = render({ trip: current, width, height })
      const contentWidth = width - (height >= 150 ? 28 : 12)
      const route = nodes(tree, n => n.type === "HStack" && n.props.frame?.height === 40 && n.props.frame?.width === contentWidth)[0]
      const [left, center, right] = route.props.children
      assert.equal(left.props.frame.width + route.props.spacing + center.props.frame.width / 2, contentWidth / 2)
      const [label, arrow] = center.props.children
      assert.equal(label.props.frame.alignment, "center")
      assert.equal(label.props.frame.width, center.props.frame.width)
      assert.equal(label.props.minScaleFactor, 0.75)
      assert.equal(label.props.lineLimit, 1)
      assert.equal(label.props.frame.height + center.props.spacing + arrow.props.frame.height, 40)
      assert.ok(arrow.props.frame.width >= 24 && arrow.props.frame.width <= center.props.frame.width - 12)
      assert.equal(arrow.props.children.reduce((sum, child) => sum + child.props.frame.width, 0), arrow.props.frame.width)
      assert.equal(right.props.alignment, "trailing")
      if (durationMin === 18) assert.equal(label.props.children[0], "18 分")
      if (durationMin === 84) assert.equal(label.props.children[0], "1 小时 24 分")
      if (durationMin === 0) assert.equal(label.props.children[0], "时长待补")
      arrows.push(arrow.props.frame.width)
    }
    assert.ok(arrows[2] > arrows[0], "longer duration needs a longer arrow")
  }
})
test("arrival and seat rows share the date's trailing boundary", () => {
  const tree = render()
  const contentWidth = base.width - 28
  const body = nodes(tree, n => n.type === "VStack" && n.props.frame?.width === contentWidth && n.props.frame?.height === 130)[0]
  const header = body.props.children[0]
  assert.equal(header.props.frame.width, contentWidth)
  assert.equal(header.props.children.at(-2).type, "Spacer")
  assert.equal(header.props.children.at(-1).type, "Text")
  const route = nodes(tree, n => n.type === "HStack" && n.props.frame?.height === 40 && n.props.frame?.width === contentWidth)[0]
  const arrival = route.props.children.at(-1)
  for (const row of arrival.props.children) {
    assert.equal(row.props.children[0].type, "Spacer")
    assert.equal(row.props.children.at(-1).type, "Text")
  }
  const footer = nodes(tree, n => n.type === "HStack" && n.props.frame?.height === 34)[0]
  assert.equal(footer.props.frame.width, contentWidth)
  const seat = footer.props.children.at(-1)
  assert.equal(seat.props.alignment, "trailing")
  for (const row of seat.props.children.slice(0, 2)) {
    assert.equal(row.props.children[0].type, "Spacer")
    assert.equal(row.props.children.at(-1).type, "Text")
  }
})
