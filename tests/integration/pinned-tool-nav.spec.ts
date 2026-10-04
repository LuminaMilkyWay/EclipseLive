import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

/** 轮询快照中 example-web 的 webtools 状态（openWebTool 异步）。 */
async function readToolStatus(
  page: import('@playwright/test').Page
): Promise<{ state: string; pinned: boolean } | undefined> {
  const snap = (await page.evaluate(() =>
    (globalThis as unknown as { eclipselive: { diagnostics: () => Promise<unknown> } })
      .eclipselive.diagnostics()
  )) as { webtools: { statuses: Array<{ moduleId: string; state: string; pinned: boolean }> } }
  return snap.webtools.statuses.find((s) => s.moduleId === 'example-web')
}

test('pinned 声明式工具进扩展组：点击=openWebTool（state open + chip 在位 + active 绑定快照）', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-ptnav-it-'))
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

  // 展开「模块」二级下拉 → pinned 工具项（example-web manifest pinned:true）
  await page.getByTestId('tab-modules').click()
  await page.waitForSelector("[data-testid='tool-nav-example-web']")
  await expect(page.getByTestId('tool-nav-example-web')).toContainText('Example Web Tool')

  // 页面模块照旧独立存在（两种项视觉一致、行为各按其类）
  await expect(page.getByTestId('page-nav-example-empty')).toBeVisible()

  // 点击 = 切到 tool 视图（ToolSlot 挂载 openWebTool 保活）：轮询快照 state open
  await page.getByTestId('tool-nav-example-web').click()
  await expect
    .poll(() => readToolStatus(page), { timeout: 8000 })
    .toMatchObject({ state: 'open', pinned: true })

  // chip 在位（底部网页工具条）
  await expect(page.locator('.tool-bar .tool-chip').filter({ hasText: 'example-web' })).toBeVisible()

  // 点击后 tab 切换使下拉自动收起——重新展开验证 active 绑定当前 tool 视图
  await page.getByTestId('tab-modules').click()
  await expect(page.getByTestId('tool-nav-example-web')).toHaveClass(/active/)
  await page.getByTestId('tab-modules').click()

  // 宿主显示遵循本体 UI 规范：内容区工具槽位在位（圆角玻璃壳），侧栏不再被全幅覆盖
  await expect(page.getByTestId('tool-slot')).toBeVisible()
  await expect(page.getByTestId('tab-settings')).toBeVisible()

  // T37 回归：工具打开后切「设置」→ 设置页可见（工具不再盖住设置页）、工具视图隐藏且保活
  await page.getByTestId('tab-settings').click()
  await expect(page.locator("[data-testid='tool-slot']")).toHaveCount(0)
  await expect(page.getByTestId('settings-group-appearance')).toBeVisible()
  await expect
    .poll(() => readToolStatus(page), { timeout: 8000 })
    .toMatchObject({ state: 'open' })

  // 经 tool-bar chip 切回工具视图（保活显示）
  await page.getByTestId('tool-chip-example-web').click()
  await expect(page.getByTestId('tool-slot')).toBeVisible()

  // 经 chip 关闭工具 → React 正常：无槽位壳、侧栏/诊断页元素在位
  await page.locator('.tool-bar').getByRole('button', { name: '关闭' }).click()
  await expect
    .poll(() => readToolStatus(page), { timeout: 8000 })
    .toMatchObject({ state: 'closed' })
  await expect(page.getByTestId('tool-slot')).toHaveCount(0)
  await page.getByRole('button', { name: '诊断', exact: true }).click()
  await expect(page.locator("[data-testid='module-page-host']")).toHaveCount(0)
  await expect(page.getByRole('button', { name: '立即刷新' })).toBeVisible()

  await app.close()
})
