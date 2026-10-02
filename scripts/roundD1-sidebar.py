"""第 9-D① 轮：把侧栏 JSX 搬到 shell/Sidebar.tsx（纯 JSX 搬运，props 传值，不动 hook/状态）。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
OUT = os.path.join(ROOT, "src", "renderer", "src", "shell", "Sidebar.tsx")

lines = open(APP, encoding="utf-8").read().split("\n")
total = len(lines)

start = next(i for i, l in enumerate(lines) if l.strip() == '<aside className="side">')
end = next(i for i in range(start, len(lines)) if lines[i].strip() == "</aside>")
# 含上一行的分区注释
if lines[start - 1].strip().startswith("{/*"):
    start -= 1
block = "\n".join(lines[start:end + 1])
# 若首行是 JSX 注释，则移入 <aside> 内部（否则与 <aside> 构成两个顶层节点 ⇒ JSX 报错）
lead = ""
if block.lstrip().startswith("{/*"):
    first, _, restb = block.partition("\n")
    lead = first.strip()
    block = restb
print("BLOCK=" + str(start + 1) + "-" + str(end + 1) + " (" + str(end - start + 1) + " lines) lead=" + str(bool(lead)))

# 该块里用到的 App 作用域标识符（人工核对过；多写的会由 tsc 提示无用，少写的会由 tsc 提示未定义）
USED = ["APP_NAME", "formatAppVersion", "Badge", "isPageTab"]
APP_SCOPE = ["tab", "setTab", "info", "snap", "extOpen", "extClosing", "toggleExt", "sideNavRef"]
for name in USED + APP_SCOPE:
    assert re.search(r"\b" + name + r"\b", block), name

out = '''import { APP_NAME, formatAppVersion, type AppInfo } from '@shared/appInfo'
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
''' + lead + "\n" + "\n".join("    " + l if l.strip() else l for l in block.split("\n")) + '''
    </>
  )
}
'''
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w", encoding="utf-8", newline="\n").write(out)

replacement = '''      <Sidebar
        info={info}
        snap={snap}
        tab={tab}
        setTab={setTab}
        extOpen={extOpen}
        extClosing={extClosing}
        toggleExt={toggleExt}
        sideNavRef={sideNavRef}
      />'''
new_app = "\n".join(lines[:start] + [replacement] + lines[end + 1:])
new_app = new_app.replace(
    "import { TitleScreen } from './screens/TitleScreen'",
    "import { TitleScreen } from './screens/TitleScreen'\nimport { Sidebar } from './shell/Sidebar'",
    1,
)
open(APP, "w", encoding="utf-8", newline="\n").write(new_app)
print("APP_BEFORE=" + str(total) + " APP_AFTER=" + str(len(new_app.split("\n"))))
