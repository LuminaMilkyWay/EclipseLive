import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 多模块并存时的**视图互斥**守卫。
 *
 * 用户反馈：开启多个模块后，切到「设置」页，设置页原有的功能菜单被模块/工具的嵌入式视图顶掉。
 *
 * 根因：`ModulePageHost` 卸载时会"恢复第三方工具显示"（T11 chip 遗留行为），
 * 于是离开模块页去非模块页时，**已打开的工具视图被重新显示、盖住设置页**。
 *
 * 断言方式：嵌入式视图（WebContentsView）不在 DOM 里，无法用选择器判断，
 * 故直接记录渲染层调用的 `setModulePageVisible` 轨迹 —— 规则是
 * **任何时刻最多只有一个嵌入式视图可见，且离开后必须全部为隐藏**。
 */

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

interface ViewState {
  url: string
  visible: boolean
  bounds: { x: number; y: number; width: number; height: number } | null
}

async function launchApp() {
  const iso = mkdtempSync(join(tmpdir(), 'el-multi-mod-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: {
      ...process.env,
      EL_TEST_USERDATA: iso,
      EL_TEST_SKIP_TITLE: '1',
      EL_TEST_SKIP_WHATS_NEW: '1'
    } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()
  return { app, page }
}

/**
 * 主进程真值：窗口 contentView 的每个子视图（模块页/工具页）当前的可见性与矩形。
 * 不用渲染层插桩 —— contextBridge 暴露的对象是只读的，包装不生效。
 */
async function viewStates(app: Awaited<ReturnType<typeof launchApp>>['app']): Promise<ViewState[]> {
  return await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const kids = (win?.contentView?.children ?? []) as Array<{
      webContents?: { getURL(): string }
      getVisible?: () => boolean
      getBounds?: () => { x: number; y: number; width: number; height: number }
    }>
    return kids.map((v) => ({
      url: (() => {
        try {
          return v.webContents?.getURL() ?? ''
        } catch {
          return ''
        }
      })(),
      visible: typeof v.getVisible === 'function' ? v.getVisible() : false,
      bounds: typeof v.getBounds === 'function' ? v.getBounds() : null
    }))
  })
}

/** 只看模块/工具视图（排除应用自身与可能的背景页）。 */
function embeddedViews(states: ViewState[]): ViewState[] {
  return states.filter((s) => s.url.startsWith('http://127.0.0.1') || s.url.startsWith('https://'))
}

async function openFromModuleDropdown(
  page: Awaited<ReturnType<typeof launchApp>>['page'],
  testId: string
): Promise<void> {
  const item = page.getByTestId(testId)
  if (!(await item.isVisible().catch(() => false))) {
    await page.getByTestId('tab-modules').click()
  }
  await item.waitFor({ state: 'visible', timeout: 10000 })
  await item.click()
  await page.waitForTimeout(1200)
}

test('多模块开启后切到设置页：不得有任何嵌入式视图仍可见', async () => {
  const { app, page } = await launchApp()
  try {
    // ① 打开外部站点 pinned 工具（LaplaceLive-Link）
    await openFromModuleDropdown(page, 'tool-nav-laplacelive-link')
    // ② 再打开页面模块（VTS ControlPad）—— 两者并存
    await openFromModuleDropdown(page, 'page-nav-vts-controlpad')

    const before = embeddedViews(await viewStates(app))
    const modPage = before.find((v) => v.url.includes('vts-controlpad'))
    expect(modPage, '模块页视图应已创建').toBeTruthy()
    expect(modPage?.visible, '当前页面模块应可见').toBe(true)
    // 互斥断言改为**轮询**：隐藏是异步 IPC，固定 1200ms 在负载下不够（实测偶发红）。
    // 意图不变：页面模块打开时，工具视图最终必须被隐藏。
    await expect
      .poll(
        async () => {
          const vs = embeddedViews(await viewStates(app))
          return vs.find((v) => v.url.includes('laplace'))?.visible ?? false
        },
        { timeout: 15000, message: '互斥：页面模块打开时工具应被隐藏' }
      )
      .toBe(false)

    // ③ 切到「设置」——设置页不是模块页，任何嵌入式视图都不该可见
    await page.getByTestId('tab-settings').click()
    await page.waitForTimeout(1200)
    const after = embeddedViews(await viewStates(app))

    for (const v of after) {
      expect(
        v.visible,
        `切到设置页后仍有嵌入式视图可见（会盖住设置页的功能菜单）：${v.url}`
      ).toBe(false)
    }
    await expect(page.getByTestId('tab-settings')).toBeVisible()
  } finally {
    await app.close().catch(() => {})
  }
})
