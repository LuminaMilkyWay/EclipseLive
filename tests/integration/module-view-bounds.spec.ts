import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * ★ 所有模块的嵌入式视图**必须被限制在右侧功能页（内容区）之内**。
 *
 * 用户目视验收：「模块展开变成了最早的样子，全部突破了右侧功能页的限制」。
 * 日志实证（真实运行）：
 *   embedded view setBounds :: {"moduleId":"laplacelive-link","x":676,"y":36,"width":1848,"height":1233}
 * —— 1848×1233 比屏幕还大，视图被画到窗口外、盖住一切。
 *
 * 根因：槽位宿主上报的是 `el.getBoundingClientRect()` 的**原始**矩形。
 * `.content` 是 `overflow-y: auto` 的滚动容器，槽位是 `flex:1 + min-height:60vh`，
 * 内容超高时槽位会长过容器可见区 ⇒ 上报矩形超出可见范围 ⇒ 视图越界。
 *
 * 本测试对**每个**模块页面/工具逐一验证：视图矩形必须落在内容区可见盒内。
 */

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')
const TOL = 2 // 允许 2px 的取整/边框误差

interface Box {
  x: number
  y: number
  width: number
  height: number
}
interface ViewState extends Box {
  url: string
  visible: boolean
}

async function launchApp() {
  const iso = mkdtempSync(join(tmpdir(), 'el-bounds-'))
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

async function embeddedViews(app: Awaited<ReturnType<typeof launchApp>>['app']): Promise<ViewState[]> {
  return await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const kids = (win?.contentView?.children ?? []) as Array<{
      webContents?: { getURL(): string }
      getVisible?: () => boolean
      getBounds?: () => { x: number; y: number; width: number; height: number }
    }>
    return kids
      .map((v) => ({
        url: (() => {
          try {
            return v.webContents?.getURL() ?? ''
          } catch {
            return ''
          }
        })(),
        visible: typeof v.getVisible === 'function' ? v.getVisible() : false,
        ...(typeof v.getBounds === 'function' ? v.getBounds() : { x: 0, y: 0, width: 0, height: 0 })
      }))
      .filter((v) => v.url.startsWith('http'))
  })
}

/** 内容区与槽位的可见矩形（渲染层真值）。 */
async function contentBox(
  page: Awaited<ReturnType<typeof launchApp>>['page']
): Promise<{ content: Box; slot: Box | null; viewport: [number, number] }> {
  return await page.evaluate(() => {
    interface El {
      getBoundingClientRect(): { x: number; y: number; width: number; height: number }
    }
    const g = globalThis as unknown as {
      document: { querySelector(sel: string): El | null }
      innerWidth: number
      innerHeight: number
      getComputedStyle(el: unknown): { overflowY: string }
    }
    const toBox = (r: { x: number; y: number; width: number; height: number }): Box => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height)
    })
    const content = g.document.querySelector('.content')
    const slot = g.document.querySelector('.tool-slot, .module-page-host')
    return {
      content: toBox(content ? content.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 }),
      slot: slot ? toBox(slot.getBoundingClientRect()) : null,
      viewport: [g.innerWidth, g.innerHeight] as [number, number]
    }
  })
}

function assertWithin(inner: Box, outer: Box, what: string): void {
  expect(inner.x, `${what}：左边超出内容区（x=${inner.x}，内容区 x=${outer.x}）`).toBeGreaterThanOrEqual(
    outer.x - TOL
  )
  expect(inner.y, `${what}：顶部超出内容区（y=${inner.y}）`).toBeGreaterThanOrEqual(outer.y - TOL)
  const right = inner.x + inner.width
  const outerRight = outer.x + outer.width
  expect(right, `${what}：右边越出（视图右缘 ${right} > 内容区右缘 ${outerRight}）`).toBeLessThanOrEqual(
    outerRight + TOL
  )
  const bottom = inner.y + inner.height
  const outerBottom = outer.y + outer.height
  expect(
    bottom,
    `${what}：底部越出（视图下缘 ${bottom} > 内容区下缘 ${outerBottom}）`
  ).toBeLessThanOrEqual(outerBottom + TOL)
}

test('所有模块：嵌入式视图必须限制在右侧功能页之内（不得越界盖满窗口）', async () => {
  const { app, page } = await launchApp()
  try {
    // 遍历所有页面模块与 pinned 工具
    const targets: Array<{ testId: string; label: string }> = []
    await page.getByTestId('tab-modules').click()
    for (const id of ['vts-controlpad', 'prologue-live']) {
      const loc = page.getByTestId(`page-nav-${id}`)
      if (await loc.count()) targets.push({ testId: `page-nav-${id}`, label: id })
    }
    for (const id of ['laplacelive-link', 'example-web']) {
      const loc = page.getByTestId(`tool-nav-${id}`)
      if (await loc.count()) targets.push({ testId: `tool-nav-${id}`, label: id })
    }
    expect(targets.length, '应至少发现一个模块页面/工具').toBeGreaterThan(0)

    for (const t of targets) {
      const item = page.getByTestId(t.testId)
      if (!(await item.isVisible().catch(() => false))) {
        await page.getByTestId('tab-modules').click()
      }
      await item.waitFor({ state: 'visible', timeout: 10000 })
      await item.click()
      await page.waitForTimeout(1600) // 等几何上报与视图布局落定

      const { content, slot } = await contentBox(page)
      // 几何上报是**异步**的（挂载 → open → 上报 → 落定）：固定 1600ms 在负载下不够（实测偶发红）。
      // 改为**轮询到落定**，意图不变：视图最终必须落在内容区之内。
      await expect
        .poll(
          async () => {
            const views = (await embeddedViews(app)).filter((v) => v.visible)
            if (views.length === 0) return 'no-visible-view'
            try {
              for (const v of views) assertWithin(v, content, `${t.label} 视图`)
              return 'ok'
            } catch (e) {
              return String(e).slice(0, 120)
            }
          },
          { timeout: 15000, message: `${t.label}：视图必须落在内容区之内（不得越界盖满窗口）` }
        )
        .toBe('ok')

      // 落定后仍做一次**带明细**的断言（失败时给出精确坐标，便于定位）
      const views = (await embeddedViews(app)).filter((v) => v.visible)
      expect(views.length, `${t.label}：应有一个可见的嵌入式视图`).toBeGreaterThan(0)
      for (const v of views) {
        assertWithin(v, content, `${t.label} 视图（${v.url.slice(0, 60)}）`)
      }
      if (slot) {
        assertWithin(slot, content, `${t.label} 槽位 DOM 矩形`)
      }
    }
  } finally {
    await app.close().catch(() => {})
  }
})
