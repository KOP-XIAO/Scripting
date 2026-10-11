// index.tsx — 行程提醒（火车 + 航班，App 内页面）
// 结构：NavigationStack + List 分 Section：下一段行程 / 识别录入 / 行程列表 / 设置 / 关于
// 生命周期：一次性页面 —— Navigation.present() 关闭后 Script.exit()
//
// 隐私：本脚本不发起任何网络请求。行程数据只写入本机 Storage（rail.* 键），
//      截图识别由本机 Vision 框架完成，识别结果不落盘、不上传。
//
// 注意：Dialog / Storage / Pasteboard / FileManager / Photos / Vision 等均为全局对象，
//      不要从 "scripting" 导入（生产范本验证过，导入会静默拿到 undefined）。
//
// 按钮布局约定：同一行不放两个默认样式按钮（热区会互相覆盖，曾导致点「相册」却触发「相机」）。
// 每个操作按钮都独占一个 List 行（Section 的直接子节点）。

import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  RoundedRectangle,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"
import {
  arriveTimestamp,
  countdownText,
  departTimestamp,
  gateLabel,
  missingFields,
  monthDayText,
  modeLabel,
  parseTripText,
  routeText,
  seatText,
  weekdayText,
  type ParsedTrip,
  type TripMode,
} from "./services/parse"
import {
  clearTrips,
  deleteTrip,
  displayPassenger,
  getPassengerMode,
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
import { THEMES, getTheme, getThemeKey, setThemeKey, type ThemeKey } from "./services/theme"
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

// 表单字段：标签 + 输入框
function Field(props: { label: string; value: string; prompt?: string; onChanged: (v: string) => void }) {
  return (
    <VStack alignment="leading" spacing={2}>
      <Text font="caption" foregroundStyle="secondaryLabel">
        {props.label}
      </Text>
      <TextField value={props.value} prompt={props.prompt} onChanged={props.onChanged} />
    </VStack>
  )
}

function View() {
  const dismiss = Navigation.useDismiss()
  const [themeKey, setThemeKeyLocal] = useState<ThemeKey>(getThemeKey())
  const [passengerMode, setPassengerModeLocal] = useState<PassengerMode>(getPassengerMode())
  const [trips, setTrips] = useState<TripRecord[]>(listTrips())
  const [draft, setDraft] = useState<ParsedTrip | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState("")
  const [rawText, setRawText] = useState("")
  const [showRaw, setShowRaw] = useState(false)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000) // 倒计时文本每 30s 刷新
    return () => clearInterval(timer)
  }, [])

  const theme = getTheme()
  const upcoming = nextTrip(now)

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
    setDraftId(t.id) // 非空 => 表单直接渲染在该记录所在行（原地编辑）
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

  const choosePassengerMode = async () => {
    const idx = await Dialog.actionSheet({
      title: "乘客姓名显示",
      message: "控制小组件与「下一段行程」卡片中的姓名",
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
  const draftTitle = draft?.code || (draftId ? "编辑行程" : `新${draftIsFlight ? "航班" : "火车"}行程`)

  // 草稿表单（新行程显示在识别区；编辑时渲染在该记录所在行）
  const renderDraftForm = () => {
    if (!draft) return null
    const isFlight = draftIsFlight
    return (
      <VStack
        alignment="leading"
        spacing={10}
        padding={12}
        frame={{ maxWidth: "infinity" } as never}
        background={theme.accentSoft}
        clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
      >
        <HStack spacing={6}>
          <Image systemName={isFlight ? "airplane.departure" : "tram.fill"} font={12} foregroundStyle={theme.accent} />
          <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.ink}>
            {`核对 ${draftTitle}`}
          </Text>
          <Spacer />
          <Text font="caption2" foregroundStyle={theme.sub}>
            {rawText ? "来自截图识别" : draftId ? "编辑中" : "手动填写"}
          </Text>
        </HStack>

        {notice ? (
          <HStack spacing={6}>
            <Image systemName="info.circle" font={11} foregroundStyle={theme.warn} />
            <Text font="caption2" foregroundStyle={theme.ink} lineLimit={3}>
              {notice}
            </Text>
          </HStack>
        ) : null}

        {/* 类型切换（小面积独立按钮，避免热区冲突） */}
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
                  foregroundStyle={selected ? theme.accent : theme.sub}
                  padding={{ top: 3, bottom: 3, leading: 10, trailing: 10 }}
                  background={selected ? theme.accentSoft : "rgba(127,127,127,0.10)"}
                  clipShape={{ type: "rect", cornerRadius: 7, style: "continuous" }}
                >
                  {modeLabel(m)}
                </Text>
              </Button>
            )
          })}
        </HStack>

        <HStack spacing={10}>
          <Field label={isFlight ? "航班号" : "车次"} value={draft.code} prompt={isFlight ? "CA1234" : "G1234"}
            onChanged={(v) => patch({ code: v.replace(/\s+/g, "").toUpperCase() })} />
          <Field label={isFlight ? "航空公司" : "车型"} value={draft.carrier} prompt={isFlight ? "中国国际航空" : "复兴号"}
            onChanged={(v) => patch({ carrier: v })} />
        </HStack>
        <HStack spacing={10}>
          <Field label={`出发${isFlight ? "机场" : "车站"}`} value={draft.fromPlace}
            prompt={isFlight ? "北京首都T3" : "北京南"} onChanged={(v) => patch({ fromPlace: v })} />
          <Field label={`到达${isFlight ? "机场" : "车站"}`} value={draft.toPlace}
            prompt={isFlight ? "上海虹桥T2" : "上海虹桥"} onChanged={(v) => patch({ toPlace: v })} />
        </HStack>
        <HStack spacing={10}>
          <Field label="日期" value={draft.departDate} prompt="2026-10-12"
            onChanged={(v) => patch({ departDate: v.trim() })} />
          <Field label="历时(分)" value={draft.durationMin ? String(draft.durationMin) : ""} prompt="18"
            onChanged={(v) => patch({ durationMin: Math.max(0, Number(v) || 0) })} />
        </HStack>
        <HStack spacing={10}>
          <Field label={isFlight ? "起飞" : "发车"} value={draft.departTime} prompt="08:32"
            onChanged={(v) => patch({ departTime: v.trim() })} />
          <Field label="到达" value={draft.arriveTime} prompt="08:50"
            onChanged={(v) => patch({ arriveTime: v.trim() })} />
        </HStack>

        {isFlight ? (
          <HStack spacing={10}>
            <Field label="登机口" value={draft.gate} prompt="C12"
              onChanged={(v) => patch({ gate: v.trim().toUpperCase() })} />
            <Field label="航站楼" value={draft.terminal} prompt="T3"
              onChanged={(v) => patch({ terminal: v.trim().toUpperCase() })} />
          </HStack>
        ) : (
          <HStack spacing={10}>
            <Field label="检票口" value={draft.gate} prompt="6A"
              onChanged={(v) => patch({ gate: v.trim().toUpperCase() })} />
            <Field label="车厢" value={draft.seatCar} prompt="5"
              onChanged={(v) => patch({ seatCar: v.replace(/\D/g, "") })} />
          </HStack>
        )}
        {isFlight ? (
          <HStack spacing={10}>
            <Field label="登机时间" value={draft.boardingTime} prompt="07:20"
              onChanged={(v) => patch({ boardingTime: v.trim() })} />
            <Field label="值机柜台" value={draft.checkIn} prompt="H01-H10"
              onChanged={(v) => patch({ checkIn: v.trim().toUpperCase() })} />
          </HStack>
        ) : null}

        <HStack spacing={10}>
          <Field label="座位号" value={draft.seatNo} prompt={isFlight ? "32A" : "12A"}
            onChanged={(v) => patch({ seatNo: v.trim().toUpperCase() })} />
          <Field label={isFlight ? "舱位" : "座别"} value={draft.seatClass} prompt={isFlight ? "经济舱" : "二等座"}
            onChanged={(v) => patch({ seatClass: v })} />
        </HStack>
        {isFlight ? (
          <Field label="行李转盘" value={draft.baggage} prompt="可留空"
            onChanged={(v) => patch({ baggage: v.replace(/\D/g, "") })} />
        ) : null}

        <HStack spacing={10}>
          <Field label={isFlight ? "乘机人" : "乘车人"} value={draft.passenger} prompt="可留空"
            onChanged={(v) => patch({ passenger: v })} />
          <Field label="备注" value={draftNote} prompt="如：接人 / 报销" onChanged={setDraftNote} />
        </HStack>

        {rawText ? (
          <VStack alignment="leading" spacing={6}>
            <Toggle title="查看识别原文（用于排查识别不准）" value={showRaw} onChanged={setShowRaw} />
            {showRaw ? (
              <Text
                font="caption2"
                monospaced
                foregroundStyle={theme.ink}
                padding={8}
                background="rgba(127,127,127,0.10)"
                clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}
              >
                {rawText}
              </Text>
            ) : null}
          </VStack>
        ) : null}

        <HStack>
          <Button title="保存行程" action={saveDraft} />
          <Spacer />
          <Button title="放弃" role="destructive" action={cancelDraft} />
        </HStack>
      </VStack>
    )
  }

  return (
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
          title="下一段行程"
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              {upcoming
                ? countdownText(upcoming, now) + "　·　小组件显示的就是这一条"
                : "还没有行程。用下面的「从相册选行程截图识别」导入 12306 或航司行程截图即可。"}
            </Text>
          }
        >
          {upcoming ? (
            <VStack
              alignment="leading"
              spacing={8}
              padding={14}
              frame={{ maxWidth: "infinity" } as never}
              background={theme.accentSoft}
              clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
            >
              <HStack spacing={6}>
                <Image systemName={modeIcon(upcoming.mode)} font={13} foregroundStyle={theme.accent} />
                <Text font="title2" fontWeight="bold" monospaced foregroundStyle={theme.accent}>
                  {upcoming.code || "—"}
                </Text>
                {upcoming.carrier ? (
                  <Text font="caption2" foregroundStyle={theme.warn}>
                    {upcoming.carrier}
                  </Text>
                ) : null}
                <Spacer />
                <Text font="caption" foregroundStyle={theme.sub}>
                  {monthDayText(upcoming.departDate)} {weekdayText(upcoming.departDate)}
                </Text>
              </HStack>
              <HStack spacing={8}>
                <VStack alignment="leading" spacing={2}>
                  <Text font="title3" monospaced foregroundStyle={theme.ink}>
                    {upcoming.departTime || "--:--"}
                  </Text>
                  <Text font="caption" foregroundStyle={theme.ink} lineLimit={1}>
                    {upcoming.fromPlace || "—"}
                  </Text>
                </VStack>
                <Image systemName="arrow.right" font={12} foregroundStyle={theme.sub} />
                <VStack alignment="leading" spacing={2}>
                  <Text font="title3" monospaced foregroundStyle={theme.ink}>
                    {upcoming.arriveTime || "--:--"}
                  </Text>
                  <Text font="caption" foregroundStyle={theme.ink} lineLimit={1}>
                    {upcoming.toPlace || "—"}
                  </Text>
                </VStack>
                <Spacer />
              </HStack>
              <HStack spacing={12}>
                <Text font="caption" foregroundStyle={theme.ink}>
                  {gateLabel(upcoming.mode)} {upcoming.gate || "—"}
                </Text>
                <Text font="caption" foregroundStyle={theme.ink}>
                  座位 {seatText(upcoming)}
                </Text>
                {upcoming.mode === "flight" && upcoming.boardingTime ? (
                  <Text font="caption" foregroundStyle={theme.warn}>
                    登机 {upcoming.boardingTime}
                  </Text>
                ) : null}
                {displayPassenger(upcoming.passenger, passengerMode) ? (
                  <Text font="caption" foregroundStyle={theme.sub}>
                    {displayPassenger(upcoming.passenger, passengerMode)}
                  </Text>
                ) : null}
              </HStack>
            </VStack>
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
          {draft && !draftId ? renderDraftForm() : null}
        </Section>

        {/* ---------------- 行程列表（点按原地编辑，左滑删除） ---------------- */}
        <Section
          title={`行程列表 (${trips.length})`}
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              点按行程直接在原处展开编辑；向左滑动出现删除/编辑。小组件自动显示时间最近的一条。
            </Text>
          }
        >
          {trips.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">还没有行程。</Text>
          ) : (
            trips.map((t) => {
              if (draft && draftId === t.id) {
                // 原地编辑：该记录的位置直接展开为表单
                return <VStack key={t.id}>{renderDraftForm()}</VStack>
              }
              const dep = departTimestamp(t)
              const arr = arriveTimestamp(t)
              const expired = arr > 0 && now >= arr
              return (
                <VStack
                  key={t.id}
                  alignment="leading"
                  spacing={3}
                  onTapGesture={() => editTrip(t)}
                  trailingSwipeActions={{
                    allowsFullSwipe: true,
                    actions: [
                      <Button title="删除" role="destructive" action={() => removeTrip(t)} />,
                      <Button title="编辑" tint="accentColor" action={() => editTrip(t)} />,
                    ],
                  }}
                >
                  <HStack spacing={6}>
                    <Image
                      systemName={modeIcon(t.mode)}
                      font={12}
                      foregroundStyle={expired ? "secondaryLabel" : theme.accent}
                    />
                    <Text font="headline" monospaced foregroundStyle={expired ? "secondaryLabel" : theme.accent}>
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
                      seatText(t) === "—" ? "" : seatText(t),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  <Text font="caption2" foregroundStyle={expired ? "tertiaryLabel" : theme.warn}>
                    {dep ? countdownText(t, now) : "待补全出发时间"}
                    {t.note ? `　·　${t.note}` : ""}
                  </Text>
                </VStack>
              )
            })
          )}
          {trips.length > 0 ? (
            <Button
              title="清空全部行程"
              role="destructive"
              action={async () => {
                const ok = await Dialog.confirm({
                  title: "清空全部行程",
                  message: "只删除本机记录，不影响 12306 / 航司 App。",
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

        {/* ---------------- 设置 ---------------- */}
        <Section
          title="设置"
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              若更改后小组件没有立即变化，长按小组件移除后重新添加即可（iOS 会缓存小组件画面）。
            </Text>
          }
        >
          <Button
            title={`乘客姓名：${passengerModeLabel(passengerMode)}`}
            action={() => void choosePassengerMode()}
          />
          <HStack spacing={0}>
            {(Object.keys(THEMES) as ThemeKey[]).flatMap((k, i) => {
              const t = THEMES[k]
              const selected = k === themeKey
              const chip = (
                <Button
                  key={k}
                  buttonStyle="plain"
                  action={() => {
                    setThemeKeyLocal(k)
                    setThemeKey(k)
                  }}
                >
                  <VStack spacing={4}>
                    <ZStack frame={{ width: 64, height: 44 }}>
                      <RoundedRectangle frame={{ width: 64, height: 44 }} cornerRadius={9} fill={t.cardTop} />
                      <RoundedRectangle
                        frame={{ width: 28, height: 8 }}
                        cornerRadius={4}
                        fill={t.accent}
                        offset={{ x: -14, y: -8 }}
                      />
                      <RoundedRectangle
                        frame={{ width: 44, height: 6 }}
                        cornerRadius={3}
                        fill={t.sub}
                        offset={{ x: -6, y: 6 }}
                      />
                    </ZStack>
                    <Text font="caption2" foregroundStyle={selected ? t.accent : "secondaryLabel"}>
                      {selected ? `● ${t.label}` : t.label}
                    </Text>
                  </VStack>
                </Button>
              )
              return i === 0 ? [chip] : [<Spacer key={`sp-${k}`} />, chip]
            })}
          </HStack>
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
  )
}

async function run() {
  await Navigation.present({ element: <View /> })
  Script.exit()
}

run()
