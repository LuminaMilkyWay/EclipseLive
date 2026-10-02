import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

/** 轮询快照中 laplacelive-link 的模块记录（启动即发现，异步就绪）。 */
async function readModule(
  page: import('@playwright/test').Page
): Promise<
  { status: string; page: boolean; pinned: boolean; web: boolean } | undefined
> {
  for (let i = 0; i < 20; i++) {
    try {
      const snap = (await page.evaluate(() =>
        (globalThis as unknown as { eclipselive: { diagnostics: () => Promise<unknown> } }).eclipselive.diagnostics()
      )) as {
        modules: Array<{
          id: string
          status: string
          page: boolean
          pinned: boolean
          web: boolean
        }>
      }
      const m = snap.modules.find((x) => x.id === 'laplacelive-link')
      if (m) return { status: m.status, page: m.page, pinned: m.pinned, web: m.web }
    } catch {
      /* IPC 未就绪——重试 */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return undefined
}

test('LaplaceLive-Link 声明式工具：启动发现 + 扩展组 pinned 项（零 JS 直连入口）', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-ll-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: {
      ...process.env,
      EL_TEST_USERDATA: iso,
      EL_TEST_SKIP_TITLE: '1'
    } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()

  // ① 启动即发现并启动：声明式工具（web:true / page:false / pinned:true）
  await expect
    .poll(() => readModule(page), { timeout: 10000 })
    .toEqual({ status: 'started', page: false, pinned: true, web: true })

  // ② 展开「模块」二级下拉 → pinned 工具项在位（名称=LaplaceLive-Link；行为类=工具项而非页面项）
  await page.getByTestId('tab-modules').click()
  await page.waitForSelector("[data-testid='tool-nav-laplacelive-link']")
  await expect(page.getByTestId('tool-nav-laplacelive-link')).toContainText('LaplaceLive-Link')
  await expect(page.locator("[data-testid='page-nav-laplacelive-link']")).toHaveCount(0)

  // ③ 模块管理在设置页「模块」分区可见（验收：管理分区可见；下拉占流不遮挡设置按钮）
  await page.getByTestId('tab-settings').click()
  await expect(page.getByTestId('module-card-laplacelive-link')).toContainText('started', {
    timeout: 5000
  })

  await app.close()
})
