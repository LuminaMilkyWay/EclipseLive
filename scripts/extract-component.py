"""通用组件抽取（App.tsx → 独立文件）。纯搬运：代码逐字不变，只加 export 与文件级 import。

用法：python scripts/extract-component.py <组件名> <相对输出路径>
例：  python scripts/extract-component.py DiagnosticsPage diagnostics/DiagnosticsPage.tsx
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")

name = sys.argv[1]
rel_out = sys.argv[2]
OUT = os.path.join(ROOT, "src", "renderer", "src", rel_out.replace("/", os.sep))
depth = rel_out.count("/")  # 0 = 与 App.tsx 同级，1 = 子目录

lines = open(APP, encoding="utf-8").read().split("\n")
total = len(lines)

# 1) 定位组件块
start = None
for i, l in enumerate(lines):
    if re.match(r"^function\s+" + re.escape(name) + r"\s*\(", l):
        start = i
        break
assert start is not None, "未找到 function " + name

# 2) 块结束：下一个顶层声明（function/const/interface/type/export）或文件尾
end = total
for j in range(start + 1, total):
    if re.match(r"^(export\s+)?(function|const|let|interface|type|class|async function)\s", lines[j]):
        end = j
        break
while end > start and lines[end - 1].strip() == "":
    end -= 1

# 3) import 区
imp_end = 0
for i, l in enumerate(lines[:60]):
    if l.startswith("import ") or l.startswith("} from"):
        imp_end = i + 1
    elif l.strip() == "" and imp_end and not l.startswith(" "):
        break
assert lines[imp_end - 1].startswith("import ") or lines[imp_end - 1].startswith("} from")

imports = "\n".join(lines[0:imp_end])
if depth:
    imports = imports.replace("from './", "from '../")

block = "\n".join(lines[start:end]).replace("function " + name + "(", "export function " + name + "(", 1)

header = (
    "/**\n"
    " * " + name + "（自 App.tsx 拆出；纯搬运，逻辑与语句顺序未改）。\n"
    " *\n"
    " * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md。\n"
    " * 原 App.tsx 行号：" + str(start + 1) + "-" + str(end) + "。\n"
    " */\n"
)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(header + imports + "\n\n" + block + "\n")

# 4) 重写 App.tsx
rest = lines[0:start] + lines[end:]
new_app = "\n".join(rest)
marker = lines[imp_end - 1]
assert marker in new_app
imp_path = "./" + rel_out[:-4] if rel_out.endswith(".tsx") else "./" + rel_out
new_app = new_app.replace(marker, marker + "\nimport { " + name + " } from '" + imp_path + "'", 1)
with open(APP, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(new_app)

# 5) 自由标识符（人工核对用）
declared = set()
for l in lines[start:end]:
    for m in re.finditer(r"(?:const|function|let)\s+([A-Za-z_$][\w$]*)", l):
        declared.add(m.group(1))
used = set(re.findall(r"\b([a-z][A-Za-z0-9_$]*)\b", "\n".join(lines[start:end])))
print("BLOCK=" + str(start + 1) + "-" + str(end) + " (" + str(end - start) + " lines)")
print("NEW_FILE=" + OUT)
print("APP_BEFORE=" + str(total) + " APP_AFTER=" + str(len(new_app.split("\n"))))
print("LOWER_USED=" + ",".join(sorted(used - declared))[:400])
