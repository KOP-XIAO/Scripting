// services/parse.ts — 行程截图 OCR 文本 -> 结构化行程（火车 / 航班通用）
// 纯函数模块：不引用任何 Scripting 全局对象，可在 Node 里直接跑断言（tools/test-parse.cjs）。
// 隐私：本模块只做字符串处理，不含任何网络请求；识别结果仅交给调用方写入本机 Storage。

export type TripMode = "rail" | "flight"

export type ParsedTrip = {
  mode: TripMode
  code: string // 车次 G1234 / 航班号 CA1234
  carrier: string // 复兴号 / 中国国际航空
  fromPlace: string // 出发站 / 出发机场（含航站楼时如 北京首都T3）
  toPlace: string // 到达站 / 到达机场
  departDate: string // yyyy-MM-dd
  departTime: string // HH:mm
  arriveTime: string // HH:mm
  durationMin: number
  gate: string // 检票口（火车）/ 登机口（航班）
  terminal: string // 航站楼（航班），火车留空
  checkIn: string // 值机柜台（航班）
  boardingTime: string // 登机时间（航班）
  baggage: string // 行李转盘（航班）
  seatCar: string // 车厢号（火车）
  seatNo: string // 座位号，如 12A
  seatClass: string // 二等座 / 经济舱
  passenger: string
}

const pad2 = (n: number) => String(n).padStart(2, "0")
const stripLeadingZero = (s: string) => s.replace(/^0+(\d)/, "$1")

// 全角 -> 半角（OCR 常见混排），仅处理会干扰解析的符号与数字
export function normalizeOCR(text: string): string {
  return text
    .replace(/[：]/g, ":")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\r/g, "")
}

// 航司名（含常见简称）
const AIRLINES = [
  "中国国际航空", "中国东方航空", "中国南方航空", "海南航空", "厦门航空", "深圳航空",
  "四川航空", "吉祥航空", "春秋航空", "山东航空", "天津航空", "首都航空", "河北航空",
  "国泰航空", "香港航空", "澳门航空", "中华航空", "长荣航空", "全日空", "日本航空",
  "大韩航空", "韩亚航空", "新加坡航空", "酷航", "亚洲航空", "国航", "东航", "南航",
  "海航", "厦航", "深航", "川航", "山航",
]

const FLIGHT_HINTS = /航班|登机口|登机时间|值机|航站楼|机场|承运人|舱|行李转盘/
const RAIL_HINTS = /车次|检票口|候车|车厢|站台|复兴号|和谐号/

export function detectMode(text: string): TripMode {
  const up = text.toUpperCase()
  const flightHint = FLIGHT_HINTS.test(text)
  const railHint = RAIL_HINTS.test(text)
  // 号码形态：火车是单字母前缀（G1234/D2288…），航班是两字符航司码（CA1234 / 3U8888）
  const railCode = /\b[GDCZTKY]\s?\d{3,4}\b/.test(up)
  const flightCode = /\b(?:[A-Z]{2}|[0-9][A-Z])\s?\d{3,4}\b/.test(up)

  if (flightHint && !railHint) return "flight"
  if (railHint && !flightHint) return "rail"
  // 无明确线索时先认火车号码（避免「G1234」被 [A-Z]\d 形态误判成航班）
  if (railCode) return "rail"
  if (flightCode) return "flight"
  if (flightHint) return "flight"
  return "rail"
}

function pickTime(text: string): string[] {
  const out: string[] = []
  const re = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const t = `${pad2(Number(m[1]))}:${m[2]}`
    if (!out.includes(t)) out.push(t)
  }
  return out
}

// 日期：2026-10-12 / 10月12日 / 10-12；缺年时用当年，若已过去 90 天以上则视为次年
export function parseDate(text: string, now = new Date()): string {
  let y = 0
  let mo = 0
  let d = 0
  let m = text.match(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})/)
  if (m) {
    y = Number(m[1])
    mo = Number(m[2])
    d = Number(m[3])
  } else if ((m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/))) {
    mo = Number(m[1])
    d = Number(m[2])
  } else if ((m = text.match(/\b(\d{1,2})-(\d{1,2})\b/))) {
    mo = Number(m[1])
    d = Number(m[2])
  }
  if (!mo || !d) return ""
  if (!y) {
    y = now.getFullYear()
    const guess = new Date(y, mo - 1, d, 23, 59, 59)
    if (guess.getTime() < now.getTime() - 90 * 86400000) y += 1 // 跨年票据
  }
  return `${y}-${pad2(mo)}-${pad2(d)}`
}

