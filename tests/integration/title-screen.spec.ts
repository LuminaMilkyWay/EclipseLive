import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

// T18 标题页：默认展示全屏标题页（应用标识 + 进入入口），进入前主界面不挂载；
// EL_TEST_SKIP_TITLE=1（19 个既有 spec 注入的测试缝）直入主界面。
test('标题页：全屏展示应用标识，点击进入后渲染主界面', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-title-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // 窗口标题 = 展示名 + 展示版本（用户 2026-09-30 指定：EclipseLive 0.2.1-Corona）
  await expect(page).toHaveTitle(/^EclipseLive/i, { timeout: 20000 })
  // 全屏标题页 + 应用标识
  await expect(page.locator('.title-screen')).toBeVisible()
  // Playwright Electron 页面 page.viewportSize() 返回 null，走 evaluate 结构化读窗口尺寸
  const vp = await page.evaluate(() => {
    const g = globalThis as unknown as { innerWidth: number; innerHeight: number }
    return { w: g.innerWidth, h: g.innerHeight }
  })
  const box = await page.locator('.title-screen').boundingBox()
  if (!box) throw new Error('bounding box unavailable')
  expect(box.width).toBeGreaterThanOrEqual(vp.w - 1)
  expect(box.height).toBeGreaterThanOrEqual(vp.h - 1)
  // 品牌（用户 2026-09-30 指定）：产品名 EclipseLive + 展示版本 0.2.1-Corona
  await expect(page.locator('.title-screen')).toContainText('EclipseLive')
  await expect(page.locator('.title-version')).toHaveText(/^\d+\.\d+\.\d+(-[\w.]+)?$/, { timeout: 20000 })

  // 进入前主界面不挂载
  await expect(page.getByRole('button', { name: '诊断', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '模块', exact: true })).toHaveCount(0)

  // 点击「进入」→ 标题页卸载、主界面可见
  await page.locator('[data-testid="title-enter"]').click()
  await expect(page.locator('.title-screen')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '诊断', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '模块', exact: true })).toBeVisible()
  await expect(page.getByTestId('tab-settings')).toBeVisible()

  await app.close()
})

test('标题页测试缝：EL_TEST_SKIP_TITLE=1 直入主界面', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-title-it-'))
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

  await expect(page.locator('.title-screen')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '诊断', exact: true })).toBeVisible()
  await expect(page.getByTestId('tab-settings')).toBeVisible()

  await app.close()
})
