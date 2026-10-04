/**
 * ToolSlot（自 App.tsx 拆出；纯搬运，逻辑与语句顺序未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md。
 * 原 App.tsx 行号：486-553。
 */
import { useEffect, useRef, useState } from 'react'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import { EmptyState } from '../ui'
import { computeSlotReport, createSettledReporter } from './report-rect'

export const TOOL_SLOT_PAD = 12 // = 壳 padding var(--sp-3)，与 renderer.css .tool-slot 保持一致

export function ToolSlot({
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

  useEffect(() => {
    const el = hostRef.current
    let disposed = false
    // 上报几何：纯逻辑在 slots/report-rect（**动画中跳过 + 夹取到窗口可视区**）。
    // 回归背景：工具槽在档 4 入场动画（缩放）期间上报过 x677 w1846 的包围盒 —— 比窗口还大，
    // 视图被画到窗口外盖住一切（见 report-rect.ts 头注释与 tests/unit/slot-rect-report.spec.ts）。
    const report = (): boolean => {
      const r = el?.getBoundingClientRect()
      if (!el || !r) return false
      const out = computeSlotReport({
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        offsetWidth: el.offsetWidth,
        offsetHeight: el.offsetHeight,
        pad: TOOL_SLOT_PAD,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      })
      if (!out) return false // 动画进行中（或尺寸非法）⇒ 等动画结束/落定信号的补报
      void window.eclipselive.reportModulePageRect(moduleId, out)
      return true
    }
    // T47：落定补报必须"重试到一致为止"（理由同 ModulePageHost）。
    const settled = createSettledReporter(report)
    // 动画结束补报：入场/退场动画（档 4 materialize）结束后 transform 归位，此时再报一次才是最终几何。
    const onAnimEnd = (): void => {
      report()
    }
    // 进入：隐藏其它 open 视图（互斥，最后激活者赢）
    for (const s of statusesRef.current) {
      if (s.state === 'open' && s.moduleId !== moduleId) {
        void window.eclipselive.setModulePageVisible(s.moduleId, false)
      }
    }
    void window.eclipselive.openWebTool(moduleId).then((r) => {
      if (disposed) {
        // 卸载后 open 才完成：保活（已 open）但保持隐藏，不泄漏显示。
        if (r.ok) void window.eclipselive.setModulePageVisible(moduleId, false)
        return
      }
      if (!r.ok) {
        setFailure(r.errors.join('；'))
        return
      }
      void window.eclipselive.setModulePageVisible(moduleId, true)
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
      // 卸载：**只隐藏自身**。理由同 ModulePageHost：此前"恢复其它 open 视图"会把
      // 模块页/工具页重新显示出来，盖住设置页等非模块页（用户实测反馈）。
      // 回到某个工具只需点底部工具条的 chip（会重新进 tool:<id> 页签）。
      void window.eclipselive.setModulePageVisible(moduleId, false)
    }
  }, [moduleId])

  return (
    <div className="tool-slot" data-testid="tool-slot" ref={hostRef}>
      {failure === null ? (
        <p className="dim module-page-note">网页工具（嵌入视图加载中）</p>
      ) : (
        <EmptyState text={`网页工具打开失败：${failure}`} />
      )}
    </div>
  )
}
