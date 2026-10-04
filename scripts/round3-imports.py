"""第 3 轮：补齐 ModuleManagePanel 的类型导入 + 清掉残留未用导入。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MMP = os.path.join(ROOT, "src", "renderer", "src", "settings", "ModuleManagePanel.tsx")

t = open(MMP, encoding="utf-8").read()

# ① 补 DiagnosticsSnapshot 类型导入（WebTool 两组件需要）
if "DiagnosticsSnapshot" not in t.split("\n\n")[0]:
    lines = t.split("\n")
    last_imp = max(i for i, l in enumerate(lines[:80]) if l.startswith("import ") or l.startswith("} from"))
    lines.insert(last_imp + 1, "import type { DiagnosticsSnapshot } from '@shared/diagnostics'")
    t = "\n".join(lines)

# ② 从多行 import 中移除未使用的成员（含"最后一个成员 + 前一行逗号"两种形态）
for name in ("UiSettings", "TextInput"):
    t = re.sub(r"\n\s*" + name + r",", "", t)
    t = re.sub(r",\n\s*" + name + r"\n", "\n", t)
    t = re.sub(r"\n\s*" + name + r"\n", "\n", t)

# ③ 清掉残留的空成员行（只有空白或仅逗号的行）与连续空行
t = re.sub(r"\n\s*,?\s*(?=\n)", "\n", t)
t = re.sub(r"\n{3,}", "\n\n", t)
open(MMP, "w", encoding="utf-8", newline="\n").write(t)
print("FIXED=" + MMP)
