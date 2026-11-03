import { Button, GeometryReader, HStack, Image, Rectangle, RoundedRectangle, ScrollView, Spacer, Text, VStack, ZStack, useState, type VirtualNode } from "scripting"
import { modeLabel, type TripMode } from "../services/parse"
import { archiveInsights, archiveTrendBreakdown, type ArchiveInsights, type ArchiveTrendBreakdown, type ArchiveTrendDimension } from "../services/statistics"
import type { Theme } from "../services/theme"
import { listTrips, type TripRecord } from "../services/trips"

export type TrendMeasure = "count" | "duration"
export type PlaceMetric = "total" | "departures" | "arrivals"
const PLACE_LABELS: Record<PlaceMetric, string> = { total: "合计", departures: "出发", arrivals: "到达" }
const DIMENSION_LABELS: Record<ArchiveTrendDimension, string> = { departure: "出发站", arrival: "到达站", code: "车次或航班号" }
const DIMENSIONS: ArchiveTrendDimension[] = ["departure", "arrival", "code"]
const MODES: Array<"all" | TripMode> = ["all", "rail", "flight"]
const minutesText = (minutes: number) => minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`
const shortMinutes = (minutes: number) => minutes < 60 ? `${minutes}分` : `${Math.floor(minutes / 60)}时${minutes % 60 ? `${minutes % 60}分` : ""}`
const monthText = (month: string) => `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`

export function statisticsPalette(theme: Theme): string[] {
  const background = theme.cardTop.replace("#", "")
  const rgb = [0, 2, 4].map(offset => parseInt(background.slice(offset, offset + 2), 16) / 255)
  const dark = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 < 0.5
  return dark
    ? ["#8CBFFF", "#F5B66F", "#83D7B0", "#D4ACF2", "#F29AB2", "#C4CDDC"]
    : ["#215DA8", "#A95117", "#237451", "#7750A2", "#B13F62", "#536379"]
}

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
    <Text font={25} fontWeight="semibold" monospacedDigit foregroundStyle={theme.ink} lineLimit={1} minScaleFactor={0.6}>{value}</Text>
  </VStack>
}

function StatsBlock({ title, icon, theme, children, footer }: { title: string; icon: string; theme: Theme; children?: VirtualNode | (VirtualNode | null | undefined)[]; footer?: VirtualNode }) {
  return <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <HStack spacing={7}>
      <Image systemName={icon} font={13} foregroundStyle={theme.sub} accessibilityHidden={true} />
      <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.ink}>{title}</Text>
    </HStack>
    {children}
    {footer}
  </VStack>
}

function FilterControl({ label, icon, theme, action }: { label: string; icon: string; theme: Theme; action?: () => void }) {
  const content = <HStack spacing={6} padding={{ horizontal: 8, vertical: 7 }}>
    <Image systemName={icon} font={12} foregroundStyle={theme.accent} accessibilityHidden={true} />
    <Text font="caption" foregroundStyle={theme.accent} lineLimit={1} minScaleFactor={0.6}>{label}</Text>
  </HStack>
  return action ? <Button buttonStyle="plain" frame={{ minWidth: 0, maxWidth: "infinity", minHeight: 36 }} background={<RoundedRectangle cornerRadius={8} fill={theme.accentSoft} />} action={action}>{content}</Button>
    : <VStack frame={{ minWidth: 0, maxWidth: "infinity", minHeight: 36 }} background={<RoundedRectangle cornerRadius={8} fill={theme.accentSoft} />}>{content}</VStack>
}

/** Pure native view, also used by the desktop layout preview. */
export function TripStatisticsContent({ insights, theme, placeMetric = "total", trendMonths = insights.months.length > 3 ? 12 : 3, onChooseYear, onChooseMode, onChoosePlaceMetric, onChooseTrend, breakdown, breakdownDimension = "departure", onChooseBreakdownDimension, measure = "count", onChooseMeasure, title = "出行统计", onClose }: {
  insights: ArchiveInsights
  measure?: TrendMeasure
  onChooseMeasure?: () => void
  title?: string
  onClose?: () => void
  breakdown?: ArchiveTrendBreakdown
  breakdownDimension?: ArchiveTrendDimension
  onChooseBreakdownDimension?: () => void
  theme: Theme
  placeMetric?: PlaceMetric
  trendMonths?: 3 | 12
  onChooseTrend?: () => void
  onChooseYear?: () => void
  onChooseMode?: () => void
  onChoosePlaceMetric?: () => void
}) {
  const { summary, months, longest } = insights
  const yearLabel = `年份：${insights.selectedYear === null ? "全部年份" : `${insights.selectedYear} 年`}`
  const modeFilterLabel = `出行方式：${insights.selectedMode === "all" ? "全部方式" : modeLabel(insights.selectedMode)}`
  const trendLabel = `趋势范围：${trendMonths === 3 ? "最近 3 个月" : "12 个月"}`
  const metricLabel = `站点排行：${PLACE_LABELS[placeMetric]}`
  const places = [...summary.places].filter(place => place[placeMetric] > 0).sort((a, b) =>
    b[placeMetric] - a[placeMetric] || a.name.localeCompare(b.name, "zh-CN") || a.mode.localeCompare(b.mode, "en"))
  const duration = measure === "duration"
  const valueOf = (item: { total: number; totalMinutes: number }) => duration ? item.totalMinutes : item.total
  const maximum = Math.max(0, ...months.map(valueOf))
  const peak = months.find(month => valueOf(month) === maximum)
  const period = months.length ? `${monthText(months[0].month)} — ${monthText(months[months.length - 1].month)}` : "暂无可用日期"
  const chartCount = months.reduce((total, month) => total + month.total, 0)
  const palette = statisticsPalette(theme)
  const series = breakdown?.series ?? []
  const colors = new Map(series.map((item, index) => [item.key, palette[index % palette.length]]))
  const labels = new Map(series.map(item => [item.key, item.label]))
  const breakdownMonths = new Map(breakdown?.months.map(month => [month.month, month]) ?? [])
  const chartMinutes = months.reduce((total, month) => total + month.totalMinutes, 0)
  const chartKnown = breakdown?.months.reduce((total, month) => total + month.knownDurationCount, 0)
  const trendNotes = `按出发月份计数；概览仍含全部筛选归档。${trendMonths === 3 ? "截至当前筛选最近有效出发月份，展示连续至多 3 个月。" : insights.selectedYear === null ? "图表展示截至最近有效出发月份的连续 12 个月。" : "图表展示所选年份的 1 至 12 月。"}${insights.selectedYear === null ? "" : `所有图示仅限所选年份。${trendMonths === 3 ? "最近 3 个月在年初可能不足 3 个月。" : ""}`}`
  const durationCoverage = `已知时长 ${summary.knownDurationCount} 次 · 缺少时长 ${summary.unknownDurationCount} 次`
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background={theme.cardTop}
    navigationTitle={title} navigationBarTitleDisplayMode="inline"
    toolbar={onClose ? { cancellationAction: <Button title="关闭" action={onClose} /> } : undefined}>
    <Rectangle fill={theme.cardTop} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} ignoresSafeArea={{ regions: "container", edges: "all" }} accessibilityHidden={true} />
    <ScrollView background={theme.cardTop}>
    <VStack alignment="leading" spacing={16} frame={{ maxWidth: "infinity", alignment: "leading" }} padding={{ horizontal: 16, top: 12, bottom: 24 }} background={theme.cardTop}>
    <HStack spacing={8}>
      <FilterControl label={yearLabel} icon="calendar" theme={theme} action={onChooseYear} />
      <FilterControl label={modeFilterLabel} icon="tram.fill" theme={theme} action={onChooseMode} />
    </HStack>
    <StatsBlock theme={theme} title="出行概览" icon="chart.bar" footer={<Text font="caption" foregroundStyle={theme.sub}>{summary.total ? `${insights.routes.length} 条常用路线 · ${durationCoverage}` : "当前范围没有归档行程。可切换年份或出行方式，或先在首页归档一段行程。"}</Text>}>
      <VStack alignment="leading" spacing={12}>
        <HStack alignment="top" spacing={12}>
          <OverviewValue label="累计行程" value={`${summary.total} 次`} theme={theme} />
          <OverviewValue label="累计时长" value={summary.knownDurationCount ? minutesText(summary.totalMinutes) : "暂无时长"} theme={theme} />
        </HStack>
        <HStack alignment="top" spacing={12}>
          <OverviewValue label="出行天数" value={`${insights.activeDays} 天`} theme={theme} />
          <OverviewValue label="到访车站 / 机场" value={`${summary.uniquePlaceCount} 处`} theme={theme} />
        </HStack>
      </VStack>
    </StatsBlock>
    <StatsBlock theme={theme} title="月度趋势" icon="chart.bar.xaxis" footer={<Text font="caption" foregroundStyle={theme.sub}>{`${period}。${insights.invalidDateCount ? `${insights.invalidDateCount} 次缺少有效日期，未计入趋势和出行天数。` : ""}`}</Text>}>
      <HStack spacing={8}>
        <FilterControl label={trendLabel} icon="calendar.badge.clock" theme={theme} action={onChooseTrend} />
        <FilterControl label={`分区：${DIMENSION_LABELS[breakdownDimension]}`} icon="square.stack.3d.up" theme={theme} action={onChooseBreakdownDimension} />
      </HStack>
      <FilterControl label={`图表：${duration ? "累计时长" : "出行次数"}`} icon="chart.bar" theme={theme} action={onChooseMeasure} />
      <VStack alignment="leading" spacing={8} frame={{ minHeight: maximum > 0 ? 210 : 0, alignment: "leading" }}>
        <HStack alignment="firstTextBaseline">
          <Text font="subheadline" foregroundStyle={theme.ink}>{`图示 ${chartCount} 次行程`}</Text>
          <Spacer />
          <Text font="caption" foregroundStyle={theme.sub}>{duration ? "累计时长 · 单位：分钟" : "总次数 · 单位：次"}</Text>
        </HStack>
        {maximum > 0 ? <HStack alignment="bottom" spacing={3} frame={{ height: 170 }}>
          {months.map(month => <VStack key={month.month} spacing={4} frame={{ minWidth: 0, maxWidth: "infinity", minHeight: 170, maxHeight: 170 }}
            accessibilityElement="ignore" accessibilityLabel={`${monthText(month.month)}：${month.total} 次${breakdownMonths.get(month.month)?.segments.filter(segment => segment.count > 0).map(segment => `，${labels.get(segment.key) ?? segment.key} ${segment.count} 次`).join("") ?? ""}，火车 ${month.rail} 次，航班 ${month.flight} 次，${month.totalMinutes > 0 ? `已知累计时长 ${minutesText(month.totalMinutes)}` : month.total > 0 ? "暂无可用时长" : "无行程"}`}>
            <Text font={11} monospacedDigit foregroundStyle={theme.ink} lineLimit={1} minScaleFactor={0.6} frame={{ height: 20 }}>{duration ? month.totalMinutes > 0 ? shortMinutes(month.totalMinutes) : "—" : String(month.total)}</Text>
            <VStack spacing={0} frame={{ height: 122, alignment: "bottom" }}>
              <VStack spacing={0} frame={{ width: trendMonths === 3 ? 24 : 12, height: valueOf(month) / maximum * 122 }} accessibilityHidden={true}>
                {breakdown ? (breakdownMonths.get(month.month)?.segments ?? []).filter(segment => (duration ? segment.minutes : segment.count) > 0).map(segment =>
                  <Rectangle key={segment.key} fill={colors.get(segment.key) ?? theme.accent} frame={{ width: trendMonths === 3 ? 24 : 12, height: (duration ? segment.minutes : segment.count) / maximum * 122 }} />)
                  : valueOf(month) > 0 ? <Rectangle fill={theme.accent} frame={{ width: trendMonths === 3 ? 24 : 12, height: valueOf(month) / maximum * 122 }} /> : null}
              </VStack>
            </VStack>
            <Text font={11} monospacedDigit foregroundStyle={theme.sub} lineLimit={1} minScaleFactor={0.6} frame={{ height: 20 }}>{month.month.slice(5)}</Text>
          </VStack>)}
        </HStack> : <Text font="subheadline" foregroundStyle={theme.sub}>{duration && chartCount > 0 ? "暂无可用时长" : "当前范围没有可绘制的月份。归档行程并补全出发日期后，即可查看每月出行变化。"}</Text>}
        {series.length ? <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          {series.map(item => <HStack key={item.key} spacing={8} accessibilityElement="combine">
            <RoundedRectangle cornerRadius={4} fill={colors.get(item.key)} frame={{ width: 8, height: 8 }} accessibilityHidden={true} />
            <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text font="caption" foregroundStyle={theme.ink} lineLimit={2}>{item.label}</Text>
              {duration ? <Text font="caption2" foregroundStyle={theme.sub}>{`已知 ${item.knownDurationCount} / ${item.total} 次`}</Text> : null}
            </VStack>
            <Text font="caption" monospacedDigit foregroundStyle={theme.ink} lineLimit={1}>{duration ? item.knownDurationCount ? shortMinutes(item.totalMinutes) : "—" : `${item.total} 次`}</Text>
          </HStack>)}
        </VStack> : null}
        {maximum > 0 && peak ? <Text font="caption" foregroundStyle={theme.sub} lineLimit={2}>{`${duration ? "时长最多" : "最多出行"}：${monthText(peak.month)} · ${duration ? shortMinutes(maximum) : `${maximum} 次`}${months.filter(month => valueOf(month) === maximum).length > 1 ? "（并列）" : ""}`}</Text> : null}
        {duration ? <Text font="caption" foregroundStyle={theme.sub}>{`图示已知累计 ${minutesText(chartMinutes)} · ${chartKnown === undefined ? "缺失时长不绘制" : `已知 ${chartKnown} 次 / ${chartCount} 次，缺少 ${chartCount - chartKnown} 次`}`}</Text> : null}
      </VStack>
      {months.length ? <VStack alignment="leading" spacing={5}>
        <HStack><Text font="caption" fontWeight="semibold" foregroundStyle={theme.ink}>月度明细</Text><Spacer /><Text font="caption" foregroundStyle={theme.sub}>次数 · 累计 · 平均</Text></HStack>
        {months.map(month => {
          const known = breakdownMonths.get(month.month)?.knownDurationCount
          return <HStack key={`detail-${month.month}`} spacing={6} accessibilityElement="combine">
            <Text font="caption" foregroundStyle={theme.sub}>{`${Number(month.month.slice(5))} 月`}</Text><Spacer />
            <Text font="caption" monospacedDigit foregroundStyle={theme.ink} lineLimit={1} minScaleFactor={0.6}>{`${month.total} 次 · ${month.totalMinutes > 0 ? shortMinutes(month.totalMinutes) : "—"} · ${known ? shortMinutes(Math.round(month.totalMinutes / known)) : "—"}`}</Text>
          </HStack>
        })}
      </VStack> : null}
    </StatsBlock>
    <Rectangle fill={theme.accentSoft} frame={{ height: 1 }} accessibilityHidden={true} />
    <StatsBlock theme={theme} title="出行方式" icon="tram.fill">
      <HStack spacing={16}>{(["rail", "flight"] as TripMode[]).map(mode => <VStack key={mode} alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
        <HStack accessibilityElement="combine">
          <Text foregroundStyle={theme.ink}>{modeLabel(mode)}</Text><Spacer />
          <Text font="subheadline" monospacedDigit foregroundStyle={theme.ink}>{`${summary[mode]} 次 · ${summary.total ? Math.round(summary[mode] / summary.total * 100) : 0}%`}</Text>
        </HStack>
        <FrequencyBar value={summary[mode]} maximum={summary.total} theme={theme} />
      </VStack>)}</HStack>
    </StatsBlock>
    <StatsBlock theme={theme} title="时长统计" icon="clock" footer={<Text font="caption" foregroundStyle={theme.sub}>仅使用已填写或可由出发 / 到达时间计算的时长；缺失时长不按 0 分钟计入平均。</Text>}>
      <HStack accessibilityElement="combine"><Text foregroundStyle={theme.ink}>平均每次</Text><Spacer /><Text fontWeight="semibold" foregroundStyle={theme.ink}>{insights.averageMinutes === null ? "暂无可用时长" : minutesText(insights.averageMinutes)}</Text></HStack>
      <VStack alignment="leading" spacing={5}>
        <HStack><Text foregroundStyle={theme.ink}>最长行程</Text><Spacer /><Text fontWeight="semibold" foregroundStyle={theme.ink}>{longest ? minutesText(longest.minutes) : "暂无可用时长"}</Text></HStack>
        {longest ? <Text font="caption" foregroundStyle={theme.sub} lineLimit={2} minScaleFactor={0.8}>{`${longest.code || "未填写车次 / 航班号"} · ${longest.from || "未填写出发地"} → ${longest.to || "未填写到达地"}`}</Text> : null}
      </VStack>
      <Text font="caption" foregroundStyle={theme.sub}>{durationCoverage}</Text>
    </StatsBlock>
    <Rectangle fill={theme.accentSoft} frame={{ height: 1 }} accessibilityHidden={true} />
    <StatsBlock theme={theme} title="常用车站与机场" icon="mappin.and.ellipse" footer={<Text font="caption" foregroundStyle={theme.sub}>最多显示前 8 处。只统计行程两端，不包含经停站；同名车站与机场分别统计。</Text>}>
      {onChoosePlaceMetric ? <Button buttonStyle="plain" frame={{ minHeight: 32, maxWidth: "infinity", alignment: "leading" }} action={onChoosePlaceMetric}><HStack spacing={7}><Image systemName="line.3.horizontal.decrease.circle" font={13} foregroundStyle={theme.accent} accessibilityHidden={true} /><Text foregroundStyle={theme.accent}>{metricLabel}</Text></HStack></Button> : <Text foregroundStyle={theme.ink}>{metricLabel}</Text>}
      {places.length ? places.slice(0, 8).map((place, index) => <HStack key={`${place.mode}-${place.name}`} alignment="top" spacing={12}>
        <Text font="caption" monospacedDigit foregroundStyle={theme.sub} frame={{ width: 16 }} padding={{ top: 3 }}>{String(index + 1)}</Text>
        <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <HStack alignment="firstTextBaseline" spacing={8}>
            <Text foregroundStyle={theme.ink} lineLimit={2} minScaleFactor={0.8}>{place.name}</Text><Spacer />
            <Text font="subheadline" monospacedDigit foregroundStyle={theme.ink} lineLimit={1}>{`${place[placeMetric]} 次`}</Text>
          </HStack>
          <FrequencyBar value={place[placeMetric]} maximum={places[0][placeMetric]} theme={theme} />
          <Text font="caption" foregroundStyle={theme.sub}>{`${modeLabel(place.mode)} · 出发 ${place.departures} 次 · 到达 ${place.arrivals} 次`}</Text>
        </VStack>
      </HStack>) : <Text font="subheadline" foregroundStyle={theme.sub}>当前范围暂无地点记录。补全归档行程的出发 / 到达地点后，即可查看排行。</Text>}
    </StatsBlock>
    <StatsBlock theme={theme} title="常用路线" icon="arrow.triangle.branch" footer={<Text font="caption" foregroundStyle={theme.sub}>{`最多显示前 5 条；相同方向、相同出行方式合并，往返分别统计。${insights.missingRouteCount ? `${insights.missingRouteCount} 次缺少起点或终点，未计入路线。` : ""}`}</Text>}>
      {insights.routes.length ? insights.routes.slice(0, 5).map((route, index) => <VStack key={`${route.mode}-${route.from}-${route.to}`} alignment="leading" spacing={8}>
        <HStack alignment="top" spacing={10}>
          <Text font="caption" monospacedDigit foregroundStyle={theme.sub} frame={{ width: 16 }} padding={{ top: 3 }}>{String(index + 1)}</Text>
          <Text foregroundStyle={theme.ink} lineLimit={2} minScaleFactor={0.8} frame={{ maxWidth: "infinity", alignment: "leading" }}>{`${route.from} → ${route.to}`}</Text>
          <Text font="subheadline" monospacedDigit foregroundStyle={theme.ink} lineLimit={1}>{`${route.total} 次`}</Text>
        </HStack>
        <FrequencyBar value={route.total} maximum={insights.routes[0].total} theme={theme} />
        <Text font="caption" foregroundStyle={theme.sub}>{`${modeLabel(route.mode)} · ${route.knownDurationCount ? `已知累计 ${minutesText(route.totalMinutes)}（${route.knownDurationCount} 次）` : "暂无可用时长"}`}</Text>
      </VStack>) : <Text font="subheadline" foregroundStyle={theme.sub}>补全归档行程的起点和终点后，即可查看常用路线。</Text>}
    </StatsBlock>
    <StatsBlock theme={theme} title="数据完整度" icon="checkmark.circle">
      <Text font="caption" foregroundStyle={theme.ink}>{`时长 ${summary.total ? Math.round(summary.knownDurationCount / summary.total * 100) : 0}% · 有效日期 ${summary.total ? Math.round((summary.total - insights.invalidDateCount) / summary.total * 100) : 0}% · 缺少起终点 ${insights.missingRouteCount} 次`}</Text>
      <Text font="caption" foregroundStyle={theme.sub}>完整度按当前筛选行程计算；平均时长仅以已知时长的行程为分母。</Text>
    </StatsBlock>
    <StatsBlock theme={theme} title="统计说明" icon="info.circle">
      <Text font="caption" foregroundStyle={theme.sub}>{trendNotes}</Text>
      <Text font="caption" foregroundStyle={theme.sub}>地点按车站 / 机场分别去重；活跃天数按有效出发日期去重。分区显示图示范围内最多的前 4 类，其余合并为其他；未填写项单独列出。</Text>
      <Text font="caption" foregroundStyle={theme.sub}>每条归档记录计 1 次，不按乘客人数计数。包含手动归档的未来行程，仅代表本机已记录，未核实是否实际完成。</Text>
    </StatsBlock>
    </VStack>
    </ScrollView>
  </ZStack>
}

export function TripStatisticsPage({ theme, records: liveRecords, onClose, title = "出行统计" }: { theme: Theme; records?: TripRecord[]; onClose?: () => void; title?: string }) {
  const [year, setYear] = useState<number | null>(null)
  const [mode, setMode] = useState<"all" | TripMode>("all")
  const [placeMetric, setPlaceMetric] = useState<PlaceMetric>("total")
  const [trendMonths, setTrendMonths] = useState<3 | 12>(3)
  const [breakdownDimension, setBreakdownDimension] = useState<ArchiveTrendDimension>("departure")
  const [measure, setMeasure] = useState<TrendMeasure>("count")
  const records = liveRecords ?? listTrips()
  const filter = { year: year ?? undefined, mode, trendMonths }
  const insights = archiveInsights(records, filter)
  const breakdown = archiveTrendBreakdown(records, filter, breakdownDimension)
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
  const chooseTrend = async () => {
    const values: Array<3 | 12> = [3, 12]
    const index = await Dialog.actionSheet({ title: "趋势范围", actions: [{ label: "最近 3 个月" }, { label: "12 个月" }], cancelButton: true })
    if (index != null && index >= 0 && index < values.length) setTrendMonths(values[index])
  }
  const chooseBreakdownDimension = async () => {
    const index = await Dialog.actionSheet({ title: "选择柱图分区", actions: DIMENSIONS.map(value => ({ label: DIMENSION_LABELS[value] })), cancelButton: true })
    if (index != null && index >= 0 && index < DIMENSIONS.length) setBreakdownDimension(DIMENSIONS[index])
  }
  const chooseMeasure = async () => {
    const values: TrendMeasure[] = ["count", "duration"]
    const index = await Dialog.actionSheet({ title: "选择图表指标", actions: [{ label: "出行次数" }, { label: "累计时长" }], cancelButton: true })
    if (index != null && index >= 0 && index < values.length) setMeasure(values[index])
  }
  return <TripStatisticsContent insights={insights} theme={theme} title={title} onClose={onClose} measure={measure} onChooseMeasure={() => void chooseMeasure()} placeMetric={placeMetric} trendMonths={trendMonths}
    breakdown={breakdown} breakdownDimension={breakdownDimension} onChooseBreakdownDimension={() => void chooseBreakdownDimension()}
    onChooseTrend={() => void chooseTrend()}
    onChooseYear={() => void chooseYear()} onChooseMode={() => void chooseMode()} onChoosePlaceMetric={() => void choosePlaceMetric()} />
}
