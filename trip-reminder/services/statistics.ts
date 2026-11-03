import { tripDurationMinutes, type TripMode } from "./parse"
import { stripRailStationMarker } from "./rail-stops"
import type { TripRecord } from "./trips"

export type PlaceStatistics = {
  mode: TripMode
  name: string
  departures: number
  arrivals: number
  total: number
}

export type ArchiveStatistics = {
  total: number
  rail: number
  flight: number
  totalMinutes: number
  knownDurationCount: number
  unknownDurationCount: number
  places: PlaceStatistics[]
  uniquePlaceCount: number
}

export type ArchiveInsightsFilter = { year?: number; mode?: "all" | TripMode; trendMonths?: 3 | 12 }

export type ArchiveTrendDimension = "departure" | "arrival" | "code"

export type ArchiveTrendBreakdown = {
  dimension: ArchiveTrendDimension
  months: Array<{
    month: string; total: number; totalMinutes: number; knownDurationCount: number; unknownDurationCount: number
    segments: Array<{ key: string; count: number; minutes: number; knownDurationCount: number }>
  }>
  series: Array<{ key: string; label: string; total: number; totalMinutes: number; knownDurationCount: number }>
}

export type ArchiveInsights = {
  summary: ArchiveStatistics
  years: number[]
  selectedYear: number | null
  selectedMode: "all" | TripMode
  months: Array<{ month: string; total: number; rail: number; flight: number; totalMinutes: number }>
  routes: Array<{ mode: TripMode; from: string; to: string; total: number; totalMinutes: number; knownDurationCount: number }>
  averageMinutes: number | null
  longest: { id: string; code: string; from: string; to: string; minutes: number } | null
  activeDays: number
  invalidDateCount: number
  missingRouteCount: number
}

function durationMinutes(trip: TripRecord): number {
  const minutes = tripDurationMinutes({
    durationMin: typeof trip.durationMin === "number" ? trip.durationMin : 0,
    departTime: typeof trip.departTime === "string" ? trip.departTime : "",
    arriveTime: typeof trip.arriveTime === "string" ? trip.arriveTime : "",
  })
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0
}

function placeName(mode: TripMode, value: unknown): string {
  const raw = typeof value === "string" ? value : ""
  const name = mode === "rail"
    ? stripRailStationMarker(raw).replace(/站$/, "").trim()
    : raw.trim()
  return /^(?:[-—–?？]+|未知|未识别|待补(?:全)?)$/.test(name) ? "" : name
}

function departureDate(value: unknown): { day: string; year: number; monthIndex: number } | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  // setFullYear also round-trips years below 100 without Date's 1900 offset.
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return { day: value, year, monthIndex: year * 12 + month - 1 }
}

export function archiveStatistics(records: TripRecord[]): ArchiveStatistics {
  const result: ArchiveStatistics = {
    total: 0, rail: 0, flight: 0, totalMinutes: 0,
    knownDurationCount: 0, unknownDurationCount: 0, places: [], uniquePlaceCount: 0,
  }
  const places = new Map<string, PlaceStatistics>()
  for (const trip of records) {
    if (!trip.archivedAt) continue
    result.total += 1
    const validMode = trip.mode === "rail" || trip.mode === "flight"
    if (validMode) result[trip.mode] += 1
    const minutes = durationMinutes(trip)
    if (minutes > 0) {
      result.totalMinutes += minutes
      result.knownDurationCount += 1
    } else {
      result.unknownDurationCount += 1
    }
    if (!validMode) continue
    for (const direction of ["departures", "arrivals"] as const) {
      const value = direction === "departures" ? trip.fromPlace : trip.toPlace
      const name = placeName(trip.mode, value)
      if (!name) continue
      const key = `${trip.mode}:${name}`
      const place = places.get(key) ?? { mode: trip.mode, name, departures: 0, arrivals: 0, total: 0 }
      place[direction] += 1
      place.total += 1
      places.set(key, place)
    }
  }
  result.places = [...places.values()].sort((a, b) =>
    b.total - a.total || a.name.localeCompare(b.name, "zh-CN") || a.mode.localeCompare(b.mode, "en"))
  result.uniquePlaceCount = result.places.length
  return result
}

