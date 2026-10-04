"""第 9 轮收尾：补注入依赖 refresh/message、导出 openTools、补 ActionResult 类型导入。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
HOOK = os.path.join(ROOT, "src", "renderer", "src", "hooks", "useAppActions.ts")

h = open(HOOK, encoding="utf-8").read()
h = h.replace("import type { DiagnosticsSnapshot } from '@shared/diagnostics'",
              "import type { ActionResult, DiagnosticsSnapshot } from '@shared/diagnostics'")
h = h.replace("  snap: DiagnosticsSnapshot | null\n}",
              "  snap: DiagnosticsSnapshot | null\n  /** 立即刷新诊断快照（模块操作后回读）。 */\n  refresh: () => void\n  /** 当前动作反馈文案（Toast 显示源）。 */\n  message: string\n}")
h = h.replace("  webStatuses: NonNullable<DiagnosticsSnapshot['webtools']>['statuses']\n}",
              "  webStatuses: NonNullable<DiagnosticsSnapshot['webtools']>['statuses']\n  /** 打开模块页/工具页（供侧栏与工具条使用）。 */\n  openTools: (t: string) => void\n}")
h = h.replace("export function useAppActions({ setUi, setMessage, snap }: UseAppActionsDeps): UseAppActionsResult {",
              "export function useAppActions({ setUi, setMessage, snap, refresh, message }: UseAppActionsDeps): UseAppActionsResult {")
h = h.replace("  return { installWallpaper, resetWallpaper, run, isBusy, webStatuses }",
              "  return { installWallpaper, resetWallpaper, run, isBusy, webStatuses, openTools }")
open(HOOK, "w", encoding="utf-8", newline="\n").write(h)
print("HOOK_PATCHED=True")

a = open(APP, encoding="utf-8").read()
a = a.replace(
    "const { installWallpaper, resetWallpaper, run, isBusy, webStatuses } = useAppActions({\n    setUi,\n    setMessage,\n    snap\n  })",
    "const { installWallpaper, resetWallpaper, run, isBusy, webStatuses, openTools } = useAppActions({\n    setUi,\n    setMessage,\n    snap,\n    refresh,\n    message\n  })",
)
open(APP, "w", encoding="utf-8", newline="\n").write(a)
print("APP_PATCHED=" + str("openTools } = useAppActions" in a))
