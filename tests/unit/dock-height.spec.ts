import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCK_HEIGHT_CSS, DOCK_HEIGHT_PX } from '../../src/shared/layout'

/**
 * DOCK 任务栏高度「单一真源」守卫（T38）。
 *
 * 机制（docs/UI-OBS-FOCUS-MODE-ASSESSMENT.md §三-结论 1）：
 *   `WebContentsView` 是**原生层**，DOM 的 z-index 盖不住它 —— 任务栏"在最上"靠的是
 *   **几何内缩**：原生视图高度 = 窗口高 − 任务栏高。因此
 *   **CSS 的 `--dock-h` 必须与 `shared/layout.ts` 的 `DOCK_HEIGHT_PX` 数值完全一致**，
 *   且 `.tool-bar` 必须消费该令牌（不得再出现 `height: 48px` 这类硬编码）。
 */
const CSS = resolve(__dirname, '../../src/renderer/src/renderer.css')

describe('DOCK 任务栏高度：单一真源', () => {
  it('CSS 令牌 --dock-h 与 shared/layout.ts 数值一致', async () => {
    const css = await readFile(CSS, 'utf8')
    const m = /--dock-h:\s*(\d+)px/.exec(css)
    expect(m, 'CSS 缺少 --dock-h 令牌').toBeTruthy()
    expect(`--dock-h: ${m![1]}px`).toBe(`--dock-h: ${DOCK_HEIGHT_CSS}`)
    expect(Number(m![1])).toBe(DOCK_HEIGHT_PX)
  })

  it('.tool-bar 消费 --dock-h，且不再硬编码高度', async () => {
    const css = await readFile(CSS, 'utf8')
    const block = /\.tool-bar\s*\{([^}]*)\}/.exec(css)
    expect(block, '缺少 .tool-bar 规则').toBeTruthy()
    expect(block![1], '.tool-bar 高度必须用 var(--dock-h)').toContain('height: var(--dock-h)')
    expect(block![1], '.tool-bar 不得再硬编码 height: 48px').not.toMatch(/height:\s*48px/)
  })

  it('hover 放大只用 transform（不得改变高度 ⇒ 不得牵动原生视图内缩）', async () => {
    const css = await readFile(CSS, 'utf8')
    // 只取 .dock-item 自身的规则（含 :hover / .active 变体），**不含** .dock-item-icon / .dock-item-label
    const blocks = [...css.matchAll(/\.dock-item(?::hover|\.active)?\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '')
    expect(blocks.length, '缺少 .dock-item 规则（DOCK 项）').toBeGreaterThan(0)
    for (const body of blocks) {
      expect(body, 'DOCK 项不得改变高度（会让原生视图内缩错位）').not.toMatch(/(^|[^-])height:/)
    }
    const hover = /\.dock-item:hover\s*\{([^}]*)\}/.exec(css)
    expect(hover, '缺少 .dock-item:hover 规则').toBeTruthy()
    expect(hover![1], 'hover 放大只能用 transform').toContain('transform')
  })
})
