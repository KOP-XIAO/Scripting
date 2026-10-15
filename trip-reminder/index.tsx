// index.tsx — 行程提醒（火车 + 航班，App 内页面）
// 结构：原生底部 TabView：首页行程工作流 / 设置与外观预览
// 生命周期：一次性页面 —— Navigation.present() 关闭后 Script.exit()
//
// 隐私：本脚本不发起任何网络请求。行程数据只写入本机 Storage（rail.* 键），
//      截图识别由本机 Vision 框架完成，识别结果不落盘、不上传。
//
// 注意：Dialog / Storage / Pasteboard / FileManager / Photos / Vision 等均为全局对象，
//      不要从 "scripting" 导入（生产范本验证过，导入会静默拿到 undefined）。
//
// 布局约定（本运行时实证）：
//  ① 同一行不放两个默认样式按钮（热区互相覆盖）——每个操作按钮独占一个 List 行
//  ② TextField 必须包含 title 或 label，字段采用带 title 的双列布局
//  ③ 普通列表用系统自适应色；主题卡片同时使用主题背景和配套文字色。

import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  NavigationLink,
  RoundedRectangle,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  Tab,
  TabView,
  useObservable,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"
import {
  durationText,
  countdownText,
  departTimestamp,
  gateLabel,
  missingFields,
  monthDayText,
  modeLabel,
  parseTripText,
  routeText,
  weekdayText,
  type ParsedTrip,
  type TripMode,
} from "./services/parse"
import {
  clearTrips,
  archiveTrip,
  deleteTrip,
  displayPassenger,
  getPassengerMode,
  getHideSeatNumber,
  setHideSeatNumber,
  displaySeat,
  listTrips,
  newTripId,
  nextTrip,
  passengerModeLabel,
  setPassengerMode,
  upsertTrip,
  type PassengerMode,
  type TripRecord,
} from "./services/trips"
import { recognizeFromCamera, recognizeFromPickedScreenshot } from "./services/ocr"
import { THEMES, ACCENTS, getAccentKey, getThemeKey, resolveTheme, setAccentKey, setThemeKey, type ThemeKey, type AccentKey } from "./services/theme"
import { ThemeBackground } from "./components/theme-background"
import { TripCard } from "./components/trip-card"
import { TripWidgetPreview } from "./components/trip-widget"
import { RailTimetable, RailTimetablePage } from "./components/rail-timetable"
import { VERSION } from "./utils/common"

const TRIP_MODES: TripMode[] = ["rail", "flight"]

const EMPTY_DRAFT: ParsedTrip = {
  mode: "rail",
  code: "",
  carrier: "",
  fromPlace: "",
  toPlace: "",
  departDate: "",
  departTime: "",
  arriveTime: "",
  durationMin: 0,
  gate: "",
  terminal: "",
  checkIn: "",
  boardingTime: "",
  baggage: "",
  seatCar: "",
  seatNo: "",
  seatClass: "",
  passenger: "",
}

function ArchivePage({ trips, passengerMode, hideSeatNumber }: {
  trips: TripRecord[]; passengerMode: PassengerMode; hideSeatNumber: boolean
}) {
  return <List navigationTitle="归档记录" navigationBarTitleDisplayMode="inline">
    <Section title={`归档记录 (${trips.length})`} footer={<Text font="caption" foregroundStyle="secondaryLabel">已归档行程仅供回看，不参与小组件展示。</Text>}>
      {trips.length === 0 ? <Text foregroundStyle="secondaryLabel">暂无归档记录。</Text> : [...trips].reverse().map(t =>
        <VStack key={t.id} alignment="leading" spacing={4}>
          <Text font="headline">{t.code || "—"} · {routeText(t)}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{[
            `${monthDayText(t.departDate)} ${weekdayText(t.departDate)}`.trim(),
            `${t.departTime || "--:--"} → ${t.arriveTime || "--:--"}`,
            t.terminal, t.gate ? `${gateLabel(t.mode)} ${t.gate}` : "", displaySeat(t, hideSeatNumber),
          ].filter(Boolean).join(" · ")}</Text>
          <Text font="caption2" foregroundStyle="secondaryLabel">{[
            `已归档 · ${durationText(t)}`, t.carrier, t.boardingTime ? `登机 ${t.boardingTime}` : "",
            t.checkIn ? `值机 ${t.checkIn}` : "", t.baggage ? `行李转盘 ${t.baggage}` : "",
            displayPassenger(t.passenger, passengerMode), t.note,
          ].filter(Boolean).join(" · ")}</Text>
          {t.mode === "rail" && t.railStops?.length ? <NavigationLink destination={<RailTimetablePage trip={t} />}>
            <Text font="caption" foregroundStyle="systemBlue">查看乘车区间时刻表</Text>
          </NavigationLink> : null}
        </VStack>
      )}
    </Section>
  </List>
}

