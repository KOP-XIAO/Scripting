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
    const minutes = tripDurationMinutes({
      durationMin: typeof trip.durationMin === "number" ? trip.durationMin : 0,
      departTime: typeof trip.departTime === "string" ? trip.departTime : "",
      arriveTime: typeof trip.arriveTime === "string" ? trip.arriveTime : "",
    })
    if (Number.isFinite(minutes) && minutes > 0) {
      result.totalMinutes += minutes
      result.knownDurationCount += 1
    } else {
      result.unknownDurationCount += 1
    }
    if (!validMode) continue
    for (const direction of ["departures", "arrivals"] as const) {
      const value = direction === "departures" ? trip.fromPlace : trip.toPlace
      const raw = typeof value === "string" ? value : ""
      const name = trip.mode === "rail"
        ? stripRailStationMarker(raw).replace(/站$/, "").trim()
        : raw.trim()
      if (!name || /^(?:[-—–?？]+|未知|未识别|待补(?:全)?)$/.test(name)) continue
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
