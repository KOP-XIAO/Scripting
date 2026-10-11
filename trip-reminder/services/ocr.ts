// services/ocr.ts — 相册选图 + 本机文字识别（Vision）
// Vision / Photos / PHPickerFilter 均为全局对象，禁止从 "scripting" 导入
// （生产范本验证：导入会静默拿到 undefined）。
//
// 隐私：识别全部在本机 Vision 框架完成，无任何网络请求、无第三方服务；
//       选中的图片仅用于本次识别，不落盘、不上传。
//
// 错误处理约定：用户主动取消（关闭选图器 / 退出扫描器）是正常操作——
// 系统桥接层会抛异常，这里统一归类为 reason:"cancelled"，由调用方静默处理，
// 不再弹「扫描失败／用户放弃扫描」这类会误导的提示；真失败才带出错步骤。

declare const Vision: any
declare const Photos: any
declare const PHPickerFilter: any

export type OCRResult =
  | { ok: true; text: string }
  | { ok: false; reason: "cancelled" | "unsupported" | "failed"; message: string }

// 取消类错误：文案可能是「用户放弃扫描」「已取消」「Cancel」等
function isCancelError(e: unknown): boolean {
  return /取消|放弃|cancel|dismiss|abort/i.test(String(e ?? ""))
}

function fail(step: string, e: unknown): OCRResult {
  if (isCancelError(e)) return { ok: false, reason: "cancelled", message: "已取消" }
  return { ok: false, reason: "failed", message: `${step}：${String(e)}` }
}

// 相册选图 → 本机识别
export async function recognizeFromPickedScreenshot(): Promise<OCRResult> {
  if (typeof Photos === "undefined" || typeof Vision === "undefined") {
    return { ok: false, reason: "unsupported", message: "当前 Scripting 版本不支持本机识别（需要 Vision + Photos）" }
  }

  // 选图：优先带图片过滤器；该版本若没有 PHPickerFilter 就退回无过滤调用
  let picked: any[] = []
  try {
    const canFilter = typeof PHPickerFilter !== "undefined" && typeof PHPickerFilter.images === "function"
    picked = canFilter
      ? await Photos.pick({ filter: PHPickerFilter.images(), limit: 1 })
      : await Photos.pick({ limit: 1 })
  } catch (e) {
    return fail("打开相册失败", e)
  }
  if (!picked || !picked.length) return { ok: false, reason: "cancelled", message: "已取消选择" }

  let image: any = null
  try {
    image = await picked[0].uiImage()
  } catch (e) {
    return fail("读取所选图片失败", e)
  }
  if (!image) return { ok: false, reason: "failed", message: "所选项目不是图片，请选一张行程截图" }

  try {
    const result = await Vision.recognizeText(image, {
      recognitionLevel: "accurate",
      recognitionLanguages: ["zh-Hans", "en"],
      usesLanguageCorrection: true,
    })
    const text: string = result?.text ?? ""
    if (!text.trim()) {
      return { ok: false, reason: "failed", message: "没识别到文字：图片可能过糊，或选到了非截图" }
    }
    return { ok: true, text }
  } catch (e) {
    return fail("文字识别失败", e)
  }
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
    return { ok: true, text }
  } catch (e) {
    return fail("相机扫描", e)
  }
}
