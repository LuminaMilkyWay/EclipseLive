import type { ChangelogSnapshot } from '@shared/changelog'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import type { UiSettings } from '@shared/theme'
import { ChangelogPage } from '../changelog'
import { DiagnosticsPage } from '../diagnostics/DiagnosticsPage'
import { ModulePageHost } from '../slots/ModulePageHost'
import { ToolSlot } from '../slots/ToolSlot'
import { SettingsPage } from '../settings/SettingsPage'
import { ObsStreamPage } from '../screens/ObsStreamPage'
import { isPageTab, isToolTab, pageTabModuleId, toolTabModuleId, type Tab } from '../app-tables'
import type { PageProps } from '../page-props'

/**
 * 右侧内容区（自 App.tsx 拆出；**纯 JSX 搬运**，页签分支与槽位挂载顺序未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 的 D 方案（布局壳拆分）第 ② 步。
 * 红线遵守：**不含任何 hook/状态/副作用**；槽位组件（ModulePageHost / ToolSlot）的挂载条件、
 * key 与 props 与拆分前逐字一致 ⇒ 不改变 WebContentsView 的几何上报时机。
 */
export interface ContentAreaProps {
  tab: Tab
  snap: DiagnosticsSnapshot | null
  changelog: ChangelogSnapshot | null
  ui: UiSettings | null
  webStatuses: NonNullable<DiagnosticsSnapshot['webtools']>['statuses']
  refresh: () => void
  run: PageProps['run']
  isBusy: PageProps['isBusy']
  setMessage: (text: string) => void
  patchUi: (patch: Partial<UiSettings>) => void
  installWallpaper: () => void
  resetWallpaper: () => void
  fpsDegraded: boolean
}

export function ContentArea({
  tab,
  snap,
  changelog,
  ui,
  webStatuses,
  refresh,
  run,
  isBusy,
  setMessage,
  patchUi,
  installWallpaper,
  resetWallpaper,
  fpsDegraded
}: ContentAreaProps): React.JSX.Element {
  return (
          <section className="content">
      {/* B 方案：内层滚动容器 —— 外层只做"不滚动的玻璃外框"，场景层（底图折射/色散）挂在它上面，因此不会随内容滚动。 */}
      <div className="content-scroll">
            {tab === 'obs' ? (
          <ObsStreamPage />
        ) : isPageTab(tab) ? (
              <ModulePageHost key={tab} moduleId={pageTabModuleId(tab)} statuses={webStatuses} />
            ) : tab === 'diagnostics' ? (
              <DiagnosticsPage snap={snap} onRefresh={refresh} run={run} isBusy={isBusy} />
            ) : tab === 'changelog' ? (
              <ChangelogPage snapshot={changelog} />
            ) : tab === 'settings' ? (
              <SettingsPage
                ui={ui}
                snap={snap}
                run={run}
                onRefresh={refresh}
                setMessage={setMessage}
                onPatch={patchUi}
                onInstallWallpaper={installWallpaper}
                onResetWallpaper={resetWallpaper}
                fpsDegraded={fpsDegraded}
                isBusy={isBusy}
              />
            ) : isToolTab(tab) ? (
              // T37 第三方工具视图：仅当显式切到 tool: 时显示（不再无条件盖住诊断/设置页）；
              // ToolSlot 卸载即隐藏视图（保活），切回即重挂载显示。
              <ToolSlot key={tab} moduleId={toolTabModuleId(tab)} statuses={webStatuses} />
            ) : null}
          </div>
    </section>
  )
}