function archiveSelection(records: TripRecord[], filter: ArchiveInsightsFilter) {
  const archived = records.filter((trip) => !!trip.archivedAt).map((trip) => ({
    trip, date: departureDate(trip.departDate),
  }))
  const selectedYear = filter.year ?? null
  const selectedMode = filter.mode ?? "all"
  const filtered = archived.filter(({ trip, date }) =>
    (selectedMode === "all" || trip.mode === selectedMode)
    && (selectedYear === null || date?.year === selectedYear))
  const months: ArchiveInsights["months"] = []
  let latestMonth: number | null = null
  for (const { date } of filtered) {
    if (date && (latestMonth === null || date.monthIndex > latestMonth)) latestMonth = date.monthIndex
  }
  const trendMonths = filter.trendMonths ?? 12
  const firstMonth = trendMonths === 3
    ? latestMonth === null ? null : Math.max(selectedYear === null ? 0 : selectedYear * 12, latestMonth - 2)
    : selectedYear !== null ? selectedYear * 12 : latestMonth === null ? null : latestMonth - 11
  const monthCount = trendMonths === 3 && firstMonth !== null && latestMonth !== null ? latestMonth - firstMonth + 1 : 12
  if (firstMonth !== null) {
    for (let offset = 0; offset < monthCount; offset += 1) {
      const index = firstMonth + offset
      const year = Math.floor(index / 12)
      const month = index - year * 12 + 1
      months.push({
        month: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
        total: 0, rail: 0, flight: 0, totalMinutes: 0,
      })
    }
  }
  return { archived, filtered, selectedYear, selectedMode, firstMonth, months }
}

export function archiveInsights(records: TripRecord[], filter: ArchiveInsightsFilter = {}): ArchiveInsights {
  const { archived, filtered, selectedYear, selectedMode, firstMonth, months } = archiveSelection(records, filter)
  const summary = archiveStatistics(filtered.map(({ trip }) => trip))
  const result: ArchiveInsights = {
    summary,
    years: [...new Set(archived.flatMap(({ date }) => date ? [date.year] : []))].sort((a, b) => b - a),
    selectedYear, selectedMode, months, routes: [],
    averageMinutes: summary.knownDurationCount ? Math.round(summary.totalMinutes / summary.knownDurationCount) : null,
    longest: null, activeDays: 0, invalidDateCount: 0, missingRouteCount: 0,
  }
  const routes = new Map<string, ArchiveInsights["routes"][number]>()
  const activeDays = new Set<string>()
  for (const { trip, date } of filtered) {
    const minutes = durationMinutes(trip)
    const validMode = trip.mode === "rail" || trip.mode === "flight"
    const from = placeName(trip.mode, trip.fromPlace)
    const to = placeName(trip.mode, trip.toPlace)
    if (date) {
      activeDays.add(date.day)
      const month = firstMonth === null ? undefined : result.months[date.monthIndex - firstMonth]
      if (month) {
        month.total += 1
        if (validMode) month[trip.mode] += 1
        month.totalMinutes += minutes
      }
    } else {
      result.invalidDateCount += 1
    }
    if (validMode) {
      if (from && to) {
        const key = JSON.stringify([trip.mode, from, to])
        const route = routes.get(key) ?? { mode: trip.mode, from, to, total: 0, totalMinutes: 0, knownDurationCount: 0 }
        route.total += 1
        route.totalMinutes += minutes
        if (minutes > 0) route.knownDurationCount += 1
        routes.set(key, route)
      } else {
        result.missingRouteCount += 1
      }
    }
    const id = typeof trip.id === "string" ? trip.id : ""
    if (minutes > 0 && (!result.longest || minutes > result.longest.minutes
      || (minutes === result.longest.minutes && id < result.longest.id))) {
      result.longest = { id, code: typeof trip.code === "string" ? trip.code : "", from, to, minutes }
    }
  }
  result.routes = [...routes.values()].sort((a, b) =>
    b.total - a.total || a.from.localeCompare(b.from, "zh-CN")
    || a.to.localeCompare(b.to, "zh-CN") || a.mode.localeCompare(b.mode, "en"))
  result.activeDays = activeDays.size
  return result
}

