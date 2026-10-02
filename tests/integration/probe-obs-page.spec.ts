import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 目视探针：直播中控页在**专注布局**下的实际排版（纯 DOM ⇒ 窗口截图有效）。
 * 只产出截图与量测，供判读；除"页面可达"外不做断言。
 * 启动方式与既有集成用例一致（隔离 userData，避免与真实实例抢锁）。
 */
test('probe: 直播中控页专注布局截图', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-probe-obs-'))
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
  await win.click('[data-testid="tab-obs"]')
  await win.waitForTimeout(1200)
  await win.screenshot({ path: 'diag-obs-page.png' })

  const metrics = await win.evaluate(
    "[\'.content\',\'.content-scroll\',\'.content-scroll .card\',\'.content-scroll .module-actions\',\'.content-scroll input\',\'.tool-bar\'].map(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { sel: s, h: Math.round(r.height), w: Math.round(r.width) }; }).filter(Boolean)"
  )
  console.log('OBS_PAGE_METRICS=' + JSON.stringify(metrics))

  const cards = await win.$$eval('.content-scroll .card', (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { h: Math.round(r.height), w: Math.round(r.width), cls: e.className }
    })
  )
  console.log('OBS_PAGE_CARDS=' + JSON.stringify(cards))
  expect(cards.length).toBeGreaterThan(0)
  await app.close()
})
