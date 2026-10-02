import { useCallback, useEffect, useState } from 'react'

/**
 * DOCK 行为（T43 前置）：**常驻 / 自动隐藏 + 底边唤出**。
 *
 * 研究依据（Apple 官方 Dock 偏好项）：Dock 支持"自动隐藏与显示 Dock"，隐藏后
 * **指针移到屏幕底边即滑出**；并支持"放大"与"为打开的 App 显示指示灯"。
 * 参考实现范式："rail reveal slides in from its own edge"（neomjs/neo#18079）。
 *
 * 几何契约（红线）：本 hook **只改根属性**（`data-dock`），**不改变任务栏高度** ⇒
 * 原生视图的底部内缩值恒定不变（否则 WebContentsView 会与任务栏错位）。
 * 持久化：pin 状态目前仅内存（写入配置结构需单独批准）；UI 上提供切换按钮。
 */
export function useDockBar(): {
  pinned: boolean
  togglePinned: () => void
  reveal: () => void
  conceal: () => void
} {
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    const root = document.documentElement
    if (!pinned) root.setAttribute('data-dock', 'hidden')
    else root.setAttribute('data-dock', 'pinned')
    return () => {
      root.removeAttribute('data-dock')
    }
  }, [pinned])

  const reveal = useCallback(() => {
    document.documentElement.setAttribute('data-dock', 'pinned')
  }, [])
  const conceal = useCallback(() => {
    if (!pinned) document.documentElement.setAttribute('data-dock', 'hidden')
  }, [pinned])
  const togglePinned = useCallback(() => setPinned((v) => !v), [])

  return { pinned, togglePinned, reveal, conceal }
}