// 历时：历时18分 / 历时 1小时20分 / 飞行时间 2小时15分
export function parseDuration(text: string): number {
  let m = text.match(/(?:历时|飞行时间|航程|时长)\s*(\d{1,3})\s*分(?:钟)?/)
  if (m) return Number(m[1])
  m = text.match(/(?:历时|飞行时间|航程|时长)\s*(?:(\d{1,2})\s*(?:小时|时))?\s*(\d{1,3})\s*分/)
  if (m) return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
  m = text.match(/(?:历时|飞行时间|航程|时长)\s*(\d{1,2})\s*(?:小时|时)/)
  if (m) return Number(m[1]) * 60
  m = text.match(/\b(\d{1,2})\s*小时\s*(\d{1,3})\s*分/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  return 0
}

const cleanPlace = (s: string) =>
  s
    .replace(/[（(].*?[)）]/g, "")
    .replace(/^[过终始发到]\s*[·.、:：]?\s*/, "")
    .replace(/[^\u4e00-\u9fa5A-Z0-9]+$/g, "") // 尾部垃圾字符（，、〉等，OCR 常把小图标认成标点）
    .replace(/[站\s]+$/g, "")
    .trim()

// 火车车站：支持三种写法——
//   ① 「过 北京南」同一行；② 「过」「北京南」被 OCR 拆成两行；③ 「出发站：北京南」标签式
// 都找不到时再用 A → B 兜底
function parseRailPlaces(text: string): { from: string; to: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  const fromList: string[] = []
  const toList: string[] = []
  const push = (marker: string, raw: string) => {
    const name = cleanPlace(raw)
    if (!name) return
    if (marker === "终" || marker === "到") toList.push(name)
    else fromList.push(name)
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const labeled = line.match(/^(出发站|始发站|乘车站|到达站|终到站)\s*[:：]?\s*([\u4e00-\u9fa5]{2,12})/)
    if (labeled) {
      push(/到达|终到/.test(labeled[1]) ? "终" : "过", labeled[2])
      continue
    }
    const sameLine = line.match(/^([过终始发到])\s*[·.、:：]?\s*([\u4e00-\u9fa5]{2,12})/)
    if (sameLine) {
      push(sameLine[1], sameLine[2])
      continue
    }
    // 标记单独一行：取下一行的开头中文片段作为站名
    if (/^[过终始发到]$/.test(line) && i + 1 < lines.length) {
      const next = lines[i + 1].match(/^([\u4e00-\u9fa5]{2,12})/)
      if (next) {
        push(line, next[1])
        i += 1
      }
    }
  }
  if (fromList.length && toList.length) return { from: fromList[0], to: toList[0] }
  const sep = text.match(/([\u4e00-\u9fa5]{2,12})\s*[→\-—~至]\s*([\u4e00-\u9fa5]{2,12})/)
  if (sep) return { from: cleanPlace(sep[1]), to: cleanPlace(sep[2]) }
  return { from: fromList[0] ?? "", to: toList[0] ?? "" }
}

// 机场：优先逐行找「出发 - 到达」区间（覆盖 北京首都T3 → 上海虹桥T2、成都天府T2 - 北京大兴），
// 其次按「机场/航站楼/三字码」关键词扫描
function parseFlightPlaces(text: string): { from: string; to: string; terminal: string } {
  const norm = (v: string) => v.replace(/[（(].*?[)）]/g, "").replace(/[，,。;；、]+$/, "").trim()
  // 两侧都得像地名：至少两字中文，或三字机场码（防止把 2026-10-12 这种日期当成区间）
  const looksPlace = (v: string) => /[\u4e00-\u9fa5]{2}/.test(v) || /^[A-Z]{3}$/.test(v.trim())
  const terminalOf = (a: string, b: string) => (a.match(/T[1-4]/) ?? b.match(/T[1-4]/) ?? [""])[0]

  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(.{2,24}?)\s*(?:→|->|—|–|~|至|-)\s*(.{2,24})$/)
    if (!m) continue
    const from = norm(m[1])
    const to = norm(m[2])
    if (looksPlace(from) && looksPlace(to)) {
      return { from, to, terminal: terminalOf(from, to) }
    }
  }

  const airportish = /([\u4e00-\u9fa5]{2,10}(?:国际)?机场|\b[A-Z]{3}\b|[\u4e00-\u9fa5]{2,8}(?=T[1-4]))(T[1-4])?/g
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = airportish.exec(text)) !== null) {
    const name = (m[1] + (m[2] ?? "")).trim()
    if (name && !found.includes(name)) found.push(name)
  }
  return { from: found[0] ?? "", to: found[1] ?? "", terminal: terminalOf(found[0] ?? "", found[1] ?? "") }
}

