import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UiSettings } from '@shared/theme'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('设置界面：6 组分组渲染、外观组三设置即时生效并持久', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：Windows 下 APPDATA 不重定向 userData，下同。
  const iso = mkdtempSync(join(tmpdir(), 'el-settings-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // 等 preload 桥就绪（与 theme-wiring 同模式）
  await page.evaluate(async () => {
    const g = globalThis as unknown as {
      eclipselive?: { uiSettings: () => Promise<unknown> }
    }
    for (let i = 0; i < 20; i++) {
      if (g.eclipselive) {
        try {
          await g.eclipselive.uiSettings()
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

  // 1) 六组分组卡片按规格渲染，高级组标注独立小卡
  for (const id of ['appearance', 'features', 'modules', 'connection', 'diagnostics', 'advanced']) {
    await expect(page.getByTestId(`settings-group-${id}`)).toBeVisible()
  }
  await expect(page.getByTestId('settings-group-appearance')).toContainText('外观')
  await expect(page.getByTestId('settings-group-advanced')).toContainText('独立小卡')

  // 2) 主题模式：浅色即时生效（根节点属性 + active 态）+ 持久
  await page.getByTestId('seg-theme-light').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('seg-theme-light')).toHaveClass(/active/)
  let s = await invoke<UiSettings>(page, 'uiSettings')
  expect(s.themeMode).toBe('light')

  // 3) 强调色：青蓝
  await page.getByTestId('seg-accent-cyan-blue').click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'cyan-blue')
  s = await invoke<UiSettings>(page, 'uiSettings')
  expect(s.accent).toBe('cyan-blue')

  // 4) 材质档位：档 3
  await page.getByTestId('seg-material-3').click()
  await expect(page.locator('html')).toHaveAttribute('data-material', '3')
  s = await invoke<UiSettings>(page, 'uiSettings')
  expect(s.material).toBe(3)

  // 5) 外观组控件不得因布局压缩消失（回归：.content flex 曾压缩 .page 挤没控件；
  //    SegGroup 的 testid 落在选项按钮上，如 seg-material-3）
  await expect(page.getByTestId('seg-material-3')).toBeVisible()
  await expect(page.getByTestId('wallpaper-reset')).toBeVisible()

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
