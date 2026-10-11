// index.tsx — 高铁提醒（App 内页面）
// 结构：NavigationStack + List 分 Section：下一班 / 识别行程 / 行程列表 / 设置 / 关于
// 生命周期：一次性页面 —— Navigation.present() 关闭后 Script.exit()
//
// 隐私：本脚本不发起任何网络请求。行程数据只写入本机 Storage（rail.* 键），
//      截图识别由本机 Vision 框架完成，识别结果不落盘、不上传。
//
// 注意：Dialog / Storage / Pasteboard / FileManager / Photos / Vision 等均为全局对象，
//      不要从 "scripting" 导入（生产范本验证过，导入会静默拿到 undefined）。

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
  parseTripText,
  countdownText,
  departTimestamp,
  arriveTimestamp,
  monthDayText,
  routeText,
  seatText,
  weekdayText,
  type ParsedTrip,
} from "./services/parse"
import {
  clearTrips,
  deleteTrip,
  getShowPassenger,
  listTrips,
  newTripId,
  nextTrip,
  setShowPassenger,
  upsertTrip,
  type TrainTrip,
} from "./services/trips"
import { recognizeFromCamera, recognizeFromPickedScreenshot } from "./services/ocr"
import { THEMES, getTheme, getThemeKey, setThemeKey, type ThemeKey } from "./services/theme"
import { VERSION } from "./utils/common"

const EMPTY_DRAFT: ParsedTrip = {
  trainNo: "",
  trainType: "",
  fromStation: "",
  toStation: "",
  departDate: "",
  departTime: "",
  arriveTime: "",
  durationMin: 0,
  gate: "",
  seatCar: "",
  seatNo: "",
  seatClass: "",
  passenger: "",
}

