import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('关闭到托盘：窗口隐藏、进程存活、可显式退出', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：本用例隐藏到托盘后进程仍持有单实例锁，
  // 隔离后不阻塞其它用例。
  const iso = mkdtempSync(join(tmpdir(), 'el-tray-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  await app.firstWindow()

  // 关闭主窗口（closeToTray 默认 true）→ 隐藏而非退出
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close()
  })

  const visible = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.isVisible()
  )
  expect(visible).toBe(false)
  expect(await app.evaluate(() => process.pid)).toBeGreaterThan(0)

  // 显式退出正常结束
  await app.close()
})
