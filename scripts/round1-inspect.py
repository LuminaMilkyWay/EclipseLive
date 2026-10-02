"""第 1 轮拆分前置检查（只读）：SettingsPage 的精确边界、它依赖的 App 作用域标识符。"""
import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
P = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
lines = open(P, encoding="utf-8").read().split("\n")

def show(a, b, tag):
    print(f"--- {tag} (L{a}-{b}) ---")
    for i in range(a - 1, min(b, len(lines))):
        print(f"{i+1:5d}| {lines[i]}")

# 找关键锚点
anchors = {}
for i, l in enumerate(lines):
    for name in ("SettingsPage", "ModuleManagePanel", "SETTINGS_PENDING", "WebToolUrl", "function App"):
        if re.search(r"(function|const)\s+" + name + r"\b", l):
            anchors.setdefault(name, []).append(i + 1)
print("ANCHORS=" + json.dumps(anchors, ensure_ascii=True))

# SettingsPage 上方注释起点
sp = anchors["SettingsPage"][0]
j = sp - 1
while j > 0 and (lines[j - 1].strip().startswith("*") or lines[j - 1].strip().startswith("/*")
                 or lines[j - 1].strip().startswith("/**")):
    j -= 1
print("SETTINGS_BLOCK_START=" + str(j + 1))
show(j + 1, j + 24, "SettingsPage 头部")
show(sp + 380, sp + 435, "SettingsPage 尾部→下一个组件")
show(800, 815, "ModuleManagePanel 头部")
show(915, 935, "ModuleManagePanel 尾部→常量")

# SettingsPage + ModuleManagePanel + SETTINGS_PENDING 三段里引用到的"自由标识符"
ranges = [(j + 1, anchors["SettingsPage"][0] - 1), (anchors["ModuleManagePanel"][0] - 1, 932)]
body = "\n".join(lines[a - 1:b] for a, b in ranges)
names = set(re.findall(r"\b([A-Za-z_$][\w$]*)\b", body))
declared = set()
for a, b in ranges:
    for l in lines[a - 1:b]:
        m = re.match(r"\s*(?:const|function|let|var)\s+([A-Za-z_$][\w$]*)", l)
        if m:
            declared.add(m.group(1))
        for m2 in re.finditer(r"const\s*\[\s*([A-Za-z_$][\w$]*)", l):
            declared.add(m2.group(1))
        m3 = re.match(r"\s*function\s+([A-Za-z_$][\w$]*)", l)
        if m3:
            declared.add(m3.group(1))
module_level = set()
for i, l in enumerate(lines[:60]):
    m = re.match(r"(?:export\s+)?(?:const|function|let)\s+([A-Za-z_$][\w$]*)", l)
    if m:
        module_level.add(m.group(1))
kw = set("""const let var function return if else for while do switch case break continue new typeof
instanceof in of null undefined true false this super class extends import export default from as
await async yield try catch finally throw void delete requires" """.split())
free = sorted(n for n in names if n not in declared and n not in kw and not n[0].isupper())
print("FREE_LOWER=" + json.dumps(free[:80], ensure_ascii=True))
print("MODULE_LEVEL=" + json.dumps(sorted(module_level), ensure_ascii=True))
