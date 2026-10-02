import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 目视诊断探针（T44 动效与 DOCK 项）：
 * ① DOCK 上"已打开的模块/网页工具"长什么样；
 * ② 点「菜单」前后根属性与计算样式是否真的在过渡（用来定位"没动画"）；
 * ③ 展开/收起中途各截一张，便于判读动效。
 * 只产出截图与量测，供判读。
 */
test('probe: DOCK 模块项 + 菜单动效诊断', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-probe-motion-'))
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
  const win = await app.firstWindow()
  await win.waitForSelector('[data-testid="tab-obs"]', { timeout: 30_000 })

  const attrs = async (): Promise<string> =>
    await win.evaluate(
      'JSON.stringify({sidebar:document.documentElement.getAttribute("data-sidebar"),focus:document.documentElement.getAttribute("data-focus"),dock:document.documentElement.getAttribute("data-dock"),layoutTier:document.documentElement.getAttribute("data-layout-tier")})'
    )

  console.log('ATTRS_INITIAL=' + (await attrs()))

  // 打开一个网页工具（若已声明）：优先用 pinned 工具入口
  const chip = await win.$('.dock-center .tool-chip')
  console.log('DOCK_CHIP_BEFORE=' + String(chip !== null))
  // 尝试从侧栏「模块」下拉里打开一个页面模块，制造 DOCK 项
  const opened = await win.evaluate(
    "(async () => { const api = window.eclipselive; if (!api || !api.openWebTool) return 'no-api'; try { await api.openWebTool('example-web'); return 'opened'; } catch (e) { return 'failed:' + String(e).slice(0, 80); } })()"
  )
  console.log('OPEN_WEB_TOOL=' + opened)
  await win.waitForTimeout(900)
  await win.screenshot({ path: 'diag-dock-with-tool.png' })

  const chipInfo = await win.evaluate(
    "(() => { const c = document.querySelector('.dock-center .tool-chip'); if (!c) return null; const r = c.getBoundingClientRect(); const btn = c.querySelector('button'); const br = btn ? btn.getBoundingClientRect() : null; return { chip: { w: Math.round(r.width), h: Math.round(r.height) }, closeBtn: br ? { w: Math.round(br.width), h: Math.round(br.height) } : null, text: c.innerText.replace(/\\n/g, '|') }; })()"
  )
  console.log('DOCK_CHIP_INFO=' + JSON.stringify(chipInfo))

  // 进入直播中控（专注布局）后测试菜单动效
  await win.click('[data-testid="tab-obs"]')
  await win.waitForTimeout(500)
  console.log('ATTRS_FOCUS=' + (await attrs()))

  // 点菜单并在 ~120ms 时截图（看是否处在过渡中间态）
  await win.click('[data-testid="dock-sidebar-toggle"]')
  await win.waitForTimeout(120)
  await win.screenshot({ path: 'diag-menu-mid-anim.png' })
  const mid = await win.evaluate(
    "(() => { const side = document.querySelector('.side'); if (!side) return null; const cs = getComputedStyle(side); return { transform: cs.transform, opacity: cs.opacity, transition: cs.transitionProperty + ' / ' + cs.transitionDuration, position: cs.position }; })()"
  )
  console.log('MENU_MID=' + JSON.stringify(mid))
  console.log('ATTRS_AFTER_TOGGLE=' + (await attrs()))
  await win.waitForTimeout(600)
  await win.screenshot({ path: 'diag-menu-open.png' })
  const settled = await win.evaluate(
    "(() => { const side = document.querySelector('.side'); if (!side) return null; const cs = getComputedStyle(side); const r = side.getBoundingClientRect(); return { transform: cs.transform, opacity: cs.opacity, w: Math.round(r.width), x: Math.round(r.x) }; })()"
  )
  console.log('MENU_SETTLED=' + JSON.stringify(settled))

  expect(await win.$('[data-testid="dock-sidebar-toggle"]')).not.toBeNull()
  await app.close()
})
