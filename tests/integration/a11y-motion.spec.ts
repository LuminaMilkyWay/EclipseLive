import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActionResult } from '@shared/diagnostics'
import type { UiSettings } from '@shared/theme'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

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
  await waitThemeApi(page)
  return { app, page }
}

async function waitThemeApi(page: Page): Promise<void> {
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
async function invoke<T>(page: Page, channel: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([ch, a]) =>
      (globalThis as unknown as { eclipselive: Record<string, (...xs: unknown[]) => Promise<T>> })
        .eclipselive[ch as string](...(a as unknown[])),
    [channel, args] as const
  )
}

// tsconfig.node 无 DOM 类型——结构化访问 document（集成测试通用惯例）。
function rootAttr(page: Page, name: string): Promise<string | null> {
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

test('可读性降级三开关：默认关、根属性即时生效、持久往返、非法 patch 拒绝', async () => {
  const { app, page } = await launchApp('el-a11y-it-')

  // 1. 启动默认：三降级属性全 '0'
  expect(await rootAttr(page, 'data-reduce-transparency')).toBe('0')
  expect(await rootAttr(page, 'data-high-contrast')).toBe('0')
  expect(await rootAttr(page, 'data-reduce-motion')).toBe('0')

  // 2. 逐个开启：根属性即时生效 + 持久往返
  for (const [key, attr] of [
    ['reduceTransparency', 'data-reduce-transparency'],
    ['highContrast', 'data-high-contrast'],
    ['reduceMotion', 'data-reduce-motion']
  ] as const) {
    const r = await invoke<ActionResult>(page, 'setUiSettings', { [key]: true })
    expect(r.ok).toBe(true)
    expect(await rootAttr(page, attr)).toBe('1')
    const s = await invoke<UiSettings>(page, 'uiSettings')
    expect(s[key]).toBe(true)
  }

  // 3. 关闭往返
  const off = await invoke<ActionResult>(page, 'setUiSettings', { reduceMotion: false })
  expect(off.ok).toBe(true)
  expect(await rootAttr(page, 'data-reduce-motion')).toBe('0')

  // 4. 非法 patch（highContrast: 'yes'）→ ok:false 且根属性不变
  const bad = await invoke<ActionResult>(page, 'setUiSettings', { highContrast: 'yes' })
  expect(bad.ok).toBe(false)
  expect(await rootAttr(page, 'data-high-contrast')).toBe('1')

  await app.close()
})

test('档 3 自动降档 + 外观组三开关 UI + 降档提示 + 失焦不变', async () => {
  const { app, page } = await launchApp('el-a11y-ui-')
  await page.getByTestId('tab-settings').click()

  // 1. 外观组三开关在位、默认未勾选
  for (const id of [
    'switch-reduce-transparency',
    'switch-high-contrast',
    'switch-reduce-motion'
  ]) {
    await expect(page.getByTestId(id)).toHaveCount(1)
    await expect(page.getByTestId(id)).not.toBeChecked()
  }

  // 2. 档 3 正常渲染为 3（点击后断根属性用自动重试断言，避免与异步应用竞态）
  await page.getByTestId('seg-material-3').click()
  await expect(page.locator('html')).toHaveAttribute('data-material', '3')

  // 3. 开高对比度 → 档 3 文字对比度不足，自动降为档 2 渲染；存储仍 3；提示可见
  await page.getByTestId('switch-high-contrast').click()
  await expect(page.locator('html')).toHaveAttribute('data-material', '2')
  await expect(page.locator('html')).toHaveAttribute('data-high-contrast', '1')
  const s = await invoke<UiSettings>(page, 'uiSettings')
  expect(s.material).toBe(3)
  await expect(page.getByTestId('material-degrade-hint')).toBeVisible()

  // 4. 失焦/获焦后材质与降级属性不变
  await page.evaluate(() => {
    const g = globalThis as unknown as {
      dispatchEvent(e: unknown): boolean
      Event: new (type: string) => unknown
    }
    g.dispatchEvent(new g.Event('blur'))
    g.dispatchEvent(new g.Event('focus'))
  })
  expect(await rootAttr(page, 'data-material')).toBe('2')
  await expect(page.locator('html')).toHaveAttribute('data-high-contrast', '1')
  await expect(page.locator('html')).toHaveAttribute('data-reduce-transparency', '0')

  // 5. 关高对比度 → 回档 3 渲染，提示消失
  await page.getByTestId('switch-high-contrast').click()
  await expect(page.locator('html')).toHaveAttribute('data-material', '3')
  await expect(page.getByTestId('material-degrade-hint')).toBeHidden()

  await app.close()
})
