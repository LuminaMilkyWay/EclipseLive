import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 模块页槽位几何守卫（用户反馈"功能页没占满右侧内容区"后补的**应用级**实测）。
 *
 * 之前我用"单独渲染模块页"的方式量过排版 —— 那只能证明**页面自己**会铺满，
 * 证明不了**宿主给它的槽位**够不够大。真正的几何来自主窗里的
 * `.module-page-host` 上报矩形（T30/T31），所以这里直接量主窗 DOM：
 * 槽位是否覆盖内容区（= 右侧 3/4），主进程的 WebContentsView 就是按这个矩形叠上去的。
 */

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('模块页槽位：必须覆盖整个内容区（右侧四分之三不能空着）', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-slot-'))
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
    // 打开 VTS 控制台的功能页（模块页）；没有 VTS 也能打开，页面显示空状态
    const nav = page.getByTestId('page-nav-vts-controlpad')
    await nav.waitFor({ state: 'visible', timeout: 15000 }).catch(async () => {
      // 模块下拉需要先展开
      await page.getByTestId('tab-modules').click()
      await nav.waitFor({ state: 'visible', timeout: 5000 })
    })
    await nav.click()

    const host = page.getByTestId('module-page-host')
    await expect(host).toBeVisible()
    await page.waitForTimeout(400) // 等入场动效与 ResizeObserver 上报

    // ★ 用户说的是"全屏之后"，故必须量**大窗口**：把主窗拉到接近全屏再测
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.setSize(1900, 1000)
    })
    await page.waitForTimeout(600)

    const box = await host.boundingBox()
    const metrics = await page.evaluate(() => {
      interface Box {
        getBoundingClientRect(): { x: number; y: number; width: number; height: number }
      }
      const g = globalThis as unknown as {
        document: { querySelector(sel: string): Box | null }
        innerWidth: number
        innerHeight: number
      }
      const content = g.document.querySelector('.content')
      const rect = content ? content.getBoundingClientRect() : null
      return {
        innerWidth: g.innerWidth,
        innerHeight: g.innerHeight,
        content: rect ? { x: rect.x, width: rect.width, height: rect.height } : null
      }
    })

    // eslint-disable-next-line no-console
    console.log('SLOT', JSON.stringify({ box, ...metrics }))

    expect(box, '模块页槽位应可见').toBeTruthy()
    // 槽位宽度应基本铺满内容区（容许 2px 边框误差）
    if (metrics.content) {
      expect(
        box!.width,
        `槽位宽度 ${Math.round(box!.width)} 应铺满内容区宽度 ${Math.round(metrics.content.width)}`
      ).toBeGreaterThan(metrics.content.width - 3)
      // 高度也应基本铺满内容区（内容区可能是滚动容器，故只要求不小于其 80%）
      expect(box!.height).toBeGreaterThan(metrics.content.height * 0.8)
      // 内容区应从侧栏之后开始，且右侧不留大片空白
      const rightGap = metrics.innerWidth - (box!.x + box!.width)
      expect(rightGap, `右侧空白 ${Math.round(rightGap)}px 过大`).toBeLessThan(
        metrics.innerWidth - metrics.content.x - metrics.content.width + 40
      )
    }
  } finally {
    await app.close().catch(() => {})
  }
})
