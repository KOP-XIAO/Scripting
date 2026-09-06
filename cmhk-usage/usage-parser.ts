// usage-parser.ts — 用量解析器（对未知结构兜底）
// 统一策略：无论捕获到的是 JSON 还是 HTML，都先转成文本，
// 用「中文界面真实字段形态」的正则管线提取。字段形态来自真机截图：
//   60.00GB 餘量 / 已用：0.00/60.00GB / 失效日期：2026.10.06 /
//   應繳金額 HK$0 / 主賬號：56088892 / 200.00分鐘 餘量 / 500條 餘量

export type UsageBucket = {
  name: string            // 桶名（套餐内数据/额外赠送/漫遊數據…）
  totalGB?: number
  remainingGB?: number
  expiry?: string
}

export type ParsedUsage = {
  planName?: string
  accountNumber?: string
  dataTotalGB?: number
  dataRemainingGB?: number
  roamDataTotalGB?: number
  roamDataRemainingGB?: number
  roamExpiry?: string
  voiceTotalMin?: number
  voiceRemainingMin?: number
  voiceUnlimited?: boolean
  smsRemaining?: number
  balanceHKD?: number
  billAmountHKD?: number
  membershipTier?: string   // 我的會籍（白金/金/银…）
  points?: number           // 我的積分
  buckets?: UsageBucket[]   // 全部 GB 桶（含套餐内/赠送/漫游）
}

function num(s: string | undefined): number | undefined {
  if (s == null) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function toGB(value: number, unit: string): number {
  return /mb/i.test(unit) ? +(value / 1024).toFixed(3) : value
}

// HTML → 文本：真实捕获是 HTML 源码，可见文本被标签切碎（如
// <span>已用：</span><span>0.00</span>/<span>60.00GB</span>），必须先去标签还原。
function normalizeInput(raw: string): string {
  const trimmed = raw.trim()
  // JSON 直接拍平
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(trimmed))
    } catch { /* 落回文本处理 */ }
  }
  if (!/<[a-z][\s\S]*>/i.test(trimmed)) return raw
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, " ")
}

