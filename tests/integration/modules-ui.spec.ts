import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('模块管理分区（设置页）：列表/禁用/启用/网页工具按钮', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：Windows 下 APPDATA 不重定向 userData，下同。
  const iso = mkdtempSync(join(tmpdir(), 'el-modui-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // 模块管理已迁入设置页「模块」分区卡
  await page.getByTestId('tab-settings').click()
  await expect(page.getByTestId('module-card-example-empty')).toContainText('started', {
    timeout: 5000
  })
  const webCard = page.getByTestId('module-card-example-web')
  await expect(webCard).toContainText('started')
  await expect(webCard).toContainText('example.com')

  // 禁用 → 徽章 disabled（操作即刷新 + 2s 轮询兜底）
  await webCard.getByRole('button', { name: '禁用' }).click()
  await expect(webCard).toContainText('disabled', { timeout: 5000 })

  // 启用 → discovered（重启应用后随启动加载——启动语义不变）
  await webCard.getByRole('button', { name: '启用' }).click()
  await expect(webCard).toContainText('discovered', { timeout: 5000 })

  // 网页工具打开按钮在位（联网加载行为归真机验收，不点击）
  await expect(webCard.getByRole('button', { name: '打开' })).toBeVisible()

  await app.close()
})
