"""T39 收尾：修签名 + 守卫。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
R = os.path.join(ROOT, "src", "renderer", "src")

# ① 去掉未使用的 id 形参
p = os.path.join(R, "hooks", "useFocusMode.ts")
t = open(p, encoding="utf-8").read()
t = t.replace(
    "export function requestAutoFocus(focus: FocusMode, id: string | null | undefined, tier: LayoutTier): void {",
    "export function requestAutoFocus(focus: FocusMode, tier: LayoutTier): void {",
)
open(p, "w", encoding="utf-8", newline="\n").write(t)
print("SIG_FIXED=" + str("requestAutoFocus(focus: FocusMode, tier" in t))

# ② App 调用同步
p = os.path.join(R, "App.tsx")
t = open(p, encoding="utf-8").read()
t = t.replace(
    "requestAutoFocus(focus, tab === 'obs' ? 'obs-stream' : null, layoutFor(tab === 'obs' ? 'obs-stream' : null))",
    "requestAutoFocus(focus, layoutFor(tab === 'obs' ? 'obs-stream' : null))",
)
open(p, "w", encoding="utf-8", newline="\n").write(t)
print("APP_FIXED=True")

# ③ 守卫
open(os.path.join(ROOT, "tests", "unit", "focus-mode.spec.ts"), "w", encoding="utf-8", newline="\n").write('''import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LAYOUT_RULES, layoutFor } from '../../src/renderer/src/layout-rules'

/**
 * 布局扩展能力守卫（T39；docs/UI-OBS-FOCUS-MODE-ASSESSMENT.md §十）。
 *
 * 钉四件事：
 * ① **接口稳定性**：`useFocusMode` 的对外面**恰好**是 { state, enter, exit, toggle }；
 * ② 规则表：`layout` 只能是三档枚举，且**缺省必须 standard**（防"忘记声明就全屏"）；
 * ③ CSS：专注态列宽为 0 + 1fr，且 `column-gap` 同时归零（否则残留 16px 空带）；
 * ④ 分流：存在原生视图时**关闭过渡**（避免嵌入页面逐帧 reflow）。
 */
const HOOK = resolve(__dirname, '../../src/renderer/src/hooks/useFocusMode.ts')
const CSS = resolve(__dirname, '../../src/renderer/src/renderer.css')

describe('布局扩展能力（L1/L2）', () => {
  it('① useFocusMode 返回面恰好四件（防接口膨胀）', async () => {
    const src = await readFile(HOOK, 'utf8')
    const m = /return\\s*\\{\\s*([^}]*)\\}/.exec(src)
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

  it('③ 专注态列宽为 0 + 1fr，且 column-gap 归零', async () => {
    const css = await readFile(CSS, 'utf8')
    const m = /:root\\[data-sidebar='collapsed'\\]\\s*\\.shell\\s*\\{([^}]*)\\}/.exec(css)
    expect(m, '缺少专注态 .shell 规则').toBeTruthy()
    expect(m![1]).toMatch(/grid-template-columns:\\s*0\\s+minmax\\(0,\\s*1fr\\)/)
    expect(m![1]).toMatch(/column-gap:\\s*0/)
  })

  it('④ 有原生视图时关闭过渡（避免逐帧 reflow）', async () => {
    const css = await readFile(CSS, 'utf8')
    expect(css, '缺少 [data-native-view] 关闭过渡的规则').toMatch(
      /\\[data-native-view='1'\\][^{]*\\{[^}]*transition:\\s*none/
    )
  })
})
''')
print("GUARD_WRITTEN=True")