export function parseUsageText(raw: string): ParsedUsage {
  const text = normalizeInput(raw)

  const out: ParsedUsage = {}

  // 主賬號：56088892
  const acc = text.match(/主賬號[：:\s]*(\d{6,})/)
  if (acc) out.accountNumber = acc[1]

  // 套餐名：5G一咭三地計劃60GB
  const plan = text.match(/(?:我的服務計劃|服務計劃數據)[^A-Za-z0-9一-龥]{0,12}([0-9A-Za-z一-龥]*計劃[0-9A-Za-z一-龥]*)/)
    ?? text.match(/([0-9A-Za-z一-龥]*計劃[\d.]+GB)/)
  if (plan) out.planName = plan[1]

  // 應繳金額 HK$0（上台账户是"应缴"，不是余额）
  const due = text.match(/應繳金額[^0-9]{0,20}(?:HK\$|HKD?)\s*([\d,]+(?:\.\d+)?)/)
  if (due) out.billAmountHKD = num(due[1].replace(/,/g, ""))

  // 话费余额（储值卡形态）
  const bal = text.match(/(?:餘額|余额|balance)[^0-9]{0,20}(?:HK\$|HKD?)\s*([\d,]+(?:\.\d+)?)/i)
  if (bal) out.balanceHKD = num(bal[1].replace(/,/g, ""))

  // 数据桶：「已用：0.00/60.00GB」给出 已用/总量；「60.00GB 餘量」给出剩余
  // 按出现顺序：第一个=服務計劃數據，第二个（若邻近"漫遊"）=漫遊數據
  const dataBuckets: { totalGB?: number; remainingGB?: number; usedGB?: number; index: number }[] = []

  const usedRe = /已用[：:\s]*([\d.]+)\s*\/\s*([\d.]+)\s*(GB|MB)/gi
  let m: RegExpExecArray | null
  while ((m = usedRe.exec(text))) {
    dataBuckets.push({ usedGB: toGB(+m[1], m[2]), totalGB: toGB(+m[2], m[2]), index: m.index })
  }
  const roamSplit0 = text.search(/漫遊數據/)
  const remainRe = /([\d.]+)\s*(GB|MB)\s*餘量/gi
  while ((m = remainRe.exec(text))) {
    const sameSide = (b: { index: number }) =>
      roamSplit0 < 0 || (b.index > roamSplit0) === (m!.index > roamSplit0)
    const existing = dataBuckets.find((b) => sameSide(b) && Math.abs(b.index - (m!.index)) < 400)
    if (existing) {
      existing.remainingGB = toGB(+m[1], m[2])
    } else {
      dataBuckets.push({ remainingGB: toGB(+m[1], m[2]), index: m.index })
    }
  }

  dataBuckets.sort((a, b) => a.index - b.index)
  const roamSplit = text.search(/漫遊數據/)
  const isRoam = (b: { index: number }) => roamSplit >= 0 && b.index > roamSplit

  const main = dataBuckets.find((b) => !isRoam(b))
  const roam = dataBuckets.find((b) => isRoam(b))

  if (main) {
    out.dataTotalGB = main.totalGB
    out.dataRemainingGB = main.remainingGB ?? (main.totalGB != null && main.usedGB != null ? +(main.totalGB - main.usedGB).toFixed(2) : undefined)
  }
  if (roam) {
    out.roamDataTotalGB = roam.totalGB
    out.roamDataRemainingGB = roam.remainingGB ?? (roam.totalGB != null && roam.usedGB != null ? +(roam.totalGB - roam.usedGB).toFixed(2) : undefined)
  }

  // 漫遊失效日期：2026.10.06 00:00
  const exp = text.match(/失效日期[：:\s]*([\d]{4}[.\-/][\d]{1,2}[.\-/][\d]{1,2})/)
  if (exp) out.roamExpiry = exp[1].replace(/[.\/]/g, "-")

  // 話音：「200.00分鐘 餘量」（可能多个桶，取首个为主，累计为总量）
  const voiceRe = /([\d.]+)\s*分鐘\s*餘量/gi
  const voiceBuckets: number[] = []
  while ((m = voiceRe.exec(text))) {
    const v = num(m[1])
    if (v != null) voiceBuckets.push(v)
  }
  if (voiceBuckets.length) {
    out.voiceRemainingMin = voiceBuckets[0]
    out.voiceTotalMin = voiceBuckets.reduce((a, b) => a + b, 0)
  }
  if (/話音[\s\S]{0,200}無限/.test(text) || /無限通話/.test(text)) out.voiceUnlimited = true

  // 短訊：500條 餘量
  const sms = text.match(/([\d,]+)\s*條\s*餘量/)
  if (sms) out.smsRemaining = num(sms[1].replace(/,/g, ""))

  // 會籍：我的會籍 白金
  const tier = text.match(/我的會籍[^A-Za-z0-9一-龥]{0,12}(白金|鑽石|钻石|金|銀|银|銅|铜)/)
  if (tier) out.membershipTier = tier[1]

  // 積分：我的積分 4006
  const pts = text.match(/我的積分[^0-9]{0,12}([\d,]{2,})/)
  if (pts) out.points = num(pts[1].replace(/,/g, ""))

  return out
}

