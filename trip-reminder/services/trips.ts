// services/trips.ts — 行程的本机存储与「下一班」选择（火车 / 航班通用）
// Storage / Widget 为全局对象，禁止从 scripting 导入。
// 隐私：数据只写入本机 Storage（rail.* 键），不发起任何网络请求。

import { type ParsedTrip, arriveTimestamp, departTimestamp, seatText, tripDurationMinutes } from "./parse"

export type TripRecord = ParsedTrip & {
  id: string
  note: string
  createdAt: string
  archivedAt?: string
}

const KEY = "rail.trips"
const SHOW_PASSENGER_KEY = "rail.showPassenger"

function read(): TripRecord[] {
  try {
    const v = Storage.get<TripRecord[]>(KEY)
    return Array.isArray(v) ? v.filter((t) => t && typeof t === "object") : []
  } catch {
    return []
  }
}

function write(list: TripRecord[], reloadWidgets = true) {
  try {
    Storage.set(KEY, list)
  } catch {}
  if (!reloadWidgets) return
  try {
    Widget.reloadAll() // 行程变化立即刷新主屏幕小组件
  } catch {}
}

// arriveTimestamp 缺少历时时返回出发时间；归档须保守地保留到出发日结束。
function endTimestamp(trip: TripRecord): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trip.departDate)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(trip.departTime)) return 0
  const departure = departTimestamp(trip)
  const date = new Date(departure)
  if (!Number.isFinite(departure) || !departure
    || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` !== trip.departDate) return 0
  const validArrival = /^([01]\d|2[0-3]):[0-5]\d$/.test(trip.arriveTime)
  const usable = { ...trip, arriveTime: validArrival ? trip.arriveTime : "" }
  const duration = tripDurationMinutes(usable)
  if (Number.isFinite(duration) && duration > 0) {
    const arrival = arriveTimestamp(usable)
    if (Number.isFinite(arrival) && arrival > departure) return arrival
  }
  date.setHours(24, 0, 0, 0)
  return date.getTime()
}

export function listTrips(now = Date.now()): TripRecord[] {
  let changed = false
  const list = read().map((trip) => {
    const end = trip.archivedAt ? 0 : endTimestamp(trip)
    if (!end || end > now || !Number.isFinite(now)) return trip
    changed = true
    return { ...trip, archivedAt: new Date(now).toISOString() }
  })
  // 小组件也读取列表；持久化归档不得触发递归刷新。
  if (changed) write(list, false)
  return list.sort((a, b) => departTimestamp(a) - departTimestamp(b))
}

export function upsertTrip(trip: TripRecord): TripRecord[] {
  const list = read()
  const i = list.findIndex((t) => t.id === trip.id)
  if (i >= 0) list[i] = trip
  else list.push(trip)
  write(list)
  return listTrips()
}

export function deleteTrip(id: string): TripRecord[] {
  write(read().filter((t) => t.id !== id))
  return listTrips()
}

// 清空未归档记录时保留归档。
export function clearTrips(): TripRecord[] {
  write(read().filter((t) => !!t.archivedAt))
  return listTrips()
}

export function archiveTrip(id: string): TripRecord[] {
  write(read().map((t) => t.id === id && !t.archivedAt
    ? { ...t, archivedAt: new Date().toISOString() } : t))
  return listTrips()
}

export function newTripId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// 下一班：出发时间最近且尚未结束的有效行程；没有候选时返回 null。
export function nextTrip(now = Date.now()): TripRecord | null {
  return listTrips(now).find((trip) => !trip.archivedAt && endTimestamp(trip) > now) ?? null
}

const HIDE_SEAT_NUMBER_KEY = "rail.hideSeatNumber"

export function getHideSeatNumber(): boolean {
  try {
    return Storage.get<boolean>(HIDE_SEAT_NUMBER_KEY) === true
  } catch {
    return false
  }
}

export function setHideSeatNumber(hidden: boolean) {
  try {
    if (Storage.set(HIDE_SEAT_NUMBER_KEY, hidden) === false) return
  } catch { return }
  try {
    Widget.reloadAll()
  } catch {}
}

export function displaySeat(trip: Parameters<typeof seatText>[0], hidden = getHideSeatNumber()): string {
  return seatText(hidden ? { ...trip, seatCar: "", seatNo: "" } : trip)
}

// -------------------------------------------------------------
// 乘客姓名显示模式：完整 / 打码 / 隐藏（旧版布尔开关自动迁移）
// -------------------------------------------------------------
export type PassengerMode = "full" | "masked" | "hidden"

const PASSENGER_MODE_KEY = "rail.passengerMode"

export function getPassengerMode(): PassengerMode {
  try {
    const v = Storage.get<string>(PASSENGER_MODE_KEY)
    if (v === "full" || v === "masked" || v === "hidden") return v
    const legacy = Storage.get<boolean>(SHOW_PASSENGER_KEY)
    return legacy === false ? "hidden" : "full"
  } catch {
    return "full"
  }
}

export function setPassengerMode(mode: PassengerMode) {
  try {
    Storage.set(PASSENGER_MODE_KEY, mode)
  } catch {}
  try {
    Widget.reloadAll()
  } catch {}
}

// 打码：张三 -> 张×；John -> J***
export function maskPassenger(name: string): string {
  const n = name.trim()
  if (!n) return ""
  return /^[A-Za-z]/.test(n) ? n[0] + "***" : n[0] + "×"
}

// 按模式输出要显示的姓名（hidden 时返回空串，调用方应跳过渲染）
export function displayPassenger(name: string, mode: PassengerMode = getPassengerMode()): string {
  if (mode === "hidden") return ""
  if (mode === "masked") return maskPassenger(name)
  return name
}

export function passengerModeLabel(mode: PassengerMode): string {
  return mode === "full" ? "完整显示" : mode === "masked" ? "打码显示（张×）" : "隐藏"
}

// 小组件与 App 共享的轻量快照
export function widgetSnapshot(): { trip: TripRecord | null } {
  return { trip: nextTrip() }
}
