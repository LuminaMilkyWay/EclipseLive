"""第 6 轮定位：ui 状态 / patchUi / 3 个 ui 同步 effect 的精确行号与代码。"""
import io
import re
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
lines = open(os.path.join(ROOT, "src", "renderer", "src", "App.tsx"), encoding="utf-8").read().split("\n")

# 钩子调用及其行号
for i, l in enumerate(lines):
    if re.search(r"useState|useRef|useEffect\(|useCallback", l) or "patchUi" in l or "setDegraded" in l:
        print(f"{i+1:4d}| {l.rstrip()[:120]}")
print("=== 文件总行: " + str(len(lines)) + " ===")
