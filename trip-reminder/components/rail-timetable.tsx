import { HStack, List, Text, Toggle, useState, VStack } from "scripting"
import type { ParsedTrip } from "../services/parse"
import { railJourneyStops } from "../services/rail-stops"

/** 只渲染乘车区间，完整识别表留在记录中供修改端点后重新裁切。 */
export function RailTimetable({ trip }: { trip: ParsedTrip }) {
  const [expanded, setExpanded] = useState(false)
  if (trip.mode !== "rail") return null
  const stops = railJourneyStops(trip)
  if (!trip.railStops?.length) return <Text font="caption" foregroundStyle="secondaryLabel">未识别到经停站表；可从包含时刻表的行程截图重新识别。</Text>
  if (!stops.length) return <Text font="caption" foregroundStyle="secondaryLabel">已识别到时刻表，但未匹配乘车区间。请核对起终点名称，并确认截图包含两个端点且顺序正确。</Text>
  const departureDay = (stop: typeof stops[number]) => (stop.dayOffset ?? 0) + (stop.arrival && stop.departure && stop.departure < stop.arrival ? 1 : 0)
  const originDay = departureDay(stops[0])
  const timeLabel = (time: string, day: number) => `${time || "--:--"}${time && day > originDay ? ` (+${day - originDay}天)` : ""}`
  return <VStack alignment="leading" spacing={8}>
    <Toggle title={`展开区间时刻表 · ${Math.max(0, stops.length - 2)} 个已识别中间站`} value={expanded} onChanged={setExpanded} />
    {expanded ? <VStack alignment="leading" spacing={10}>
      <Text font="caption" foregroundStyle="secondaryLabel">{`${trip.fromPlace} → ${trip.toPlace} · 仅列出截图已识别站点，可能有遗漏，请以票务信息为准。`}</Text>
      {stops.map((stop, index) => {
        const day = (stop.dayOffset ?? originDay) - originDay
        return <VStack key={`${index}-${stop.station}`} alignment="leading" spacing={2}>
          <HStack spacing={6}>
            <Text font="headline">{`${index === 0 ? "上车" : index === stops.length - 1 ? "下车" : `${index}`} · ${stop.station}`}</Text>
            {day > 0 ? <Text font="caption" foregroundStyle="systemBlue">{`+${day} 天`}</Text> : null}
          </HStack>
          <Text font="caption" monospaced foregroundStyle="secondaryLabel">{[
            index === 0 ? "" : `到 ${timeLabel(stop.arrival, stop.dayOffset ?? originDay)}`,
            index === stops.length - 1 ? "" : `发 ${timeLabel(stop.departure, departureDay(stop))}`,
            index > 0 && index < stops.length - 1 && stop.stopMinutes != null ? `停 ${stop.stopMinutes} 分` : "",
          ].filter(Boolean).join("　")}</Text>
        </VStack>
      })}
    </VStack> : null}
  </VStack>
}

export function RailTimetablePage({ trip }: { trip: ParsedTrip }) {
  return <List navigationTitle={`${trip.code || "列车"} · 区间时刻表`} navigationBarTitleDisplayMode="inline">
    <RailTimetable trip={trip} />
  </List>
}
