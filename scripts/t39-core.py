"""T39：useFocusMode（L1）+ layout-rules（L2）+ OBS 菜单第一项 + 占位页 + 自动专注。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
R = os.path.join(ROOT, "src", "renderer", "src")

# ---------- ① L2 规则表 ----------
open(os.path.join(R, "layout-rules.ts"), "w", encoding="utf-8", newline="\n").write('''/**
 * 布局扩展规则表（L2，**零清单格式变更**）。
 *
 * 来源：docs/UI-OBS-FOCUS-MODE-ASSESSMENT.md §十。
 * 语义：`moduleId/pageId → 布局档`；**缺省必须是 `standard`**（防止"忘记声明就全屏"）。
 * 新增一个需要更大操作范围的功能页时，**只在这里加一行**。
 */
export type LayoutTier = 'standard' | 'wide' | 'full'

/** 页面/功能标识 → 布局档。键用稳定的功能标识（不是模块 id）。 */
export const LAYOUT_RULES: Readonly<Record<string, LayoutTier>> = {
  // 直播中控是第一个消费者：进入即回缩侧栏、内容区扩展到原侧栏左边界
  'obs-stream': 'full'
}

/** 查表（缺省 standard）。 */
export function layoutFor(id: string | null | undefined): LayoutTier {
  if (!id) return 'standard'
  return LAYOUT_RULES[id] ?? 'standard'
}
''')
print("RULES_WRITTEN=True")

# ---------- ② L1 能力 hook ----------
open(os.path.join(R, "hooks", "useFocusMode.ts"), "w", encoding="utf-8", newline="\n").write('''import { useCallback, useEffect, useRef, useState } from 'react'
import type { LayoutTier } from '../layout-rules'

/**
 * 布局扩展能力（L1）—— 与业务无关、与 OBS 无关的一等能力。
 *
 * 来源：docs/UI-OBS-FOCUS-MODE-ASSESSMENT.md §九/§十。
 * 对外**只暴露** `{ state, enter, exit, toggle }`（守卫断言"恰好四件"，防止接口悄悄膨胀）；
 * 其余（过渡实现、gap 归零、按原生视图分流、锁定语义）都是**内部细节**。
 *
 * 与 T38 的关系：两者**共用同一组根属性**（`data-sidebar='collapsed'`）——本 hook 进入专注时
 * 记下当前的手动状态，退出时**原样恢复**，因此不会与 DOCK 上的「菜单」开关互相打架。
 *
 * 锁定（Q2=A）：锁定期间**自动**请求被忽略（手动 `enter/exit` 仍可用）。
 */

/** 锁定状态（独立小 hook，不并入 useFocusMode 的返回面）。 */
let layoutLocked = false
const lockListeners = new Set<(v: boolean) => void>()

export function useLayoutLock(): { locked: boolean; setLocked: (v: boolean) => void } {
  const [locked, set] = useState(layoutLocked)
  useEffect(() => {
    const fn = (v: boolean): void => set(v)
    lockListeners.add(fn)
    return () => {
      lockListeners.delete(fn)
    }
  }, [])
  const setLocked = useCallback((v: boolean) => {
    layoutLocked = v
    for (const l of lockListeners) l(v)
  }, [])
  return { locked, setLocked }
}

export interface FocusMode {
  state: LayoutTier
  enter: (tier: LayoutTier) => void
  exit: () => void
  toggle: (tier: LayoutTier) => void
}

export function useFocusMode(): FocusMode {
  const [state, setState] = useState<LayoutTier>('standard')
  /** 进入专注前的手动收起状态（退出时恢复，避免与 DOCK 的菜单开关打架）。 */
  const manualBefore = useRef<string | null>(null)

  useEffect(() => {
    const root = document.documentElement
    if (state === 'standard') return
    if (manualBefore.current === null) manualBefore.current = root.getAttribute('data-sidebar')
    root.setAttribute('data-sidebar', 'collapsed')
    root.setAttribute('data-layout-tier', state)
    return () => {
      if (manualBefore.current === null) root.removeAttribute('data-sidebar')
      else root.setAttribute('data-sidebar', manualBefore.current)
      manualBefore.current = null
      root.removeAttribute('data-layout-tier')
    }
  }, [state])

  const enter = useCallback((tier: LayoutTier) => {
    if (tier === 'standard') return
    setState(tier)
  }, [])
  const exit = useCallback(() => setState('standard'), [])
  const toggle = useCallback((tier: LayoutTier) => {
    setState((s) => (s === 'standard' ? tier : 'standard'))
  }, [])

  return { state, enter, exit, toggle }
}

/** 自动请求（供规则表驱动的页面进入逻辑使用；锁定时忽略）。 */
export function requestAutoFocus(focus: FocusMode, id: string | null | undefined, tier: LayoutTier): void {
  if (layoutLocked) return
  if (tier === 'standard') focus.exit()
  else focus.enter(tier)
}
''')
print("HOOK_WRITTEN=True")
