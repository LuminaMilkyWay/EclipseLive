/**
 * T-A7 交付测试：系统偏好（prefers-reduced-motion）与低配模式。
 *
 * 关键点：既有的单测只断言"降级规则文本存在"、集成测试只断言"根属性变化"，
 * 因此**降级是否真的关掉了动效**从未被验证——历史上正是这个盲区让
 * `[data-reduce-motion='1'] *` 因特异性不足被 `.card` 覆盖而静默失效。
 * 本用例直接读**计算样式**，锁住行为面。
 *
 * tsconfig.node 无 DOM 类型——结构化访问 DOM（集成测试通用惯例）。
 */
import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

interface El {
  getAttribute(n: string): string | null
}
interface Win {
  document: { documentElement: El; querySelector(s: string): El | null }
  getComputedStyle(e: unknown): Record<string, string>
}
interface Snapshot {
  reduceTransparency: string | null
  reduceMotion: string | null
  sysReduceMotion: string | null
  wallpaperDisplay: string | null
  cardTransition: string | null
  knobTransition: string | null
}

async function launchApp(
  prefix: string
): Promise<{ app: Awaited<ReturnType<typeof electron.launch>>; page: Page }> {
  const iso = mkdtempSync(join(tmpdir(), prefix))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.shell')
  return { app, page }
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const w = globalThis as unknown as Win
    const de = w.document.documentElement
    const wp = w.document.querySelector('.wallpaper')
    const card = w.document.querySelector('.card')
    const knob = w.document.querySelector('.switch-knob')
    return {
      reduceTransparency: de.getAttribute('data-reduce-transparency'),
      reduceMotion: de.getAttribute('data-reduce-motion'),
      sysReduceMotion: de.getAttribute('data-sys-reduce-motion'),
      wallpaperDisplay: wp ? w.getComputedStyle(wp).display : null,
      cardTransition: card ? w.getComputedStyle(card).transitionDuration : null,
      knobTransition: knob ? w.getComputedStyle(knob).transitionDuration : null
    }
  })
}

test('低配模式：一键同时关模糊/动效/底图，且动效真的被关掉（读计算样式）', async () => {
  const { app, page } = await launchApp('el-lowspec-')
  await page.getByTestId('tab-settings').click()
  await page.waitForSelector('[data-testid="seg-material-2"]')

  const before = await snapshot(page)
  expect(before.reduceTransparency).toBe('0')
  expect(before.reduceMotion).toBe('0')
  expect(before.wallpaperDisplay, '默认底图可见').not.toBe('none')
  expect(before.cardTransition, '默认卡片应有过渡').not.toBe('0s')

  // 打开低配模式
  await page.getByTestId('switch-low-spec').click()
  await expect(page.locator('html')).toHaveAttribute('data-reduce-transparency', '1')
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', '1')
  const on = await snapshot(page)
  expect(on.wallpaperDisplay, '低配模式应隐藏底图层').toBe('none')
  expect(on.cardTransition, '低配模式应真的关掉卡片过渡').toBe('0s')
  expect(on.knobTransition, '低配模式应连开关滑块过渡一起关掉').toBe('0s')

  // 关闭后恢复
  await page.getByTestId('switch-low-spec').click()
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', '0')
  const off = await snapshot(page)
  expect(off.wallpaperDisplay, '关闭后底图应恢复').not.toBe('none')
  expect(off.cardTransition, '关闭后过渡应恢复').not.toBe('0s')

  await app.close()
})

test('系统 prefers-reduced-motion：独立根属性生效且真的关掉动效', async () => {
  const { app, page } = await launchApp('el-sysrm-')
  await page.getByTestId('tab-settings').click()
  await page.waitForSelector('[data-testid="seg-material-2"]')

  // 默认（no-preference）
  const dflt = await snapshot(page)
  expect(dflt.sysReduceMotion).toBe('0')
  expect(dflt.cardTransition).not.toBe('0s')

  // 系统开启"减少动态效果"
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('html')).toHaveAttribute('data-sys-reduce-motion', '1')
  const reduced = await snapshot(page)
  expect(reduced.cardTransition, '系统偏好应真的关掉过渡').toBe('0s')
  // 语义隔离：应用内开关属性不应被系统偏好污染（既有断言依赖它反映用户设置）
  expect(reduced.reduceMotion, '系统偏好不得改写应用内开关属性').toBe('0')

  // 恢复系统偏好
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.locator('html')).toHaveAttribute('data-sys-reduce-motion', '0')
  const restored = await snapshot(page)
  expect(restored.cardTransition, '恢复后过渡应回归').not.toBe('0s')

  await app.close()
})
