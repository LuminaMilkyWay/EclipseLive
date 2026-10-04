import { useCallback, useEffect, useRef, useState } from 'react'
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
    // 专注态：侧栏改为**覆盖层**（浮在面板之上，展开时不再挤回布局）
    root.setAttribute('data-focus', '1')
    return () => {
      if (manualBefore.current === null) root.removeAttribute('data-sidebar')
      else root.setAttribute('data-sidebar', manualBefore.current)
      manualBefore.current = null
      root.removeAttribute('data-layout-tier')
      root.removeAttribute('data-focus')
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

/**
 * 锁定状态读取（T43：锁定 = ① 不自动隐藏 ② 不参与回缩动画 ③ 位置固定）。
 * 语义落点：锁定时**自动**请求被忽略（用户手动仍可切换）；同时把状态写到根属性，
 * 供 CSS 关闭该层动画（"不参与动画"的机械表达）。
 */
export function isLayoutLocked(): boolean {
  return layoutLocked
}

/** 自动请求（供规则表驱动的页面进入逻辑使用；锁定时忽略）。 */
export function requestAutoFocus(focus: FocusMode, tier: LayoutTier): void {
  if (layoutLocked) return
  if (tier === 'standard') focus.exit()
  else focus.enter(tier)
}
