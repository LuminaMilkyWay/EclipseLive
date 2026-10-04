"""第 9 轮：抽 useAppActions（底图动作 / 模块动作+Toast / 网页工具状态）。
连续段 L208-290；依赖以参数传入（setUi / setMessage / snap）。依赖数组逐字保留。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
HOOK = os.path.join(ROOT, "src", "renderer", "src", "hooks", "useAppActions.ts")

lines = open(APP, encoding="utf-8").read().split("\n")
total = len(lines)

# 起点：T17 全局底图动作 注释行
start = next(i for i, l in enumerate(lines) if "T17 全局底图动作" in l)
while start > 0 and lines[start - 1].strip().startswith("//"):
    start -= 1
# 终点：网页工具状态 effect 的 `}, [...])` 结束行（在 webStatusesRef 之后第一个 `  }, [`）
ws = next(i for i, l in enumerate(lines) if "webStatusesRef.current" in l)
end = next(i for i in range(ws, len(lines)) if re.match(r"^  \}, \[", lines[i]))
# 断言该段含三组内容
seg = "\n".join(lines[start:end + 1])
for must in ("installWallpaper", "resetWallpaper", "const run = useCallback", "const isBusy", "webStatusesRef"):
    assert must in seg, must
# 段落之后必须紧跟 App 的 next 内容（不再是 hook 段）
print("SEGMENT=" + str(start + 1) + "-" + str(end + 1) + " (" + str(end - start + 1) + " lines)")

hook = '''import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import type { UiSettings } from '@shared/theme'

/**
 * 应用级动作与状态：全局底图动作、模块操作（含 Toast 反馈）、网页工具状态。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 9 轮（其余 hooks 的可安全成组部分）。
 * 红线遵守：本文件内所有 useCallback / useEffect 的**代码与依赖数组逐字来自 App.tsx**
 * （含 `run` 的 in-flight 去重、Toast 5s 覆盖式、网页工具状态的 2s 轮询 ref 写入），未做任何重写。
 * 依赖以参数注入：`setUi`（底图动作回读）、`setMessage`（动作反馈）、`snap`（网页工具状态来源）。
 */

/** 调用方注入的依赖。 */
export interface UseAppActionsDeps {
  setUi: (s: UiSettings) => void
  setMessage: (text: string) => void
  snap: DiagnosticsSnapshot | null
}

export interface UseAppActionsResult {
  installWallpaper: () => void
  resetWallpaper: () => void
  run: (label: string, action: () => Promise<{ ok: boolean; errors: string[] }>, key?: string) => Promise<void>
  isBusy: (key: string) => boolean
  webStatuses: NonNullable<DiagnosticsSnapshot['webtools']>['statuses']
}

export function useAppActions({ setUi, setMessage, snap }: UseAppActionsDeps): UseAppActionsResult {
''' + "\n".join(lines[start:end + 1]) + '''

  return { installWallpaper, resetWallpaper, run, isBusy, webStatuses }
}
'''
os.makedirs(os.path.dirname(HOOK), exist_ok=True)
open(HOOK, "w", encoding="utf-8", newline="\n").write(hook)

# App.tsx：删段 + 插入 hook 调用
rest = lines[0:start] + lines[end + 1:]
text = "\n".join(rest)
text = text.replace(
    "import { useGlassOptics } from './hooks/useGlassOptics'",
    "import { useGlassOptics } from './hooks/useGlassOptics'\nimport { useAppActions } from './hooks/useAppActions'",
    1,
)
anchor = "  useGlassOptics(ui)"
assert anchor in text
text = text.replace(
    anchor,
    anchor + "\n  // 第 9 轮：底图动作 / 模块操作（含 Toast）/ 网页工具状态收进 hook\n"
    "  const { installWallpaper, resetWallpaper, run, isBusy, webStatuses } = useAppActions({\n"
    "    setUi,\n    setMessage,\n    snap\n  })",
    1,
)
open(APP, "w", encoding="utf-8", newline="\n").write(text)
print("HOOK_LINES=" + str(len(hook.split("\n"))))
print("APP_BEFORE=" + str(total) + " APP_AFTER=" + str(len(text.split("\n"))))
