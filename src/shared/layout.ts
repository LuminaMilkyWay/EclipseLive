/**
 * 布局常量（**单一真源**）—— DOCK 任务栏高度。
 *
 * 为什么必须单一真源（T38，docs/UI-OBS-FOCUS-MODE-ASSESSMENT.md §三-结论 1）：
 *   `.tool-bar` 的高度与**原生视图的底部内缩**（`WebContentsView` 的 height 要减去它）
 *   必须**永远相等** —— 否则原生层会盖住任务栏（DOM 的 z-index 对原生视图无效）。
 *   此前这两个值分别硬编码在主进程（`WEB_TOOLBAR_PX = 48`）与 CSS（`height: 48px`）里
 *   ⇒ 任何一侧改动都会静默漂移。
 *
 * 三处引用（改动本文件即可，守卫 `tests/unit/dock-height.spec.ts` 防漂移）：
 *   ① 主进程装配层：`src/main/index.ts` 的 `getBottomInset()`
 *   ② 渲染层样式：`renderer.css` 的 `--dock-h`（守卫断言两者数值一致）
 *   ③ 渲染层布局：`.tool-bar { height: var(--dock-h) }`
 */

/** DOCK 任务栏高度（px）。 */
export const DOCK_HEIGHT_PX = 48

/** 供 CSS 侧比对/写出用的字符串形式（`48px`）。 */
export const DOCK_HEIGHT_CSS = `${DOCK_HEIGHT_PX}px`
