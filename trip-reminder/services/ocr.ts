// services/ocr.ts — 相册选图 + 本机文字识别（Vision）
// Vision / Photos / PHPickerFilter 均为全局对象，禁止从 "scripting" 导入
// （生产范本验证：导入会静默拿到 undefined）。
//
// 隐私：识别全部在本机 Vision 框架完成，无任何网络请求、无第三方服务；
//       选中的图片仅用于本次识别，不落盘、不上传。

declare const Vision: any
declare const Photos: any
declare const PHPickerFilter: any

export type OCRResult =
  | { ok: true; text: string }
  | { ok: false; reason: "cancelled" | "unsupported" | "failed"; message: string }

export async function recognizeFromPickedScreenshot(): Promise<OCRResult> {
  if (typeof Photos === "undefined" || typeof Vision === "undefined" || typeof PHPickerFilter === "undefined") {
    return { ok: false, reason: "unsupported", message: "当前 Scripting 版本不支持本机识别（需要 Vision + Photos）" }
  }
  try {
    const picked = await Photos.pick({ filter: PHPickerFilter.images(), limit: 1 })
    if (!picked || !picked.length) return { ok: false, reason: "cancelled", message: "已取消选择" }

    const image = await picked[0].uiImage()
    if (!image) return { ok: false, reason: "failed", message: "无法读取所选图片" }

    const result = await Vision.recognizeText(image, {
      recognitionLevel: "accurate",
      recognitionLanguages: ["zh-Hans", "en"],
      usesLanguageCorrection: true,
    })
    const text: string = result?.text ?? ""
    if (!text.trim()) return { ok: false, reason: "failed", message: "没识别到文字，换一张更清晰的行程截图试试" }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, reason: "failed", message: String(e) }
  }
}

// 相机扫描兜底：纸质车票或另一台设备上的截图
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
    if (!text.trim()) return { ok: false, reason: "cancelled", message: "已取消或未识别到内容" }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, reason: "failed", message: String(e) }
  }
}
