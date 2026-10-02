"""D②：把内容区 JSX 搬到 shell/ContentArea.tsx（纯 JSX 搬运，props 传值）。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
OUT = os.path.join(ROOT, "src", "renderer", "src", "shell", "ContentArea.tsx")

lines = open(APP, encoding="utf-8").read().split("\n")
total = len(lines)

start = next(i for i, l in enumerate(lines) if l.strip() == '<section className="content">')
end = next(i for i in range(start, len(lines)) if lines[i].strip() == "</section>")
block = "\n".join(lines[start:end + 1])
print("BLOCK=" + str(start + 1) + "-" + str(end + 1) + " (" + str(end - start + 1) + " lines)")

NEED = ["isPageTab", "pageTabModuleId", "ModulePageHost", "DiagnosticsPage", "ChangelogPage",
        "SettingsPage", "isToolTab", "toolTabModuleId", "ToolSlot"]
for n in NEED:
    assert re.search(r"\b" + n + r"\b", block), n

out = '''import type { ChangelogSnapshot } from '@shared/changelog'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import type { UiSettings } from '@shared/theme'
import { ChangelogPage } from '../changelog'
import { DiagnosticsPage } from '../diagnostics/DiagnosticsPage'
import { ModulePageHost } from '../slots/ModulePageHost'
import { ToolSlot } from '../slots/ToolSlot'
import { SettingsPage } from '../settings/SettingsPage'
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
''' + "\n".join("    " + l if l.strip() else l for l in block.split("\n")) + '''
  )
}
'''
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w", encoding="utf-8", newline="\n").write(out)

replacement = '''      <ContentArea
        tab={tab}
        snap={snap}
        changelog={changelog}
        ui={ui}
        webStatuses={webStatuses}
        refresh={refresh}
        run={run}
        isBusy={isBusy}
        setMessage={setMessage}
        patchUi={patchUi}
        installWallpaper={installWallpaper}
        resetWallpaper={resetWallpaper}
        fpsDegraded={fpsDegraded}
      />'''
new_app = "\n".join(lines[:start] + [replacement] + lines[end + 1:])
new_app = new_app.replace(
    "import { Sidebar } from './shell/Sidebar'",
    "import { Sidebar } from './shell/Sidebar'\nimport { ContentArea } from './shell/ContentArea'",
    1,
)
open(APP, "w", encoding="utf-8", newline="\n").write(new_app)
print("APP_BEFORE=" + str(total) + " APP_AFTER=" + str(len(new_app.split("\n"))))
