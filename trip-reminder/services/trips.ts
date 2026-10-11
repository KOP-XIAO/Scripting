// services/trips.ts — 行程的本机存储与「下一班」选择（火车 / 航班通用）
// Storage / Widget 为全局对象，禁止从 scripting 导入。
// 隐私：数据只写入本机 Storage（rail.* 键），不发起任何网络请求。

import { type ParsedTrip, arriveTimestamp, departTimestamp } from "./parse"

export type TripRecord = ParsedTrip & {
  id: string
  note: string
  createdAt: string
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

function write(list: TripRecord[]) {
  try {
    Storage.set(KEY, list)
  } catch {}
  try {
    Widget.reloadAll() // 行程变化立即刷新主屏幕小组件
  } catch {}
}

export function listTrips(): TripRecord[] {
  return read().sort((a, b) => departTimestamp(a) - departTimestamp(b))
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

export function clearTrips(): TripRecord[] {
  write([])
  return []
}

export function newTripId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// 下一班：发车/起飞时间最近的「还没结束」的行程；都结束了则返回最后一条（便于回看）
export function nextTrip(now = Date.now()): TripRecord | null {
  const list = listTrips()
  if (!list.length) return null
  const upcoming = list.find((t) => {
    const arr = arriveTimestamp(t)
    return arr ? arr >= now : departTimestamp(t) >= now
  })
  return upcoming ?? list[list.length - 1]
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
export function widgetSnapshot(): { trip: TripRecord | null; showPassenger: boolean } {
  return { trip: nextTrip(), showPassenger: getShowPassenger() }
}
