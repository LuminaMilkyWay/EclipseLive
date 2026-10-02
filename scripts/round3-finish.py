"""第 3 轮收尾：修重复 export、把 WebToolUrl/WebToolButton 随 ModuleManagePanel 搬到同一文件、清理残留导入。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MMP = os.path.join(ROOT, "src", "renderer", "src", "settings", "ModuleManagePanel.tsx")
SP = os.path.join(ROOT, "src", "renderer", "src", "settings", "SettingsPage.tsx")

# ① 修重复 export
t = open(MMP, encoding="utf-8").read()
t2 = t.replace("export export function", "export function")
open(MMP, "w", encoding="utf-8", newline="\n").write(t2)
print("DUP_EXPORT_FIXED=" + str(t != t2))

# ② 把 WebToolUrl / WebToolButton 从 SettingsPage 搬到 ModuleManagePanel（它们只被 ModuleManagePanel 使用）
sp = open(SP, encoding="utf-8").read()
lines = sp.split("\n")
blocks = []
for name in ("WebToolUrl", "WebToolButton"):
    start = next(i for i, l in enumerate(lines) if re.match(r"^(export\s+)?function\s+" + name + r"\s*\(", l))
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if re.match(r"^(export\s+)?(function|const|let|interface|type|class)\s", lines[j]):
            end = j
            break
    while end > start and lines[end - 1].strip() == "":
        end -= 1
    blocks.append((start, end, "\n".join(lines[start:end])))
    print("FOUND_" + name + "=" + str(start + 1) + "-" + str(end))

# 倒序删除
for start, end, _ in sorted(blocks, key=lambda b: -b[0]):
    del lines[start:end]
open(SP, "w", encoding="utf-8", newline="\n").write("\n".join(lines))

mmp = open(MMP, encoding="utf-8").read().rstrip("\n")
for _, _, blk in blocks:
    mmp += "\n\n" + blk.replace("function ", "export function ", 1) if False else "\n\n" + blk
open(MMP, "w", encoding="utf-8", newline="\n").write(mmp + "\n")
print("MOVED=" + ",".join(b[2].split("(")[0].replace("function ", "") for b in blocks))
