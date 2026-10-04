"""通用组件抽取（任意源文件 → 独立文件）。纯搬运：代码逐字不变，只加 export 与文件级 import。

用法：python scripts/extract-component2.py <源文件> <组件名> <相对输出路径>
例：  python scripts/extract-component2.py src/renderer/src/settings/SettingsPage.tsx ModuleManagePanel settings/ModuleManagePanel.tsx
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, sys.argv[1].replace("/", os.sep))
name = sys.argv[2]
rel_out = sys.argv[3]
OUT = os.path.join(ROOT, "src", "renderer", "src", rel_out.replace("/", os.sep))

src_dir = os.path.dirname(SRC)
out_dir = os.path.dirname(OUT)


def rel_import(path_from, path_to):
    """计算相对导入路径（不含扩展名），以 './' 或 '../' 开头。"""
    rel = os.path.relpath(path_to, path_from).replace("\\", "/")
    rel = re.sub(r"\.tsx?$", "", rel)
    if not rel.startswith("."):
        rel = "./" + rel
    return rel


lines = open(SRC, encoding="utf-8").read().split("\n")
total = len(lines)

start = None
for i, l in enumerate(lines):
    if re.match(r"^(export\s+)?function\s+" + re.escape(name) + r"\s*\(", l):
        start = i
        break
assert start is not None, "未找到 function " + name

end = total
for j in range(start + 1, total):
    if re.match(r"^(export\s+)?(function|const|let|interface|type|class|async function)\s", lines[j]):
        end = j
        break
while end > start and lines[end - 1].strip() == "":
    end -= 1

# import 区
imp_end = 0
for i, l in enumerate(lines[:80]):
    if l.startswith("import ") or l.startswith("} from"):
        imp_end = i + 1
    elif l.strip() == "" and imp_end and not l.startswith(" "):
        break
assert imp_end > 0

# 把源文件的本地相对导入改写成指向新位置
# 注意：源文件的 import 可能是**多行**形式（`import {` … `} from './ui'`），
# 逐行正则匹配不到 ⇒ 先整体做一次 `from './` → 目标前缀 的字符串替换（多行安全），
# 再对单行形式做一次精确校正。
imp_block = "\n".join(lines[0:imp_end])
if os.path.normpath(src_dir) != os.path.normpath(out_dir):
    prefix = os.path.relpath(src_dir, out_dir).replace("\\", "/")
    if not prefix.startswith("."):
        prefix = "./" + prefix
    imp_block = re.sub(r"from '\./", "from '" + prefix.rstrip("/") + "/", imp_block)
imports = imp_block.split("\n")
imports = "\n".join(imports)

block = "\n".join(lines[start:end]).replace("function " + name + "(", "export function " + name + "(", 1)

header = (
    "/**\n"
    " * " + name + "（自 " + os.path.basename(SRC) + " 拆出；纯搬运，逻辑与语句顺序未改）。\n"
    " *\n"
    " * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md。\n"
    " * 原 " + os.path.basename(SRC) + " 行号：" + str(start + 1) + "-" + str(end) + "。\n"
    " */\n"
)

os.makedirs(out_dir, exist_ok=True)
with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(header + imports + "\n\n" + block + "\n")

rest = lines[0:start] + lines[end:]
new_src = "\n".join(rest)
marker = lines[imp_end - 1]
assert marker in new_src
imp_path = rel_import(src_dir, OUT)
new_src = new_src.replace(marker, marker + "\nimport { " + name + " } from '" + imp_path + "'", 1)
with open(SRC, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(new_src)

print("BLOCK=" + str(start + 1) + "-" + str(end) + " (" + str(end - start) + " lines)")
print("NEW_FILE=" + OUT)
print("IMPORT_PATH=" + imp_path)
print("SRC_BEFORE=" + str(total) + " SRC_AFTER=" + str(len(new_src.split("\n"))))
