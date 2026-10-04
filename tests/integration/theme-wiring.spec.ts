import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActionResult } from '@shared/diagnostics'
import type { UiSettings } from '@shared/theme'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

async function waitThemeApi(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const g = globalThis as unknown as { eclipselive: { uiSettings: () => Promise<unknown> } }
    for (let i = 0; i < 20; i++) {
      try {
        await g.eclipselive.uiSettings()
        return
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    throw new Error('uiSettings IPC not ready')
  })
}

// page.evaluate 返回的函数闭包不可跨 evaluate 复用——统一用通道名调用。
function invoke<T>(page: import('@playwright/test').Page, channel: string, ...args: unknown[]) {
  return page.evaluate(
    ([ch, a]) =>
      (globalThis as unknown as { eclipselive: Record<string, (...xs: unknown[]) => Promise<T>> })
        .eclipselive[ch as string](...(a as unknown[])),
    [channel, args] as const
  )
}

// tsconfig.node 无 DOM 类型——结构化访问 document（集成测试通用惯例）。
function rootAttr(page: import('@playwright/test').Page, name: string): Promise<string | null> {
  return page.evaluate(
    (n) =>
      (
        globalThis as unknown as {
          document: { documentElement: { getAttribute(k: string): string | null } }
        }
      ).document.documentElement.getAttribute(n),
    name
  )
}

test('主题系统：默认令牌属性 + 模式/强调色切换 + system 解析 + 非法值拒绝', async () => {
  // 独立 userData（临时目录）："启动默认"断言需要干净的 core.ui，
  // 且不污染开发环境配置、不与运行中的安装版争抢单实例锁。
  const iso = mkdtempSync(join(tmpdir(), 'el-theme-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()
  await waitThemeApi(page)

  // 1. 启动默认：dark + corona-orange
  expect(await rootAttr(page, 'data-theme')).toBe('dark')
  expect(await rootAttr(page, 'data-accent')).toBe('corona-orange')

  // 2. 模式切换 light 立即生效
  const r1 = await invoke<ActionResult>(page, 'setUiSettings', { themeMode: 'light' })
  expect(r1.ok).toBe(true)
  expect(await rootAttr(page, 'data-theme')).toBe('light')

  // 3. 强调色切换
  const r2 = await invoke<ActionResult>(page, 'setUiSettings', { accent: 'cyan-blue' })
  expect(r2.ok).toBe(true)
  expect(await rootAttr(page, 'data-accent')).toBe('cyan-blue')

  // 4. system 解析为 light|dark 之一（CI 环境外观不保证，断言解析值合法）
  await invoke(page, 'setUiSettings', { themeMode: 'system' })
  const resolvedTheme = await rootAttr(page, 'data-theme')
  expect(['light', 'dark']).toContain(resolvedTheme)

  // 5. 往返一致
  const settings = await invoke<UiSettings>(page, 'uiSettings')
  expect(settings.themeMode).toBe('system')
  expect(settings.accent).toBe('cyan-blue')

  // 6. 非法 patch 拒绝且不变
  const bad = await invoke<ActionResult>(page, 'setUiSettings', {
    themeMode: 'neon' as unknown as UiSettings['themeMode']
  })
  expect(bad.ok).toBe(false)
  const settings2 = await invoke<UiSettings>(page, 'uiSettings')
  expect(settings2.themeMode).toBe('system')
  expect(await rootAttr(page, 'data-theme')).toBe(resolvedTheme)

  await app.close()
})
