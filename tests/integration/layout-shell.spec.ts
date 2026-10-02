import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('主界面布局：左 1/4 导航 + 右 3/4 内容 + 功能分组导航 + 内容区承载', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：Windows 下 APPDATA 不重定向 userData，下同。
  const iso = mkdtempSync(join(tmpdir(), 'el-layout-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // ① 几何：`.side` 在左、`.content` 在右并排，宽度比 ≈ 3:1（右 3/4 : 左 1/4）。
  // 本断言只做 boundingBox 相对比较、不依赖 viewport（Electron 页 page.viewportSize() 返回 null——T18 教训）。
  const sideBox = await page.locator('.side').boundingBox()
  const contentBox = await page.locator('.content').boundingBox()
  if (!sideBox || !contentBox) throw new Error('layout bounding box unavailable')
  expect(sideBox.x + sideBox.width).toBeLessThanOrEqual(contentBox.x + 2)
  expect(contentBox.width / sideBox.width).toBeGreaterThanOrEqual(2.5)
  expect(contentBox.width / sideBox.width).toBeLessThanOrEqual(3.5)

  // ② 导航按功能分组：`.nav-group` ≥ 2、每组 `.nav-group-label` 非空；
  //    「诊断」「模块」「设置」三入口各归属恰好一个 `.nav-group`。
  const groups = await page.locator('.nav-group').count()
  expect(groups).toBeGreaterThanOrEqual(2)
  const labels = page.locator('.nav-group .nav-group-label')
  const labelCount = await labels.count()
  for (let i = 0; i < labelCount; i++) {
    const text = await labels.nth(i).textContent()
    expect((text ?? '').trim().length).toBeGreaterThan(0)
  }
  for (const name of ['诊断', '模块', '设置']) {
    const inGroups = await page.locator(`.nav-group:has(.nav-item:text-is("${name}"))`).count()
    expect(inGroups).toBe(1)
  }

  // ③ 内容承载：三入口切换后对应页面元素在 `.content` 内可见，来回切换稳定。
  await page.getByRole('button', { name: '诊断', exact: true }).click()
  await expect(page.locator('.content').getByTestId('gateway-port')).toBeVisible()
  // 模块 = 二级下拉：点击展开/收起（占流面板不遮挡下方按钮）；模块管理在设置页「模块」分区卡
  await page.getByRole('button', { name: '模块', exact: true }).click()
  await expect(page.locator('.nav-dropdown')).toBeVisible()
  await page.getByRole('button', { name: '模块', exact: true }).click()
  await expect(page.locator('.nav-dropdown')).toHaveCount(0)
  await page.getByRole('button', { name: '模块', exact: true }).click()
  await page.getByTestId('tab-settings').click()
  await expect(page.locator('.content').getByTestId('module-card-example-empty')).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.locator('.content').getByTestId('settings-group-appearance')).toBeVisible()
  await page.getByRole('button', { name: '诊断', exact: true }).click()
  await expect(page.locator('.content').getByTestId('gateway-port')).toBeVisible()

  await app.close()
})
