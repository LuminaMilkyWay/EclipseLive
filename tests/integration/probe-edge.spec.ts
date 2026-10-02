import { test, _electron as electron } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 排障探针（临时，诊断"功能区域左侧边界灰色带"用）：
 * 用可识别底图分别以档 2 / 档 3 / 档 4 启动，抓真实窗口画面。
 * 之后由外部脚本**量像素**（扫描线穿过侧栏右缘 = 内容区左边界），用数据判断是否存在灰带。
 */
const electronExecutablePath = require('electron') as string
const projectRoot = resolve(__dirname, '../..')

function profile(material: number): string {
  const dir = mkdtempSync(join(tmpdir(), `el-edge${material}-`))
  mkdirSync(join(dir, 'config'), { recursive: true })
  const wp = join(dir, 'wallpapers')
  mkdirSync(wp, { recursive: true })
  copyFileSync(resolve('tests/fixtures/wallpaper-probe.png'), join(wp, 'probe.png'))
  writeFileSync(
    join(dir, 'config', 'core.ui.json'),
    JSON.stringify({
      format: 'eclipselive-config-section',
      version: 4,
      updatedAt: Date.now(),
      data: {
        themeMode: 'dark',
        accent: 'corona-orange',
        material,
        wallpaperImage: 'probe.png',
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

for (const tier of [2, 3, 4]) {
  test(`灰边排障 · 档 ${tier}`, async () => {
    const app = await electron.launch({
      executablePath: electronExecutablePath,
      args: [projectRoot],
      env: {
        ...process.env,
        EL_TEST_USERDATA: profile(tier),
        EL_TEST_SKIP_TITLE: '1',
        EL_TEST_SKIP_WHATSNEW: '1'
      } as unknown as Record<string, string>
    })
    const page = await app.firstWindow()
    try {
      await page.waitForTimeout(1200)
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
      if (b64) writeFileSync(resolve(`edge-tier${tier}.png`), Buffer.from(b64, 'base64'))
    } finally {
      await app.close().catch(() => {})
    }
  })
}
