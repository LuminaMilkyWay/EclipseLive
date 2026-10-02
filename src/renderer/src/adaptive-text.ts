/**
 * 自适应文字色（Apple 的 vibrancy 思路）：**识别玻璃背后实际是什么颜色 → 自动选黑字或白字**。
 *
 * 为什么现在能做而之前不能：壁纸经自有协议 `eclipse-wallpaper://` 加载，直接塞进 canvas 会被拦/污染 ✗。
 * 但渲染层 CSP 的 `connect-src` **允许** `eclipse-wallpaper:` ✓ ⇒ 可以先 `fetch` 成 **Blob**，
 * 再用 `createImageBitmap` → 离屏 canvas 取像素 ✓ —— Blob 属同源，**不会污染 canvas** ✓。
 *
 * 分层（可测性）：
 * - 纯函数（node 单测）：`meanLuma` / `compositeLuma` / `pickTextTone`；
 * - 薄适配层（浏览器）：`sampleWallpaperLuma` —— **按 URL 采样一次并缓存**（用户既定决策"采样一次"）。
 */

/** 采样降采样边长。 */
export const LUMA_SAMPLE_SIZE = 32

/** Rec.709 相对亮度均值（0..1）。空输入返回 0（视为暗）。 */
export function meanLuma(rgba: ArrayLike<number>): number {
  const n = Math.floor(rgba.length / 4)
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] / 255
    const g = rgba[i * 4 + 1] / 255
    const b = rgba[i * 4 + 2] / 255
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return sum / n
}

/** 面板底色（可带 alpha）。 */
export interface PanelColor {
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

/**
 * **合成亮度**：文字实际"看到"的是「面板色 × α + 底图 × (1-α)」。
 * 这就是"识别下方元素颜色"的核心一步 —— 不能只看底图，也不能只看面板。
 */
export function compositeLuma(panel: PanelColor, backdropLuma: number): number {
  const a = Math.max(0, Math.min(1, panel.a))
  const pr = panel.r / 255
  const pg = panel.g / 255
  const pb = panel.b / 255
  const panelLuma = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb
  return panelLuma * a + backdropLuma * (1 - a)
}

/**
 * 按合成亮度选文字明暗：合成偏亮 ⇒ **深色字**；偏暗 ⇒ **浅色字**。
 * 阈值 0.5 取两套文字色（深浅主题各自的 `--txt-*`）对比度的平衡点。
 */
export function pickTextTone(luma: number, threshold = 0.5): 'light' | 'dark' {
  return luma > threshold ? 'dark' : 'light'
}

/** 按 URL 缓存采样结果（"采样一次"）。 */
const cache = new Map<string, number>()

/** 仅供测试/诊断：缓存条目数。 */
export function lumaCacheSize(): number {
  return cache.size
}

/** 清空缓存（测试用）。 */
export function clearLumaCache(): void {
  cache.clear()
}

/**
 * 采样壁纸平均亮度（**一次性 + 按 URL 缓存**）。任何失败都返回 `null`
 * ⇒ 调用方保持主题默认文字色（**不改变观感**），绝不因采样失败而变色。
 */
export async function sampleWallpaperLuma(url: string): Promise<number | null> {
  if (!url) return null
  const hit = cache.get(url)
  if (hit !== undefined) return hit
  try {
    const g = globalThis as unknown as {
      fetch(input: string): Promise<{ blob(): Promise<unknown> }>
      createImageBitmap(blob: unknown): Promise<{
        width: number
        height: number
        close?(): void
      }>
      OffscreenCanvas?: new (w: number, h: number) => {
        getContext(id: string): {
          drawImage(img: unknown, x: number, y: number, w: number, h: number): void
          getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray }
        } | null
      }
    }
    const res = await g.fetch(url)
    const blob = await res.blob()
    const bmp = await g.createImageBitmap(blob)
    const size = LUMA_SAMPLE_SIZE
    const CanvasCtor = g.OffscreenCanvas
    if (!CanvasCtor) return null
    const canvas = new CanvasCtor(size, size)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, size, size)
    const data = ctx.getImageData(0, 0, size, size).data
    const luma = meanLuma(data)
    bmp.close?.()
    cache.set(url, luma)
    return luma
  } catch {
    return null
  }
}
