"""T38 补充：DOCK 常驻「菜单」控件按钮（所有页面可用）+ 原生视图存在时瞬时切换。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CSS = os.path.join(ROOT, "src", "renderer", "src", "renderer.css")
HOOK = os.path.join(ROOT, "src", "renderer", "src", "hooks", "useSidebarToggle.ts")

# ---------- ① 新 hook：侧栏收起状态 + 根属性 + 原生视图探测 ----------
hook = '''import { useCallback, useEffect, useState } from 'react'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'

/**
 * 侧栏收起/展开（T38 补充：**所有页面**都能在 DOCK 上手动切换 —— 包括不需要自动回缩的页面）。
 *
 * 设计要点（docs/UI-OBS-FOCUS-MODE-ASSESSMENT.md §9.2/§9.3）：
 * - 状态写在**根属性**上（`data-sidebar='collapsed'`）⇒ CSS 负责列宽与 gap，组件不碰布局；
 * - 同时写 `data-native-view`（当前是否有已打开的原生视图）⇒ CSS 据此**关闭过渡**：
 *   有原生视图时布局必须**瞬时切换**，否则嵌入页面会逐帧 reflow（最贵的一步）；
 * - 本 hook 只做"手动开关"，T39 的 `useFocusMode`（自动回驻 + 三档宽度 + 锁定）在其上叠加，
 *   两者**共用同一组根属性**，不引入第二套状态。
 */
export function useSidebarToggle(statuses: DiagnosticsSnapshot['webtools']['statuses']): {
  collapsed: boolean
  toggle: () => void
} {
  const [collapsed, setCollapsed] = useState(false)
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

  const toggle = useCallback(() => setCollapsed((v) => !v), [])
  return { collapsed, toggle }
}
'''
os.makedirs(os.path.dirname(HOOK), exist_ok=True)
open(HOOK, "w", encoding="utf-8", newline="\n").write(hook)
print("HOOK_WRITTEN=True")

# ---------- ② CSS：根属性驱动的布局 + 过渡（有原生视图时瞬时） ----------
css = open(CSS, encoding="utf-8").read()
ADD = """

/* ==========================================================================
 * T38 补充：DOCK 上的「菜单」控件按钮 —— **所有页面常驻可用**
 * 用户口径：「不需要回缩的页面，也还是在 DOCK 上补充一个菜单的控件按钮」。
 *
 * 机制：
 *   · 根属性 `data-sidebar='collapsed'` 驱动布局（列宽 + gap 同时变），组件不碰布局；
 *   · 根属性 `data-native-view='1'`（存在已打开的原生视图）时**关闭过渡** ⇒ 瞬时切换 ⇒
 *     嵌入页面只 reflow 一次（否则逐帧 reflow，正是 §9.2 要规避的最贵路径）；
 *   · 无原生视图的页面则**带动画**（侧栏从右上向左下收进任务栏的观感在 T39 完整化）。
 * ========================================================================== */
.shell {
  transition:
    grid-template-columns var(--duration-normal) var(--ease-decelerate),
    column-gap var(--duration-normal) var(--ease-decelerate);
}

[data-native-view='1'] .shell {
  transition: none; /* 有原生视图：瞬时切换，避免逐帧 reflow */
}

:root[data-sidebar='collapsed'] .shell {
  grid-template-columns: 0 minmax(0, 1fr);
  column-gap: 0;
}

:root[data-sidebar='collapsed'] .side {
  /* 收起：不占位（T39 会补上"从右上锚点向左下收拢"的完整动画） */
  opacity: 0;
  pointer-events: none;
}
"""
if "data-sidebar='collapsed'" not in css:
    css = css.rstrip("\n") + ADD
open(CSS, "w", encoding="utf-8", newline="\n").write(css)
print("CSS_ADDED=" + str("data-sidebar='collapsed'" in css))
