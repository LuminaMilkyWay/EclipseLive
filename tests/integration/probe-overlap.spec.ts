import { test, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 故障点定位（用户报障：「开启多窗口时是把窗口叠在一起吗？有时候模块页会卡在一起导致折射不正确」）。
 *
 * 做法：连续打开多个页面模块/工具，**每 50ms 采样同时可见的原生视图数与各自矩形**，
 * 一旦出现"同时可见 ≥2 个视图"，即打印时间线与矩形 —— 那就是"叠在一起"的故障点。
 * 只诊断，不断言（断言由既有守卫承担）。
 */
const projectRoot = join(__dirname, '../..')

interface ViewState {
  url: string
  visible: boolean
  x: number
  y: number
  width: number
  height: number
}

test('probe: 原生视图重叠故障点定位', async () => {
  test.setTimeout(180_000)
  const iso = mkdtempSync(join(tmpdir(), 'el-overlap-'))
  const app = await electron.launch({
    executablePath: require('electron') as string,
    args: [projectRoot],
    env: {
      ...process.env,
      EL_TEST_USERDATA: iso,
      EL_TEST_SKIP_TITLE: '1',
      EL_TEST_SKIP_WHATSNEW: '1'
    } as unknown as Record<string, string>
  })

  const views = async (): Promise<ViewState[]> =>
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const kids = (win?.contentView?.children ?? []) as Array<{
        webContents?: { getURL(): string }
        getVisible?: () => boolean
        getBounds?: () => { x: number; y: number; width: number; height: number }
      }>
      return kids
        .map((v) => ({
          url: (() => {
            try {
              return v.webContents?.getURL() ?? ''
            } catch {
              return ''
            }
          })(),
          visible: typeof v.getVisible === 'function' ? v.getVisible() : false,
          ...(typeof v.getBounds === 'function' ? v.getBounds() : { x: 0, y: 0, width: 0, height: 0 })
        }))
        .filter((v) => v.url.startsWith('http'))
    })

  const short = (u: string): string => {
    try {
      return new URL(u).host + new URL(u).pathname.slice(0, 18)
    } catch {
      return u.slice(0, 30)
    }
  }

  try {
    const page = await app.firstWindow()
    await page.waitForSelector('[data-testid="tab-modules"]', { timeout: 30_000 })
    await page.waitForTimeout(800)

    /** 打开一个模块入口（页面模块或 pinned 工具）。 */
    const openEntry = async (testId: string): Promise<void> => {
      const item = page.getByTestId(testId)
      if (!(await item.isVisible().catch(() => false))) {
        await page.getByTestId('tab-modules').click()
        await page.waitForTimeout(300)
      }
      await item.waitFor({ state: 'visible', timeout: 10_000 })
      await item.click()
      await page.waitForTimeout(150)
    }

    /** 采样一段时间，报告"同时可见 ≥2"的窗口。 */
    const watch = async (label: string, ms: number): Promise<void> => {
      const t0 = Date.now()
      const overlapFrames: string[] = []
      let maxVisible = 0
      while (Date.now() - t0 < ms) {
        const vs = await views()
        const vis = vs.filter((v) => v.visible)
        maxVisible = Math.max(maxVisible, vis.length)
        if (vis.length >= 2) {
          overlapFrames.push(
            `t+${Date.now() - t0}ms  同时可见 ${vis.length} 个：` +
              vis.map((v) => `${short(v.url)}[${v.x},${v.y} ${v.width}x${v.height}]`).join('  |  ')
          )
        }
        await page.waitForTimeout(50)
      }
      console.log(`WATCH ${label}: 最大同时可见=${maxVisible} 重叠帧数=${overlapFrames.length}`)
      for (const f of overlapFrames.slice(0, 6)) console.log('  OVERLAP ' + f)
    }

    // 场景 A'（用户实测复现）：VTS 页面模块 + 测试浏览器模块（example-web）
    await openEntry('page-nav-vts-controlpad')
    await watch('打开 VTS 页面模块后', 1500)
    await openEntry('tool-nav-example-web')
    await watch('紧接着打开测试浏览器(example-web)后', 3000)
    await openEntry('page-nav-vts-controlpad')
    await watch('再切回 VTS 页面模块后', 3000)
    await openEntry('tool-nav-example-web')
    await watch('再切回 example-web 后', 3000)

    // 场景 B：页面模块 ↔ pinned 工具 来回切
    await openEntry('tool-nav-laplacelive-link')
    await watch('再打开 pinned 网页工具后', 2500)
    await openEntry('page-nav-vts-controlpad')
    await watch('切回 VTS 页面模块后', 2500)

    // 场景 C：切到非模块页（设置）后
    await page.getByTestId('tab-settings').click()
    await watch('切到设置页后', 2000)

    const final = await views()
    console.log('FINAL_VIEWS=' + JSON.stringify(final.map((v) => ({ u: short(v.url), vis: v.visible }))))
  } finally {
    await app.close().catch(() => {})
  }
})
