import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTier, LAYOUT_RULES } from '../../src/renderer/src/layout-rules'

/**
 * C3 守卫：模块 nav.immersive ⇒ 专注档位。
 *
 * 三条不变式：
 *   1. **未声明 immersive ⇒ 与今天完全一致**（模块页留在 standard，绝不误全屏）—— 安全默认；
 *   2. 显式 immersive === true ⇒ full（与内置「直播中控」同档）；
 *   3. 内置规则表仍优先（obs-stream ⇒ full，不因模块传参变化）。
 *
 * resolveTier 是**纯函数**（layout-rules.ts 无 DOM）⇒ 可绕开"测试项目没有 DOM"的项目边界，真跑单测。
 */
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('模块 immersive ⇒ 专注档位（C3）', () => {
  it('1 未声明 immersive ⇒ standard（安全默认）', () => {
    expect(resolveTier('my-module', undefined), '未声明必须留 standard').toBe('standard')
    expect(resolveTier('my-module', false), '显式 false 也留 standard').toBe('standard')
    expect(resolveTier(null, true), '没有页面键时不得凭 immersive 全屏').toBe('standard')
  })

  it('2 显式 immersive === true ⇒ full', () => {
    expect(resolveTier('my-module', true)).toBe('full')
  })

  it('3 内置规则表优先', () => {
    expect(resolveTier('obs-stream', undefined), '直播中控仍应为 full').toBe('full')
    expect(resolveTier('obs-stream', false), '规则表不因模块传参改变').toBe('full')
    expect(LAYOUT_RULES['obs-stream']).toBe('full')
  })

  it('4 接线：App 在**不增加行数**的前提下把快照传给布局 hook', () => {
    const app = read('src/renderer/src/App.tsx')
    expect(app, 'App 必须把 snap 传给布局 hook').toContain('snap ?? null')
    expect(app.split('\n').length, 'App.tsx 不得因本卡增长（棘轮）').toBeLessThanOrEqual(337)
    const hook = read('src/renderer/src/hooks/useShellLayout.ts')
    expect(hook, '布局 hook 必须用 resolveTier 裁决').toContain('resolveTier(')
    expect(hook, '必须从 tab 解析模块 id').toContain('pageTabModuleId(tab as Tab)')
    expect(hook, '必须读模块的 nav.immersive').toContain('nav?.immersive')
  })
})
