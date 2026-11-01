// services/ocr.ts — 相册选图 + 本机文字识别（Vision）
// Vision / Photos / PHPickerFilter 均为全局对象，禁止从 "scripting" 导入
// （生产范本验证：导入会静默拿到 undefined）。
//
// 隐私：识别全部在本机 Vision 框架完成，无任何网络请求、无第三方服务；
//       选中的图片仅用于本次识别，不落盘、不上传。
//
// 错误处理约定：用户主动取消（关闭选图器 / 退出扫描器）是正常操作——
// 系统桥接层会抛异常，这里统一归类为 reason:"cancelled"，由调用方静默处理；
// 真失败才带出错步骤。相册选图器在不同 Scripting 版本上签名可能不同，
// 因此采用多级降级：pick({filter,limit}) → pick({limit}) → pickPhotos(1)。

import { parseTripText, railStationState } from "./parse"

declare const Vision: any
declare const Photos: any
declare const PHPickerFilter: any

export type OCRCandidate = {
  content: string
  confidence: number
  boundingBox: { x: number; y: number; width: number; height: number }
}

export type OCRResult =
  | { ok: true; text: string; candidates: OCRCandidate[] }
  | { ok: false; reason: "cancelled" | "unsupported" | "failed"; message: string }

// 取消类错误：文案可能是「用户放弃扫描」「已取消」「Cancel」等
function isCancelError(e: unknown): boolean {
  return /取消|放弃|cancel|dismiss|abort/i.test(String(e ?? ""))
}

function fail(step: string, e: unknown): OCRResult {
  if (isCancelError(e)) return { ok: false, reason: "cancelled", message: "已取消" }
  return { ok: false, reason: "failed", message: `${step}：${String(e)}` }
}

// 尝试多种方式取到一张 UIImage；全部失败时返回最后一个错误（方便用户反馈具体信息）
async function pickOneImage(): Promise<{ image: any | null; error: string }> {
  const attempts: Array<{ name: string; run: () => Promise<any | null> }> = []
  if (typeof Photos !== "undefined" && typeof Photos.pick === "function") {
    if (typeof PHPickerFilter !== "undefined" && typeof PHPickerFilter.images === "function") {
      attempts.push({
        name: "Photos.pick(filter)",
        run: async () => {
          const r = await Photos.pick({ filter: PHPickerFilter.images(), limit: 1 })
          return (await r?.[0]?.uiImage?.()) ?? null
        },
      })
    }
    attempts.push({
      name: "Photos.pick()",
      run: async () => {
        const r = await Photos.pick({ limit: 1 })
        return (await r?.[0]?.uiImage?.()) ?? null
      },
    })
  }
  if (typeof Photos !== "undefined" && typeof Photos.pickPhotos === "function") {
    attempts.push({
      name: "Photos.pickPhotos(1)",
      run: async () => {
        const r = await Photos.pickPhotos(1)
        return r?.[0] ?? null
      },
    })
  }
  let lastError = ""
  for (const attempt of attempts) {
    try {
      const image = await attempt.run()
      if (image) return { image, error: "" }
      // 返回空但没抛错：用户取消了选择器
      return { image: null, error: "__cancelled__" }
    } catch (e) {
      if (isCancelError(e)) return { image: null, error: "__cancelled__" }
      lastError = `${attempt.name} ${String(e)}`
    }
  }
  return { image: null, error: lastError || "当前版本无可用相册接口" }
}

// 相册选图 → 本机识别
export async function recognizeFromPickedScreenshot(): Promise<OCRResult> {
  if (typeof Photos === "undefined" || typeof Vision === "undefined") {
    return { ok: false, reason: "unsupported", message: "当前 Scripting 版本不支持本机识别（需要 Vision + Photos）" }
  }
  const picked = await pickOneImage()
  if (picked.error === "__cancelled__") return { ok: false, reason: "cancelled", message: "已取消选择" }
  if (!picked.image) return { ok: false, reason: "failed", message: `打开相册失败：${picked.error}` }
  return recognize(picked.image)
}

// 相机扫描（纸质票 / 另一台设备上的截图）；用户退出扫描器属正常取消
export async function recognizeFromCamera(): Promise<OCRResult> {
  if (typeof Vision === "undefined" || typeof Vision.scanDocument !== "function") {
    return { ok: false, reason: "unsupported", message: "当前 Scripting 版本不支持相机扫描" }
  }
  try {
    const pages = await Vision.scanDocument({
      recognitionLevel: "accurate",
      recognitionLanguages: ["zh-Hans", "en"],
    })
    const text = Array.isArray(pages) ? pages.join("\n") : ""
    if (!text.trim()) return { ok: false, reason: "cancelled", message: "已取消扫描" }
    return { ok: true, text, candidates: [] }
  } catch (e) {
    return fail("相机扫描", e)
  }
}

function clockValue(content: string): string {
  const match = content.trim().replace(/：/g, ":").match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : ""
}

