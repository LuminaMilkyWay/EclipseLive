import { expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 用户报障复现路径的回归闸（两次实例请求）：
 *  「打字机模块所有文字和控件位置不正确、盖住菜单按钮」＋「laplace link 出现两个 web 视图，
 *    一个突出面板盖住一切、一个大小正常叠在上面」——**都发生在从「直播中控」切走之后**。
 *
 * 机械判据：**从专注态切回普通页后，任何可见视图的矩形都必须落在右侧内容区之内**。
 * 越界 ⇒ 打印明细（这正是"突出的那个视图"）。
 */
const projectRoot = join(__dirname, '../..')

interface Box {
  x: number
  y: number
  width: number
  height: number
}

test('probe: 专注态切回普通页后，视图矩形必须回到内容区内', async () => {
  test.setTimeout(180_000)
  const iso = mkdtempSync(join(tmpdir(), 'el-focusexit-'))
  const app = await import('@playwright/test').then(({ _electron }) =>
    _electron.launch({
      executablePath: require('electron') as string,
      args: [projectRoot],
      env: {
        ...process.env,
        EL_TEST_USERDATA: iso,
        EL_TEST_SKIP_TITLE: '1',
        EL_TEST_SKIP_WHATSNEW: '1'
      } as unknown as Record<string, string>
    })
  )

  const views = async (): Promise<Array<Box & { url: string; visible: boolean }>> =>
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const kids = (win?.contentView?.children ?? []) as Array<{
        webContents?: { getURL(): string }
        getVisible?: () => boolean
        getBounds?: () => Box
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

  const contentBox = async (): Promise<Box> =>
    await app.firstWindow().then((p) =>
      p.evaluate(() => {
        interface El {
          getBoundingClientRect(): { x: number; y: number; width: number; height: number }
        }
        const g = globalThis as unknown as { document: { querySelector(s: string): El | null } }
        const r = g.document.querySelector('.content')?.getBoundingClientRect()
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : { x: 0, y: 0, width: 0, height: 0 }
      })
    )

  const TOL = 3
  const problems: string[] = []

  const check = async (label: string): Promise<void> => {
    const box = await contentBox()
    const vis = (await views()).filter((v) => v.visible)
    if (vis.length >= 2) problems.push(`${label}: 同时可见 ${vis.length} 个视图（应只有 1 个）`)
    for (const v of vis) {
      const out =
        v.x < box.x - TOL ||
        v.y < box.y - TOL ||
        v.x + v.width > box.x + box.width + TOL ||
        v.y + v.height > box.y + box.height + TOL
      const line = `${label}: ${new URL(v.url).host}${new URL(v.url).pathname.slice(0, 16)} [${v.x},${v.y} ${v.width}x${v.height}] 内容区 [${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}]`
      if (out) problems.push('越界 ' + line)
      else console.log('OK   ' + line)
    }
  }

  try {
    const page = await app.firstWindow()
    await page.waitForSelector('[data-testid="tab-obs"]', { timeout: 30_000 })
    await page.waitForTimeout(1000)

    /**
     * 点侧栏导航项。专注态下侧栏是收起的覆盖层（opacity:0 + pointer-events:none，
     * 命中测试永远落到内容区元素上 ⇒ 点不到），真实用户路径是先点 DOCK「菜单」展开
     * 覆盖层侧栏再点导航项。探针必须模拟该动作，否则失败原因不可信（此前误读为
     * "原生视图盖住按钮"）。
     */
    const clickNav = async (testId: string): Promise<void> => {
      const collapsed = await page.evaluate(() => {
        const g = globalThis as unknown as {
          document: { documentElement: { getAttribute(n: string): string | null } }
        }
        return g.document.documentElement.getAttribute('data-sidebar') === 'collapsed'
      })
      if (collapsed) {
        await page.getByTestId('dock-sidebar-toggle').click()
        await page.waitForTimeout(700) // 等侧栏展开动画播完（panel 320ms + 余量）
      }
      await page.getByTestId(testId).click()
    }

    // ① 先进入「直播中控」（专注态）
    await clickNav('tab-obs')
    await page.waitForTimeout(1200)

    // ② 从专注态切回普通页（用户报障的触发动作）
    await clickNav('tab-settings')
    await page.waitForTimeout(1400)

    // ③ 逐个打开所有页面模块与 pinned 工具，每次打开后校验矩形
    // 模块二级下拉只在展开时渲染（extOpen）——先展开再收集目标，否则 TARGETS 恒为空、
    // 探针空转（此前一轮即因此什么都没测还通过）。
    await clickNav('tab-modules')
    await page.waitForTimeout(500)
    const targets = await page.evaluate(() =>
      (() => {
        interface El2 {
          getAttribute(n: string): string | null
        }
        const g2 = globalThis as unknown as {
          document: { querySelectorAll(s: string): { length: number; [i: number]: El2 } }
        }
        const list = g2.document.querySelectorAll('[data-testid^="page-nav-"],[data-testid^="tool-nav-"]')
        const out: string[] = []
        for (let i = 0; i < list.length; i++) out.push(list[i].getAttribute('data-testid') ?? '')
        return out
      })()
    )
    console.log('TARGETS=' + JSON.stringify(targets))
    for (const testId of targets.filter(Boolean)) {
      // 下拉会被"点击面板外"收起（切页后恒收起）——打开目标前先确认渲染，必要时重新展开。
      const openTarget = async (): Promise<boolean> => {
        if (!(await page.getByTestId(testId).isVisible().catch(() => false))) {
          await clickNav('tab-modules')
          await page.waitForTimeout(400)
        }
        if (!(await page.getByTestId(testId).isVisible().catch(() => false))) return false
        await page.getByTestId(testId).click()
        return true
      }
      if (!(await openTarget())) continue
      await page.waitForTimeout(1800) // 等布局与上报落定
      await check(testId)
      // 用户报障的真实路径：专注态（直播中控）→ **直接**切回该模块/工具页。
      // （此前切到设置页再校验——设置页本就没有可见视图，断言恒通过，等于没测。）
      await clickNav('tab-obs')
      await page.waitForTimeout(1000)
      if (!(await openTarget())) continue
      await page.waitForTimeout(1800)
      await check(testId + '（专注直达后）')
    }

    console.log('PROBLEMS=' + problems.length)
    for (const p of problems) console.log('PROBLEM ' + p)
    // 机械判据落地：有问题必须让用例失败（此前只打印不断言，探针永远不红）。
    expect(problems, problems.join('\n')).toEqual([])
  } finally {
    await app.close().catch(() => {})
  }
})
