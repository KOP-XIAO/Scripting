// services/parse.ts — 12306 行程截图 OCR 文本 -> 结构化行程
// 纯函数模块：不引用任何 Scripting 全局对象，可在 Node 里直接跑测试（tools/test-parse.cjs）。
// 隐私：本模块只做字符串处理，不含任何网络请求；识别结果仅交给调用方写入本机 Storage。

export type ParsedTrip = {
  trainNo: string
  trainType: string
  fromStation: string
  toStation: string
  departDate: string // yyyy-MM-dd
  departTime: string // HH:mm
  arriveTime: string // HH:mm
  durationMin: number
  gate: string // 检票口
  seatCar: string // 车厢号（去零：05 -> 5）
  seatNo: string // 座位号，如 12A
  seatClass: string // 二等座 等
  passenger: string
}

const CN_NUM_PAD = (s: string) => s.replace(/^0+(\d)/, "$1")

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

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
    if (guess.getTime() < now.getTime() - 90 * 86400000) y += 1 // 跨年车票
  }
  return `${y}-${pad2(mo)}-${pad2(d)}`
}

// 历时：历时18分 / 历时 1小时20分 / 1时20分
export function parseDuration(text: string): number {
  let m = text.match(/历时\s*(\d{1,3})\s*分(?:钟)?/)
  if (m) return Number(m[1])
  m = text.match(/历时\s*(?:(\d{1,2})\s*(?:小时|时))?\s*(\d{1,3})\s*分/)
  if (m) return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
  m = text.match(/历时\s*(\d{1,2})\s*(?:小时|时)/)
  if (m) return Number(m[1]) * 60
  return 0
}

// 车站：优先「过/终/始 + 站名」逐行规则，其次站点分隔符兜底
function parseStations(text: string): { from: string; to: string } {
  const clean = (s: string) => s.replace(/[（(].*?[)）]/g, "").replace(/[站\s]+$/, "").trim()
  const fromList: string[] = []
  const toList: string[] = []
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^([过终始发到])\s*[·.、]?\s*([\u4e00-\u9fa5]{2,12})/)
    if (!m) continue
    const name = clean(m[2])
    if (!name) continue
    if (m[1] === "终" || m[1] === "到") toList.push(name)
    else fromList.push(name)
  }
  if (fromList.length && toList.length) return { from: fromList[0], to: toList[0] }
  // 两侧都用贪婪匹配：懒惰匹配会把「广州南」截成「广州」（离线测试 C2 抓到的真 bug）
  const sep = text.match(/([\u4e00-\u9fa5]{2,12})\s*[→\-—~至]\s*([\u4e00-\u9fa5]{2,12})/)
  if (sep) return { from: clean(sep[1]), to: clean(sep[2]) }
  return { from: fromList[0] ?? "", to: toList[0] ?? "" }
}

export function parseTripText(rawText: string, now = new Date()): ParsedTrip {
  const text = normalizeOCR(rawText)
  const flat = text.replace(/\n/g, " ")

  const times = pickTime(flat)
  const stations = parseStations(text)

  const trainNo = (flat.match(/\b([GDCZTKY]\s?\d{1,4})\b/) ?? ["", ""])[1].replace(/\s+/g, "")
  const trainType = (flat.match(/(复兴号|和谐号|智能动车组|绿巨人)/) ?? ["", ""])[1]

  // 检票口：6A检票口 / 检票口:6A / 检票口 6A
  const gateM = flat.match(/检票口\s*[:\s]*([0-9]{1,2}\s*[A-Za-z]{1,2}|[A-Za-z]{1,2}\s*[0-9]{1,2}|[0-9]{1,3})/)
  const gate = gateM ? gateM[1].replace(/\s+/g, "").toUpperCase() : ""

  // 座位：08车12A二等座 / 座位号:8车12A / 5车厢09C
  let seatCar = ""
  let seatNo = ""
  const seatM = flat.match(/(\d{1,2})\s*车(?:厢)?\s*([0-9]{1,3}\s*[A-Fa-f]?)/)
  if (seatM) {
    seatCar = CN_NUM_PAD(seatM[1])
    seatNo = seatM[2].replace(/\s+/g, "").toUpperCase()
  } else {
    const carOnly = flat.match(/(\d{1,2})\s*车(?:厢)?/)
    if (carOnly) seatCar = CN_NUM_PAD(carOnly[1])
  }
  const seatClass = (flat.match(/(商务座|特等座|一等座|二等座|无座|硬座|软座|硬卧|软卧|动卧)/) ?? ["", ""])[1]

  const passengerM = flat.match(/乘车人\s*[:\s]*([\u4e00-\u9fa5]{1,6}|[A-Za-z]{2,20})/)
  const passenger = passengerM ? passengerM[1] : ""

  return {
    trainNo,
    trainType,
    fromStation: stations.from,
    toStation: stations.to,
    departDate: parseDate(flat, now),
    departTime: times[0] ?? "",
    arriveTime: times[1] ?? "",
    durationMin: parseDuration(flat),
    gate,
    seatCar,
    seatNo,
    seatClass,
    passenger,
  }
}

// -------------------------------------------------------------
// 展示辅助（纯函数，widget 与 App 共用）
// -------------------------------------------------------------
export function departTimestamp(trip: { departDate: string; departTime: string }): number {
  if (!trip.departDate || !trip.departTime) return 0
  const t = new Date(`${trip.departDate}T${trip.departTime}:00`).getTime()
  return Number.isFinite(t) ? t : 0
}

export function arriveTimestamp(trip: { departDate: string; departTime: string; durationMin: number }): number {
  const dep = departTimestamp(trip)
  if (!dep) return 0
  return dep + Math.max(0, trip.durationMin) * 60000
}

export function countdownText(trip: {
  departDate: string
  departTime: string
  durationMin: number
}, now = Date.now()): string {
  const dep = departTimestamp(trip)
  if (!dep) return "待补全时间"
  const arr = arriveTimestamp(trip)
  if (arr && now >= arr) return "行程已结束"
  if (now >= dep) return "行程中"
  const min = Math.round((dep - now) / 60000)
  if (min <= 0) return "即将发车"
  if (min < 60) return `${min} 分钟后发车`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} 小时后发车` : `${h} 小时 ${m} 分后发车`
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

export function seatText(trip: { seatCar: string; seatNo: string; seatClass: string }): string {
  const seat = [trip.seatCar ? `${trip.seatCar}车` : "", trip.seatNo].filter(Boolean).join("")
  return [seat, trip.seatClass].filter(Boolean).join(" ") || "—"
}

export function routeText(trip: { fromStation: string; toStation: string }): string {
  const a = trip.fromStation || "—"
  const b = trip.toStation || "—"
  return `${a} → ${b}`
}
