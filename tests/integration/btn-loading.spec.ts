/**
 * T-A3 加载态交付测试：spinner + 文字变淡 + 不可重复点击。
 *
 * 覆盖边界（如实标注）：
 * - 「spinner / 文字变淡 / progress 光标 / 原生 disabled 阻止真实点击」为**运行时确定断言**；
 * - 「run() 同一操作在途时忽略重复触发」由 `tests/unit/components.spec.ts` 对 `run` 源码做早退断言覆盖
 *   （端到端连点因操作完成时间不可控，不做时序断言以免 flaky）。
 *
 * tsconfig.node 无 DOM 类型——结构化访问 DOM（集成测试通用惯例，见 a11y-motion.spec.ts）。
 */
import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

type Css = Record<string, string>
interface El {
  disabled: boolean
  hasAttribute(n: string): boolean
  getAttribute(n: string): string | null
  setAttribute(n: string, v: string): void
  prepend(n: unknown): void
  querySelector(s: string): El | null
  addEventListener(t: string, f: () => void): void
}
interface Win {
  document: { querySelector(s: string): El | null; createElement(t: string): El }
  getComputedStyle(e: unknown): Css
  __hits: number
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

test('加载态：spinner 就位、文字变淡、原生 disabled 阻止真实点击', async () => {
  const { app, page } = await launchApp('el-btn-loading-')

  // 取诊断页第一个按钮作为样本：强制进入加载态（等价于 run() 在途的状态）
  const sel = '.page-actions .btn'
  await page.waitForSelector(sel)

  await page.evaluate((s) => {
    const w = globalThis as unknown as Win
    const b = w.document.querySelector(s) as El
    b.disabled = true
    b.setAttribute('data-loading', 'true')
    const sp = w.document.createElement('span')
    sp.setAttribute('class', 'spinner')
    b.prepend(sp)
  }, sel)

  const state = await page.evaluate((s) => {
    const w = globalThis as unknown as Win
    const b = w.document.querySelector(s) as El
    const bcs = w.getComputedStyle(b)
    const sp = b.querySelector('.spinner')
    const scs = sp ? w.getComputedStyle(sp) : null
    return {
      disabled: b.disabled,
      dataLoading: b.getAttribute('data-loading'),
      opacity: bcs.opacity,
      cursor: bcs.cursor,
      animationName: scs ? scs.animationName : '',
      animationDuration: scs ? scs.animationDuration : '',
      animationTimingFunction: scs ? scs.animationTimingFunction : '',
      animationIterationCount: scs ? scs.animationIterationCount : '',
      spinnerRadius: scs ? scs.borderRadius : ''
    }
  }, sel)

  // 1) 加载中：原生可直接拦掉点击 + 光标 progress（而非 not-allowed）+ 比禁用态更清晰
  expect(state.disabled, '加载中按钮必须 disabled（原生拦截重复点击）').toBe(true)
  expect(state.dataLoading).toBe('true')
  expect(state.cursor, '加载中光标应为 progress').toBe('progress')
  expect(state.opacity, '加载中应比禁用态（0.5）更清晰').toBe('0.7')

  // 2) spinner 存在且真的在转（唯一允许的持续旋转）
  expect(state.animationName, '缺少 spinner 旋转动画').toBe('el-spin')
  expect(state.animationTimingFunction, 'spinner 是线性缓动的显式例外').toBe('linear')
  expect(state.animationIterationCount, 'spinner 应为持续旋转').toBe('infinite')
  expect(parseFloat(state.animationDuration), 'spinner 时长应来自令牌').toBeGreaterThan(0)
  expect(state.spinnerRadius, 'spinner 应为圆形（胶囊令牌）').toBe('999px')

  // 3) 原生 disabled 确实阻止点击。
  //    必须用**真实鼠标点击**——合成 dispatchEvent(new MouseEvent('click'))
  //    会绕过浏览器的 disabled 拦截，测不出真实行为。
  await page.evaluate((s) => {
    const w = globalThis as unknown as Win
    const b = w.document.querySelector(s) as El
    w.__hits = 0
    b.addEventListener('click', () => {
      w.__hits += 1
    })
  }, sel)
  const box = await page.locator(sel).first().boundingBox()
  expect(box, '取不到按钮位置').not.toBeNull()
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const hits = await page.evaluate(() => (globalThis as unknown as Win).__hits)
  expect(hits, '真实点击不应抵达 disabled 按钮的处理器').toBe(0)

  await app.close()
})

test('加载态样式不得在正常按钮上误触发', async () => {
  const { app, page } = await launchApp('el-btn-idle-')
  const sel = '.page-actions .btn'
  await page.waitForSelector(sel)
  const idle = await page.evaluate((s) => {
    const w = globalThis as unknown as Win
    const b = w.document.querySelector(s) as El
    const cs = w.getComputedStyle(b)
    return {
      disabled: b.disabled,
      hasLoading: b.hasAttribute('data-loading'),
      spinner: b.querySelector('.spinner') !== null,
      opacity: cs.opacity,
      cursor: cs.cursor,
      shadow: cs.boxShadow,
      display: cs.display
    }
  }, sel)
  expect(idle.disabled).toBe(false)
  expect(idle.hasLoading, '未在途的按钮不应带 data-loading').toBe(false)
  expect(idle.spinner, '未在途的按钮不应有 spinner').toBe(false)
  expect(idle.opacity).toBe('1')
  expect(idle.cursor).toBe('pointer')
  expect(idle.shadow, '静止态应有控件阴影').not.toBe('none')
  // button 的 inline-flex 会被规范化为 flex（Chromium 行为），只断言 flex 系
  expect(idle.display).toContain('flex')
  await app.close()
})
