/**
 * ModulePageHost（自 App.tsx 拆出；纯搬运，逻辑与语句顺序未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md。
 * 原 App.tsx 行号：484-564。
 */
import { useEffect, useRef, useState } from 'react'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import { collectUiTokens } from '../ui-tokens'
import { EmptyState } from '../ui'
import { computeSlotReport, createSettledReporter } from './report-rect'

export function ModulePageHost({
  moduleId,
  statuses
}: {
  moduleId: string
  statuses: DiagnosticsSnapshot['webtools']['statuses']
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses
  const [failure, setFailure] = useState<string | null>(null)
  // T33: 打开成功后隐藏「加载中」占位（页面自身透明，占位会透出），并首推 UI 令牌。
  const [opened, setOpened] = useState(false)

  useEffect(() => {
    const el = hostRef.current
    let disposed = false
    // 同 ToolSlot：纯逻辑在 slots/report-rect（动画中跳过 + 夹取到窗口可视区；模块页槽 pad=0）。
    const report = (): boolean => {
      const r = el?.getBoundingClientRect()
      if (!el || !r) return false
      const out = computeSlotReport({
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        offsetWidth: el.offsetWidth,
        offsetHeight: el.offsetHeight,
        pad: 0,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      })
      if (!out) return false
      void window.eclipselive.reportModulePageRect(moduleId, out)
      return true
    }
    // T47：落定补报必须"重试到一致为止"——单次补报撞上尾帧动画会被一致性检查吞掉，
    // 之后没人再报 ⇒ 视图停在专注态宽矩形（用户实测事故）。
    const settled = createSettledReporter(report)
    const onAnimEnd = (): void => {
      report()
    }
    // 进入：隐藏其它 open 视图（互斥），打开并显示自身，成功后对齐几何。
    for (const s of statusesRef.current) {
      if (s.state === 'open' && s.moduleId !== moduleId) {
        void window.eclipselive.setModulePageVisible(s.moduleId, false)
      }
    }
    void window.eclipselive.openWebTool(moduleId).then((r) => {
      if (disposed) {
        // 切走后 open 才完成：保活（已 open）但保持隐藏，不泄漏显示。
        if (r.ok) void window.eclipselive.setModulePageVisible(moduleId, false)
        return
      }
      if (!r.ok) {
        setFailure(r.errors.join('；'))
        return
      }
      setOpened(true)
      void window.eclipselive.setModulePageVisible(moduleId, true)
      void window.eclipselive.setModulePageUiTokens(moduleId, collectUiTokens())
      report()
    })
    const ro = el ? new ResizeObserver(report) : null
    el && ro?.observe(el)
    window.addEventListener('resize', report)
    // ⚠️ 事故修复（用户报障：从「直播中控」切到打字机/网页工具后视图仍停在**专注态的宽矩形**
    // ⇒ 越出内容区、盖住侧栏与菜单，嵌入页面按错误宽度排版 =「文字与控件位置不正确」；
    // 同时表现为"一个突出的视图盖住一切 + 一个正常大小的视图叠在上面"）。
    // 成因：槽位只监听**自身**的 animationend/transitionend，而从专注态切回普通页时
    // 变化发生在**根属性与栅格**上、槽位自身无动画 ⇒ 没有任何重报 ⇒ 视图停在旧宽矩形。
    // useShellLayout 会在布局落定后广播 `el:layout-settled`，这里订阅它做**强制补报**。
    window.addEventListener('el:layout-settled', settled.poke)
    el?.addEventListener('animationend', onAnimEnd)
    el?.addEventListener('transitionend', onAnimEnd)
    return () => {
      disposed = true
      settled.cancel()
      ro?.disconnect()
      window.removeEventListener('resize', report)
      window.removeEventListener('el:layout-settled', settled.poke)
      el?.removeEventListener('animationend', onAnimEnd)
      el?.removeEventListener('transitionend', onAnimEnd)
      // 卸载：**只隐藏自身**（保活不 close）。
      // ⚠️ 曾经在这里"恢复其它 open 视图显示"（T11 chip 遗留行为）——那是错的：
      // 切到「设置」这类非模块页时会把已打开的工具视图重新显示出来，**盖住设置页的功能菜单**
      // （用户实测反馈）。可见性的唯一真源是"当前页签"：谁被激活，谁的宿主挂载时就显示自己；
      // 底部工具条的 chip 点击会重新进 tool:<id> 页签，因此不需要任何人替它恢复。
      void window.eclipselive.setModulePageVisible(moduleId, false)
    }
  }, [moduleId])

  return (
    <div className="module-page-host" data-testid="module-page-host" ref={hostRef}>
      {failure !== null ? (
        <EmptyState text={`模块页面打开失败：${failure}`} />
      ) : !opened ? (
        <p className="dim module-page-note">模块页面（本地内容 · 嵌入视图加载中）</p>
      ) : null}
    </div>
  )
}

/**
 * 第三方工具槽位（laplacelive-link 等 web 工具遵循本体 UI 规范）：打开即 openWebTool
 * （幂等保活）；ResizeObserver + resize 实时上报**壳内容盒**矩形（比壳内缩一圈 →
 * WebContentsView 四角外露出圆角玻璃边，侧栏不再被全幅覆盖）；互斥同 ModulePageHost
 * （最后激活者赢），卸载隐藏自身并恢复其它 open 视图。
 */
