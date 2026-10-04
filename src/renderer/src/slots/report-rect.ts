/**
 * 槽位矩形上报的**纯逻辑**（`AI_RULES` 25 / `docs/CODE-LAYOUT.md`：逻辑入模块，组件只接线）。
 *
 * 背景（用户实测回归，日志现场）：
 *   `laplacelive-link` 先上报正确矩形 `x313 y37 w754 h543`，随后又上报
 *   `x677 y37 w1846 h1231` —— **比窗口还大** ⇒ 嵌入视图被画到窗口外、盖住一切。
 *   该尺寸是**带 transform 缩放**的包围盒（1846 ≠ 元素布局宽 754），
 *   即上报发生在**入场动画（档 4 materialize）进行中**，`getBoundingClientRect()`
 *   返回的是缩放后的盒子 —— 与 `module-view-bounds` 头注释记载的历史根因同类。
 *
 * 因此上报必须满足两条：
 *   ① **动画中不上报**：`rect.width` 与元素布局宽（`offsetWidth`）不一致即说明有缩放 ⇒ 本次跳过，
 *      等动画结束后的补报（组件监听 animationend / transitionend）；
 *   ② **一律夹取到窗口可视区**：防御性兜底 —— 即使再出现异常盒，也**永远不会**超出窗口
 *      （用户可见症状"盖住一切"从机制上不可能再发生）。
 */

/** 上报给主进程的矩形（窗口 CSS 像素）。 */
export interface SlotRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SlotRectInput {
  /** `el.getBoundingClientRect()` 的结果（含 transform）。 */
  rect: { x: number; y: number; width: number; height: number }
  /** `el.offsetWidth` —— 布局宽（不含 transform），用于识别"动画中的缩放盒"。 */
  offsetWidth: number
  /** `el.offsetHeight`。 */
  offsetHeight: number
  /** 壳内缩（工具槽 12px；模块页槽 0）。 */
  pad: number
  /** 窗口可视区尺寸。 */
  viewport: { width: number; height: number }
  /**
   * **被 DOM 覆盖层挡住的边界**（左/上），单位与 rect 相同。
   *
   * 为什么需要它：原生 `WebContentsView` **永远画在 DOM 之上**（见 `src/shared/layout.ts` 注释
   * "DOM 的 z-index 对原生视图无效"）。专注态下内容区无条件跨两列（守卫钉住），用户**展开侧栏**时
   * 侧栏只是 DOM 覆盖层 ⇒ 模块页槽位又**故意铺满内容区** ⇒ 原生视图会**压住侧栏与顶栏**
   * （视觉上盖住、点击也归视图 —— 用户实测："标题/「监控」从卡片缝里透出来、DOCK 点不动"）。
   * ⇒ 因此把"侧栏右缘 / 顶栏下缘"作为遮挡边界传入，视图**让开**这几条即可。
   */
  occluded?: { left?: number; top?: number }
  /** 允许的缩放判定容差（默认 0.5px，规避亚像素抖动）。 */
  tolerance?: number
}

/**
 * 计算本次要上报的矩形；**返回 `null` 表示本次不上报**（动画中 / 尺寸非法）。
 */
