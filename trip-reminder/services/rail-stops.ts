// Timetable recognition is gated by an explicit screenshot section heading.
export type RailStop = {
  station: string
  arrival: string
  departure: string
  stopMinutes?: number
  // Relative to the first table event; an overnight dwell uses its arrival day.
  dayOffset?: number
}

type RailJourney = { mode?: string; fromPlace: string; toPlace: string; railStops?: RailStop[] }
const stationKey = (name: string) => name.trim().replace(/站$/, "")

export function railJourneyStops(trip: RailJourney): RailStop[] {
  if (trip.mode && trip.mode !== "rail") return []
  const stops = trip.railStops ?? []
  const from = stationKey(trip.fromPlace), to = stationKey(trip.toPlace)
  if (!from || !to || from === to) return []
  const start = stops.findIndex((stop) => stationKey(stop.station) === from)
  const end = stops.findIndex((stop, i) => i > start && stationKey(stop.station) === to)
  return start >= 0 && end > start ? stops.slice(start, end + 1) : []
}

const SECTION = /经停站|经停信息|列车时刻表|时刻表/g
const SLOT = "(?:[0-2]?\\d:[0-5]\\d|--|—|始发|终到)"
const ROW = new RegExp(`^\\s*(?:\\d{1,3}[.、]?\\s+)?(?:[始过终]\\s+)?([\\u4e00-\\u9fa5]{2,12})\\s+(${SLOT})\\s+(${SLOT})(?:[ \\t]*(?:\\n[ \\t]*)?(?:停留\\s*[:：]?\\s*)?(\\d{1,3})\\s*(?:分钟|分))?(?=\\s|$)`)
const HEADER = /^(?:站序|序号|站名|车站|到达时间|到站时间|到时|到达|出发时间|发车时间|开车时间|发车|开车|发时|出发|停留时间|停站时间|停留|停站|站点|时间|\s|[|:：])+$/
const NOT_STATION = /站序|序号|站名|到达|出发|发车|开车|停留|停站|时间|检票|乘车|订单|车票|行程/

function timeValue(raw: string): string {
  const m = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : ""
}

// End the table only at recognizable ticket content. Damaged rows must not leak times.
const TICKET_START = /^(?:[GDCZTKY]\s?\d{1,4}\b|车次|乘车站|出发站|到达站|始发站|终到站|乘车人|检票口|座位|订单|行程|\d{4}[-/年]\d|\d{1,2}月\d)|[→]|[\u4e00-\u9fa5]{2,12}\s*(?:->|至|—|~)\s*[\u4e00-\u9fa5]{2,12}/
export function extractRailTimetable(text: string): { text: string; hasTable: boolean; stops: RailStop[] } {
  const stops: RailStop[] = []
  let primary = "", last = 0, match: RegExpExecArray | null
  SECTION.lastIndex = 0
  while ((match = SECTION.exec(text)) !== null) {
    primary += text.slice(last, match.index)
    let cursor = match.index + match[0].length
    cursor += text.slice(cursor).match(/^[ \t:：]*/)?.[0].length ?? 0
    while (cursor < text.length) {
      const rest = text.slice(cursor)
      const blank = rest.match(/^\s*\n/)
      if (blank) { cursor += blank[0].length; continue }
      const line = rest.split("\n", 1)[0]
      if (line.trim() && HEADER.test(line.trim())) {
        cursor += line.length
        continue
      }
      if (TICKET_START.test(line.trim()) || /^(?:经停站|经停信息|列车时刻表|时刻表)/.test(line.trim())) break
      const row = rest.match(ROW)
      if (!row || NOT_STATION.test(row[1])) {
        cursor += line.length || 1
        continue
      }
      const arrival = timeValue(row[2]), departure = timeValue(row[3])
      if ((!arrival && /^\d/.test(row[2])) || (!departure && /^\d/.test(row[3]))) {
        cursor += row[0].length
        continue
      }
      const stop: RailStop = { station: row[1], arrival, departure }
      if (row[4] != null) stop.stopMinutes = Number(row[4])
      stops.push(stop)
      cursor += row[0].length
    }
    primary += "\n"
    last = cursor
    SECTION.lastIndex = cursor
  }
  primary += text.slice(last)
  let day = 0, previous = -1
  for (const stop of stops) {
    let arrivalDay: number | undefined
    for (const time of [stop.arrival, stop.departure]) {
      if (!time) continue
      const [h, m] = time.split(":").map(Number)
      const clock = h * 60 + m
      if (previous >= 0 && clock < previous) day += 1
      if (arrivalDay == null) arrivalDay = day
      previous = clock
    }
    if (arrivalDay != null) stop.dayOffset = arrivalDay
  }
  return { text: primary, hasTable: last > 0, stops }
}
