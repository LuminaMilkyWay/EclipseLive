"""第 1 轮：把 SettingsPage(+ModuleManagePanel+SETTINGS_PENDING+WebToolUrl+WebToolButton)
从 App.tsx 搬到 settings/SettingsPage.tsx。纯搬运：代码行逐字不变，只加 export 与文件级 import。
"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
OUT = os.path.join(ROOT, "src", "renderer", "src", "settings", "SettingsPage.tsx")

src = open(APP, encoding="utf-8").read()
lines = src.split("\n")
total = len(lines)

assert lines[804].startswith("function ModuleManagePanel("), lines[804]
assert lines[917].startswith("const SETTINGS_PENDING"), lines[917]
assert lines[1083].startswith("function SettingsPage("), lines[1083]
assert lines[1516].startswith("function WebToolUrl("), lines[1516]
assert lines[1528].startswith("function WebToolButton("), lines[1528]
assert lines[1551].startswith("function TitleScreen("), lines[1551]

imp_end = 0
for i, l in enumerate(lines[:60]):
    if l.startswith("import ") or l.startswith("} from"):
        imp_end = i + 1
    elif l.strip() == "" and imp_end and not l.startswith(" "):
        break
assert lines[imp_end - 1].startswith("} from"), lines[imp_end - 1]

imports = "\n".join(lines[0:imp_end])
# 新文件位于 src/renderer/src/settings/ ⇒ 本地相对导入要下移一层（'./x' → '../x'）
imports = imports.replace("from './", "from '../")
block_a = "\n".join(lines[804:932])
block_b = "\n".join(lines[1083:1551])

block_a = block_a.replace("function ModuleManagePanel(", "export function ModuleManagePanel(", 1)
block_b = block_b.replace("function SettingsPage(", "export function SettingsPage(", 1)

header = (
    "/**\n"
    " * 设置页（自 App.tsx 拆出；纯搬运，逻辑与语句顺序未改）。\n"
    " *\n"
    " * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 1 轮。\n"
    " * 原 App.tsx 行号：SettingsPage 1084-1516；ModuleManagePanel 805-917；\n"
    " * SETTINGS_PENDING 918-932；WebToolUrl 1517-1528；WebToolButton 1529-1551。\n"
    " * 同轮搬出的理由：后四者只被 SettingsPage 使用，留在 App.tsx 会变成孤儿或形成循环导入。\n"
    " * 后续轮次：ModuleManagePanel 于第 3 轮、WebToolUrl/WebToolButton 于第 4 轮再拆成独立文件。\n"
    " */\n"
)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(header + imports + "\n\n" + block_a + "\n\n" + block_b + "\n")

rest = lines[0:imp_end] + lines[imp_end:804] + lines[932:1083] + lines[1551:total]
new_app = "\n".join(rest)
marker = lines[imp_end - 1]
assert marker in new_app
new_app = new_app.replace(marker, marker + "\nimport { SettingsPage } from './settings/SettingsPage'", 1)
with open(APP, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(new_app)

print("IMPORT_END=" + str(imp_end))
print("NEW_FILE_LINES=" + str(len(open(OUT, encoding="utf-8").read().split("\n"))))
print("APP_BEFORE=" + str(total) + " APP_AFTER=" + str(len(new_app.split("\n"))))
