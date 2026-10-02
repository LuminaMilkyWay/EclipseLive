import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

/** 轮询快照中 example-empty 的 webtools 状态（openWebTool 异步）。 */
async function readPageStatus(
  page: import('@playwright/test').Page
): Promise<{ state: string; page?: boolean } | undefined> {
  const snap = (await page.evaluate(() =>
    (globalThis as unknown as { eclipselive: { diagnostics: () => Promise<unknown> } })
      .eclipselive.diagnostics()
  )) as {
    webtools: { statuses: Array<{ moduleId: string; state: string; page: boolean }> }
  }
  return snap.webtools.statuses.find((s) => s.moduleId === 'example-empty')
}

test('模块页二级菜单：页面模块出现在扩展组，点击进入槽位且视图 open', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-mp-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: {
      ...process.env,
      EL_TEST_USERDATA: iso,
      EL_TEST_SKIP_TITLE: '1'
    } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // 展开「模块」二级下拉 → 模块页子项（页面模块）
  await page.getByTestId('tab-modules').click()
  await page.waitForSelector("[data-testid='page-nav-example-empty']")
  await expect(page.getByTestId('page-nav-example-empty')).toContainText('Empty Example')

  // 点击进入模块页：槽位壳渲染 + 主进程侧视图 open（openWebTool 异步——轮询快照）
  await page.getByTestId('page-nav-example-empty').click()
  await page.waitForSelector("[data-testid='module-page-host']")
  await expect
    .poll(() => readPageStatus(page), { timeout: 8000 })
    .toMatchObject({ state: 'open', page: true })

  // T34 几何回归：槽位必须撑满右侧 3/4 内容区（高 ≥ 70% 窗口高、宽 ≥ 70% 窗口宽、
  // 位于右侧导航区之后）——此前 .content 非 flex 容器导致 flex:1 失效、槽位退化为
  // min-height:60vh，WebContentsView 只覆盖右上局部。
  // 注：集成 spec 在 node 类型下编译，浏览器全局走 globalThis cast（同 readPageStatus）。
  const geo = await page.evaluate(() => {
    // node 类型下的宽松全局 cast（同 readPageStatus 的 globalThis 模式）
    const g = globalThis as unknown as {
      document: {
        querySelector(sel: string): { getBoundingClientRect(): unknown } | null
      }
      innerWidth: number
      innerHeight: number
    }
    const r = g.document.querySelector("[data-testid='module-page-host']")?.getBoundingClientRect() as
      | { x: number; y: number; width: number; height: number }
      | undefined
    return {
      box: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
      w: g.innerWidth,
      h: g.innerHeight
    }
  })
  expect(geo.box).not.toBeNull()
  const box = geo.box as { x: number; y: number; width: number; height: number }
  // 宽度阈值取 0.6（侧栏占 1/4 + shell padding/gap，内容区实测 ≈0.69 窗口宽）
  expect(box.width).toBeGreaterThanOrEqual(geo.w * 0.6)
  expect(box.height).toBeGreaterThanOrEqual(geo.h * 0.7)
  expect(box.x).toBeGreaterThanOrEqual(geo.w * 0.2)

  await app.close()
})

test('切走保活：离开模块页视图保持 open（仅隐藏），React 内容正常', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-mp-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: {
      ...process.env,
      EL_TEST_USERDATA: iso,
      EL_TEST_SKIP_TITLE: '1'
    } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // 展开「模块」二级下拉 → 模块页子项（页面模块）
  await page.getByTestId('tab-modules').click()
  await page.waitForSelector("[data-testid='page-nav-example-empty']")
  await page.getByTestId('page-nav-example-empty').click()
  await page.waitForSelector("[data-testid='module-page-host']")
  // 保活前提：先等视图 open 完成
  await expect
    .poll(() => readPageStatus(page), { timeout: 8000 })
    .toMatchObject({ state: 'open' })

  // 切回"诊断"：槽位卸载、React 页面正常渲染
  await page.getByRole('button', { name: '诊断', exact: true }).click()
  await expect(page.locator("[data-testid='module-page-host']")).toHaveCount(0)
  await expect(page.getByRole('button', { name: '立即刷新' })).toBeVisible()

  // 视图未销毁（保活，仅隐藏）：快照 state 仍 open
  const found = await readPageStatus(page)
  expect(found?.state).toBe('open')

  await app.close()
})
