// usage-parser.ts — 用量解析器（对未知结构兜底）
// 统一策略：无论捕获到的是 JSON 还是 HTML，都先转成文本，
// 用「中文界面真实字段形态」的正则管线提取。字段形态来自真机截图：
//   60.00GB 餘量 / 已用：0.00/60.00GB / 失效日期：2026.10.06 /
//   應繳金額 HK$0 / 主賬號：56088892 / 200.00分鐘 餘量 / 500條 餘量

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
}

function num(s: string | undefined): number | undefined {
  if (s == null) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function toGB(value: number, unit: string): number {
  return /mb/i.test(unit) ? +(value / 1024).toFixed(3) : value
}

export function parseUsageText(raw: string): ParsedUsage {
  // JSON 则先拍平成文本（字段顺序即桶顺序：計劃數據 → 漫遊 → 話音 → 短訊）
  let text = raw
  const trimmed = raw.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const obj = JSON.parse(trimmed)
      text = JSON.stringify(obj)
    } catch { /* 保留原文 */ }
  }

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
  const remainRe = /([\d.]+)\s*(GB|MB)\s*餘量/gi
  while ((m = remainRe.exec(text))) {
    const existing = dataBuckets.find((b) => Math.abs(b.index - (m!.index)) < 400)
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

  return out
}
