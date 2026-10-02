import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('组件库接入：确认对话框 / Toast / 空状态', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-comp-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // ① 确认对话框：卸载走 ConfirmDialog（不再 window.confirm）；取消后模块卡仍在。
  //    （模块管理已迁入设置页「模块」分区卡）
  await page.getByTestId('tab-settings').click()
  const card = page.getByTestId('module-card-example-empty')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '卸载' }).click()
  await expect(page.locator('.confirm-dialog')).toBeVisible()
  await page.locator('.confirm-dialog').getByRole('button', { name: '取消' }).click()
  await expect(page.locator('.confirm-dialog')).toHaveCount(0)
  await expect(card).toBeVisible()

  // ② Toast：动作反馈统一 Toast 浮层（替代侧栏常驻消息），含动作名。
  await page.getByRole('button', { name: '诊断', exact: true }).click()
  await page.getByRole('button', { name: 'OBS 重连' }).click()
  await expect(page.locator('.toast')).toContainText('OBS 重连', { timeout: 5000 })

  // ③ 空状态：「最近错误」为空时 .empty-state 在位（不再整卡隐藏）。
  await expect(page.locator('.empty-state')).toBeVisible()

  await app.close()
})

test('Toast 退场：先经 data-closing 播退场动画再卸载（T49）', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-toast-exit-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // 触发一条 Toast（诊断 → OBS 重连）；5s 后 App 层自动清文案（既有产品行为）。
  await page.getByRole('button', { name: '诊断', exact: true }).click()
  await page.getByRole('button', { name: 'OBS 重连' }).click()
  await expect(page.locator('.toast')).toContainText('OBS 重连', { timeout: 5000 })

  // 在消失前装上 MutationObserver：浏览器侧观察属性翻转是确定性的，
  // 不依赖测试端轮询时机（交接教训：禁用固定 waitForTimeout 后立即断言）。
  await page.evaluate(() => {
    const g = globalThis as unknown as {
      __toastClosingSeen: boolean
      MutationObserver: new (cb: () => void) => { observe(target: unknown, init: unknown): void }
      document: {
        body: unknown
        querySelector(s: string): { getAttribute(n: string): string | null } | null
      }
    }
    g.__toastClosingSeen = false
    new g.MutationObserver(() => {
      if (g.document.querySelector('.toast')?.getAttribute('data-closing') === 'true') {
        g.__toastClosingSeen = true
      }
    }).observe(g.document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-closing']
    })
  })

  // 卸载发生（≈5s 清文案 + 退场窗口），且卸载前必须出现过退场态。
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 })
  const closingSeen = await page.evaluate(
    () => (globalThis as unknown as { __toastClosingSeen: boolean }).__toastClosingSeen
  )
  expect(closingSeen, 'Toast 卸载前必须经 data-closing 播完退场动画').toBe(true)

  await app.close()
})
