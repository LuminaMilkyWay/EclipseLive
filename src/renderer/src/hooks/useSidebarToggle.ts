import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'

/**
 * 侧栏展开/收起（T38 补充：**所有页面**都能在 DOCK 上手动切换）。
 *
 * T44 修正（用户反馈"菜单展开和收起没动画"）：此前本 hook **自己持有一份状态**（从 `false` 起步），
 * 而专注态由 `useFocusMode` 直接把侧栏收起（写属性）⇒ 两份状态不同步 ⇒ 点「菜单」时
 * 内部状态翻转但**视觉状态没变** ⇒ 看起来"没有动画"（探针实测：点击前后 `data-sidebar` 恒为 collapsed）。
 *
 * 现在改为**受控**：`collapsed` 由调用方（`useShellLayout`，单真源）传入，本 hook 只负责
 * 写根属性与原生视图标记，并回传手动切换意图。
 */
export function useSidebarToggle(
  statuses: DiagnosticsSnapshot['webtools']['statuses'],
  collapsed: boolean,
  onToggle: () => void
): { toggle: () => void } {
  const hasNativeView = statuses.some((s) => s.state === 'open')

  useEffect(() => {
    const root = document.documentElement
    if (collapsed) root.setAttribute('data-sidebar', 'collapsed')
    else root.removeAttribute('data-sidebar')
  }, [collapsed])

  useEffect(() => {
    const root = document.documentElement
    if (hasNativeView) root.setAttribute('data-native-view', '1')
    else root.removeAttribute('data-native-view')
  }, [hasNativeView])

  const toggle = useCallback(() => onToggle(), [onToggle])
  return { toggle }
}

/** 手动覆盖状态（null = 尚未手动切换过 ⇒ 由专注态决定）。 */
export function useManualSidebar(): {
  manual: boolean | null
  setManual: (v: boolean | null) => void
} {
  const [manual, setManual] = useState<boolean | null>(null)
  const ref = useRef(manual)
  ref.current = manual
  return { manual, setManual }
}
