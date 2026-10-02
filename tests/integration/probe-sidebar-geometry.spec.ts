import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 侧栏几何守卫（用户规格）：专注态下菜单**盖在浮动面板之上**，且其尺寸/位置与普通态**完全一致**。
 * 最小流程（无顺序假设）：一次「进入直播中控」+ 一次「展开菜单」，全部 DOM 直点。
 */
test('probe: 专注态覆盖层几何与普通态一致', async () => {
  test.setTimeout(60_000)
  const iso = mkdtempSync(join(tmpdir(), 'el-probe-y-'))
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
  const rect = (sel: string): string =>
    `(() => { const e = document.querySelector('${sel}'); if (!e) return 'missing'; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return JSON.stringify({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),z:cs.zIndex}); })()`

  try {
    const win = await app.firstWindow()
    await win.waitForSelector('[data-testid="tab-obs"]', { timeout: 30_000 })
    await win.waitForTimeout(400)

    const plain = String(await win.evaluate(rect('.side')))
    console.log('SIDE_PLAIN=' + plain)

    await win.evaluate("document.querySelector('[data-testid=\"tab-obs\"]')?.click()")
    await win.waitForTimeout(900)
    await win.evaluate("document.querySelector('[data-testid=\"dock-sidebar-toggle\"]')?.click()")
    await win.waitForTimeout(900)
    const focus = String(await win.evaluate(rect('.side')))
    console.log('SIDE_FOCUS_OPEN=' + focus)

    const a = JSON.parse(plain) as { x: number; y: number; w: number; h: number }
    const b = JSON.parse(focus) as { x: number; y: number; w: number; h: number; z: string }
    expect(Math.abs(a.x - b.x), `x 不一致：${plain} vs ${focus}`).toBeLessThanOrEqual(1)
    expect(Math.abs(a.y - b.y), `y 不一致：${plain} vs ${focus}`).toBeLessThanOrEqual(1)
    expect(Math.abs(a.w - b.w), `宽度不一致：${plain} vs ${focus}`).toBeLessThanOrEqual(1)
    expect(Math.abs(a.h - b.h), `高度不一致：${plain} vs ${focus}`).toBeLessThanOrEqual(2)
    // 用户规格：专注态菜单**盖在浮动面板之上**（z-index 必须高于内容面板）
    expect(Number(b.z), `专注态菜单应浮在面板之上，实际 z-index=${b.z}`).toBeGreaterThan(1)
  } finally {
    await app.close().catch(() => {})
  }
})
