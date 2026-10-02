import { test, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 诊断探针：设置 → 模块 页的**真实几何**。
 * 逐张模块卡读出：卡片高度、`.module-actions` 个数、每个按钮的 x/y/宽/高、是否发生换行（y 不同）。
 * 输出 `GEOM=…` 供定位"控件高度异常"到底是哪一种。
 */
const electronExecutablePath = require('electron') as string
const projectRoot = resolve(__dirname, '../..')

function profile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'el-geom-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(
    join(dir, 'config', 'core.ui.json'),
    JSON.stringify({
      format: 'eclipselive-config-section',
      version: 4,
      updatedAt: Date.now(),
      data: {
        themeMode: 'dark',
        accent: 'corona-orange',
        material: 4,
        wallpaperImage: '',
        wallpaperFit: 'fill',
        wallpaperOpacity: 1,
        wallpaperBlur: 0,
        reduceTransparency: false,
        highContrast: false,
        reduceMotion: false
      }
    }),
    'utf8'
  )
  return dir
}

test('设置→模块 控件几何诊断', async () => {
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: {
      ...process.env,
      EL_TEST_USERDATA: profile(),
      EL_TEST_SKIP_TITLE: '1',
      EL_TEST_SKIP_WHATSNEW: '1'
    } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()
  try {
    await page.getByTestId('tab-settings').click()
    await page.waitForTimeout(900)

    const data = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelectorAll(sel: string): ArrayLike<unknown> }
        getComputedStyle(el: unknown): { paddingTop?: string; paddingBottom?: string; height?: string }
      }
      const out: unknown[] = []
      const cards = g.document.querySelectorAll('[data-testid^="module-card-"]')
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i] as unknown as {
          getBoundingClientRect(): { height: number; width: number }
          querySelectorAll(sel: string): ArrayLike<unknown>
          getAttribute(n: string): string | null
        }
        const rect = card.getBoundingClientRect()
        const rows = card.querySelectorAll('.module-actions')
        const btns = card.querySelectorAll('.module-actions .btn')
        const btnsInfo: unknown[] = []
        for (let b = 0; b < btns.length; b++) {
          const el = btns[b] as unknown as {
            getBoundingClientRect(): { x: number; y: number; width: number; height: number }
            textContent: string | null
          }
          const r = el.getBoundingClientRect()
          btnsInfo.push({
            t: (el.textContent ?? '').trim().slice(0, 6),
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height)
          })
        }
        const url = card.querySelectorAll('.web-url')
        out.push({
          id: card.getAttribute('data-testid'),
          cardH: Math.round(rect.height),
          cardW: Math.round(rect.width),
          rows: rows.length,
          urlRows: url.length,
          btns: btnsInfo
        })
      }
      return out
    })
    console.log('GEOM=' + JSON.stringify(data))
    await page.waitForTimeout(300)
    const b64 = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const b = win.getContentBounds()
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: b.width, height: b.height }
      })
      // T50：字面量须随 APP_NAME（'EclipseLive'）同步——evaluate 闭包在浏览器侧执行，引用不了外部常量
      const mine = sources.find((s) => s.name.includes('EclipseLive')) ?? sources[0]
      return mine ? mine.thumbnail.toPNG().toString('base64') : ''
    })
    if (b64) writeFileSync(resolve('module-geom.png'), Buffer.from(b64, 'base64'))
  } finally {
    await app.close().catch(() => {})
  }
})
