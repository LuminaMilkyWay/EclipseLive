import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * 锁定模式守卫（T43；用户选择 Q2=A：不自动隐藏 / 不参与回缩动画 / 位置固定）。
 *
 * ⚠️ 本文件**不 import** `hooks/useFocusMode.ts`：该 hook 使用 DOM API，
 * 而 `tsconfig.node.json` 覆盖 `tests/**` ⇒ 直接 import 会让 node 侧出现
 * "Cannot find name 'document'"（本轮真实踩到）。因此按本仓惯例**读源码文本**断言。
 */
const HOOK = resolve(__dirname, '../../src/renderer/src/hooks/useFocusMode.ts')
const CSS = resolve(__dirname, '../../src/renderer/src/renderer.css')
const SHELL_LAYOUT = resolve(__dirname, '../../src/renderer/src/hooks/useShellLayout.ts')
const TOOLBAR = resolve(__dirname, '../../src/renderer/src/shell/ToolBar.tsx')

describe('布局锁定（T43）', () => {
  it('① 锁定态存在且自动请求被忽略', async () => {
    const src = await readFile(HOOK, 'utf8')
    expect(src, '缺少锁定态存储').toContain('let layoutLocked')
    expect(src, '缺少 isLayoutLocked()').toContain('export function isLayoutLocked')
    const fn = /export function requestAutoFocus[\s\S]*?\n\}/.exec(src)
    expect(fn, '缺少 requestAutoFocus').toBeTruthy()
    expect(fn![0], '锁定时必须忽略自动请求').toMatch(/if \(layoutLocked\) return/)
  })

  it('② 锁定写入根属性，并由 CSS 关闭动画/过渡（位置固定）', async () => {
    const layout = await readFile(SHELL_LAYOUT, 'utf8')
    expect(layout, '缺少 data-layout-locked 写入').toContain("setAttribute('data-layout-locked', '1')")
    expect(layout, '解锁必须移除该属性').toContain("removeAttribute('data-layout-locked')")

    const css = await readFile(CSS, 'utf8')
    const block = /:root\[data-layout-locked='1'\]\s*\.side,[\s\S]*?\n\}/.exec(css)
    expect(block, '缺少锁定态规则').toBeTruthy()
    expect(block![0], '锁定必须关闭动画').toContain('animation: none')
    expect(block![0], '锁定必须关闭过渡（位置固定）').toContain('transition: none')
    const shell = /:root\[data-layout-locked='1'\]\s*\.shell\s*\{([^}]*)\}/.exec(css)
    expect(shell, '缺少锁定态的 .shell 规则').toBeTruthy()
    expect(shell![1]).toContain('transition: none')
  })

  it('③ DOCK 上有锁定入口（可点、可访问）', async () => {
    const toolbar = await readFile(TOOLBAR, 'utf8')
    expect(toolbar).toContain('data-testid="dock-lock"')
    expect(toolbar, '锁定按钮需要可访问名').toContain("aria-label={layoutLocked ? '解除锁定' : '锁定布局'}")
    expect(toolbar, '锁定按钮需要按下态').toContain('aria-pressed={layoutLocked}')
  })
})
