import { useEffect, useState } from 'react'
import { Btn } from '../ui'

/**
 * T43 增量 2：内置「迷你中控」悬浮窗内容（用户要求：悬浮窗控制，支持置顶、透明、穿透，
 * 与打字机 / VTS 悬浮窗隔离）。
 *
 * 它运行在 `core/overlay-windows` 创建的**独立置顶透明窗口**里（`isOverlayWindow` 标记），
 * 通过新增通道 `overlay:mini:*` 读写自身窗口状态（置顶 / 穿透 / 关闭）。
 * 透明背景 + `-webkit-app-region: drag` 拖动（与模块悬浮窗同一套窗口原语）。
 *
 * 本轮范围（增量 2 第一步）：**窗口能力 + 状态呈现**（置顶 / 穿透 / 关闭）。
 * 场景切换与开播停机沿用既有 `obs:*` 数据源，作为下一步增量（避免与直播中控页重复实现）。
 */
export function MiniControl(): React.JSX.Element {
  const [clickThrough, setClickThrough] = useState(false)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    void window.eclipselive
      .overlayMiniState()
      .then((s) => {
        setOpen(s.open)
        setClickThrough(s.clickThrough)
      })
      .catch(() => {})
  }, [])

  const toggleClickThrough = (): void => {
    const next = !clickThrough
    setClickThrough(next)
    void window.eclipselive.overlayMiniSet({ clickThrough: next })
  }

  const close = (): void => {
    void window.eclipselive.overlayMiniClose().then(() => setOpen(false))
  }

  if (!open) {
    return <div className="mini-body" data-testid="mini-closed" />
  }

  return (
    <div className="mini-body" data-testid="mini-control">
      <header className="mini-head">
        <span className="mini-dot" aria-hidden="true" />
        <span className="mini-title">迷你中控</span>
        <button className="mini-x" data-testid="mini-close" onClick={close} aria-label="关闭">
          ✕
        </button>
      </header>
      <div className="mini-actions">
        <Btn
          variant={clickThrough ? 'primary' : undefined}
          data-testid="mini-click-through"
          onClick={toggleClickThrough}
        >
          {clickThrough ? '穿透中' : '穿透'}
        </Btn>
        <span className="mini-hint">置顶 + 透明（在直播中控页可再次打开）</span>
      </div>
    </div>
  )
}

