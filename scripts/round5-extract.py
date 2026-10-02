"""第 5 轮：把 Tab 类型 + 4 个 Tab 辅助函数 + SKIP_TITLE 搬到 app-tables.ts；并清掉 ./ui 导入里的空行。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
OUT = os.path.join(ROOT, "src", "renderer", "src", "app-tables.ts")

lines = open(APP, encoding="utf-8").read().split("\n")
total = len(lines)

# 定位 Tab 的 JSDoc 起点 → SKIP_TITLE 行结束
tab_doc = next(i for i, l in enumerate(lines) if l.startswith("/**") and "固定页 + T31" in lines[i + 1])
skip = next(i for i, l in enumerate(lines) if l.startswith("const SKIP_TITLE"))
assert lines[skip + 1].strip() == "", lines[skip + 1]
block = lines[tab_doc:skip + 1]
# 补 export（Tab / 4 个辅助函数 / SKIP_TITLE）——否则新文件不是模块
block = [
    l.replace("type Tab =", "export type Tab =", 1)
    if l.startswith("type Tab =")
    else re.sub(r"^const (isPageTab|pageTabModuleId|isToolTab|toolTabModuleId|SKIP_TITLE)\b",
                r"export const \1", l)
    for l in block
]

out_text = (
    "/**\n"
    " * 应用级类型与常量（自 App.tsx 拆出；纯搬运，逻辑与顺序未改）。\n"
    " *\n"
    " * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 5 轮（常量表）。\n"
    " * 原 App.tsx 行号：" + str(tab_doc + 1) + "-" + str(skip + 1) + "。\n"
    " */\n\n" + "\n".join(block) + "\n"
)
open(OUT, "w", encoding="utf-8", newline="\n").write(out_text)

# App.tsx：删除该段 + 清理 ./ui 导入空行 + 补 import
rest = lines[0:tab_doc] + lines[skip + 1:]
new_app = "\n".join(rest)
# 清理 ./ui 导入块里的空行：按**行定位**（从 `} from './ui'` 往回找配对的 `import {`），
# 不用跨行正则 —— 无锚定的 `import \{(?:[^\n]*\n)*?\} from './ui'` 会从文件里第一个 import 吞起。
al = new_app.split("\n")
end_idx = next(i for i, l in enumerate(al) if l.strip() == "} from './ui'")
start_idx = next(i for i in range(end_idx, -1, -1) if al[i].startswith("import {"))
members = [m.strip().rstrip(",") for m in al[start_idx + 1:end_idx] if m.strip() not in ("", ",")]
al[start_idx:end_idx + 1] = ["import { " + ", ".join(members) + " } from './ui'"]
new_app = "\n".join(al)
new_app = new_app.replace(
    "import { TitleScreen } from './screens/TitleScreen'",
    "import { TitleScreen } from './screens/TitleScreen'\nimport { SKIP_TITLE, isPageTab, isToolTab, pageTabModuleId, toolTabModuleId } from './app-tables'\nimport type { Tab } from './app-tables'",
    1,
)
open(APP, "w", encoding="utf-8", newline="\n").write(new_app)

print("BLOCK=" + str(tab_doc + 1) + "-" + str(skip + 1) + " (" + str(skip + 1 - tab_doc) + " lines)")
print("APP_BEFORE=" + str(total) + " APP_AFTER=" + str(len(new_app.split("\n"))))
print("UI_IMPORT_CLEAN=" + str("Badge, Btn, EmptyState, Toast" in new_app))
