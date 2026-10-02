import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UiSettings } from '@shared/theme'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

test('全局底图：安装/协议取图/显示方式/透明度模糊度/恢复默认', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：Windows 下 APPDATA 不重定向 userData，下同。
  const iso = mkdtempSync(join(tmpdir(), 'el-wallpaper-it-'))
  const srcDir = mkdtempSync(join(tmpdir(), 'el-wallpaper-src-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // 等 preload 桥就绪（与 settings-ui 同模式）
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

  // 1) 外观组底图控件渲染：五种显示方式 + 恢复默认 + 两滑杆
  for (const fit of ['fill', 'fit', 'tile', 'center', 'stretch']) {
    await expect(page.getByTestId(`seg-wallpaper-fit-${fit}`)).toBeVisible()
  }
  await expect(page.getByTestId('wallpaper-reset')).toBeVisible()
  await expect(page.getByTestId('wallpaper-opacity')).toBeVisible()
  await expect(page.getByTestId('wallpaper-blur')).toBeVisible()

  // 2) 默认：无图、--wallpaper-url 为 none
  let s = await invoke<UiSettings>(page, 'uiSettings')
  expect(s.wallpaperImage).toBe('')
  expect(await rootVar(page, '--wallpaper-url')).toBe('none')

  // 3) 安装（sourcePath 测试缝；原名含空格，落盘生成安全唯一名）
  const src = join(srcDir, 'my wall.png')
  writeFileSync(src, PNG)
  const r = await invoke<{ ok: boolean; errors: string[]; name: string }>(
    page,
    'wallpaperInstall',
    src
  )
  expect(r.ok).toBe(true)
  expect(r.name).not.toBe('')
  s = await invoke<UiSettings>(page, 'uiSettings')
  expect(s.wallpaperImage).toBe(r.name)
  expect(await rootVar(page, '--wallpaper-url')).toContain(`eclipse-wallpaper://local/${r.name}`)
  expect(existsSync(join(iso, 'wallpapers', r.name))).toBe(true)

  // 4) 协议取图 200 + content-type；缺失 / 编码穿越 404
  const okRes = await fetchWall(page, `eclipse-wallpaper://local/${r.name}`)
  expect(okRes.status).toBe(200)
  expect(okRes.ct).toBe('image/png')
  expect((await fetchWall(page, 'eclipse-wallpaper://local/ghost.png')).status).toBe(404)
  expect((await fetchWall(page, 'eclipse-wallpaper://local/%2e%2e%2fa.png')).status).toBe(404)
  expect((await fetchWall(page, 'eclipse-wallpaper://local/..%5ca.png')).status).toBe(404)

  // 5) 显示方式 / 透明度 / 模糊度即时生效并持久
  await page.getByTestId('seg-wallpaper-fit-tile').click()
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-fit', 'tile')
  s = await invoke<UiSettings>(page, 'uiSettings')
  expect(s.wallpaperFit).toBe('tile')

  await setRange(page, 'wallpaper-opacity', '0.5')
  await setRange(page, 'wallpaper-blur', '8')
  expect(await rootVar(page, '--wallpaper-opacity')).toBe('0.5')
  expect(await rootVar(page, '--wallpaper-blur')).toBe('8px')
  s = await invoke<UiSettings>(page, 'uiSettings')
  expect(s.wallpaperOpacity).toBe(0.5)
  expect(s.wallpaperBlur).toBe(8)

  // 6) 恢复默认：清图 + 变量归 none + 文件删除。
  //    T50 竞态修复：reset 走 IPC 异步落账（探针实测落定窗口 ≤250ms），
  //    "点击后立即断言"必输——按交接教训改 expect.poll 轮询到落定。
  await page.getByTestId('wallpaper-reset').click()
  await expect
    .poll(async () => (await invoke<UiSettings>(page, 'uiSettings')).wallpaperImage, { timeout: 5000 })
    .toBe('')
  await expect.poll(() => rootVar(page, '--wallpaper-url'), { timeout: 5000 }).toBe('none')
  await expect
    .poll(() => existsSync(join(iso, 'wallpapers', r.name)), { timeout: 5000 })
    .toBe(false)

  // 7) 缺失文件 404 + 兜底可见（T-A1 起兜底 = body 的 --bg-0→--bg-1 渐变 + 辉光）
  await invoke(page, 'setUiSettings', { wallpaperImage: 'ghost.png' })
  expect(await rootVar(page, '--wallpaper-url')).toContain('eclipse-wallpaper://local/ghost.png')
  expect((await fetchWall(page, 'eclipse-wallpaper://local/ghost.png')).status).toBe(404)
  expect(await fallbackVisible(page)).toBe(true)

  await app.close()
})

/** 桥方法名模式 invoke：evaluate 闭包不可跨 evaluate 复用（集成测试惯例）。 */
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

/** 读根节点内联 CSS 变量（preload 应用的壁纸变量）。 */
async function rootVar(page: Page, name: string): Promise<string> {
  return page.evaluate((n: string) => {
    const g = globalThis as unknown as {
      document: { documentElement: { style: { getPropertyValue: (k: string) => string } } }
    }
    return g.document.documentElement.style.getPropertyValue(n).trim()
  }, name)
}

/** 经 eclipse-wallpaper:// 协议取图（真实协议端到端）。 */
async function fetchWall(
  page: Page,
  url: string
): Promise<{ status: number; ct: string | null }> {
  return page.evaluate(async (u: string) => {
    const g = globalThis as unknown as {
      fetch: (x: string) => Promise<{
        status: number
        headers: { get: (n: string) => string | null }
      }>
    }
    const res = await g.fetch(u)
    return { status: res.status, ct: res.headers.get('content-type') }
  }, url)
}

/** 滑杆设值 + 触发 input 事件（React onChange 语义；原型 setter 绕过 value tracker）。 */
async function setRange(page: Page, testId: string, value: string): Promise<void> {
  await page.evaluate((payload: [string, string]) => {
    const g = globalThis as unknown as {
      document: {
        querySelector: (s: string) => {
          value: string
          dispatchEvent: (e: Event) => boolean
        } | null
      }
      HTMLInputElement: { prototype: Record<string, unknown> }
    }
    const el = g.document.querySelector(`[data-testid="${payload[0]}"]`)
    if (!el) throw new Error(`控件缺失: ${payload[0]}`)
    const desc = Object.getOwnPropertyDescriptor(g.HTMLInputElement.prototype, 'value')
    ;(desc?.set as ((v: string) => void) | undefined)?.call(el, payload[1])
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, [testId, value] as [string, string])
}

/** 缺图时兜底是否可见（探针对比法）。
 *
 *  T-A1 起兜底由 **body** 承担（`--bg-0 → --bg-1` 渐变 + 强调色辉光），`.wallpaper`
 *  只负责用户图片且必须保持透明。原先兜底是写在 `.wallpaper` 上的不透明纯色
 *  `var(--bg-0)`，会把 body 的辉光整层盖住、面板背后永远是纯色，导致玻璃层做不出效果
 *  （实测档 1 α=0.90 与档 3 α=0.68 的落色通道差仅 2/765，肉眼不可辨）。
 *  故此处校验改为：**body 的兜底渐变包含 --bg-0 且底图层透明**（不再要求平面纯色）。 */
async function fallbackVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const g = globalThis as unknown as {
      document: {
        querySelector: (s: string) => unknown
        createElement: (t: string) => {
          style: { setProperty: (k: string, v: string) => void }
        }
        body: {
          appendChild: (n: unknown) => unknown
          removeChild: (n: unknown) => unknown
        }
      }
      getComputedStyle: (el: unknown) => { backgroundColor: string; backgroundImage: string }
    }
    const probe = g.document.createElement('div')
    probe.style.setProperty('background-color', 'var(--bg-0)')
    g.document.body.appendChild(probe)
    const want = g.getComputedStyle(probe).backgroundColor
    g.document.body.removeChild(probe)
    const wall = g.document.querySelector('.wallpaper')
    if (!wall) return false
    // 底图层必须透明，否则会遮住 body 的兜底与辉光
    if (g.getComputedStyle(wall).backgroundColor !== 'rgba(0, 0, 0, 0)') return false
    // body 的兜底渐变必须由 --bg-0 起头
    return g.getComputedStyle(g.document.body).backgroundImage.includes(want)
  })
}
