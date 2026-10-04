import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LAYOUT_RULES, layoutFor } from '../../src/renderer/src/layout-rules'

/**
 * 布局扩展能力守卫（T39；docs/UI-OBS-FOCUS-MODE-ASSESSMENT.md §十）。
 *
 * 钉四件事：
 * ① **接口稳定性**：`useFocusMode` 的对外面**恰好**是 { state, enter, exit, toggle }；
 * ② 规则表：`layout` 只能是三档枚举，且**缺省必须 standard**（防"忘记声明就全屏"）；
 * ③ CSS：专注态列宽为 `minmax(0, 0fr) + minmax(0, 1fr)`（两端同单位才可插值 ⇒ 展开有过渡），且 `column-gap` 同时归零；
 * ④ 分流：存在原生视图时**关闭过渡**（避免嵌入页面逐帧 reflow）。
 */
const HOOK = resolve(__dirname, '../../src/renderer/src/hooks/useFocusMode.ts')
const CSS = resolve(__dirname, '../../src/renderer/src/renderer.css')

describe('布局扩展能力（L1/L2）', () => {
  it('① useFocusMode 返回面恰好四件（防接口膨胀）', async () => {
    const src = await readFile(HOOK, 'utf8')
    // 只取 useFocusMode 函数体（文件里还有 useLayoutLock 的 return，不能抓第一个）
    const body = /export function useFocusMode[\s\S]*?\n\}/.exec(src)
    expect(body, '未找到 useFocusMode 函数体').toBeTruthy()
    const m = /return\s*\{\s*([^}]*)\}/.exec(body![0])
    expect(m, '未找到 return { … }').toBeTruthy()
    const keys = m![1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort()
    expect(keys).toEqual(['enter', 'exit', 'state', 'toggle'])
  })

  it('② 规则表：三档枚举 + 缺省 standard', () => {
    const allowed = ['standard', 'wide', 'full']
    for (const [k, v] of Object.entries(LAYOUT_RULES)) {
      expect(allowed, `规则 ${k} 的档位非法：${v}`).toContain(v)
    }
    expect(layoutFor('不存在的功能')).toBe('standard')
    expect(layoutFor(null)).toBe('standard')
    expect(layoutFor(undefined)).toBe('standard')
    // 直播中控是第一个消费者
    expect(layoutFor('obs-stream')).toBe('full')
  })

  it('③ 专注态不产生布局动画（菜单栅格对齐 + z-index 覆盖；内容区跨列铺满）', async () => {
    const css = await readFile(CSS, 'utf8')
    const m = /:root\[data-sidebar='collapsed'\]\s*\.shell\s*\{([^}]*)\}/.exec(css)
    expect(m, '缺少专注态 .shell 规则').toBeTruthy()
    // 焦点修订：内容区跨列铺满后，column-gap 不再需要变化 ⇒ 专注态**不产生任何布局动画**
    // （这是几何抖动（槽位上报时序）的根治手段）
    // 用户规格：内容区跨列铺满 + 菜单盖在其上（列宽不再参与收放 ⇒ 不再牵动槽位上报时序）
    expect(css, '内容区必须跨列铺满').toMatch(/:root\[data-focus='1'\]\s*\.content\s*\{[^}]*grid-column:\s*1 \/ -1/)
    expect(css, '菜单必须有更高的 z-index').toMatch(/:root\[data-focus='1'\]\s*\.side\s*\{[^}]*z-index:\s*30/)
  })

  it('④ 有原生视图时关闭过渡（避免逐帧 reflow）', async () => {
    const css = await readFile(CSS, 'utf8')
    expect(css, '缺少 [data-native-view] 关闭过渡的规则').toMatch(
      /\[data-native-view='1'\][^{]*\{[^}]*transition:\s*none/
    )
  })
})
