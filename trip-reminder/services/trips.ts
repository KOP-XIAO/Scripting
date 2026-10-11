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

export function getShowPassenger(): boolean {
  try {
    const v = Storage.get<boolean>(SHOW_PASSENGER_KEY)
    return v !== false // 默认显示
  } catch {
    return true
  }
}

export function setShowPassenger(on: boolean) {
  try {
    Storage.set(SHOW_PASSENGER_KEY, on)
  } catch {}
  try {
    Widget.reloadAll()
  } catch {}
}

// 小组件与 App 共享的轻量快照
export function widgetSnapshot(): { trip: TripRecord | null; showPassenger: boolean } {
  return { trip: nextTrip(), showPassenger: getShowPassenger() }
}