export function archiveTrendBreakdown(
  records: TripRecord[],
  filter: ArchiveInsightsFilter = {},
  dimension: ArchiveTrendDimension = "departure",
): ArchiveTrendBreakdown {
  const selection = archiveSelection(records, filter)
  const months: ArchiveTrendBreakdown["months"] = selection.months.map(({ month }) => ({
    month, total: 0, totalMinutes: 0, knownDurationCount: 0, unknownDurationCount: 0, segments: [],
  }))
  const counts = months.map(() => new Map<string, ArchiveTrendBreakdown["months"][number]["segments"][number]>())
  const categories = new Map<string, ArchiveTrendBreakdown["series"][number]>()
  for (const { trip, date } of selection.filtered) {
    if (!date || selection.firstMonth === null) continue
    const index = date.monthIndex - selection.firstMonth
    const month = months[index]
    if (!month) continue
    const validMode = trip.mode === "rail" || trip.mode === "flight"
    const value = dimension === "code"
      ? placeName("flight", typeof trip.code === "string" ? trip.code.replace(/\s+/g, "").toUpperCase() : "")
      : placeName(trip.mode, dimension === "departure" ? trip.fromPlace : trip.toPlace)
    const key = validMode && value ? `${trip.mode}:${value}` : "unknown"
    const minutes = durationMinutes(trip)
    const knownDurationCount = minutes > 0 ? 1 : 0
    month.total += 1
    month.totalMinutes += minutes
    month.knownDurationCount += knownDurationCount
    month.unknownDurationCount += 1 - knownDurationCount
    const segment = counts[index].get(key) ?? { key, count: 0, minutes: 0, knownDurationCount: 0 }
    segment.count += 1
    segment.minutes += minutes
    segment.knownDurationCount += knownDurationCount
    counts[index].set(key, segment)
    const category = categories.get(key) ?? {
      key,
      label: key === "unknown"
        ? dimension === "departure" ? "未填出发站" : dimension === "arrival" ? "未填到达站" : "未填车次或航班号"
        : `${value} · ${trip.mode === "rail" ? "火车" : "航班"}`,
      total: 0, totalMinutes: 0, knownDurationCount: 0,
    }
    category.total += 1
    category.totalMinutes += minutes
    category.knownDurationCount += knownDurationCount
    categories.set(key, category)
  }
  const ranked = [...categories.values()].filter(({ key }) => key !== "unknown").sort((a, b) =>
    b.total - a.total || a.label.localeCompare(b.label, "zh-CN") || a.key.localeCompare(b.key, "en"))
  const series = ranked.slice(0, 4)
  const topKeys = new Set(series.map(({ key }) => key))
  const other = { key: "other", label: "其他", total: 0, totalMinutes: 0, knownDurationCount: 0 }
  for (const category of ranked.slice(4)) {
    other.total += category.total
    other.totalMinutes += category.totalMinutes
    other.knownDurationCount += category.knownDurationCount
  }
  if (other.total) series.push(other)
  const unknown = categories.get("unknown")
  if (unknown) series.push(unknown)
  for (let index = 0; index < months.length; index += 1) {
    const grouped = new Map<string, ArchiveTrendBreakdown["months"][number]["segments"][number]>()
    for (const [key, segment] of counts[index]) {
      const group = key === "unknown" || topKeys.has(key) ? key : "other"
      const combined = grouped.get(group) ?? { key: group, count: 0, minutes: 0, knownDurationCount: 0 }
      combined.count += segment.count
      combined.minutes += segment.minutes
      combined.knownDurationCount += segment.knownDurationCount
      grouped.set(group, combined)
    }
    months[index].segments = series.flatMap(({ key }) => {
      const segment = grouped.get(key)
      return segment ? [segment] : []
    })
  }
  return { dimension, months, series }
}
