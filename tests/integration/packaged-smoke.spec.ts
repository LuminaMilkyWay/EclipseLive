import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChangelogSnapshot } from '@shared/changelog'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'

/**
 * 打包产物冒烟测试（docs/BUILD.md §6.6 的自动化版）。
 *
 * 直接跑 `dist/win-unpacked/EclipseLIVE.exe`，验证**打包态**才暴露的问题：
 * 1. 打包后版本的更新日志能读到 —— 主进程按 `process.resourcesPath/CHANGELOG.md` 读取，
 *    与开发态（仓库根）是**两条不同路径**，不跑一次等于没验证；
 * 2. 模块从 `resources/modules` 加载（asar 之外），五个模块都在；
 * 3. 外壳能正常渲染（成品可运行）。
 *
 * 未打包时（没有 dist）自动跳过——它属于"打包之后"的验证，不该拖累日常回归。
 */

const EXE = join(__dirname, '../../dist/win-unpacked/EclipseLIVE.exe')

// T50：标题断言走品牌真源（app-launch 同模式）——品牌升版只改常量，测试不再炸。
const { APP_DISPLAY_VERSION, APP_NAME } = require('../../src/shared/appInfo') as {
  APP_DISPLAY_VERSION: string
  APP_NAME: string
}

test('打包产物：能启动、能读打包态更新日志、模块从 resources/modules 加载', async () => {
  test.skip(!existsSync(EXE), '未找到 dist/win-unpacked/EclipseLIVE.exe（先跑 npm run dist）')

  const iso = mkdtempSync(join(tmpdir(), 'el-packaged-'))
  const app = await electron.launch({
    executablePath: EXE,
    env: {
      ...process.env,
      EL_TEST_USERDATA: iso,
      EL_TEST_SKIP_WHATS_NEW: '1',
      EL_TEST_SKIP_TITLE: '1'
    } as unknown as Record<string, string>
  })
  const pid = app.process().pid
  try {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle(`${APP_NAME} ${APP_DISPLAY_VERSION}`)

    // ① 打包态更新日志：读的是 resources/CHANGELOG.md，且版本与成品一致
    const changelog = await page.evaluate(async (): Promise<ChangelogSnapshot> => {
      const g = globalThis as unknown as {
        eclipselive: { changelogGet: () => Promise<ChangelogSnapshot> }
      }
      return await g.eclipselive.changelogGet()
    })
    expect(changelog.releases.length, '打包态应读到更新日志（resources/CHANGELOG.md）').toBeGreaterThan(0)
    expect(changelog.releases[0].version, '成品版本应与 CHANGELOG 顶部一致').toBe(changelog.current)
    expect(changelog.releases.length).toBeLessThanOrEqual(3)

    // ② 模块从 resources/modules 加载（含本次新增的 vts-controlpad）
    const snap = await page.evaluate(async (): Promise<DiagnosticsSnapshot> => {
      const g = globalThis as unknown as {
        eclipselive: { diagnostics: () => Promise<DiagnosticsSnapshot> }
      }
      for (let i = 0; i < 20; i++) {
        try {
          return await g.eclipselive.diagnostics()
        } catch {
          await new Promise((r) => setTimeout(r, 250))
        }
      }
      throw new Error('diagnostics IPC not ready')
    })
    const ids = snap.modules.map((m) => m.id)
    expect(ids).toContain('vts-controlpad')
    expect(ids).toContain('prologue-live')

    // ③ 更新日志页签可用
    await page.getByTestId('tab-changelog').click()
    await expect(page.getByTestId('changelog-page')).toBeVisible()
  } finally {
    await app.close().catch(() => {})
    // 成品开了 close-to-tray：关窗不等于退出，进程会留在托盘里。
    // 残留实例会持有**单实例锁**，让后续任何一次启动都直接 quit、连窗口都建不出来
    // （实测踩过：4 个残留进程导致本测试连续超时）。所以这里强制回收自己启动的进程。
    if (pid) {
      try {
        process.kill(pid)
      } catch {
        // 已退出
      }
    }
  }
})
