"""D③：把底部工具条 + 升级弹窗 + Toast 搬到 shell/ToolBar.tsx（纯 JSX 搬运，props 传值）。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
OUT = os.path.join(ROOT, "src", "renderer", "src", "shell", "ToolBar.tsx")

lines = open(APP, encoding="utf-8").read().split("\n")
total = len(lines)

start = next(i for i, l in enumerate(lines) if l.strip() == "{openTools.length > 0 && (")
end = next(i for i in range(start, len(lines)) if lines[i].strip() == "<Toast text={message || null} />")
block = "\n".join(lines[start:end + 1])
print("BLOCK=" + str(start + 1) + "-" + str(end + 1) + " (" + str(end - start + 1) + " lines)")
for n in ("openTools", "tool-chip", "WhatsNewDialog", "Toast", "changelogSeen"):
    assert n in block, n

out = '''import type { ChangelogSnapshot } from '@shared/changelog'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import { Btn, Toast } from '../ui'
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
}

export function ToolBar({
  openTools,
  tab,
  setTab,
  run,
  changelog,
  whatsNew,
  setWhatsNew,
  message
}: ToolBarProps): React.JSX.Element {
  return (
    <>
''' + "\n".join("    " + l if l.strip() else l for l in block.split("\n")) + '''
    </>
  )
}
'''
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w", encoding="utf-8", newline="\n").write(out)

replacement = '''      <ToolBar
        openTools={openTools}
        tab={tab}
        setTab={setTab}
        run={run}
        changelog={changelog}
        whatsNew={whatsNew}
        setWhatsNew={setWhatsNew}
        message={message}
      />
    </main>'''
# 用替换块覆盖 [start, end+1) —— 其中 end+1 行是 "</main>" 的上一行；这里连 "</main>" 一起处理
end_main = next(i for i in range(end, len(lines)) if lines[i].strip() == "</main>")
new_app = "\n".join(lines[:start] + [replacement] + lines[end_main + 1:])
new_app = new_app.replace(
    "import { ContentArea } from './shell/ContentArea'",
    "import { ContentArea } from './shell/ContentArea'\nimport { ToolBar } from './shell/ToolBar'",
    1,
)
open(APP, "w", encoding="utf-8", newline="\n").write(new_app)
print("APP_BEFORE=" + str(total) + " APP_AFTER=" + str(len(new_app.split("\n"))))