function validBox(candidate: OCRCandidate): boolean {
  const b = candidate?.boundingBox
  return typeof candidate?.content === "string" && !!b &&
    [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
    b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 &&
    b.x + b.width <= 1.001 && b.y + b.height <= 1.001
}

// 只重试缺站名/徽章的双列火车卡片；裁图失败不影响首次识别。
async function retryStationRow(image: any, text: string, candidates: OCRCandidate[]): Promise<OCRCandidate[]> {
  try {
    if (typeof image?.renderedIn !== "function" || !Number.isFinite(image.width) || !Number.isFinite(image.height) ||
      image.width <= 0 || image.height <= 0) return candidates
    const boxes = candidates.filter(validBox)
    const trip = parseTripText(text, undefined, "auto", boxes.map(c => ({
      content: c.content, x: c.boundingBox.x, y: c.boundingBox.y, w: c.boundingBox.width, h: c.boundingBox.height,
    })))
    if (trip.mode !== "rail" || !/^[GDCZTKY]\d{1,4}$/.test(trip.code)) return candidates
    if (trip.fromPlace && trip.toPlace && railStationState(trip, trip.fromPlace) && railStationState(trip, trip.toPlace)) return candidates
    if (!trip.departTime || !trip.arriveTime || trip.departTime === trip.arriveTime) return candidates
    const left = boxes.find(c => clockValue(c.content) === trip.departTime)
    const right = boxes.find(c => clockValue(c.content) === trip.arriveTime)
    if (!left || !right) return candidates
    const a = left.boundingBox, b = right.boundingBox
    const clockHeight = Math.max(a.height, b.height)
    const centerA = a.y + a.height / 2, centerB = b.y + b.height / 2
    if (a.x + a.width > b.x || Math.abs(centerA - centerB) > clockHeight / 2) return candidates
    const mid = (centerA + centerB) / 2
    // wrapper 未约定 y 原点：两种方向均由原时间对校验，不能导入错误区域。
    for (const bottomOrigin of [false, true]) {
      const visualMid = bottomOrigin ? 1 - mid : mid
      const top = Math.max(0, visualMid - clockHeight)
      const bottom = Math.min(1, visualMid + 2.5 * clockHeight)
      const span = bottom - top
      const sourceHeight = image.height * span
      const scale = Math.min(2, 2400 / image.width, Math.sqrt(2000000 / (image.width * sourceHeight)))
      try {
        const crop = image.renderedIn(
          { width: Math.max(1, Math.floor(image.width * scale)), height: Math.max(1, Math.floor(sourceHeight * scale)) },
          { position: { x: 0, y: top * image.height }, size: { width: image.width, height: sourceHeight } },
        )
        if (!crop) continue
        const result = await Vision.recognizeText(crop, {
          recognitionLevel: "accurate",
          recognitionLanguages: ["zh-Hans", "en"],
          usesLanguageCorrection: true,
          minimumTextHeight: 0.005,
          customWords: ["起", "过", "终"],
        })
        const cropCandidates: OCRCandidate[] = Array.isArray(result?.candidates) ? result.candidates.filter(validBox) : []
        const clocks = new Set(`${result?.text ?? ""}\n${cropCandidates.map(c => c.content).join("\n")}`
          .replace(/：/g, ":").match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)?.map(clockValue))
        if (!clocks.has(trip.departTime) || !clocks.has(trip.arriveTime)) continue
        const yOffset = bottomOrigin ? 1 - bottom : top
        const mapped = cropCandidates.map(c => ({
          ...c, boundingBox: { ...c.boundingBox, y: yOffset + c.boundingBox.y * span, height: c.boundingBox.height * span },
        }))
        // 两个裁图区重叠时，时间块的位置还需匹配，才能确认坐标方向。
        if (![left, right].every(original => mapped.some(c => clockValue(c.content) === clockValue(original.content) &&
          Math.abs(c.boundingBox.y + c.boundingBox.height / 2 - original.boundingBox.y - original.boundingBox.height / 2) < clockHeight / 2))) continue
        return [...candidates, ...mapped.filter(c => !clockValue(c.content))]
      } catch {} // 有界增强失败，继续下一方向或保留原结果。
    }
  } catch {} // 首次识别成功后，增强不得让相册流程失败。
  return candidates
}

async function recognize(image: any): Promise<OCRResult> {
  try {
    const result = await Vision.recognizeText(image, {
      recognitionLevel: "accurate",
      recognitionLanguages: ["zh-Hans", "en"],
      usesLanguageCorrection: true,
      minimumTextHeight: 0.005,
    })
    const text: string = result?.text ?? ""
    if (!text.trim()) {
      return { ok: false, reason: "failed", message: "没识别到文字：图片可能过糊，或选到了非截图" }
    }
    const candidates = Array.isArray(result?.candidates) ? result.candidates : []
    return { ok: true, text, candidates: await retryStationRow(image, text, candidates) }
  } catch (e) {
    return fail("文字识别失败", e)
  }
}
