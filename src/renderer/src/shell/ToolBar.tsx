import type { ChangelogSnapshot } from '@shared/changelog'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import { Toast } from '../ui'
import { WhatsNewDialog } from '../changelog'
import type { Tab } from '../app-tables'

/**
 * 底部工具条 + 升级弹窗 + Toast（自 App.tsx 拆出；**纯 JSX 搬运**，结构与分支顺序未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 的 D 方案（布局壳拆分）第 ③ 步。
 * 红线遵守：不含任何 hook/状态/副作用；工具条仍"仅在有打开的工具时出现"（`openTools.length > 0`），
 * chip 的 data-testid、点击切回工具视图、关闭按钮阻止冒泡等行为与拆分前逐字一致。
 */
export interface ToolBarProps {
  /** 已打开的网页工具（空数组 ⇒ 不渲染工具条，与拆分前一致）。 */
  openTools: NonNullable<DiagnosticsSnapshot['webtools']>['statuses']
  tab: Tab
  setTab: (t: Tab) => void
  run: (label: string, action: () => Promise<{ ok: boolean; errors: string[] }>, key?: string) => Promise<void>
  changelog: ChangelogSnapshot | null
  whatsNew: boolean
  setWhatsNew: (v: boolean) => void
  message: string
  /** T38 补充：DOCK 上的「菜单」控件按钮 —— 所有页面常驻可用。 */
  onToggleSidebar: () => void
  sidebarCollapsed: boolean
  /** Dock 是否常驻（false = 自动隐藏，可由底边唤出）。 */
  dockPinned: boolean
  onToggleDockPinned: () => void
  onRevealDock: () => void
  /** T43：布局锁定（不自动隐藏 / 不参与回缩动画 / 位置固定）。 */
  layoutLocked: boolean
  onToggleLocked: () => void
}

export function ToolBar({
  openTools,
  tab,
  setTab,
  run,
  changelog,
  whatsNew,
  setWhatsNew,
  message,
  onToggleSidebar,
  sidebarCollapsed,
  dockPinned,
  onToggleDockPinned,
  onRevealDock,
  layoutLocked,
  onToggleLocked
}: ToolBarProps): React.JSX.Element {
  return (
    <>
      <footer className="tool-bar">
        <div className="dock">
          {/* 左端：菜单（侧栏的"来处与去处"锚点 —— 用户要求「否则菜单将无法做到从哪来回哪去」） */}
          <div className="dock-left">
            <button
              type="button"
              className="dock-item dock-side-toggle"
              data-testid="dock-sidebar-toggle"
              aria-label={sidebarCollapsed ? '展开侧栏菜单' : '收起侧栏菜单'}
              aria-pressed={sidebarCollapsed}
              title={sidebarCollapsed ? '展开侧栏菜单' : '收起侧栏菜单'}
              onClick={onToggleSidebar}
            >
              <span className="dock-item-icon" aria-hidden="true">
                ☰
              </span>
              <span className="dock-item-label">菜单</span>
            </button>
          </div>

          {/* 中间：工具图标组（真正居中；图标 = 首字缩写，无需图标库；名称常显） */}
          <div className="dock-center">
            {openTools.map((t) => (
              <span
                key={t.moduleId}
                className={tab === `tool:${t.moduleId}` ? 'dock-item tool-chip active' : 'dock-item tool-chip'}
                data-testid={`tool-chip-${t.moduleId}`}
                title={t.moduleId}
                role="button"
                tabIndex={0}
                aria-label={t.moduleId}
                aria-pressed={tab === `tool:${t.moduleId}`}
                onClick={() => setTab(`tool:${t.moduleId}`)}
                onKeyDown={(e) => {
                  // T48：chip 是 span，补键盘可达性（Enter/Space 激活；焦点环走 .dock-item:focus-visible）
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setTab(`tool:${t.moduleId}`)
                  }
                }}
              >
                <span className="dock-item-icon" aria-hidden="true">
                  {t.moduleId.slice(0, 1).toUpperCase()}
                </span>
                <span className="dock-item-label">{t.moduleId}</span>
                {t.state === 'open' && <span className="dock-item-running" aria-hidden="true" />}
                {/* T44：关闭改为 hover 才浮现的 ✕ 徽标（不再塞一个文字按钮进图标块）。
                    保留 button + aria-label="关闭" 与 .tool-chip button 结构 ⇒ 集成用例语义不变。 */}
                <span className="dock-close">
                  <button
                    type="button"
                    className="dock-close-btn"
                    aria-label="关闭"
                    title={`关闭 ${t.moduleId}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      // 关闭的是当前 tool 视图时切回默认页（避免 ToolSlot 残留并重开）
                      if (tab === `tool:${t.moduleId}`) setTab('diagnostics')
                      void run(`关闭 ${t.moduleId}`, () => window.eclipselive.closeWebTool(t.moduleId))
                    }}
                  >
                    ✕
                  </button>
                </span>
              </span>
            ))}
          </div>

          {/* 右端：常驻开关 + 状态区（macOS Dock 特性：自动隐藏 / 为打开的 App 显示指示灯） */}
          <div className="dock-right">
            <button
              type="button"
              className="dock-item dock-pin"
              data-testid="dock-pin"
              aria-label={dockPinned ? '设为自动隐藏' : '设为常驻显示'}
              aria-pressed={dockPinned}
              title={dockPinned ? '设为自动隐藏' : '设为常驻显示'}
              onClick={onToggleDockPinned}
            >
              <span className="dock-item-icon" aria-hidden="true">
                {dockPinned ? '📌' : '⌄'}
              </span>
              <span className="dock-item-label">{dockPinned ? '常驻' : '自动隐藏'}</span>
            </button>

            {/* T43 锁定（Q2=A）：不自动隐藏 / 不参与回缩动画 / 位置固定 */}
            <button
              type="button"
              className="dock-item dock-lock"
              data-testid="dock-lock"
              aria-label={layoutLocked ? '解除锁定' : '锁定布局'}
              aria-pressed={layoutLocked}
              title={layoutLocked ? '解除锁定' : '锁定布局（不自动隐藏、不参与回缩动画、位置固定）'}
              onClick={onToggleLocked}
            >
              <span className="dock-item-icon" aria-hidden="true">
                {layoutLocked ? '🔒' : '🔓'}
              </span>
              <span className="dock-item-label">{layoutLocked ? '已锁定' : '锁定'}</span>
            </button>
          </div>
        </div>

      </footer>

      {/* 底边唤出热区：自动隐藏时指针到达窗口底边即唤出（macOS 行为） */}
      <div className="dock-hotzone" onPointerEnter={onRevealDock} aria-hidden="true" />

          {/* T34 升级后首次启动弹一次；关闭即记录"当前版本已读"（下次不再弹） */}
          {whatsNew &&
      changelog &&
      // 迁移第 4 步：**当前版本在 RELEASE_NOTES.md 里没有段就不弹窗**（避免弹空窗）
      changelog.releases.some((r) => r.version === changelog.current) ? (
            <WhatsNewDialog
              snapshot={changelog}
              onClose={() => {
                setWhatsNew(false)
                void window.eclipselive.changelogSeen().catch(() => {})
              }}
            />
          ) : null}

          <Toast text={message || null} />
    </>
  )
}
