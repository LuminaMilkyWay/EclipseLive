import { test, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 诊断探针：同一界面在**深色 / 浅色主题、无底图 / 有底图**四种组合下各抓一张，
 * 用来确定"内容区左边界那条浅色竖条"到底是什么（应用底色？底图？面板描边？）。
 * 抓到后由外部脚本量同一段扫描线。
 */
const electronExecutablePath = require('electron') as string
const projectRoot = resolve(__dirname, '../..')

function profile(theme: string, withWallpaper: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), `el-diag-${theme}-`))
  mkdirSync(join(dir, 'config'), { recursive: true })
  if (withWallpaper) {
    const wp = join(dir, 'wallpapers')
    mkdirSync(wp, { recursive: true })
    writeFileSync(join(wp, 'probe.png'), Buffer.from([]))
    // 用一张纯浅色图，复现"浅色底图"场景
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64'
    )
    writeFileSync(join(wp, 'probe.png'), png)
  }
  writeFileSync(
    join(dir, 'config', 'core.ui.json'),
    JSON.stringify({
      format: 'eclipselive-config-section',
      version: 4,
      updatedAt: Date.now(),
      data: {
        themeMode: theme,
        accent: 'corona-orange',
        material: 3,
        wallpaperImage: withWallpaper ? 'probe.png' : '',
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

for (const theme of ['dark', 'light']) {
  for (const wp of [false, true]) {
    test(`边界诊断 ${theme} wallpaper=${wp}`, async () => {
      const app = await electron.launch({
        executablePath: electronExecutablePath,
        args: [projectRoot],
        env: {
          ...process.env,
          EL_TEST_USERDATA: profile(theme, wp),
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
        if (b64) writeFileSync(resolve(`diag-${theme}-${wp ? 'wp' : 'nowp'}.png`), Buffer.from(b64, 'base64'))
      } finally {
        await app.close().catch(() => {})
      }
    })
  }
}
