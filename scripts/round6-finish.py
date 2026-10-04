"""第 6 轮收尾：hook 暴露 setUi；App 清理无用导入。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
HOOK = os.path.join(ROOT, "src", "renderer", "src", "hooks", "useUiSettings.ts")

h = open(HOOK, encoding="utf-8").read()
h = h.replace(
    "export interface UseUiSettingsResult {\n  ui: UiSettings | null\n",
    "export interface UseUiSettingsResult {\n  ui: UiSettings | null\n  /** 直接写入（供底图安装/复位等既有调用点使用；语义与拆分前一致）。 */\n  setUi: (s: UiSettings) => void\n",
)
h = h.replace("  return { ui, patchUi }", "  return { ui, setUi, patchUi }")
open(HOOK, "w", encoding="utf-8", newline="\n").write(h)
print("HOOK_EXPOSES_SETUI=" + str("setUi, patchUi" in h))

a = open(APP, encoding="utf-8").read()
a = a.replace("const { ui, patchUi } = useUiSettings({ setDegraded })",
              "const { ui, setUi, patchUi } = useUiSettings({ setDegraded })")
a = re.sub(r"\n\s*resolveTheme,", "", a)
a = re.sub(r"\n\s*type UiSettings(?=\s*\n)", "", a)
open(APP, "w", encoding="utf-8", newline="\n").write(a)
print("APP_PATCHED=True")
