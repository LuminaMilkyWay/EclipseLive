import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 面板/菜单过渡守卫（用户规格版）：
 * - 菜单：**向下回收 / 向上展开**（纯上下位移，采样必须出现 ≥3 个不同中间值）；
 * - 浮动面板：专注态改为"内容区跨列铺满" ⇒ **不再有列宽动画**（宽度采样应恒定 ⇒ 布局时序问题从根上消失）。
 * 流程最小化：只做 DOM 直点，不等可见性。
 */
test('probe: 菜单上下动效 + 面板无列宽动画', async () => {
  test.setTimeout(60_000)
  const iso = mkdtempSync(join(tmpdir(), 'el-probe-x-'))
  const app = await electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: resolve(__dirname, '../..'),
    env: {
      ...process.env,
      EL_TEST_USERDATA: iso,
      EL_TEST_SKIP_TITLE: '1',
      EL_TEST_SKIP_WHATSNEW: '1'
    } as unknown as Record<string, string>
  })
  try {
    const win = await app.firstWindow()
    await win.waitForSelector('[data-testid="dock-sidebar-toggle"]', { timeout: 30_000 })
    await win.waitForTimeout(500)

    const click = async (sel: string): Promise<void> => {
      await win.evaluate(`document.querySelector('${sel}')?.click()`)
    }
    const sample = async (expr: string, times = 24): Promise<string[]> => {
      const out: string[] = []
      for (let i = 0; i < times; i++) {
        await win.waitForTimeout(30)
        out.push(String(await win.evaluate(expr)))
      }
      return out
    }
    const innerT =
      "(() => { const e = document.querySelector('.side-inner'); if (!e) return 'none'; return getComputedStyle(e).transform; })()"
    const contentW = "Math.round(document.querySelector('.content').getBoundingClientRect().width)"

    // 展开：向上（采样窗口覆盖收起延时 + 面板时长）
    await click('[data-testid="dock-sidebar-toggle"]')
    const openT = await sample(innerT)
    console.log('SIDE_OPEN_T=' + JSON.stringify(openT))
    expect(new Set(openT).size, `展开无过渡：${openT.join()}`).toBeGreaterThanOrEqual(3)

    // 收起：向下
    await click('[data-testid="dock-sidebar-toggle"]')
    const closeT = await sample(innerT)
    console.log('SIDE_CLOSE_T=' + JSON.stringify(closeT))
    expect(new Set(closeT).size, `收起无过渡：${closeT.join()}`).toBeGreaterThanOrEqual(3)

    // 浮动面板：跨列铺满后**不应再有列宽动画**（宽度采样恒定）
    const w = await sample(contentW, 6)
    console.log('CONTENT_W=' + JSON.stringify(w))
    expect(new Set(w).size, `内容区不应再有列宽动画：${w.join()}`).toBe(1)
  } finally {
    await app.close().catch(() => {})
  }
})
