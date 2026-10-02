"""T39 收尾 2：接线收进 hook（App 只留一次调用）+ 修接口守卫作用域。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
R = os.path.join(ROOT, "src", "renderer", "src")

# ① 新增 useShellLayout：把 useSidebarToggle + useFocusMode + 规则表自动专注 合并成一次调用
open(os.path.join(R, "hooks", "useShellLayout.ts"), "w", encoding="utf-8", newline="\n").write('''import { useEffect } from 'react'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import { layoutFor } from '../layout-rules'
import { useFocusMode, requestAutoFocus } from './useFocusMode'
import { useSidebarToggle } from './useSidebarToggle'

/**
 * 布局编排（把"手动开关 + 扩展能力 + 规则表自动专注"合并成**一次**调用）。
 *
 * 存在理由（docs/CODE-LAYOUT.md + AI_RULES 25）：`App.tsx` 只应做编排，且**不得增长**
 * —— 相关 effect 与状态一律落在 hooks 里，App 只保留一行调用。
 * 对外只暴露布局壳真正需要的东西：`{ sidebarCollapsed, toggleSidebar }`。
 */
export function useShellLayout(
  tab: string,
  statuses: DiagnosticsSnapshot['webtools']['statuses']
): { sidebarCollapsed: boolean; toggleSidebar: () => void } {
  const { collapsed, toggle } = useSidebarToggle(statuses)
  const focus = useFocusMode()

  // 规则表驱动的自动专注：进入"直播中控"等声明的页面时扩展；离开时还原。
  // 锁定时忽略（见 useFocusMode 的 requestAutoFocus）。
  useEffect(() => {
    requestAutoFocus(focus, layoutFor(tab === 'obs' ? 'obs-stream' : null))
  }, [tab, focus])

  return { sidebarCollapsed: collapsed, toggleSidebar: toggle }
}
''')
print("SHELL_LAYOUT_WRITTEN=True")

# ② App：三行接线 → 一行调用
p = os.path.join(R, "App.tsx")
t = open(p, encoding="utf-8").read()
old = """  // T38：DOCK 常驻「菜单」开关（所有页面可用）；有原生视图时布局瞬时切换
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarToggle(snap?.webtools.statuses ?? [])
  // T39：布局扩展能力（规则表驱动；进入直播中控等页面时自动扩展，锁定时忽略）
  const focus = useFocusMode()
  useEffect(() => {
    requestAutoFocus(focus, layoutFor(tab === 'obs' ? 'obs-stream' : null))
  }, [tab, focus])"""
new = """  // T38/T39：布局编排（手动菜单开关 + 规则表驱动的自动扩展）—— 全部落在 hooks，
  // App 只保留这一次调用（AI_RULES 25：App.tsx 不得增长）。
  const { sidebarCollapsed, toggleSidebar } = useShellLayout(tab, snap?.webtools.statuses ?? [])"""
assert old in t
t = t.replace(old, new, 1)
t = t.replace(
    "import { useSidebarToggle } from './hooks/useSidebarToggle'\nimport { requestAutoFocus, useFocusMode } from './hooks/useFocusMode'\nimport { layoutFor } from './layout-rules'",
    "import { useShellLayout } from './hooks/useShellLayout'",
    1,
)
open(p, "w", encoding="utf-8", newline="\n").write(t)
print("APP_SLIM=" + str("useShellLayout(tab" in t))

# ③ 修守卫：只在 useFocusMode 函数体内取 return
p = os.path.join(ROOT, "tests", "unit", "focus-mode.spec.ts")
g = open(p, encoding="utf-8").read()
g = g.replace(
    "    const m = /return\\s*\\{\\s*([^}]*)\\}/.exec(src)",
    "    // 只取 useFocusMode 函数体（文件里还有 useLayoutLock 的 return，不能抓第一个）\n"
    "    const body = /export function useFocusMode[\\s\\S]*?\\n\\}/.exec(src)\n"
    "    expect(body, '未找到 useFocusMode 函数体').toBeTruthy()\n"
    "    const m = /return\\s*\\{\\s*([^}]*)\\}/.exec(body![0])",
)
open(p, "w", encoding="utf-8", newline="\n").write(g)
print("GUARD_FIXED=" + str("useFocusMode 函数体" in g))
