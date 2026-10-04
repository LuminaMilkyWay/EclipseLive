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

test('材质三档：默认档 2 + 切换立即生效 + 非法值拒绝', async () => {
  // 独立 userData（临时目录）："启动默认"断言需要干净的 core.ui，
  // 且不污染开发环境配置、不与运行中的安装版争抢单实例锁。
  const iso = mkdtempSync(join(tmpdir(), 'el-material-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()
  await waitThemeApi(page)

  // 1. 启动默认：档 2（半高斯半液态玻璃）
  expect(await rootAttr(page, 'data-material')).toBe('2')

  // 2. 切档 1（纯高斯模糊）立即生效
  const r1 = await invoke<ActionResult>(page, 'setUiSettings', { material: 1 })
  expect(r1.ok).toBe(true)
  expect(await rootAttr(page, 'data-material')).toBe('1')

  // 3. 切档 3（液态玻璃）立即生效
  const r2 = await invoke<ActionResult>(page, 'setUiSettings', { material: 3 })
  expect(r2.ok).toBe(true)
  expect(await rootAttr(page, 'data-material')).toBe('3')

  // 4. 往返一致（material 字段）
  const settings = await invoke<UiSettings>(page, 'uiSettings')
  expect(settings.material).toBe(3)

  // 5. 非法 patch（material: 9）→ ok:false 且 data-material 不变
  const bad = await invoke<ActionResult>(page, 'setUiSettings', { material: 9 })
  expect(bad.ok).toBe(false)
  expect(await rootAttr(page, 'data-material')).toBe('3')

  await app.close()
})
