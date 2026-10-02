import { test, expect, _electron as electron } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('网页工具容器接线：真实启动 webtools ready 日志', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：Windows 下 APPDATA 不重定向 userData，下同。
  const iso = mkdtempSync(join(tmpdir(), 'el-webtools-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })

  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  const logsDir = join(userData, 'logs')

  let content = ''
  for (let i = 0; i < 10; i++) {
    try {
      const files = (await readdir(logsDir)).filter((f) => /^eclipselive-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      if (files.length > 0) {
        content = await readFile(join(logsDir, files[files.length - 1]), 'utf8')
        if (content.includes('webtools ready')) break
      }
    } catch {
      /* not flushed yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  await app.close()

  expect(content).toContain('[lifecycle] webtools ready')
})

test('embedded 视图父窗：存在 overlay 悬浮窗时仍挂主窗（不绑定悬浮窗）', async () => {
  // 回归：主进程此前用 getAllWindows()[0] 取父窗——打字机模块（prologue-live）启动期
  // 创建的 overlay 悬浮窗与主窗竞态，悬浮窗排到列表首位时第三方工具视图被误挂到悬浮窗
  // （视窗绑定悬浮窗 + 无边框大窗遮住底部任务栏一半）。修复后视图必须始终挂主窗。
  const iso = mkdtempSync(join(tmpdir(), 'el-wtparent-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // 模拟打字机模块的 overlay 悬浮窗（无边框/透明/skipTaskbar/大尺寸 + overlay marker）
  await app.evaluate(({ BrowserWindow }) => {
    const win = new BrowserWindow({
      frame: false,
      transparent: true,
      skipTaskbar: true,
      show: false,
      width: 1920,
      height: 1080
    })
    ;(win as unknown as Record<string, unknown>)['__eclipseliveOverlay__'] = true
  })

  // 展开「模块」二级下拉 → 打开 pinned 工具（example-web，与 pinned-tool-nav 同款：轮询快照 state open）
  await page.getByTestId('tab-modules').click()
  await page.waitForSelector("[data-testid='tool-nav-example-web']")
  await page.getByTestId('tool-nav-example-web').click()
  await expect
    .poll(
      async () => {
        const snap = (await page.evaluate(() =>
          (globalThis as unknown as { eclipselive: { diagnostics: () => Promise<unknown> } }).eclipselive.diagnostics()
        )) as { webtools: { statuses: Array<{ moduleId: string; state: string }> } }
        return snap.webtools.statuses.find((s) => s.moduleId === 'example-web')
      },
      { timeout: 8000 }
    )
    .toMatchObject({ state: 'open' })

  // 断言：WebContentsView 挂在主窗（非 overlay 悬浮窗）
  const attach = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => {
      const overlay = (w as unknown as Record<string, unknown>)['__eclipseliveOverlay__'] === true
      return { overlay, children: w.contentView.children.length, title: w.getTitle() }
    })
  )
  const hosted = attach.filter((w) => w.children > 0)
  expect(hosted.length).toBe(1)
  expect(hosted[0].overlay).toBe(false)

  await app.close()
})
