import { useEffect, useState } from 'react'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import { resolveTier } from '../layout-rules'
import { isPageTab, pageTabModuleId, type Tab } from '../app-tables'
import { useFocusMode, requestAutoFocus, useLayoutLock } from './useFocusMode'
import { useSidebarToggle } from './useSidebarToggle'
import { useDockBar } from './useDockBar'

/**
 * 布局编排（T38/T39/T44）：手动开关 + 扩展能力 + 规则表自动专注 + DOCK 行为，合并成**一次**调用。
 *
 * **侧栏状态唯一真源**（T44 修正的关键）：
 *   collapsed = 手动覆盖（用户点过「菜单」）?? 专注态默认（进入专注布局时收起）
 * ⇒ 专注态与手动操作不再各持一份状态，因此点「菜单」**必定改变状态**、必定有过渡动画。
 * 退出专注后清掉手动覆盖，回到默认。
 */
export function useShellLayout(
  tab: string,
  statuses: DiagnosticsSnapshot['webtools']['statuses'],
  /** C3：模块页的 nav 声明来自快照（App 已有该数据，传引用不新增状态）。 */
  snap: DiagnosticsSnapshot | null = null
): {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  dockPinned: boolean
  toggleDockPinned: () => void
  revealDock: () => void
  locked: boolean
  toggleLocked: () => void
} {
  const focus = useFocusMode()
  const dock = useDockBar()
  const lock = useLayoutLock()
  /** null = 未手动切换过；true/false = 用户显式选择。 */
  const [manual, setManual] = useState<boolean | null>(null)

  // 规则表驱动的自动专注（锁定时忽略）。**切到非专注页 ⇒ 自动回缩回正常布局**（用户规格）。
  useEffect(() => {
    // C3：模块页用 page:<id> 解析出模块 id ⇒ 读它的 nav.immersive（未声明 ⇒ standard，绝不误全屏）。
    const pageModuleId = isPageTab(tab as Tab) ? pageTabModuleId(tab as Tab) : null
    const immersive = snap?.modules.find((m) => m.id === pageModuleId)?.nav?.immersive
    const tier = resolveTier(tab === 'obs' ? 'obs-stream' : pageModuleId, immersive)
    // 只在**专注状态真的要变化**时打标记：普通切页不涉及布局动画，打标记会白白抑制上报
    // （抑制又没补报 ⇒ 视图回落整窗自适应 ⇒ 盖住所有面板）。
    if ((tier === 'standard') !== (focus.state === 'standard')) markLayoutAnimating()
    requestAutoFocus(focus, tier)
  }, [tab, focus])

  // 退出专注时清掉手动覆盖（回到"由专注态决定"）
  useEffect(() => {
    if (focus.state === 'standard') setManual(null)
  }, [focus.state])

  const focusCollapsed = focus.state !== 'standard'
  const collapsed = manual ?? focusCollapsed

  /**
   * 布局过渡标记（T46 根治几何抖动）：
   * 之前用 `useEffect(..., [collapsed])` 写 `data-layout-anim` ⇒ **晚一帧**才生效，
   * 而布局在同一次渲染里就开始过渡 ⇒ 存在一个"正在过渡但没被标记"的窗口，
   * 槽位在窗口内上报中间态矩形（实测把嵌入视图放到 x=0，概率性失败）。
   * 现在在**调用 setState 之前同步写入**，并在过渡时长后清除（用令牌计算，不写魔数）。
   */
  const markLayoutAnimating = (): void => {
    const root = document.documentElement
    root.setAttribute('data-layout-anim', '1')
    const panel = getComputedStyle(root).getPropertyValue('--duration-panel').trim() || '320ms'
    const delay = getComputedStyle(root).getPropertyValue('--duration-collapse-delay').trim() || '200ms'
    const toMs = (v: string): number => (v.endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000)
    window.setTimeout(() => {
      root.removeAttribute('data-layout-anim')
      // ⚠️ 关键补丁：抑制上报之后必须**广播"布局已稳定"**，否则槽位不会重新上报，
      // 宿主会一直停留在"未被槽位驱动"的状态 ⇒ 回落到整窗自适应 ⇒ **web 层盖住所有面板**。
      window.dispatchEvent(new CustomEvent('el:layout-settled'))
    }, toMs(panel) + toMs(delay) + 120)
  }

  /** T43 锁定：写入根属性 ⇒ CSS 关闭该层动画（不自动隐藏 / 不参与回缩动画 / 位置固定）。 */
  useEffect(() => {
    const root = document.documentElement
    if (lock.locked) root.setAttribute('data-layout-locked', '1')
    else root.removeAttribute('data-layout-locked')
  }, [lock.locked])

  /** 手动切换（先标记、再改状态 ⇒ 不留窗口期）。 */
  const toggle = (): void => {
    markLayoutAnimating()
    setManual(!collapsed)
  }

  const { toggle: toggleSidebar } = useSidebarToggle(statuses, collapsed, toggle)


  return {
    locked: lock.locked,
    toggleLocked: () => lock.setLocked(!lock.locked),
    sidebarCollapsed: collapsed,
    toggleSidebar,
    dockPinned: dock.pinned,
    toggleDockPinned: dock.togglePinned,
    revealDock: dock.reveal
  }
}