export function computeSlotReport(input: SlotRectInput): SlotRect | null {
  // ⚠️ 事故记录（T46，必须保留这段注释）：本函数曾在此处加过一条抑制 ——
  //   若根属性 `data-layout-anim` 存在则 `return null`（"布局过渡期间不上报"）。
  //   后果：槽位**始终不上报**（因为每次切页都会打标记，且事后没有补报）
  //   ⇒ 宿主不被槽位驱动 ⇒ 回落到 T11 的"整窗自适应" ⇒ **web 视图盖住所有面板**。
  //   结论：**任何上报抑制都必须配套"事后强制补报"**；本模块无法自行补报（它无副作用、无订阅），
  //   因此这里**不再抑制**。过渡中间态造成的偶发偏差由下方 clamp 与调用方的重报机制兜底。
  const { rect, offsetWidth, offsetHeight, pad, viewport } = input
  const tol = input.tolerance ?? 0.5

  // 非法尺寸：不上报（避免把 NaN/0 传给主进程）
  for (const v of [rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height]) {
    if (!Number.isFinite(v)) return null
  }
  if (rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null

  // ① 动画中：包围盒与布局盒不一致（存在 transform 缩放）⇒ 本次不上报
  if (offsetWidth > 0 && Math.abs(rect.width - offsetWidth) > tol) return null
  if (offsetHeight > 0 && Math.abs(rect.height - offsetHeight) > tol) return null

  // 内缩壳内距（工具槽与 renderer.css 的 padding 对齐；模块页槽 pad=0）
  let x = rect.x + pad
  let y = rect.y + pad
  let width = Math.max(rect.width - pad * 2, 0)
  let height = Math.max(rect.height - pad * 2, 0)

  // ①.5 让开**被 DOM 覆盖层挡住的边界**（专注态展开的侧栏 / 顶栏）：
  //     原生视图永远在 DOM 之上 ⇒ 不让开就会"盖住侧栏与菜单"（用户实测事故，注释见 SlotRectInput.occluded）。
  const occl = input.occluded
  if (occl) {
    if (Number.isFinite(occl.left) && (occl.left as number) > x) {
      const cut = (occl.left as number) - x
      x += cut
      width -= cut
    }
    if (Number.isFinite(occl.top) && (occl.top as number) > y) {
      const cut = (occl.top as number) - y
      y += cut
      height -= cut
    }
    // 让开之后若已无有效面积 ⇒ 本次不上报（保持视图在原处，避免出现 0 宽视图）
    if (width <= 0 || height <= 0) return null
  }

  // ② 夹取到窗口可视区：任何情况下都不允许超出
  if (x < 0) {
    width += x
    x = 0
  }
  if (y < 0) {
    height += y
    y = 0
  }
  if (x > viewport.width) {
    x = viewport.width
    width = 0
  }
  if (y > viewport.height) {
    y = viewport.height
    height = 0
  }
  width = Math.max(Math.min(width, viewport.width - x), 0)
  height = Math.max(Math.min(height, viewport.height - y), 0)

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/**
 * 落定补报器（T47，PROBLEM-REPORT-2026-10-01 §1.5 方案 A）。
 *
 * 背景：布局落定信号（`el:layout-settled`）到达时，单次补报仍可能撞上尾帧动画——
 * `computeSlotReport` 的一致性检查（rect 与布局盒不一致 ⇒ 跳过）会把这唯一的补报
 * 吞掉，之后**没有任何人再报**，视图停在错误矩形上（专注态宽矩形残留=用户实测事故）。
 *
 * 语义：`poke()` 先同步试一次（落定信号到达时矩形通常已稳定）；未上报则逐帧（rAF）
 * 重试，直到 `report()` 返回 true 或超过 `maxFrames`。`cancel()` 停止并不再响应
 * （组件卸载时调用）。纯逻辑：计时器经参数注入，单测不依赖 DOM。
 */
export interface SettledReporter {
  /** 收到落定信号：尝试补报，必要时逐帧重试。 */
  poke: () => void
  /** 停止重试并永久失效（卸载语义）。 */
  cancel: () => void
}

export function createSettledReporter(
  report: () => boolean,
  opts?: {
    /** 最大尝试帧数（默认 60 ≈ 1s@60fps，覆盖慢机/掉帧；实测场景 1–2 帧内成功）。 */
    maxFrames?: number
    raf?: (cb: () => void) => number
    caf?: (id: number) => void
  }
): SettledReporter {
  const maxFrames = opts?.maxFrames ?? 60
  // globalThis 强转：本文件被 node tsconfig（测试侧）覆盖，不能直接引用 DOM 全局。
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: () => void) => number
    cancelAnimationFrame?: (id: number) => void
  }
  const raf = opts?.raf ?? ((cb: () => void): number => g.requestAnimationFrame!(cb))
  const caf = opts?.caf ?? ((id: number): void => g.cancelAnimationFrame!(id))
  let pending = 0
  let attempts = 0
  let cancelled = false

  const step = (): void => {
    pending = 0
    if (cancelled) return
    if (report()) return
    if (++attempts >= maxFrames) return
    pending = raf(step)
  }

  return {
    poke: () => {
      if (cancelled) return
      if (pending !== 0) {
        caf(pending)
        pending = 0
      }
      attempts = 0
      if (report()) return
      attempts = 1
      pending = raf(step)
    },
    cancel: () => {
      cancelled = true
      if (pending !== 0) {
        caf(pending)
        pending = 0
      }
    }
  }
}
