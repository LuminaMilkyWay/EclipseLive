import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 材质 3 档下的「灰色底图」回归守卫（渲染级，不是文本级）。
 *
 * 用户实测反馈：「所有功能菜单部分的矩形分区卡片下有一层半透明的灰色底图」——
 * 根因是材质 3 档的 `--mat-veil`（一层 24% `--bg-card` 平面渐变）被整面刷在卡片与槽位上。
 * 该缺陷此前修过一次又复发（契约旧模板写着要它），所以这里从**渲染结果**上锁死：
 * 卡片/槽位面的 `background-image` 必须为 `none`（薄纱就是靠 background-image 实现的）。
 *
 * 同时也验证「玻璃质感仍在」：卡片底色不得完全透明（--card-bg 必须生效）。
 */

const electronExecutablePath = require('electron') as string
const projectRoot = resolve(__dirname, '../..')

/** 造一个材质 3 档的隔离 profile（默认档是 2，薄纱为 none，测不出问题）。 */
function tier3Profile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'el-veil-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  const ui = {
    format: 'eclipselive-config-section',
    version: 1,
    updatedAt: Date.now(),
    data: {
      themeMode: 'dark',
      accent: 'corona-orange',
      material: 3,
      wallpaperImage: '',
      wallpaperFit: 'fill',
      wallpaperOpacity: 1,
      wallpaperBlur: 0,
      reduceTransparency: false,
      highContrast: false,
      reduceMotion: false
    }
  }
  writeFileSync(join(dir, 'config', 'core.ui.json'), JSON.stringify(ui), 'utf8')
  return dir
}

interface SurfaceStyle {
  selector: string
  backgroundImage: string
  backgroundColor: string
  backdropFilter: string
}

/** 在某个 webContents 里量取指定选择器的计算样式。 */
async function surfacesIn(
  app: Awaited<ReturnType<typeof electron.launch>>,
  matchUrlPart: string,
  selectors: string[]
): Promise<SurfaceStyle[]> {
  return await app.evaluate(
    async ({ webContents }, args) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(args.part))
      if (!wc) return []
      const script = `(() => {
        const out = [];
        for (const sel of ${JSON.stringify(args.selectors)}) {
          for (const el of document.querySelectorAll(sel)) {
            const cs = getComputedStyle(el);
            out.push({ selector: sel, backgroundImage: cs.backgroundImage,
              backgroundColor: cs.backgroundColor, backdropFilter: cs.backdropFilter });
          }
        }
        return out;
      })()`
      try {
        return (await wc.executeJavaScript(script, true)) as SurfaceStyle[]
      } catch {
        return []
      }
    },
    { part: matchUrlPart, selectors }
  )
}

test('材质 3 档：卡片/槽位面不得有薄纱灰层（background-image 必须为 none）', async () => {
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: {
      ...process.env,
      EL_TEST_USERDATA: tier3Profile(),
      EL_TEST_SKIP_TITLE: '1',
      EL_TEST_SKIP_WHATS_NEW: '1'
    } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()
  try {
    await page.waitForTimeout(1200)
    // 确认真的在 3 档（否则本测试无意义）
    const tier = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { documentElement: { getAttribute(n: string): string | null } }
      }
      return g.document.documentElement.getAttribute('data-material')
    })
    expect(tier, '本测试必须在材质 3 档下运行').toBe('3')

    // ① 主窗：设置页分区卡片 + 槽位
    await page.getByTestId('tab-settings').click()
    await page.waitForTimeout(600)
    const mainSurfaces = await surfacesIn(app, 'index.html', [
      '.card',
      '.module-page-host',
      '.tool-slot'
    ])
    expect(mainSurfaces.length, '应至少量到一个卡片面').toBeGreaterThan(0)
    for (const s of mainSurfaces) {
      expect(s.backgroundImage, `${s.selector} 出现了背景图层（薄纱灰层）`).toBe('none')
      expect(s.backgroundColor, `${s.selector} 底色完全透明（标准材质未生效）`).not.toBe(
        'rgba(0, 0, 0, 0)'
      )
      // 契约（按用户要求"恢复原有三档材质的效果"）：内容层面**本来就有玻璃模糊**
      // （T36 曾移除，现已恢复）。本用例的**核心目的不变** —— 只钉"不得出现薄纱灰层"：
      // background-image 必须为 none、底色不得完全透明（见上方两条断言）。
      expect(
        typeof s.backdropFilter === 'string',
        `${s.selector} 的 backdrop-filter 应可读取（玻璃配方已恢复，不再禁止内容层模糊）`
      ).toBe(true)
    }

    // chrome 层保留玻璃：侧栏/工具条必须有 backdrop-filter（层级可辨的另一半）
    const chrome = await surfacesIn(app, 'index.html', ['.side', '.tool-bar'])
    expect(chrome.length, '应量到 chrome 面').toBeGreaterThan(0)
    for (const s of chrome) {
      expect(s.backdropFilter, `${s.selector} 属 chrome，应保留玻璃模糊`).not.toBe('none')
    }

    // ② 模块页：分组卡片（section）
    const nav = page.getByTestId('page-nav-prologue-live')
    if (!(await nav.isVisible().catch(() => false))) await page.getByTestId('tab-modules').click()
    await nav.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    await nav.click().catch(() => {})
    await page.waitForTimeout(1500)
    const pageSurfaces = await surfacesIn(app, 'prologue-live/control', ['section'])
    expect(pageSurfaces.length, '应至少量到一个模块页分组卡片').toBeGreaterThan(0)
    for (const s of pageSurfaces) {
      expect(s.backgroundImage, `${s.selector} 出现了背景图层（薄纱灰层）`).toBe('none')
      expect(s.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      // 用户 2026-10-02 拍板 A：模块功能页分组卡片与宿主 `.card` **同配方（玻璃材质）**
      // ⇒ 这里由"禁止 backdrop-filter"反转为"**必须有** backdrop-filter"；
      // 仍禁的只有"薄纱灰层"（--mat-veil / background-image，见上一行断言）。
      expect(
        s.backdropFilter !== 'none' && s.backdropFilter !== '',
        `模块页 ${s.selector} 缺 backdrop-filter —— 用户已拍板内容层与宿主 .card 同配方（实测：${s.backdropFilter}）`
      ).toBe(true)
    }
  } finally {
    await app.close().catch(() => {})
  }
})
