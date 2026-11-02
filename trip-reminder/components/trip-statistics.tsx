import { Button, GeometryReader, HStack, List, Rectangle, RoundedRectangle, Section, Spacer, Text, VStack, ZStack, useState } from "scripting"
import { modeLabel, type TripMode } from "../services/parse"
import { archiveInsights, type ArchiveInsights } from "../services/statistics"
import type { Theme } from "../services/theme"
import { listTrips } from "../services/trips"

export type PlaceMetric = "total" | "departures" | "arrivals"
const PLACE_LABELS: Record<PlaceMetric, string> = { total: "合计", departures: "出发", arrivals: "到达" }
const MODES: Array<"all" | TripMode> = ["all", "rail", "flight"]
const minutesText = (minutes: number) => minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`
const monthText = (month: string) => `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`

function FrequencyBar({ value, maximum, theme }: { value: number; maximum: number; theme: Theme }) {
  const fraction = maximum > 0 ? Math.min(1, Math.max(0, value / maximum)) : 0
  return <VStack spacing={0} frame={{ height: 6 }} accessibilityHidden={true}>
    <GeometryReader>
      {proxy => <ZStack alignment="leading" frame={{ width: proxy.size.width, height: 6 }}>
        <RoundedRectangle cornerRadius={3} fill={theme.accentSoft} frame={{ width: proxy.size.width, height: 6 }} />
        <RoundedRectangle cornerRadius={3} fill={theme.accent} frame={{ width: Math.max(0, proxy.size.width) * fraction, height: 6 }} />
      </ZStack>}
    </GeometryReader>
  </VStack>
}

function OverviewValue({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  return <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }} accessibilityElement="combine">
    <Text font="caption" foregroundStyle={theme.sub}>{label}</Text>
    <Text font={28} fontWeight="semibold" monospacedDigit foregroundStyle={theme.ink} lineLimit={1} minScaleFactor={0.6}>{value}</Text>
  </VStack>
}

/** Pure native view, also used by the desktop layout preview. */
export function TripStatisticsContent({ insights, theme, placeMetric = "total", onChooseYear, onChooseMode, onChoosePlaceMetric }: {
  insights: ArchiveInsights
  theme: Theme
  placeMetric?: PlaceMetric
  onChooseYear?: () => void
  onChooseMode?: () => void
  onChoosePlaceMetric?: () => void
}) {
  const { summary, months, longest } = insights
  const yearLabel = `年份：${insights.selectedYear === null ? "全部年份" : `${insights.selectedYear} 年`}`
  const modeFilterLabel = `出行方式：${insights.selectedMode === "all" ? "全部方式" : modeLabel(insights.selectedMode)}`
  const metricLabel = `站点排行：${PLACE_LABELS[placeMetric]}`
  const places = [...summary.places].filter(place => place[placeMetric] > 0).sort((a, b) =>
    b[placeMetric] - a[placeMetric] || a.name.localeCompare(b.name, "zh-CN") || a.mode.localeCompare(b.mode, "en"))
  const maximum = Math.max(0, ...months.map(month => month.total))
  const peak = months.find(month => month.total === maximum)
  const period = months.length ? `${monthText(months[0].month)} — ${monthText(months[months.length - 1].month)}` : "暂无可用日期"
  const chartCount = months.reduce((total, month) => total + month.total, 0)
  const durationCoverage = `已知时长 ${summary.knownDurationCount} 次 · 缺少时长 ${summary.unknownDurationCount} 次`
  const rowBackground = <Rectangle fill={theme.cardTop} />
  return <List navigationTitle="详细统计" navigationBarTitleDisplayMode="inline">
    <Section title="统计范围" footer={<Text font="caption" foregroundStyle="secondaryLabel">按出发日期筛选；下方所有统计随筛选更新。</Text>} listRowBackground={rowBackground}>
      {onChooseYear ? <Button action={onChooseYear}><Text foregroundStyle={theme.accent}>{yearLabel}</Text></Button> : <Text foregroundStyle={theme.ink}>{yearLabel}</Text>}
      {onChooseMode ? <Button action={onChooseMode}><Text foregroundStyle={theme.accent}>{modeFilterLabel}</Text></Button> : <Text foregroundStyle={theme.ink}>{modeFilterLabel}</Text>}
    </Section>
    <Section title="出行概览" footer={<Text font="caption" foregroundStyle="secondaryLabel">{summary.total ? `${durationCoverage}。地点按车站 / 机场分别去重；活跃天数按有效出发日期去重。` : "当前范围没有归档行程。可切换年份或出行方式，或先在首页归档一段行程。"}</Text>}>
      <VStack alignment="leading" spacing={20} padding={16} background={theme.cardTop}
        clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }} listRowInsets={0} listRowBackground={rowBackground}>
        <HStack alignment="top" spacing={16}>
          <OverviewValue label="累计行程" value={`${summary.total} 次`} theme={theme} />
          <OverviewValue label="累计时长" value={summary.knownDurationCount ? minutesText(summary.totalMinutes) : "暂无时长"} theme={theme} />
        </HStack>
        <HStack alignment="top" spacing={16}>
          <OverviewValue label="出行天数" value={`${insights.activeDays} 天`} theme={theme} />
          <OverviewValue label="到访车站 / 机场" value={`${summary.uniquePlaceCount} 处`} theme={theme} />
        </HStack>
      </VStack>
    </Section>
    <Section title="月度趋势" footer={<Text font="caption" foregroundStyle="secondaryLabel">{`${period}。按出发月份计数${insights.selectedYear === null ? "；全部年份的概览包含所有归档，图表仅展示截至最近有效出发月份的连续 12 个月" : ""}。${insights.invalidDateCount ? `${insights.invalidDateCount} 次缺少有效日期，未计入趋势和出行天数。` : ""}`}</Text>} listRowBackground={rowBackground}>
      <VStack alignment="leading" spacing={12} frame={{ minHeight: maximum > 0 ? 250 : 0, alignment: "leading" }} padding={{ top: 8, bottom: 8 }}>
        <HStack alignment="firstTextBaseline">
          <Text font="subheadline" foregroundStyle={theme.ink}>{`图示 ${chartCount} 次行程`}</Text>
          <Spacer />
          <Text font="caption" foregroundStyle={theme.sub}>单位：次</Text>
        </HStack>
        {maximum > 0 ? <HStack alignment="bottom" spacing={3} frame={{ height: 170 }}>
          {months.map(month => <VStack key={month.month} spacing={4} frame={{ minWidth: 0, maxWidth: "infinity", minHeight: 170, maxHeight: 170 }}
            accessibilityElement="ignore" accessibilityLabel={`${monthText(month.month)}：${month.total} 次，火车 ${month.rail} 次，航班 ${month.flight} 次，${month.totalMinutes > 0 ? `已知累计时长 ${minutesText(month.totalMinutes)}` : month.total > 0 ? "暂无可用时长" : "无行程"}`}>
            <Text font={11} monospacedDigit foregroundStyle={theme.ink} lineLimit={1} minScaleFactor={0.6} frame={{ height: 20 }}>{String(month.total)}</Text>
            <VStack spacing={0} frame={{ height: 122, alignment: "bottom" }}>
              <RoundedRectangle cornerRadius={3} fill={theme.accent} frame={{ width: 12, height: month.total / maximum * 122 }} />
            </VStack>
            <Text font={11} monospacedDigit foregroundStyle={theme.sub} lineLimit={1} minScaleFactor={0.6} frame={{ height: 20 }}>{month.month.slice(5)}</Text>
          </VStack>)}
        </HStack> : <Text font="subheadline" foregroundStyle={theme.sub}>当前范围没有可绘制的月份。归档行程并补全出发日期后，即可查看每月出行变化。</Text>}
        {maximum > 0 && peak ? <Text font="caption" foregroundStyle={theme.sub} lineLimit={2}>{`最多出行：${monthText(peak.month)} · ${maximum} 次${months.filter(month => month.total === maximum).length > 1 ? "（并列）" : ""}`}</Text> : null}
      </VStack>
    </Section>
    <Section title="出行方式" footer={<Text font="caption" foregroundStyle="secondaryLabel">占比以当前范围的归档行程为分母。</Text>} listRowBackground={rowBackground}>
      {(["rail", "flight"] as TripMode[]).map(mode => <VStack key={mode} alignment="leading" spacing={9} padding={{ top: 5, bottom: 5 }}>
        <HStack accessibilityElement="combine">
          <Text foregroundStyle={theme.ink}>{modeLabel(mode)}</Text><Spacer />
          <Text font="subheadline" monospacedDigit foregroundStyle={theme.ink}>{`${summary[mode]} 次 · ${summary.total ? Math.round(summary[mode] / summary.total * 100) : 0}%`}</Text>
        </HStack>
        <FrequencyBar value={summary[mode]} maximum={summary.total} theme={theme} />
      </VStack>)}
    </Section>
    <Section title="时长统计" footer={<Text font="caption" foregroundStyle="secondaryLabel">仅使用已填写或可由出发 / 到达时间计算的时长；缺失时长不按 0 分钟计入平均。</Text>} listRowBackground={rowBackground}>
      <HStack accessibilityElement="combine"><Text foregroundStyle={theme.ink}>平均每次</Text><Spacer /><Text fontWeight="semibold" foregroundStyle={theme.ink}>{insights.averageMinutes === null ? "暂无可用时长" : minutesText(insights.averageMinutes)}</Text></HStack>
      <VStack alignment="leading" spacing={5}>
        <HStack><Text foregroundStyle={theme.ink}>最长行程</Text><Spacer /><Text fontWeight="semibold" foregroundStyle={theme.ink}>{longest ? minutesText(longest.minutes) : "暂无可用时长"}</Text></HStack>
        {longest ? <Text font="caption" foregroundStyle={theme.sub} lineLimit={2} minScaleFactor={0.8}>{`${longest.code || "未填写车次 / 航班号"} · ${longest.from || "未填写出发地"} → ${longest.to || "未填写到达地"}`}</Text> : null}
      </VStack>
      <Text font="caption" foregroundStyle={theme.sub}>{durationCoverage}</Text>
    </Section>
    <Section title="常用车站与机场" footer={<Text font="caption" foregroundStyle="secondaryLabel">最多显示前 8 处。只统计行程两端，不包含经停站；同名车站与机场分别统计。</Text>} listRowBackground={rowBackground}>
      {onChoosePlaceMetric ? <Button action={onChoosePlaceMetric}><Text foregroundStyle={theme.accent}>{metricLabel}</Text></Button> : <Text foregroundStyle={theme.ink}>{metricLabel}</Text>}
      {places.length ? places.slice(0, 8).map((place, index) => <HStack key={`${place.mode}-${place.name}`} alignment="top" spacing={12} padding={{ top: 5, bottom: 5 }}>
        <Text font="caption" monospacedDigit foregroundStyle={theme.sub} frame={{ width: 16 }} padding={{ top: 3 }}>{String(index + 1)}</Text>
        <VStack alignment="leading" spacing={7} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <HStack alignment="firstTextBaseline" spacing={8}>
            <Text foregroundStyle={theme.ink} lineLimit={2} minScaleFactor={0.8}>{place.name}</Text><Spacer />
            <Text font="subheadline" monospacedDigit foregroundStyle={theme.ink} lineLimit={1}>{`${place[placeMetric]} 次`}</Text>
          </HStack>
          <FrequencyBar value={place[placeMetric]} maximum={places[0][placeMetric]} theme={theme} />
          <Text font="caption" foregroundStyle={theme.sub}>{`${modeLabel(place.mode)} · 出发 ${place.departures} 次 · 到达 ${place.arrivals} 次`}</Text>
        </VStack>
      </HStack>) : <Text font="subheadline" foregroundStyle={theme.sub}>当前范围暂无地点记录。补全归档行程的出发 / 到达地点后，即可查看排行。</Text>}
    </Section>
    <Section title="常用路线" footer={<Text font="caption" foregroundStyle="secondaryLabel">{`最多显示前 5 条；相同方向、相同出行方式合并，往返分别统计。${insights.missingRouteCount ? `${insights.missingRouteCount} 次缺少起点或终点，未计入路线。` : ""}`}</Text>} listRowBackground={rowBackground}>
      {insights.routes.length ? insights.routes.slice(0, 5).map((route, index) => <VStack key={`${route.mode}-${route.from}-${route.to}`} alignment="leading" spacing={8} padding={{ top: 5, bottom: 5 }}>
        <HStack alignment="top" spacing={10}>
          <Text font="caption" monospacedDigit foregroundStyle={theme.sub} frame={{ width: 16 }} padding={{ top: 3 }}>{String(index + 1)}</Text>
          <Text foregroundStyle={theme.ink} lineLimit={2} minScaleFactor={0.8} frame={{ maxWidth: "infinity", alignment: "leading" }}>{`${route.from} → ${route.to}`}</Text>
          <Text font="subheadline" monospacedDigit foregroundStyle={theme.ink} lineLimit={1}>{`${route.total} 次`}</Text>
        </HStack>
        <FrequencyBar value={route.total} maximum={insights.routes[0].total} theme={theme} />
        <Text font="caption" foregroundStyle={theme.sub}>{`${modeLabel(route.mode)} · ${route.knownDurationCount ? `已知累计 ${minutesText(route.totalMinutes)}（${route.knownDurationCount} 次）` : "暂无可用时长"}`}</Text>
      </VStack>) : <Text font="subheadline" foregroundStyle={theme.sub}>补全归档行程的起点和终点后，即可查看常用路线。</Text>}
    </Section>
    <Section footer={<Text font="caption" foregroundStyle="secondaryLabel">每条归档记录计 1 次，不按乘客人数计数。包含手动归档的未来行程，仅代表本机已记录，未核实是否实际完成。</Text>} />
  </List>
}

export function TripStatisticsPage({ theme }: { theme: Theme }) {
  const [year, setYear] = useState<number | null>(null)
  const [mode, setMode] = useState<"all" | TripMode>("all")
  const [placeMetric, setPlaceMetric] = useState<PlaceMetric>("total")
  const insights = archiveInsights(listTrips(), { year: year ?? undefined, mode })
  const chooseYear = async () => {
    const values: Array<number | null> = [null, ...insights.years]
    const index = await Dialog.actionSheet({ title: "选择统计年份", actions: values.map(value => ({ label: value === null ? "全部年份" : `${value} 年` })), cancelButton: true })
    if (index != null && index >= 0 && index < values.length) setYear(values[index])
  }
  const chooseMode = async () => {
    const index = await Dialog.actionSheet({ title: "选择出行方式", actions: MODES.map(value => ({ label: value === "all" ? "全部方式" : modeLabel(value) })), cancelButton: true })
    if (index != null && index >= 0 && index < MODES.length) setMode(MODES[index])
  }
  const choosePlaceMetric = async () => {
    const values: PlaceMetric[] = ["total", "departures", "arrivals"]
    const index = await Dialog.actionSheet({ title: "站点排行依据", actions: values.map(value => ({ label: PLACE_LABELS[value] })), cancelButton: true })
    if (index != null && index >= 0 && index < values.length) setPlaceMetric(values[index])
  }
  return <TripStatisticsContent insights={insights} theme={theme} placeMetric={placeMetric}
    onChooseYear={() => void chooseYear()} onChooseMode={() => void chooseMode()} onChoosePlaceMetric={() => void choosePlaceMetric()} />
}
