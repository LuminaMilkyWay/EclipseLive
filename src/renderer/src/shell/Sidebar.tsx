import { APP_NAME, formatAppVersion, type AppInfo } from '@shared/appInfo'
import iconUrl from '../assets/icon.ico'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import { Badge } from '../ui'
import { isPageTab } from '../app-tables'
import type { Tab } from '../app-tables'

/**
 * 左侧导航面板（自 App.tsx 拆出；**纯 JSX 搬运**，逻辑与结构未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 的 D 方案（布局壳拆分）第 ① 步。
 * 红线遵守：本组件**不含任何 hook、状态或副作用**，全部通过 props 取用
 *（`sideNavRef` 由 App 创建后透传，保证"点击面板外收起"的行为不变；
 * 模块二级下拉的展开/收起状态与定时器仍由 App 持有，行为与拆分前完全一致）。
 */
export interface SidebarProps {
  info: AppInfo | null
  snap: DiagnosticsSnapshot | null
  tab: Tab
  setTab: (t: Tab) => void
  extOpen: boolean
  extClosing: boolean
  toggleExt: () => void
  /** App 持有的侧栏节点 ref（用于"点击面板外自动收起"）。 */
  sideNavRef: { current: HTMLDivElement | null }
}

export function Sidebar({
  info,
  snap,
  tab,
  setTab,
  extOpen,
  extClosing,
  toggleExt,
  sideNavRef
}: SidebarProps): React.JSX.Element {
  return (
    <>
{/* T19 左 1/4 导航区：品牌纵排 + 功能分组导航 + 底部消息 */}
          <aside className="side">
        {/* T45：动效内层 —— 位移动画只作用于这一层（它没有玻璃/折射），
            玻璃层本体不做 transform，避免折射坐标空间随元素移动导致底图"游动"。 */}
        <div className="side-inner">
            <div className="brand">
              {/* 产品图标（用户要求：主界面产品名旁） */}
              <img className="brand-icon" src={iconUrl} alt="" aria-hidden="true" />
              <span className="brand-name">{APP_NAME}</span>
              <span className="brand-version">{info ? formatAppVersion(info.version) : '…'}</span>
            </div>

            <nav className="side-nav">
              {/* 菜单第一个功能项：直播中控（内置功能页，非模块） */}
              <div className="nav-group">
                <span className="nav-group-label">直播</span>
                <button
                  data-testid="tab-obs"
                  className={tab === 'obs' ? 'nav-item active' : 'nav-item'}
                  onClick={() => setTab('obs')}
                >
                  直播中控
                </button>
              </div>
              {/* C3：声明 nav.level=1 的模块 → 作为**一级菜单项**（点击仍走既有 page: tab）。
                  未声明 nav 的模块不受影响，仍在下面的「模块」下拉里。 */}
              {(snap?.modules ?? [])
                .filter((m) => m.page && m.nav?.level === 1)
                .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))
                .map((m) => (
                  <button
                    key={m.id}
                    data-testid={`page-nav-top-${m.id}`}
                    className={tab === (`page:${m.id}` as Tab) ? 'nav-item active' : 'nav-item'}
                    onClick={() => setTab(`page:${m.id}` as Tab)}
                  >
                    {m.name ?? m.id}
                  </button>
                ))}
              <div className="nav-group" ref={sideNavRef}>
                <span className="nav-group-label">扩展</span>
                {/* 模块二级下拉：点击展开/收起，列出全部已发现模块（智能路由） */}
                <button
                  data-testid="tab-modules"
                  className={extOpen || isPageTab(tab) ? 'nav-item active' : 'nav-item'}
                  onClick={toggleExt}
                >
                  模块
                </button>
                {extOpen && (
                  <div className="nav-dropdown" data-closing={extClosing ? 'true' : undefined}>
                    {(snap?.modules ?? []).length === 0 && (
                      <p className="nav-dropdown-error">暂无模块</p>
                    )}
                    {(snap?.modules ?? []).filter((m) => m.nav?.level !== 1).map((m) => {
                      // 页面模块 → 打开模块页；pinned 声明式工具 → openWebTool；
                      // 普通业务模块 → 跳转设置页「模块」管理分区。
                      if (m.page) {
                        return (
                          <button
                            key={m.id}
                            data-testid={`page-nav-${m.id}`}
                            className={
                              tab === (`page:${m.id}` as Tab)
                                ? 'nav-item nav-dropdown-item active'
                                : 'nav-item nav-dropdown-item'
                            }
                            onClick={() => setTab(`page:${m.id}`)}
                          >
                            <span className="nav-dropdown-label">{m.name ?? m.id}</span>
                            <Badge variant={m.status}>{m.status}</Badge>
                          </button>
                        )
                      }
                      if (m.web && m.pinned) {
                        return (
                          <button
                            key={m.id}
                            data-testid={`tool-nav-${m.id}`}
                            className={
                              tab === (`tool:${m.id}` as Tab)
                                ? 'nav-item nav-dropdown-item active'
                                : 'nav-item nav-dropdown-item'
                            }
                            onClick={() => setTab(`tool:${m.id}`)}
                          >
                            <span className="nav-dropdown-label">{m.name ?? m.id}</span>
                            <Badge variant={m.status}>{m.status}</Badge>
                          </button>
                        )
                      }
                      return (
                        <button
                          key={m.id}
                          data-testid={`module-nav-${m.id}`}
                          className="nav-item nav-dropdown-item"
                          onClick={() => setTab('settings')}
                          title="前往设置 · 模块管理"
                        >
                          <span className="nav-dropdown-label">{m.name ?? m.id}</span>
                          <Badge variant={m.status}>{m.status}</Badge>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="nav-group">
                <span className="nav-group-label">偏好</span>
                <button
                  data-testid="tab-settings"
                  className={tab === 'settings' ? 'nav-item active' : 'nav-item'}
                  onClick={() => setTab('settings')}
                >
                  设置
                </button>
              </div>
              <div className="nav-group">
                <span className="nav-group-label">监控</span>
                <button
                  className={tab === 'diagnostics' ? 'nav-item active' : 'nav-item'}
                  onClick={() => setTab('diagnostics')}
                >
                  诊断
                </button>
              </div>
              <div className="nav-group">
                <span className="nav-group-label">关于</span>
                <button
                  data-testid="tab-changelog"
                  className={tab === 'changelog' ? 'nav-item active' : 'nav-item'}
                  onClick={() => setTab('changelog')}
                >
                  更新日志
                </button>
              </div>
            </nav>

            </div>
      </aside>
    </>
  )
}