// 车站块停用词：长得像站名但不是站名
const PLACE_STOPWORDS = /^(过|终|始|发|到|改签|退票|灵活行|乘车码|复兴号|和谐号|智能动车组|绿巨人)$/
const PLACE_BAD_PART = /[0-9:：]|乘车|检票|座位|历时|出发|到达/

// 用候选块位置兜底车站：站名在时间行下方（±0.14 内）左右各一个中文块
function placesFromCandidates(candidates: OCRCandidateBlock[]): { from: string; to: string } {
  if (!candidates.length) return { from: "", to: "" }
  const timed = candidates.filter((c) => /^\d{2}:\d{2}$/.test(c.content.trim()))
  if (!timed.length) return { from: "", to: "" }
  const timeY = timed[0].y + timed[0].h / 2

  const stationish = candidates.filter((c) => {
    const t = c.content.trim()
    if (!/^[\u4e00-\u9fa5][\u4e00-\u9fa5]{1,9}[^\u4e00-\u9fa5]{0,2}$/.test(t)) return false
    if (PLACE_STOPWORDS.test(cleanPlace(t)) || PLACE_BAD_PART.test(t)) return false
    const dy = Math.abs(c.y + c.h / 2 - timeY)
    return dy > 0.04 && dy < 0.14
  })
  if (!stationish.length) return { from: "", to: "" }
  stationish.sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2))
  const from = cleanPlace(stationish[0].content)
  const to = cleanPlace(stationish[stationish.length - 1].content)
  return { from, to }
}

function parseRail(text: string, flat: string, now: Date, candidates: OCRCandidateBlock[] = []): ParsedTrip {
  let places = parseRailPlaces(text)
  if (!places.from || !places.to) {
    const positional = placesFromCandidates(candidates)
    places = {
      from: places.from || positional.from,
      to: places.to || positional.to,
    }
  }
  const times = pickTime(flat)
  const code = (flat.match(/\b([GDCZTKY]\s?\d{1,4})\b/) ?? ["", ""])[1].replace(/\s+/g, "")
  const carrier = (flat.match(/(复兴号|和谐号|智能动车组|绿巨人)/) ?? ["", ""])[1]

  // 「检票口:11B」「检票口Q：11B检票口」（信息图标被认成字母）「11B检票口」三种形态
  let gateM = flat.match(
    /检票口\s*[:：]?\s*(?:[A-Za-z]{1,2}\s*[:：]\s*)?([0-9]{1,2}\s*[A-Za-z]{1,2}|[A-Za-z]{1,2}\s*[0-9]{1,2}|[0-9]{1,3})/,
  )
  if (!gateM) gateM = flat.match(/([0-9]{1,2}\s*[A-Za-z]{1,2})\s*检票口/)
  const gate = gateM ? gateM[1].replace(/\s+/g, "").toUpperCase() : ""

  let seatCar = ""
  let seatNo = ""
  const seatM = flat.match(/(\d{1,2})\s*车(?:厢)?\s*([0-9]{1,3}\s*[A-Fa-f]?)/)
  if (seatM) {
    seatCar = stripLeadingZero(seatM[1])
    seatNo = seatM[2].replace(/\s+/g, "").toUpperCase()
  } else {
    const carOnly = flat.match(/(\d{1,2})\s*车(?:厢)?/)
    if (carOnly) seatCar = stripLeadingZero(carOnly[1])
  }
  const seatClass = (flat.match(/(商务座|特等座|一等座|二等座|无座|硬座|软座|硬卧|软卧|动卧)/) ?? ["", ""])[1]

  const passenger = (flat.match(/乘车人\s*[:\s]*([\u4e00-\u9fa5]{1,6}|[A-Za-z]{2,20})/) ?? ["", ""])[1]

  return {
    mode: "rail",
    code,
    carrier,
    fromPlace: places.from,
    toPlace: places.to,
    departDate: parseDate(flat, now),
    departTime: times[0] ?? "",
    arriveTime: times[1] ?? "",
    durationMin: parseDuration(flat),
    gate,
    terminal: "",
    checkIn: "",
    boardingTime: "",
    baggage: "",
    seatCar,
    seatNo,
    seatClass,
    passenger,
  }
}

