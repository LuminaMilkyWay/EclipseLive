import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

// T50：标题断言走品牌真源（app-launch 同模式）——品牌升版只改常量，测试不再炸。
const { APP_DISPLAY_VERSION, APP_NAME } = require('../../src/shared/appInfo') as {
  APP_DISPLAY_VERSION: string
  APP_NAME: string
}

test('UI 外壳：页签渲染 + diagnostics IPC 快照 + 诊断页元素', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：Windows 下 APPDATA 不重定向 userData，下同。
  const iso = mkdtempSync(join(tmpdir(), 'el-ushell-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  await expect(page).toHaveTitle(`${APP_NAME} ${APP_DISPLAY_VERSION}`)
  await expect(page.getByRole('button', { name: '诊断', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '模块', exact: true })).toBeVisible()

  // IPC 快照：网关就绪、示例模块启动、配置分区在列（渲染层就绪重试）
  const snap = await page.evaluate(async (): Promise<DiagnosticsSnapshot> => {
    const g = globalThis as unknown as {
      eclipselive: { diagnostics: () => Promise<DiagnosticsSnapshot> }
    }
    for (let i = 0; i < 20; i++) {
      try {
        return await g.eclipselive.diagnostics()
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    throw new Error('diagnostics IPC not ready')
  })
  expect(snap.gateway.started).toBe(true)
  expect(snap.gateway.tokenPresent).toBe(true)
  const statuses = new Map(snap.modules.map((m) => [m.id, m.status]))
  expect(statuses.get('example-empty')).toBe('started')
  expect(statuses.get('example-web')).toBe('started')
  expect(snap.config.sections.map((s) => s.id)).toContain('core.gateway')

  // 诊断页元素（自动刷新后）
  await expect(page.getByTestId('gateway-port')).toHaveText(/\d+/, { timeout: 5000 })
  await expect(page.getByTestId('obs-status')).toBeVisible()
  await expect(page.getByTestId('network-mode')).toHaveText('local-empty')

  await app.close()
})
