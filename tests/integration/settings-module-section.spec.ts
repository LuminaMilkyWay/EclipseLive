import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 设置页「模块」分区的控件布局守卫。
 *
 * 用户反馈：「部分 UI 元素，功能控件的高度和位置有些问题，这里举例为设置页里的模块管理部分」。
 * 实测症状（真机截图 + DOM 几何）：模块卡片里的操作按钮被拆成**两行**——「打开/关闭工具」
 * 与「禁用/卸载」分属两个 `.module-actions` 容器；且 `.module-actions` 没有 `align-items`，
 * 按钮高度不齐，模块行高也因此参差（187/249/205/219/219）。
 *
 * 本守卫把"同一张模块卡里的操作按钮必须在同一行、同一高度"钉死。
 */

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

interface BtnBox {
  label: string
  y: number
  h: number
  x: number
}

async function moduleCards(
  page: Awaited<ReturnType<typeof electron.launch>>['firstWindow'] extends () => Promise<infer P>
    ? P
    : never
): Promise<Array<{ id: string; actions: BtnBox[]; groups: number; cardH: number }>> {
  return await page.evaluate(() => {
    interface El {
      getBoundingClientRect(): { x: number; y: number; width: number; height: number }
      querySelectorAll(sel: string): ArrayLike<El>
      textContent: string | null
      dataset: { testid?: string }
    }
    const g = globalThis as unknown as {
      document: { querySelectorAll(sel: string): ArrayLike<El> }
    }
    const out: Array<{ id: string; actions: BtnBox[]; groups: number; cardH: number }> = []
    for (const card of Array.from(g.document.querySelectorAll('[data-testid^="module-card-"]'))) {
      const groups = Array.from(card.querySelectorAll('.module-actions'))
      const actions: BtnBox[] = []
      for (const el of Array.from(card.querySelectorAll('.module-actions button'))) {
        const r = el.getBoundingClientRect()
        actions.push({
          label: (el.textContent ?? '').trim().slice(0, 12),
          y: Math.round(r.y),
          h: Math.round(r.height),
          x: Math.round(r.x)
        })
      }
      out.push({
        id: card.dataset.testid ?? '',
        actions,
        groups: groups.length,
        cardH: Math.round(card.getBoundingClientRect().height)
      })
    }
    return out
  })
}

test('设置·模块分区：同一张模块卡的操作按钮必须在同一行且高度一致', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-modsec-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: {
      ...process.env,
      EL_TEST_USERDATA: iso,
      EL_TEST_SKIP_TITLE: '1',
      EL_TEST_SKIP_WHATS_NEW: '1'
    } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()
  try {
    await page.getByTestId('tab-settings').click()
    await page.waitForTimeout(800)
    // 滚到模块分区（避免懒渲染/视口外未测量）
    await page.evaluate(() => {
      interface El {
        scrollIntoView(o: unknown): void
      }
      const g = globalThis as unknown as {
        document: { querySelectorAll(sel: string): ArrayLike<El> }
      }
      const card = g.document.querySelectorAll('[data-testid^="module-card-"]')[0]
      card?.scrollIntoView({ block: 'start' })
    })
    await page.waitForTimeout(500)

    const cards = await moduleCards(page)
    expect(cards.length, '应至少有一张模块卡').toBeGreaterThan(0)

    for (const c of cards) {
      expect(c.actions.length, `${c.id} 应有操作按钮`).toBeGreaterThan(0)
      // ① 只允许**一个**操作容器（两个容器必然渲染成两行）
      expect(c.groups, `${c.id} 出现了 ${c.groups} 个 .module-actions（应为 1，否则按钮被拆成多行）`).toBe(1)
      // ② 同一行：y 差 ≤ 2px
      const ys = c.actions.map((a) => a.y)
      expect(
        Math.max(...ys) - Math.min(...ys),
        `${c.id} 的操作按钮不在同一行：${c.actions.map((a) => `${a.label}@y${a.y}`).join(' / ')}`
      ).toBeLessThanOrEqual(2)
      // ③ 高度一致：h 差 ≤ 2px
      const hs = c.actions.map((a) => a.h)
      expect(
        Math.max(...hs) - Math.min(...hs),
        `${c.id} 的操作按钮高度不一致：${c.actions.map((a) => `${a.label}: h${a.h}`).join(' / ')}`
      ).toBeLessThanOrEqual(2)
    }
  } finally {
    await app.close().catch(() => {})
  }
})