// 表单字段：标签 + 输入框（上一项目的可靠排版方式）
function Field(props: {
  label: string
  value: string
  prompt?: string
  onChanged: (v: string) => void
}) {
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
  const [showPassenger, setShowPassengerLocal] = useState<boolean>(getShowPassenger())
  const [trips, setTrips] = useState<TrainTrip[]>(listTrips())
  // 草稿：OCR 识别或编辑既有行程后进入待保存状态
  const [draft, setDraft] = useState<ParsedTrip | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState("")
  const [rawText, setRawText] = useState("")
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
    try {
      const res = from === "photos" ? await recognizeFromPickedScreenshot() : await recognizeFromCamera()
      if (!res.ok) {
        if (res.reason !== "cancelled") await Dialog.alert({ title: "识别未完成", message: res.message })
        return
      }
      const parsed = parseTripText(res.text)
      setRawText(res.text)
      setDraft(parsed)
      setDraftId(null)
      setDraftNote("")
    } finally {
      setBusy(false)
    }
  }

  const startManual = () => {
    setRawText("")
    setDraft({ ...EMPTY_DRAFT })
    setDraftId(null)
    setDraftNote("")
  }

  const editTrip = (t: TrainTrip) => {
    setRawText("")
    setDraft({ ...t })
    setDraftId(t.id)
    setDraftNote(t.note ?? "")
  }

  const saveDraft = () => {
    if (!draft) return
    if (!draft.trainNo && !draft.departTime) {
      void Dialog.alert({ message: "至少要有车次或发车时间，否则小组件没东西可显示" })
      return
    }
    const existing = draftId ? trips.find((t) => t.id === draftId) : undefined
    const trip: TrainTrip = {
      ...draft,
      id: draftId ?? newTripId(),
      note: draftNote,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    upsertTrip(trip) // 内部会 Widget.reloadAll()
    setDraft(null)
    setDraftId(null)
    setDraftNote("")
    setRawText("")
    refresh()
  }

  const removeTrip = async (t: TrainTrip) => {
    const idx = await Dialog.actionSheet({
      title: `${t.trainNo || "行程"} ${routeText(t)}`,
      message: `${monthDayText(t.departDate)} ${weekdayText(t.departDate)} ${t.departTime}`.trim(),
      actions: [{ label: "编辑" }, { label: "删除", destructive: true }],
      cancelButton: true,
    })
    if (idx == null || idx < 0) return
    if (idx === 0) {
      editTrip(t)
      return
    }
    deleteTrip(t.id)
    refresh()
  }

  const draftTrainLabel = draft?.trainNo || (draftId ? "编辑行程" : "新行程")

  return (
    <NavigationStack>
      <List
        navigationTitle={`高铁提醒 | v${VERSION}`}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}
      >
        {/* ---------------- 下一班 ---------------- */}
        <Section
          title="下一班"
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              {upcoming
                ? countdownText(upcoming, now) + "　·　小组件显示的就是这一条"
                : "还没有行程。用下面的「截图识别」导一张 12306 行程截图即可。"}
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
                <Text font="title2" fontWeight="bold" monospaced foregroundStyle={theme.accent}>
                  {upcoming.trainNo || "—"}
                </Text>
                {upcoming.trainType ? (
                  <Text font="caption2" foregroundStyle={theme.warn}>
                    {upcoming.trainType}
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
                  <Text font="caption" foregroundStyle={theme.ink}>
                    {upcoming.fromStation || "—"}
                  </Text>
                </VStack>
                <Image systemName="arrow.right" font={12} foregroundStyle={theme.sub} />
                <VStack alignment="leading" spacing={2}>
                  <Text font="title3" monospaced foregroundStyle={theme.ink}>
                    {upcoming.arriveTime || "--:--"}
                  </Text>
                  <Text font="caption" foregroundStyle={theme.ink}>
                    {upcoming.toStation || "—"}
                  </Text>
                </VStack>
                <Spacer />
              </HStack>
              <HStack spacing={12}>
                <Text font="caption" foregroundStyle={theme.ink}>
                  检票口 {upcoming.gate || "—"}
                </Text>
                <Text font="caption" foregroundStyle={theme.ink}>
                  座位 {seatText(upcoming)}
                </Text>
                {showPassenger && upcoming.passenger ? (
                  <Text font="caption" foregroundStyle={theme.sub}>
                    {upcoming.passenger}
                  </Text>
                ) : null}
              </HStack>
            </VStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无行程</Text>
          )}
        </Section>

        {/* ---------------- 识别 / 录入 ---------------- */}
        <Section
          title="识别行程"
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              在本机完成识别（iOS Vision），图片不落盘、不上传；也可以直接手填。识别后请核对一遍再保存。
            </Text>
          }
        >
          <HStack>
            <Button
              title={busy ? "识别中…" : "从截图识别"}
              disabled={busy}
              action={() => void runOCR("photos")}
            />
            <Spacer />
            <Button title="相机扫描" disabled={busy} action={() => void runOCR("camera")} />
            <Spacer />
            <Button title="手动新建" disabled={busy} action={startManual} />
          </HStack>

          {draft ? (
            <VStack
              alignment="leading"
              spacing={10}
              padding={12}
              frame={{ maxWidth: "infinity" } as never}
              background={theme.accentSoft}
              clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
            >
              <HStack>
                <Image systemName="checklist" font={12} foregroundStyle={theme.accent} />
                <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.ink}>
                  {`核对 ${draftTrainLabel}`}
                </Text>
                <Spacer />
                <Text font="caption2" foregroundStyle={theme.sub}>
                  {rawText ? "来自截图识别" : draftId ? "编辑中" : "手动填写"}
                </Text>
              </HStack>

              <HStack spacing={10}>
                <Field label="车次" value={draft.trainNo} prompt="G1234"
                  onChanged={(v) => patch({ trainNo: v.replace(/\s+/g, "").toUpperCase() })} />
                <Field label="车型" value={draft.trainType} prompt="复兴号"
                  onChanged={(v) => patch({ trainType: v })} />
              </HStack>
              <HStack spacing={10}>
                <Field label="出发站" value={draft.fromStation} prompt="北京南"
                  onChanged={(v) => patch({ fromStation: v })} />
                <Field label="到达站" value={draft.toStation} prompt="上海虹桥"
                  onChanged={(v) => patch({ toStation: v })} />
              </HStack>
              <HStack spacing={10}>
                <Field label="日期" value={draft.departDate} prompt="2026-10-12"
                  onChanged={(v) => patch({ departDate: v.trim() })} />
                <Field label="历时(分)" value={draft.durationMin ? String(draft.durationMin) : ""} prompt="18"
                  onChanged={(v) => patch({ durationMin: Math.max(0, Number(v) || 0) })} />
              </HStack>
              <HStack spacing={10}>
                <Field label="发车" value={draft.departTime} prompt="08:32"
                  onChanged={(v) => patch({ departTime: v.trim() })} />
                <Field label="到达" value={draft.arriveTime} prompt="08:50"
                  onChanged={(v) => patch({ arriveTime: v.trim() })} />
              </HStack>
              <HStack spacing={10}>
                <Field label="检票口" value={draft.gate} prompt="6A"
                  onChanged={(v) => patch({ gate: v.trim().toUpperCase() })} />
                <Field label="车厢" value={draft.seatCar} prompt="5"
                  onChanged={(v) => patch({ seatCar: v.replace(/\D/g, "") })} />
              </HStack>
              <HStack spacing={10}>
                <Field label="座位号" value={draft.seatNo} prompt="12A"
                  onChanged={(v) => patch({ seatNo: v.trim().toUpperCase() })} />
                <Field label="座别" value={draft.seatClass} prompt="二等座"
                  onChanged={(v) => patch({ seatClass: v })} />
              </HStack>
              <HStack spacing={10}>
                <Field label="乘车人" value={draft.passenger} prompt="可留空"
                  onChanged={(v) => patch({ passenger: v })} />
                <Field label="备注" value={draftNote} prompt="如：接人 / 报销"
                  onChanged={setDraftNote} />
              </HStack>

              <HStack>
                <Button title="保存行程" action={saveDraft} />
                <Spacer />
                <Button
                  title="放弃"
                  role="destructive"
                  action={() => {
                    setDraft(null)
                    setDraftId(null)
                    setDraftNote("")
                    setRawText("")
                  }}
                />
              </HStack>
            </VStack>
          ) : null}
        </Section>

        {/* ---------------- 行程列表 ---------------- */}
        <Section
          title={`行程列表 (${trips.length})`}
          footer={
            <Text font="caption" foregroundStyle="secondaryLabel">
              点按行程可编辑或删除；小组件自动显示发车时间最近的一条，过期后自动切到下一条。
            </Text>
          }
        >
          {trips.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">还没有行程。</Text>
          ) : (
            trips.map((t) => {
              const dep = departTimestamp(t)
              const arr = arriveTimestamp(t)
              const expired = arr > 0 && now >= arr
              return (
                <VStack
                  key={t.id}
                  alignment="leading"
                  spacing={3}
                  onTapGesture={() => void removeTrip(t)}
                >
                  <HStack spacing={6}>
                    <Text font="headline" monospaced foregroundStyle={expired ? "secondaryLabel" : theme.accent}>
                      {t.trainNo || "—"}
                    </Text>
                    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {routeText(t)}
                    </Text>
                    <Spacer />
                    <Image systemName="ellipsis.circle" font={12} foregroundStyle="tertiaryLabel" />
                  </HStack>
                  <Text font="caption2" monospaced foregroundStyle="secondaryLabel" lineLimit={1}>
                    {[
                      `${monthDayText(t.departDate)} ${weekdayText(t.departDate)}`.trim(),
                      `${t.departTime || "--:--"} → ${t.arriveTime || "--:--"}`,
                      t.gate ? `检票口 ${t.gate}` : "",
                      seatText(t) === "—" ? "" : seatText(t),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  <Text font="caption2" foregroundStyle={expired ? "tertiaryLabel" : theme.warn}>
                    {dep ? countdownText(t, now) : "待补全发车时间"}
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
                  message: "只删除本机记录，不影响 12306。",
                  confirmLabel: "清空",
                })
                if (ok) {
                  clearTrips()
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
              小组件会显示乘车人姓名；若不想在主屏幕展示，关掉此项即可。
            </Text>
          }
        >
          <Toggle
            title="小组件显示乘车人"
            value={showPassenger}
            onChanged={(v) => {
              setShowPassengerLocal(v)
              setShowPassenger(v)
            }}
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
                      <RoundedRectangle
                        frame={{ width: 64, height: 44 }}
                        cornerRadius={9}
                        fill={t.cardTop}
                      />
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
