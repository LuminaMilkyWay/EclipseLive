"""第 3 轮收尾 2：清 type UiSettings 残留 + 守卫目标随拆分前移（方案 A）。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MMP = os.path.join(ROOT, "src", "renderer", "src", "settings", "ModuleManagePanel.tsx")
G1 = os.path.join(ROOT, "tests", "unit", "components.spec.ts")
G2 = os.path.join(ROOT, "tests", "unit", "app-split-round1.spec.ts")

# ① 清掉未使用的 UiSettings（含 `type UiSettings` 形态）
t = open(MMP, encoding="utf-8").read()
t2 = re.sub(r",\s*\n\s*(?:type\s+)?UiSettings(?=\s*\n)", "", t)
t2 = re.sub(r"\n\s*(?:type\s+)?UiSettings,\s*\n", "\n", t2)
t2 = re.sub(r"\n\s*(?:type\s+)?UiSettings\s*\n", "\n", t2)
open(MMP, "w", encoding="utf-8", newline="\n").write(t2)
print("UI_SETTINGS_CLEARED=" + str(t != t2))

# ② components.spec.ts：扫描目标再纳入 settings/ModuleManagePanel.tsx
g = open(G1, encoding="utf-8").read()
if "MP_PATH" not in g:
    g = g.replace(
        "const SP_PATH =",
        "const MP_PATH = resolve(__dirname, '../../src/renderer/src/settings/ModuleManagePanel.tsx')\nconst SP_PATH =",
        1,
    )
    g = g.replace("(await load(APP_PATH)) + (await load(SP_PATH))",
                  "(await load(APP_PATH)) + (await load(SP_PATH)) + (await load(MP_PATH))")
    g = g.replace("(await readFile(APP_PATH, 'utf8')) + (await readFile(SP_PATH, 'utf8'))",
                  "(await readFile(APP_PATH, 'utf8')) + (await readFile(SP_PATH, 'utf8')) + (await readFile(MP_PATH, 'utf8'))")
open(G1, "w", encoding="utf-8", newline="\n").write(g)
print("COMPONENTS_SPEC_PATCHED=True")

# ③ app-split-round1.spec.ts：ModuleManagePanel 已由第 3 轮拆到独立文件 ⇒ 断言改为指向新文件
g2 = open(G2, encoding="utf-8").read()
g2 = g2.replace(
    "    expect(sp, 'ModuleManagePanel 应随 SettingsPage 一并搬出（它将由第 3 轮再拆）').toContain(\n      'export function ModuleManagePanel('\n    )",
    "    // 第 3 轮已把 ModuleManagePanel 拆到独立文件（settings/ModuleManagePanel.tsx）\n"
    "    expect(sp, 'SettingsPage 应改为 import ModuleManagePanel').toContain(\"from './ModuleManagePanel'\")",
)
open(G2, "w", encoding="utf-8", newline="\n").write(g2)
print("ROUND1_GUARD_PATCHED=" + str("from './ModuleManagePanel'" in g2))
