import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings } from '@shared/appSettings'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

interface LifecycleSettings {
  closeToTray: boolean
}

interface ObsConfigView {
  port: number
  autoReconnect: boolean
}

async function launchApp(prefix: string) {
  const iso = mkdtempSync(join(tmpdir(), prefix))
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
  // 等 preload 桥就绪（与 settings-ui 同模式）
  await page.evaluate(async () => {
    const g = globalThis as unknown as {
      eclipselive?: { appSettings: () => Promise<unknown> }
    }
    for (let i = 0; i < 20; i++) {
      if (g.eclipselive) {
        try {
          await g.eclipselive.appSettings()
          return
        } catch {
          /* 未就绪继续等 */
        }
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('preload bridge not ready')
  })
  await page.getByTestId('tab-settings').click()
  return { app, page }
}

test('设置·功能：检查更新默认关闭、关闭态显式提示；托盘开关持久往返', async () => {
  const { app, page } = await launchApp('el-settings-feat-')

  // 1) 检查更新默认关闭（UI 未勾选 + 分区回读 false）
  await expect(page.getByTestId('switch-check-updates')).not.toBeChecked()
  const a = await invoke<AppSettings>(page, 'appSettings')
  expect(a.checkUpdatesEnabled).toBe(false)

  // 2) 关闭态点「立即检查」→ Toast 显式提示、零请求
  await page.getByTestId('update-check').click()
  await expect(page.locator('.toast')).toContainText('检查更新已关闭')

  // 3) 托盘与关闭行为开关持久往返
  await expect(page.getByTestId('switch-close-to-tray')).toBeChecked()
  await page.getByTestId('switch-close-to-tray').click()
  let lc = await invoke<LifecycleSettings>(page, 'lifecycleSettings')
  expect(lc.closeToTray).toBe(false)
  await page.getByTestId('switch-close-to-tray').click()
  lc = await invoke<LifecycleSettings>(page, 'lifecycleSettings')
  expect(lc.closeToTray).toBe(true)

  await app.close()
})

test('设置·模块：权限查看与撤销往返；恢复预设显式反馈', async () => {
  const { app, page } = await launchApp('el-settings-mod-')

  // 1) 模块组含恢复预设与权限
  await expect(page.getByTestId('settings-group-modules')).toContainText('恢复预设')
  await expect(page.getByTestId('settings-group-modules')).toContainText('权限')

  // 2) example-web 声明的 network-access 权限行在位，撤销 → 恢复往返
  await expect(page.getByTestId('module-perm-example-web-network-access')).toBeVisible()
  await page.getByTestId('module-perm-example-web-network-access').click()
  let snap = await invoke<DiagnosticsSnapshot>(page, 'diagnostics')
  let perm = snap.permissions.find((p) => p.moduleId === 'example-web')
  expect(perm?.revoked).toContain('network-access')

  await page.getByTestId('module-perm-example-web-network-access').click()
  snap = await invoke<DiagnosticsSnapshot>(page, 'diagnostics')
  perm = snap.permissions.find((p) => p.moduleId === 'example-web')
  expect(perm?.revoked).not.toContain('network-access')

  // 3) 恢复预设（example 均无 config → 显式提示路径）
  await page.getByTestId('module-preset-example-web').click()
  await expect(page.locator('.toast')).toContainText('预设')

  await app.close()
})

test('设置·连接与诊断：OBS 参数生效、网关信息渲染、日志查看可用', async () => {
  const { app, page } = await launchApp('el-settings-conn-')

  // 1) OBS 端口编辑 + 应用
  await page.getByTestId('obs-port').fill('4555')
  await page.getByTestId('obs-apply').click()
  const oc = await invoke<ObsConfigView>(page, 'obsConfig')
  expect(oc.port).toBe(4555)

  // 2) 自动重连开关持久往返
  const before = await invoke<ObsConfigView>(page, 'obsConfig')
  await page.getByTestId('switch-obs-reconnect').click()
  const after = await invoke<ObsConfigView>(page, 'obsConfig')
  expect(after.autoReconnect).toBe(!before.autoReconnect)

  // 3) 本地网关信息只读渲染
  await expect(page.getByTestId('conn-gateway-started')).toBeVisible()
  await expect(page.getByTestId('conn-gateway-port')).toBeVisible()

  // 4) 日志查看：Modal 内日志区或空状态
  await page.getByTestId('logs-view').click()
  await expect(page.locator('.modal-panel')).toContainText('日志')
  await expect(page.locator('.log-view, .empty-state').first()).toBeVisible()
  await page.getByTestId('logs-close').click()
  await expect(page.locator('.modal-panel')).toBeHidden()

  // 5) 探活刷新反馈；诊断包导出按钮在位（原生保存对话框阻塞，不点击）
  await page.getByTestId('diag-refresh').click()
  await expect(page.locator('.toast')).toBeVisible()
  await expect(page.getByTestId('diag-export')).toBeVisible()

  await app.close()
})

/** 通道名模式 invoke：evaluate 闭包不可跨 evaluate 复用（集成测试惯例）。 */
async function invoke<T>(page: Page, channel: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async (payload: [string, unknown[]]) => {
      const g = globalThis as unknown as {
        eclipselive: Record<string, (...xs: unknown[]) => Promise<unknown>>
      }
      return (await g.eclipselive[payload[0]](...payload[1])) as T
    },
    [channel, args] as [string, unknown[]]
  )
}