// 精确解析 usageQuery 接口的真实结构（真机捕获实证）：
// data.result[] = 分类（服務計劃數據/漫遊數據/話音/短訊）
//   details[] = { msisdn, name, total, usage, margin(=剩余), unit, infinite, expired, effectiveDate }
export function parseUsageQueryJson(json: any): ParsedUsage {
  const result = json?.data?.result
  if (!Array.isArray(result)) return {}
  const out: ParsedUsage = {}

  const buckets: any[] = []
  for (const cat of result) {
    const catName = String(cat?.name ?? "")
    for (const d of cat?.details ?? []) buckets.push({ ...d, __cat: catName })
  }
  if (!buckets.length) return {}

  const toGBn = (b: any): number | undefined => {
    const v = num(b?.margin != null ? String(b.margin) : undefined)
    if (v == null) return undefined
    return /mb/i.test(String(b?.unit ?? "")) ? +(v / 1024).toFixed(3) : v
  }
  const totalGBn = (b: any): number | undefined => {
    const v = num(b?.total != null ? String(b.total) : undefined)
    if (v == null) return undefined
    return /mb/i.test(String(b?.unit ?? "")) ? +(v / 1024).toFixed(3) : v
  }

  const dataB = buckets.find((b) => /數據|数据/.test(b.__cat) && !/漫遊|漫游/.test(b.__cat) && /^(GB|MB)$/i.test(String(b.unit ?? "")))
  const roamB = buckets.find((b) => /漫遊|漫游/.test(b.__cat))
  const voiceBS = buckets.filter((b) => /話音|话音/.test(b.__cat))
  const smsB = buckets.find((b) => /短訊|短信/.test(b.__cat) || /條|条/.test(String(b.unit ?? "")))

  const anyB = dataB ?? roamB ?? buckets[0]
  if (anyB?.msisdn) out.accountNumber = String(anyB.msisdn)

  // 全部 GB 桶：按界面出现顺序（套餐内 → 赠送/漫遊…），名字用 detail.name，退回 category
  const gbBuckets = buckets
    .filter((b) => /^(GB|MB)$/i.test(String(b.unit ?? "")))
    .map((b) => {
      const exp = b.expiryDate ?? b.expireDate ?? b.expiredDate ?? b.effectiveDate
      return {
        name: String(b.__cat || b.name || "套餐數據"), // 优先分类名，显示更短更清晰
        totalGB: totalGBn(b),
        remainingGB: toGBn(b),
        expiry: exp ? String(exp).replace(/[./]/g, "-").slice(0, 10) : undefined,
        __cat: String(b.__cat ?? ""),
      }
    })
  if (gbBuckets.length) {
    out.buckets = gbBuckets.map(({ __cat, ...rest }) => rest)
  }

  if (dataB) {
    out.dataTotalGB = totalGBn(dataB)
    out.dataRemainingGB = toGBn(dataB)
  }
  if (roamB) {
    out.roamDataTotalGB = totalGBn(roamB)
    out.roamDataRemainingGB = toGBn(roamB)
    const exp = roamB.expiryDate ?? roamB.expireDate ?? roamB.expiredDate ?? roamB.effectiveDate
    if (exp) out.roamExpiry = String(exp).replace(/[./]/g, "-").slice(0, 10)
  }
  if (voiceBS.length) {
    const finite = voiceBS.filter((b) => b.infinite !== true)
    const sum = (arr: any[], f: (x: any) => number | undefined): number | undefined => {
      const vals = arr.map(f).filter((x): x is number => typeof x === "number" && isFinite(x))
      return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined
    }
    out.voiceRemainingMin = sum(finite, (b) => num(String(b.margin)))
    out.voiceTotalMin = sum(finite, (b) => num(String(b.total)))
    if (voiceBS.some((b) => b.infinite === true)) out.voiceUnlimited = true
  }
  if (smsB) {
    out.smsRemaining = num(smsB.margin != null ? String(smsB.margin) : undefined)
  }
  return out
}

// 账户信息接口（queryAccountInfo）：accountBalance = 代缴话费（负=欠费）
export function parseAccountInfoJson(json: any): ParsedUsage {
  const d = json?.data
  if (!d) return {}
  const out: ParsedUsage = {}
  if (d.accountBalance != null) {
    const v = num(String(d.accountBalance))
    if (v != null) out.billAmountHKD = v
  }
  if (d.ratePlan && typeof d.ratePlan === "string") out.planName = d.ratePlan
  if (d.currentMsisdn) out.accountNumber = String(d.currentMsisdn)
  return out
}

// 财富/會籍接口（wealth）：猜测 会员等级/积分 字段名，宽容取数
export function parseWealthJson(json: any): ParsedUsage {
  const d = json?.data
  if (!d) return {}
  const out: ParsedUsage = {}
  const flat: Record<string, any> = {}
  const walk = (o: any) => {
    if (o == null) return
    if (Array.isArray(o)) { o.forEach(walk); return }
    if (typeof o === "object") { Object.entries(o).forEach(([k, v]) => { flat[k.toLowerCase()] = v; walk(v) }) }
  }
  walk(d)
  for (const k of Object.keys(flat)) {
    if (out.membershipTier == null && /(membertier|memberlevel|membergrade|viplevel|grade|会籍|會員等級)/.test(k) && typeof flat[k] === "string") {
      out.membershipTier = flat[k]
    }
    if (out.points == null && /(points|point|score|integral|積分|积分)/.test(k)) {
      const n = num(String(flat[k]))
      if (n != null) out.points = n
    }
  }
  return out
}
