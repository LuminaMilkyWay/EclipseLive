import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChangelogSnapshot } from '@shared/changelog'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

/**
 * T34 应用内更新日志（真实 Electron）。
 *
 * 覆盖三件事：
 * 1. 「更新日志」页签能渲染出**当前版本**（数据确实从 CHANGELOG.md 解析出来了）；
 * 2. 应用内**只显示最近 3 个版本**；
 * 3. 升级后首次启动弹「本次更新」，点「知道了」后记录已读 —— 重启不再弹。
 */

async function launch(userData: string) {
  return electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: {
      ...process.env,
      EL_TEST_USERDATA: userData,
      EL_TEST_SKIP_TITLE: '1',
      // 本文件要**验证弹窗本身**，故显式覆盖掉 global-setup 注入的跳过开关
      EL_TEST_SKIP_WHATS_NEW: ''
    } as unknown as Record<string, string>
  })
}

function readSnapshot(page: Awaited<ReturnType<Awaited<ReturnType<typeof launch>>['firstWindow']>>) {
  return page.evaluate(async (): Promise<ChangelogSnapshot> => {
    const g = globalThis as unknown as {
      eclipselive: { changelogGet: () => Promise<ChangelogSnapshot> }
    }
    for (let i = 0; i < 20; i++) {
      try {
        return await g.eclipselive.changelogGet()
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    throw new Error('changelog IPC not ready')
  })
}

test('更新日志：页签渲染当前版本 + 只保留最近 3 个版本', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-chg-it-'))
  const app = await launch(iso)
  const page = await app.firstWindow()

  // 全新 userData ⇒ 启动会弹「本次更新」（遮罩会挡住导航），先关掉再操作页签。
  // 注意用 waitFor 显式等待：弹窗是 IPC 返回后才渲染的，`isVisible()` 不等待会漏判。
  const whatsNew = page.getByTestId('whats-new')
  try {
    await whatsNew.waitFor({ state: 'visible', timeout: 5000 })
    await page.getByTestId('whats-new-close').click()
    await expect(whatsNew).toBeHidden()
  } catch {
    // 未弹出（例如运行环境覆盖了跳过开关）→ 无需处理，继续验证页签
  }

  // 页签存在且可进入
  await expect(page.getByTestId('tab-changelog')).toBeVisible()
  await page.getByTestId('tab-changelog').click()
  await expect(page.getByTestId('changelog-page')).toBeVisible()

  // 主进程解析结果：当前版本在内、且不超过 3 个
  const snap = await readSnapshot(page)
  expect(snap.releases.length).toBeGreaterThan(0)
  expect(snap.releases.length).toBeLessThanOrEqual(3)
  expect(snap.releases.some((r) => r.version === snap.current)).toBe(true)
  expect(snap.releases[0].version, '最新版本应排在第一个').toBe(snap.current)

  // 页面上确实渲染出了当前版本卡片与"当前版本"标记
  await expect(page.getByTestId(`changelog-${snap.current}`)).toBeVisible()
  await expect(page.getByTestId('changelog-current')).toHaveText('当前版本')
  // 条目已去 markdown：不应出现星号残留
  const body = (await page.getByTestId('changelog-page').innerText()).slice(0, 4000)
  expect(body).not.toContain('**')

  await app.close()
})

test('本次更新：首次启动弹一次，点「知道了」后记录已读（重启不再弹）', async () => {
  const iso = mkdtempSync(join(tmpdir(), 'el-chg-it2-'))

  // 第一次启动：未记录已读 → 应弹
  const first = await launch(iso)
  const page1 = await first.firstWindow()
  const snap1 = await readSnapshot(page1)
  expect(snap1.showWhatsNew, '全新 userData 应提示本次更新').toBe(true)
  await expect(page1.getByTestId('whats-new')).toBeVisible()
  await expect(page1.getByTestId('whats-new')).toContainText(snap1.current)
  await page1.getByTestId('whats-new-close').click()
  await expect(page1.getByTestId('whats-new')).toBeHidden()
  await first.close()

  // 第二次启动（同一 userData）：已记录已读 → 不再弹
  const second = await launch(iso)
  const page2 = await second.firstWindow()
  const snap2 = await readSnapshot(page2)
  expect(snap2.showWhatsNew, '已读后不应再弹').toBe(false)
  await expect(page2.getByTestId('whats-new')).toBeHidden()
  // 但永久页签仍可查看
  await page2.getByTestId('tab-changelog').click()
  await expect(page2.getByTestId(`changelog-${snap2.current}`)).toBeVisible()
  await second.close()
})
