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

export type ArchiveInsightsFilter = { year?: number; mode?: "all" | TripMode }

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

export function archiveInsights(records: TripRecord[], filter: ArchiveInsightsFilter = {}): ArchiveInsights {
  const archived = records.filter((trip) => !!trip.archivedAt).map((trip) => ({
    trip, date: departureDate(trip.departDate),
  }))
  const selectedYear = filter.year ?? null
  const selectedMode = filter.mode ?? "all"
  const filtered = archived.filter(({ trip, date }) =>
    (selectedMode === "all" || trip.mode === selectedMode)
    && (selectedYear === null || date?.year === selectedYear))
  const summary = archiveStatistics(filtered.map(({ trip }) => trip))
  const result: ArchiveInsights = {
    summary,
    years: [...new Set(archived.flatMap(({ date }) => date ? [date.year] : []))].sort((a, b) => b - a),
    selectedYear, selectedMode, months: [], routes: [],
    averageMinutes: summary.knownDurationCount ? Math.round(summary.totalMinutes / summary.knownDurationCount) : null,
    longest: null, activeDays: 0, invalidDateCount: 0, missingRouteCount: 0,
  }
  let latestMonth: number | null = null
  for (const { date } of filtered) {
    if (date && (latestMonth === null || date.monthIndex > latestMonth)) latestMonth = date.monthIndex
  }
  const firstMonth = selectedYear !== null ? selectedYear * 12 : latestMonth === null ? null : latestMonth - 11
  if (firstMonth !== null) {
    for (let offset = 0; offset < 12; offset += 1) {
      const index = firstMonth + offset
      const year = Math.floor(index / 12)
      const month = index - year * 12 + 1
      result.months.push({
        month: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
        total: 0, rail: 0, flight: 0, totalMinutes: 0,
      })
    }
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
