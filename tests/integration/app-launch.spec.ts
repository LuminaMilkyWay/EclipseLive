import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Playwright 默认下载自家 Electron 构建；这里强制使用项目本地 electron，
// 保证被测对象与生产运行时完全一致（避免 CN 网络下的 CDN 下载）。
const electronExecutablePath = require('electron') as string
// 以项目根启动（走 package.json 的 main 字段），与生产启动路径一致；
// 直接传 out/main/index.js 会让 Electron 把 out/main 当应用根，版本号失效。
const projectRoot = join(__dirname, '../..')
// 品牌断言（用户 2026-09-30）：产品名 = EclipseLive，展示版本 = 0.2.1-Corona（与代码版本解耦）。
const { APP_DISPLAY_VERSION, APP_NAME } = require('../../src/shared/appInfo') as {
  APP_NAME: string
  APP_DISPLAY_VERSION: string
}

test('应用启动：窗口创建、标题正确、管理界面渲染，正常退出', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：Windows 下 APPDATA 不重定向 userData，
  // 须显式注入以免污染真实配置并与其它实例争抢单实例锁。下同。
  const iso = mkdtempSync(join(tmpdir(), 'el-launch-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  await expect(page).toHaveTitle(new RegExp(`^${APP_NAME}`, 'i'), { timeout: 20000 })
  await expect(page.locator('.brand-version')).toContainText(APP_DISPLAY_VERSION)
  await expect(page.getByRole('button', { name: '诊断', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '模块', exact: true })).toBeVisible()

  await app.close()
})