function parseFlight(text: string, flat: string, now: Date): ParsedTrip {
  const up = flat.toUpperCase() // 号码/闸口等拉丁字段大小写无关
  const places = parseFlightPlaces(text)

  // 先摘出登机时间，避免被当成起飞/到达时间
  const boardingTime = (up.match(/登机时间\s*[:\s]*([01]?\d|2[0-3]):([0-5]\d)/) ?? []).slice(1)
  let timesSource = flat
  if (boardingTime.length === 2) {
    timesSource = flat.replace(/登机时间\s*[:\s]*[01]?\d:[0-5]\d/, " ")
  }
  const times = pickTime(timesSource)

  const code = (up.match(/\b((?:[A-Z]{2}|\d[A-Z]|[A-Z]\d)\s?\d{3,4})\b/) ?? ["", ""])[1].replace(/\s+/g, "")
  const carrier =
    AIRLINES.find((a) => flat.includes(a)) ??
    (flat.match(/([\u4e00-\u9fa5]{2,8}航空(?:公司)?)/) ?? ["", ""])[1]

  const gateM = up.match(/登机口\s*[:\s]*([A-Z]?\d{1,3}[A-Z]?)/)
  const gate = gateM ? gateM[1].toUpperCase() : ""

  const checkM = up.match(/值机柜台\s*[:\s]*([A-Z]?\d{1,3}\s*[-~—]\s*[A-Z]?\d{1,3}|[A-Z]?\d{1,3})/)
  const checkIn = checkM ? checkM[1].replace(/\s+/g, "") : ""

  const seatM = up.match(/座位\s*(?:号)?\s*[:\s]*(\d{1,3}\s*[A-Z])/)
  const seatNo = seatM ? seatM[1].replace(/\s+/g, "") : ""
  const seatClass = (flat.match(/(超级经济舱|经济舱|公务舱|商务舱|头等舱)/) ?? ["", ""])[1]

  const baggage = (flat.match(/行李(?:转盘|提取处|转盘号)\s*[:\s]*(\d{1,2})/) ?? ["", ""])[1]
  const passenger = (flat.match(/(?:乘机人|旅客|乘客)\s*[:\s]*([\u4e00-\u9fa5]{1,6}|[A-Za-z]{2,20})/) ?? ["", ""])[1]
  const terminal = places.terminal || (flat.match(/\b(T[1-4])\b/) ?? ["", ""])[1]

  return {
    mode: "flight",
    code,
    carrier,
    fromPlace: places.from,
    toPlace: places.to,
    departDate: parseDate(flat, now),
    departTime: times[0] ?? "",
    arriveTime: times[1] ?? "",
    durationMin: parseDuration(flat),
    gate,
    terminal,
    checkIn,
    boardingTime: boardingTime.length === 2 ? `${boardingTime[0]}:${boardingTime[1]}` : "",
    baggage,
    seatCar: "",
    seatNo,
    seatClass,
    passenger,
  }
}

// Vision 识别块（含位置），OCR 层把 boundingBox 打平后传入
export type OCRCandidateBlock = {
  content: string
  x: number
  y: number
  w: number
  h: number
}

export function parseTripText(
  rawText: string,
  now = new Date(),
  modeHint: TripMode | "auto" = "auto",
  candidates: OCRCandidateBlock[] = [],
): ParsedTrip {
  const text = normalizeOCR(rawText)
  const flat = text.replace(/\n/g, " ")
  const mode = modeHint === "auto" ? detectMode(flat) : modeHint
  return mode === "flight" ? parseFlight(text, flat, now) : parseRail(text, flat, now, candidates)
}

// -------------------------------------------------------------
// 展示辅助（纯函数，widget 与 App 共用）
// -------------------------------------------------------------
type TimeLike = {
  departDate: string
  departTime: string
  durationMin: number
  arriveTime?: string
}