function View() {
  const dismiss = Navigation.useDismiss()
  const selection = useObservable<string>("home")
  const [accentKey, setAccentKeyLocal] = useState<AccentKey>(getAccentKey())
  const [themeKey, setThemeKeyLocal] = useState<ThemeKey>(getThemeKey())
  const [passengerMode, setPassengerModeLocal] = useState<PassengerMode>(getPassengerMode())
  const [trips, setTrips] = useState<TripRecord[]>(listTrips())
  const [hideSeatNumber, setHideSeatNumberLocal] = useState(getHideSeatNumber())
  const [draft, setDraft] = useState<ParsedTrip | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState("")
  const [rawText, setRawText] = useState("")
  const [showRaw, setShowRaw] = useState(false)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      const timestamp = Date.now()
      setTrips(listTrips(timestamp))
      setNow(timestamp)
    }, 30000) // 同时刷新倒计时与自动归档
    return () => clearInterval(timer)
  }, [])

  const theme = resolveTheme(themeKey, accentKey)
  const upcoming = nextTrip(now)
  const archived = trips.filter((t) => !!t.archivedAt)
  const activeTrips = trips.filter((t) => !t.archivedAt)
  const visibleTrips = upcoming
    ? [upcoming, ...activeTrips.filter(t => t.id !== upcoming.id)]
    : activeTrips

  const refresh = () => setTrips(listTrips())
  const patch = (p: Partial<ParsedTrip>) => setDraft((d) => (d ? { ...d, ...p } : d))

  const runOCR = async (from: "photos" | "camera") => {
    setBusy(true)
    setNotice(from === "photos" ? "入口：相册选图…" : "入口：相机扫描…")
    try {
      const res = from === "photos" ? await recognizeFromPickedScreenshot() : await recognizeFromCamera()
      if (!res.ok) {
        if (res.reason === "cancelled") {
          setNotice((prev) => prev.replace("…", "（已取消）"))
          return
        }
        setNotice(res.message) // 留在提示条里，方便把这个错误发给我定位
        await Dialog.alert({
          title: res.reason === "unsupported" ? "当前版本不支持" : "识别未完成",
          message: res.message,
        })
        return
      }
      const blocks = (res.candidates ?? []).map((c) => ({
        content: String(c?.content ?? ""),
        x: c?.boundingBox?.x ?? 0,
        y: c?.boundingBox?.y ?? 0,
        w: c?.boundingBox?.width ?? 0,
        h: c?.boundingBox?.height ?? 0,
      }))
      const parsed = parseTripText(res.text, undefined, "auto", blocks) // 自动判别 + 位置兜底
      setRawText(res.text)
      setDraft(parsed)
      setDraftId(null)
      setDraftNote("")
      const miss = missingFields(parsed)
      const coreEmpty = !parsed.code && !parsed.fromPlace && !parsed.toPlace && !parsed.departTime
      if (coreEmpty) {
        // 一个字段都没解析出来：自动展开识别原文，避免看起来像"静默失败"
        setShowRaw(true)
        setNotice(
          `识别到 ${res.text.length} 个字符，但一个字段都没解析出来。已为你展开识别原文——请把它发给我，或换一张更清晰的截图`,
        )
      } else {
        setNotice(
          miss.length
            ? `已识别。这些字段没认出来，请手动补：${miss.join("、")}`
            : "已识别，请核对一遍后保存",
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const startManual = (mode: TripMode) => {
    setRawText("")
    setShowRaw(false)
    setNotice("")
    setDraft({ ...EMPTY_DRAFT, mode })
    setDraftId(null)
    setDraftNote("")
  }

  const editTrip = (t: TripRecord) => {
    setRawText("")
    setShowRaw(false)
    setNotice("")
    setDraft({ ...t })
    setDraftId(t.id) // 非空 => 表单行直接渲染在该记录所在位置（原地编辑）
    setDraftNote(t.note ?? "")
  }

  const cancelDraft = () => {
    setDraft(null)
    setDraftId(null)
    setDraftNote("")
    setRawText("")
    setShowRaw(false)
    setNotice("")
  }

  const saveDraft = () => {
    if (!draft) return
    if (!draft.code && !draft.departTime) {
      void Dialog.alert({ message: "至少要有车次/航班号或出发时间，否则小组件没东西可显示" })
      return
    }
    const existing = draftId ? trips.find((t) => t.id === draftId) : undefined
    const trip: TripRecord = {
      ...existing,
      ...draft,
      id: draftId ?? newTripId(),
      note: draftNote,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    upsertTrip(trip) // 内部会 Widget.reloadAll()
    cancelDraft()
    refresh()
  }

  const removeTrip = (t: TripRecord) => {
    deleteTrip(t.id)
    if (draftId === t.id) cancelDraft()
    refresh()
  }

  const archiveRecord = (t: TripRecord) => {
    archiveTrip(t.id)
    if (draftId === t.id) cancelDraft()
    refresh()
  }

  const choosePassengerMode = async () => {
    const idx = await Dialog.actionSheet({
      title: "乘客姓名显示",
      message: "控制首页预览下方的乘客姓名（小组件上不显示姓名）",
      actions: [{ label: "完整显示" }, { label: "打码显示（张×）" }, { label: "隐藏" }],
      cancelButton: true,
    })
    if (idx == null || idx < 0) return
    const mode: PassengerMode = idx === 0 ? "full" : idx === 1 ? "masked" : "hidden"
    setPassengerModeLocal(mode)
    setPassengerMode(mode)
  }

  const modeIcon = (m: TripMode) => (m === "flight" ? "airplane.departure" : "tram.fill")
  const draftIsFlight = draft?.mode === "flight"

  // 草稿表单：提示、模式切换、带 title 的双列字段及保存/放弃。
  const draftRows = (): any[] => {
    if (!draft) return []
    const isFlight = draftIsFlight
    const rows: any[] = []

    // 头部卡：提示条 + 火车/航班切换（卡内只有文本与小按钮，无 TextField，嵌套安全）
    rows.push(
      <VStack
        key="head"
        alignment="leading"
        spacing={8}
        padding={10}
        frame={{ maxWidth: "infinity" } as never}
        background="rgba(127,127,127,0.10)"
        clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
      >
        {notice ? (
          <HStack spacing={6}>
            <Image systemName="info.circle" font={11} foregroundStyle="systemBlue" />
            <Text font="caption2" foregroundStyle="label" lineLimit={3}>
              {notice}
            </Text>
          </HStack>
        ) : null}
        <HStack spacing={8}>
          {TRIP_MODES.map((m) => {
            const selected = draft.mode === m
            return (
              <Button
                key={m}
                buttonStyle="plain"
                action={() =>
                  patch({
                    mode: m,
                    ...(m === "rail" ? { terminal: "", checkIn: "", boardingTime: "", baggage: "" } : { seatCar: "" }),
                  })
                }
              >
                <Text
                  font="caption"
                  fontWeight={selected ? "semibold" : "regular"}
                  foregroundStyle={selected ? "systemBlue" : "secondaryLabel"}
                  padding={{ top: 3, bottom: 3, leading: 10, trailing: 10 }}
                  background={selected ? "rgba(0,122,255,0.12)" : "rgba(127,127,127,0.10)"}
                  clipShape={{ type: "rect", cornerRadius: 7, style: "continuous" }}
                >
                  {modeLabel(m)}
                </Text>
              </Button>
            )
          })}
          <Spacer />
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {rawText ? "来自截图识别" : draftId ? "编辑中" : "手动填写"}
          </Text>
        </HStack>
      </VStack>,
    )

    // 字段：每个独立一行（label + TextField 的 VStack，直接作为 List 行）
    const fields: Array<[string, string, string | undefined, (v: string) => void]> = [
      [isFlight ? "航班号" : "车次", draft.code, isFlight ? "CA1234" : "G1234",
        (v) => patch({ code: v.replace(/\s+/g, "").toUpperCase() })],
      [isFlight ? "航空公司" : "车型", draft.carrier, isFlight ? "中国国际航空" : "复兴号",
        (v) => patch({ carrier: v })],
      [`出发${isFlight ? "机场" : "车站"}`, draft.fromPlace, isFlight ? "北京首都T3" : "北京南",
        (v) => patch({ fromPlace: v })],
      [`到达${isFlight ? "机场" : "车站"}`, draft.toPlace, isFlight ? "上海虹桥T2" : "上海虹桥",
        (v) => patch({ toPlace: v })],
      ["日期", draft.departDate, "2026-10-12", (v) => patch({ departDate: v.trim() })],
      [isFlight ? "起飞时间" : "发车时间", draft.departTime, "08:32", (v) => patch({ departTime: v.trim() })],
      ["到达时间", draft.arriveTime, "08:50", (v) => patch({ arriveTime: v.trim() })],
      ["历时（分钟）", draft.durationMin ? String(draft.durationMin) : "", "18",
        (v) => patch({ durationMin: Math.max(0, Number(v) || 0) })],
    ]
    if (isFlight) {
      fields.push(["登机口", draft.gate, "C12", (v) => patch({ gate: v.trim().toUpperCase() })])
      fields.push(["航站楼", draft.terminal, "T3", (v) => patch({ terminal: v.trim().toUpperCase() })])
      fields.push(["登机时间", draft.boardingTime, "07:20", (v) => patch({ boardingTime: v.trim() })])
      fields.push(["值机柜台", draft.checkIn, "H01-H10", (v) => patch({ checkIn: v.trim().toUpperCase() })])
    } else {
      fields.push(["检票口", draft.gate, "6A", (v) => patch({ gate: v.trim().toUpperCase() })])
      fields.push(["车厢", draft.seatCar, "5", (v) => patch({ seatCar: v.replace(/\D/g, "") })])
    }
    fields.push(["座位号", draft.seatNo, isFlight ? "32A" : "12A", (v) => patch({ seatNo: v.trim().toUpperCase() })])
    fields.push([isFlight ? "舱位" : "座别", draft.seatClass, isFlight ? "经济舱" : "二等座",
      (v) => patch({ seatClass: v })])
    if (isFlight) {
      fields.push(["行李转盘", draft.baggage, "可留空", (v) => patch({ baggage: v.replace(/\D/g, "") })])
    }
    fields.push([isFlight ? "乘机人" : "乘车人", draft.passenger, "可留空", (v) => patch({ passenger: v })])
    fields.push(["备注", draftNote, "如：接人 / 报销", setDraftNote])

    // 每两个字段一行。注意：本运行时 title 是 TextField 渲染的必要条件（否则不渲染），
    // 但 title 本身不显示——可见标签由上方 Text 提供（真机截图实证）
    for (let i = 0; i < fields.length; i += 2) {
      const pair = fields.slice(i, i + 2)
      rows.push(
        <HStack key={`row${i}`} spacing={10}>
          {pair.map(([label, value, prompt, onChanged], j) => (
            <VStack key={`f${i + j}`} alignment="leading" spacing={2} frame={{ maxWidth: "infinity" } as never}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {label}
              </Text>
              <TextField title={label} value={value} prompt={prompt} onChanged={onChanged} />
            </VStack>
          ))}
        </HStack>,
      )
    }

    if (draft.mode === "rail") {
      rows.push(<RailTimetable key="rail-timetable" trip={draft} />)
    }

    if (rawText) {
      rows.push(
        <Toggle key="raw" title="查看识别原文（用于排查识别不准）" value={showRaw} onChanged={setShowRaw} />,
      )
      if (showRaw) {
        rows.push(
          <Text
            key="rawtext"
            font="caption2"
            monospaced
            foregroundStyle="label"
            padding={8}
            background="rgba(127,127,127,0.10)"
            clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}
          >
            {rawText}
          </Text>,
        )
      }
    }
    // 保存 / 放弃各自独立成行
    rows.push(<Button key="save" title="保存行程" action={saveDraft} />)
    rows.push(<Button key="cancel" title="放弃" role="destructive" action={cancelDraft} />)
    return rows
  }

  return (
    <TabView selection={selection}>
      <Tab title="首页" systemImage="house.fill" value="home">
      <NavigationStack>
      <List
        navigationTitle={`行程提醒 | v${VERSION}`}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}
      >
        {/* ---------------- 下一段行程 ---------------- */}
        <Section
          title={`行程预览 (${visibleTrips.length})`}
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              {visibleTrips.length > 1 ? "左右滑动查看其他行程；小组件显示最近一段。" : upcoming ? "小组件显示最近一段行程。" : visibleTrips.length ? "请补全出发日期和时间，以便小组件展示与自动归档。" : "用下面的截图识别或手动新建添加行程。"}
            </Text>
          }
        >
          {visibleTrips.length > 1 ? (
            <TabView tabViewStyle="page" frame={{ height: 220 }}>
              {visibleTrips.map(t => <VStack key={t.id} spacing={0} padding={{ bottom: 30 }}>
                <TripCard trip={t} theme={theme} passengerMode={passengerMode} hideSeatNumber={hideSeatNumber} now={now} />
              </VStack>)}
            </TabView>
          ) : visibleTrips.length === 1 ? (
            <TripCard trip={visibleTrips[0]} theme={theme} passengerMode={passengerMode} hideSeatNumber={hideSeatNumber} now={now} />
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无行程</Text>
          )}
        </Section>

        {/* ---------------- 识别 / 录入（每个按钮独占一行，避免热区冲突） ---------------- */}
        <Section
          title="识别行程"
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              本机识别（iOS Vision），图片不落盘、不上传。若点「相册」却弹出相机界面，请截图反馈。
            </Text>
          }
        >
          <Button
            title={busy ? "识别中…" : "从相册选行程截图识别"}
            disabled={busy}
            action={() => void runOCR("photos")}
          />
          <Button title="相机扫描（纸质票/另一台设备）" disabled={busy} action={() => void runOCR("camera")} />
          <Button title="手动新建火车行程" disabled={busy} action={() => startManual("rail")} />
          <Button title="手动新建航班行程" disabled={busy} action={() => startManual("flight")} />
        </Section>

        {/* ---------------- 核对行程（OCR 或手动新建后） ---------------- */}
        {draft && (!draftId || !visibleTrips.some(t => t.id === draftId)) ? (
          <Section
            title={`核对行程${draft.code ? ` · ${draft.code}` : ""}`}
            footer={
              <Text font="caption" foregroundStyle="secondaryLabel">
                识别错就手改，核对完点底部「保存行程」
              </Text>
            }
          >
            {draftRows()}
          </Section>
        ) : null}

        <Section title="行程管理">
          <NavigationLink destination={<ArchivePage trips={archived} passengerMode={passengerMode} hideSeatNumber={hideSeatNumber} />}>
            <Text>{`查看归档记录（${archived.length}）`}</Text>
          </NavigationLink>
        </Section>

        <Section
          title={`行程列表 (${visibleTrips.length})`}
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              到达后自动归档；缺少到达信息时，在出发日结束后归档。点按编辑，左滑可归档或删除。
            </Text>
          }
        >
          {visibleTrips.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">暂无未归档行程。</Text>
          ) : (
            visibleTrips.flatMap((t) => {
              if (draft && draftId === t.id) {
                // 原地编辑：该记录的位置直接展开为表单行
                return draftRows()
              }
              const dep = departTimestamp(t)
              return [
                <VStack
                  key={t.id}
                  alignment="leading"
                  spacing={3}
                  onTapGesture={() => editTrip(t)}
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [
                      <Button title="归档" tint="systemOrange" action={() => archiveRecord(t)} />,
                      <Button title="删除" role="destructive" action={() => removeTrip(t)} />,
                      <Button title="编辑" tint="accentColor" action={() => editTrip(t)} />,
                    ],
                  }}
                >
                  <HStack spacing={6}>
                    <Image
                      systemName={modeIcon(t.mode)}
                      font={12}
                      foregroundStyle="systemBlue"
                    />
                    <Text font="headline" monospaced foregroundStyle="systemBlue">
                      {t.code || "—"}
                    </Text>
                    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {routeText(t)}
                    </Text>
                    <Spacer />
                    <Image systemName="pencil.circle" font={12} foregroundStyle="tertiaryLabel" />
                  </HStack>
                  <Text font="caption2" monospaced foregroundStyle="secondaryLabel" lineLimit={1}>
                    {[
                      `${monthDayText(t.departDate)} ${weekdayText(t.departDate)}`.trim(),
                      `${t.departTime || "--:--"} → ${t.arriveTime || "--:--"}`,
                      t.terminal ? t.terminal : "",
                      t.gate ? `${gateLabel(t.mode)} ${t.gate}` : "",
                      displaySeat(t, hideSeatNumber),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  <Text font="caption2" foregroundStyle="systemBlue">
                    {dep ? countdownText(t, now) : "待补全出发时间"}
                    {t.note ? `　·　${t.note}` : ""}
                  </Text>
                </VStack>,
                ...(t.mode === "rail" && t.railStops?.length ? [
                  <NavigationLink key={`${t.id}-stops`} destination={<RailTimetablePage trip={t} />}>
                    <Text font="caption" foregroundStyle="systemBlue">{`${t.code || "列车"} · 查看乘车区间时刻表`}</Text>
                  </NavigationLink>,
                ] : []),
              ]
            })
          )}
          {visibleTrips.length > 0 ? (
            <Button
              title="清空未归档行程"
              role="destructive"
              action={async () => {
                const ok = await Dialog.confirm({
                  title: "清空未归档行程",
                  message: "归档记录将保留。只删除本机未归档行程，不影响票务 App。",
                  confirmLabel: "清空",
                })
                if (ok) {
                  clearTrips()
                  cancelDraft()
                  refresh()
                }
              }}
            />
          ) : null}
        </Section>

      </List>
      </NavigationStack>
      </Tab>
      <Tab title="设置" systemImage="gearshape.fill" value="settings">
      <NavigationStack>
      <List navigationTitle="设置" navigationBarTitleDisplayMode="inline"
        toolbar={{ cancellationAction: <Button title="关闭" action={dismiss} /> }}>
        <Section title="外观预览" footer={<Text font="caption" foregroundStyle="secondaryLabel">
          {upcoming ? "中号小组件预览，共用实际布局；主屏幕尺寸与 iOS 显示模式可能影响效果。" : "虚构示例行程，仅用于预览，不会保存。"}
        </Text>}>
          <TripWidgetPreview trip={upcoming ?? {
            ...EMPTY_DRAFT, id: "appearance-demo", mode: "rail", code: "G1234",
            departDate: "2099-06-18", departTime: "09:00", arriveTime: "10:24", durationMin: 84,
            fromPlace: "杭州东", toPlace: "上海虹桥", gate: "A1", seatCar: "05", seatNo: "08F",
            note: "", createdAt: "2099-06-18T00:00:00.000Z",
          }} theme={theme} hideSeatNumber={hideSeatNumber} now={upcoming ? now : new Date("2099-06-18T07:30:00").getTime()} />
        </Section>
        {/* ---------------- 设置 ---------------- */}
        <Section
          title="背景主题"
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              首页与预览立即切换；小组件已请求刷新，显示时间由 iOS 决定。
            </Text>
          }
        >
          {/* 六套主题，两列三行；缩略图使用真实背景与当前强调色。 */}
          {Array.from({ length: Math.ceil(Object.keys(THEMES).length / 2) }, (_, row) => (
            <HStack key={`theme-row-${row}`} spacing={12}>
              {(Object.keys(THEMES) as ThemeKey[]).slice(row * 2, row * 2 + 2).flatMap((k, i) => {
                const t = resolveTheme(k, accentKey)
                const selected = k === themeKey
                const chip = (
                  <Button
                    key={k}
                    buttonStyle="plain"
                    action={() => { setThemeKeyLocal(k); setThemeKey(k) }}
                  >
                    <VStack alignment="leading" spacing={5}>
                      <ZStack frame={{ width: 112, height: 66 }}
                        clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}>
                        <VStack frame={{ width: 112, height: 66 }} background={<ThemeBackground theme={t} />}><Spacer /></VStack>
                         <Text font="caption2" fontWeight="bold" foregroundStyle={t.badgeInk ?? "#FFFFFF"}
                          padding={3} background={t.accent}
                          clipShape={{ type: "rect", cornerRadius: 4, style: "continuous" }}
                          offset={{ x: -26, y: -18 }}>G1234</Text>
                        <Text font="caption2" monospaced foregroundStyle={t.ink}
                          offset={{ x: 0, y: 2 }}>09:00 → 10:24</Text>
                        <Text font="caption2" fontWeight="semibold" foregroundStyle={t.accent}
                          offset={{ x: -8, y: 20 }}>检票口 A1</Text>
                      </ZStack>
                      <Text font="caption" foregroundStyle="label">
                        {selected ? `已选 · ${t.label}` : t.label}
                      </Text>
                    </VStack>
                  </Button>
                )
                return i === 0 ? [chip] : [<Spacer key={`theme-gap-${k}`} />, chip]
              })}
            </HStack>
          ))}
        </Section>

        <Section title="字体强调色" footer={<Text font="caption" foregroundStyle="secondaryLabel">
          用于车次／航班号、倒计时、检票口／登机口和座位。浅、深背景自动调整明度，保持文字清晰。
        </Text>}>
          {(Object.keys(ACCENTS) as AccentKey[]).map((k) => (
            <Button key={k} buttonStyle="automatic" action={() => { setAccentKeyLocal(k); setAccentKey(k) }}>
              <HStack spacing={10} padding={{ top: 8, bottom: 8 }}
                frame={{ maxWidth: "infinity", minHeight: 44 }}
                contentShape={{ kind: "interaction", shape: { type: "rect" } }}>
                <RoundedRectangle cornerRadius={6} fill={k === "theme" ? THEMES[themeKey].accent : ACCENTS[k].color}
                  frame={{ width: 28, height: 28 }} />
                <Text foregroundStyle="label">{ACCENTS[k].label}</Text>
                <Spacer />
                {k === accentKey ? <Image systemName="checkmark" foregroundStyle="systemBlue" /> : null}
              </HStack>
            </Button>
          ))}
        </Section>
        <Section title="隐私显示" footer={<Text font="caption" foregroundStyle="secondaryLabel">隐藏车厢和座位号，保留座别；首页、列表、归档及小组件共用设置，编辑时仍可查看原始数据。</Text>}>
          <Button title={`乘客姓名：${passengerModeLabel(passengerMode)}`} action={() => void choosePassengerMode()} />
          <Button title={`座位号：${hideSeatNumber ? "已隐藏" : "显示"}`} action={() => {
            setHideSeatNumberLocal(!hideSeatNumber)
            setHideSeatNumber(!hideSeatNumber)
          }} />
        </Section>

        {/* ---------------- 关于 ---------------- */}
        <Section title="关于">
          <HStack>
            <Text>版本</Text>
            <Spacer />
            <Text monospaced foregroundStyle="secondaryLabel">
              v{VERSION}
            </Text>
          </HStack>
          <HStack>
            <Text>本机行程</Text>
            <Spacer />
            <Text monospaced foregroundStyle="secondaryLabel">
              {`${trips.length} 条`}
            </Text>
          </HStack>
          <VStack alignment="leading" spacing={4}>
            <HStack spacing={6}>
              <Image systemName="lock.shield" font={12} foregroundStyle="systemGreen" />
              <Text font="caption" foregroundStyle="secondaryLabel">
                隐私：脚本不含任何网络请求
              </Text>
            </HStack>
            <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={4}>
              行程数据只保存在本机（Storage），截图识别由 iOS Vision 在本机完成，图片不落盘、
              不上传，也不会同步到代码仓库或任何第三方位置。卸载脚本前请自行留存需要的行程信息。
            </Text>
          </VStack>
        </Section>
      </List>
      </NavigationStack>
      </Tab>
    </TabView>
  )
}

async function run() {
  await Navigation.present({ element: <View /> })
  Script.exit()
}

run()
