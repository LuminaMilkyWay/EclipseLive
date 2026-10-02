"""�?1 轮：�?SettingsPage(+ModuleManagePanel+SETTINGS_PENDING) �?App.tsx 搬到 settings/SettingsPage.tsx�?纯搬运：代码行逐字保持不变，只�?export 与文件级 import�?"""
import io
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
OUT = os.path.join(ROOT, "src", "renderer", "src", "settings", "SettingsPage.tsx")

src = open(APP, encoding="utf-8").read()
lines = src.split("\n")
total = len(lines)

# 校验锚点（防止行号漂移后误切�?assert lines[804].startswith("function ModuleManagePanel("), lines[804]
assert lines[917].startswith("const SETTINGS_PENDING"), lines[917]
assert lines[1083].startswith("function SettingsPage("), lines[1083]
assert lines[1516].startswith("function WebToolUrl("), lines[1516]
# import 区真实边界：最后一行以 "} from '...'" �?"import ..." 开�?imp_end = 0
for i, l in enumerate(lines[:60]):
    if l.startswith("import ") or l.startswith("}") or l.startswith("  ") or l.strip() == "":
        if l.startswith("import ") or l.startswith("}"):
            imp_end = i + 1
    else:
        break
assert lines[imp_end - 1].startswith("} from"), lines[imp_end - 1]
print("IMPORT_END=" + str(imp_end))

imports = "\n".join(lines[0:imp_end])       # App.tsx 的完�?import �?block_a = "\n".join(lines[804:932])        # ModuleManagePanel + SETTINGS_PENDING�?05�?32�?block_b = "\n".join(lines[1083:1516])      # SettingsPage�?084�?516�?
# 只给被外部使用的组件�?export；其余保持文件内私有
block_a = block_a.replace("function ModuleManagePanel(", "export function ModuleManagePanel(", 1)
block_b = block_b.replace("function SettingsPage(", "export function SettingsPage(", 1)

header = (
    "/**\n"
    " * 设置页（�?App.tsx 拆出；纯搬运，逻辑与行序未改）。\n"
    " *\n"
    " * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md �?1 轮。\n"
    " * �?App.tsx 行号：SettingsPage 1084�?516；ModuleManagePanel 805�?17；SETTINGS_PENDING 918�?32。\n"
    " * 三者同轮搬出：SettingsPage 渲染 ModuleManagePanel 并读�?SETTINGS_PENDING，\n"
    " * 若留�?App.tsx 会形�?App �?SettingsPage 循环导入，故一并移入本文件\n"
    " *（ModuleManagePanel 将在�?3 轮再拆成独立文件）。\n"
    " */\n"
)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(header + imports + "\n\n" + block_a + "\n\n" + block_b + "\n")

# 重组 App.tsx：删两段 + �?import 区之后插�?SettingsPage 导入
rest = lines[0:imp_end] + lines[imp_end:804] + lines[932:1083] + lines[1551:total]
new_app = "\n".join(rest)
marker = lines[imp_end - 1]
assert marker in new_app, marker
new_app = new_app.replace(marker, marker + "\nimport { SettingsPage } from './settings/SettingsPage'", 1)
with open(APP, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(new_app)

print("WROTE=" + OUT)
print("NEW_FILE_LINES=" + str(len(open(OUT, encoding="utf-8").read().split("\n"))))
print("APP_LINES_BEFORE=" + str(total))
print("APP_LINES_AFTER=" + str(len(new_app.split("\n"))))