export function departTimestamp(trip: { departDate: string; departTime: string }): number {
  if (!trip.departDate || !trip.departTime) return 0
  const t = new Date(`${trip.departDate}T${trip.departTime}:00`).getTime()
  return Number.isFinite(t) ? t : 0
}

// 实际历时优先；否则按钟点差推算，早于出发视为跨午夜。
// 跨时区航班需要填写实际历时，避免本地钟点差误导。
export function tripDurationMinutes(trip: { durationMin: number; departTime: string; arriveTime?: string }): number {
  if (Number.isFinite(trip.durationMin) && trip.durationMin > 0) return Math.round(trip.durationMin)
  const clock = (value: string) => {
    const m = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const start = clock(trip.departTime)
  const end = clock(trip.arriveTime ?? "")
  return start == null || end == null ? 0 : (end - start + 1440) % 1440
}

export function durationText(trip: { durationMin: number; departTime: string; arriveTime?: string }): string {
  const total = tripDurationMinutes(trip)
  if (!total) return "时长待补"
  const h = Math.floor(total / 60), m = total % 60
  if (!h) return `${m} 分`
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

export function arriveTimestamp(trip: TimeLike): number {
  const dep = departTimestamp(trip)
  return dep ? dep + tripDurationMinutes(trip) * 60000 : 0
}

// 双单位倒计时：>=24h 显示天｜小时；<24h 显示小时｜分钟。
export function countdownText(trip: TimeLike, now = Date.now()): string {
  const dep = departTimestamp(trip)
  if (!dep) return "待补全时间"
  const arr = arriveTimestamp(trip)
  if (tripDurationMinutes(trip) > 0 && arr && now >= arr) return "行程已结束"
  if (now >= dep) return tripDurationMinutes(trip) > 0 ? "行程中" : "已出发 · 到达时间待补"
  const minutes = Math.floor((dep - now) / 60000)
  if (minutes < 1) return "即将出发"
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} 天｜${Math.floor((minutes % 1440) / 60)} 小时`
  return `${Math.floor(minutes / 60)} 小时｜${minutes % 60} 分`
}

export function weekdayText(dateStr: string): string {
  if (!dateStr) return ""
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ""
  return "周" + "日一二三四五六"[d.getDay()]
}

export function monthDayText(dateStr: string): string {
  if (!dateStr) return ""
  const m = dateStr.match(/^\d{4}-(\d{2})-(\d{2})$/)
  if (!m) return dateStr
  return `${Number(m[1])}月${Number(m[2])}日`
}

export function gateLabel(mode: TripMode): string {
  return mode === "flight" ? "登机口" : "检票口"
}

export function carrierLabel(mode: TripMode): string {
  return mode === "flight" ? "航空公司" : "车型"
}

export function placeLabel(mode: TripMode): string {
  return mode === "flight" ? "机场" : "车站"
}

export function seatText(trip: { mode: TripMode; seatCar: string; seatNo: string; seatClass: string }): string {
  if (trip.mode === "flight") {
    return [trip.seatNo, trip.seatClass].filter(Boolean).join(" ") || "—"
  }
  const seat = [trip.seatCar ? `${trip.seatCar}车` : "", trip.seatNo].filter(Boolean).join("")
  return [seat, trip.seatClass].filter(Boolean).join(" ") || "—"
}

export function routeText(trip: { fromPlace: string; toPlace: string }): string {
  return `${trip.fromPlace || "—"} → ${trip.toPlace || "—"}`
}

export function modeLabel(mode: TripMode): string {
  return mode === "flight" ? "航班" : "火车"
}

// 识别后自检：返回缺失的关键字段名，供 App 提示手动补全
export function missingFields(trip: ParsedTrip): string[] {
  const out: string[] = []
  const placeLabel = trip.mode === "flight" ? "机场" : "车站"
  if (!trip.code) out.push(trip.mode === "flight" ? "航班号" : "车次")
  if (!trip.fromPlace) out.push(`出发${placeLabel}`)
  if (!trip.toPlace) out.push(`到达${placeLabel}`)
  if (!trip.departTime) out.push("出发时间")
  if (!trip.gate) out.push(gateLabel(trip.mode))
  if (!trip.seatNo) out.push("座位号")
  return out
}
