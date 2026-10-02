"""第 6 轮（方案 A）：抽 useUiSettings = ui 状态 + patchUi + 「主题/材质→根属性」effect。
依赖数组与 effect 代码逐字保留；仅把一处渲染期赋值语句挪到 hook 调用之后（行为等价）。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
HOOK = os.path.join(ROOT, "src", "renderer", "src", "hooks", "useUiSettings.ts")

lines = open(APP, encoding="utf-8").read().split("\n")
total = len(lines)

def find(pred, start=0):
    for i in range(start, len(lines)):
        if pred(lines[i]):
            return i
    raise AssertionError("not found")

# ① ui 状态行
ui_line = find(lambda l: l.startswith("  const [ui, setUi] = useState<UiSettings | null>(null)"))
# ② 主题/材质 effect（含其上 3 行注释）
eff_start = find(lambda l: l.strip().startswith("// T14 主题引擎"), ui_line)
eff_end = find(lambda l: l == "  }, [])", eff_start)  # effect 结束
# ③ patchUi（含其上 3 行注释）
pl_start = find(lambda l: l.strip().startswith("// T16：设置项变更"), eff_end)
pl_end = find(lambda l: l == "  }, [setDegraded])", pl_start)
# ④ 渲染期赋值语句（用到 ui，需挪到 hook 之后）
motion_line = find(lambda l: l.startswith("  extMotionOffRef.current ="))

effect_src = "\n".join(lines[eff_start:eff_end + 1])
patch_src = "\n".join(lines[pl_start:pl_end + 1])
assert "useEffect(" in effect_src and "patchUi = useCallback" in patch_src

hook_src = '''import { useCallback, useEffect, useState } from 'react'
import { effectiveMaterial, resolveTheme, wallpaperUrl, type UiSettings } from '@shared/theme'

/**
 * UI 设置（主题/强调色/材质档/底图/三降级开关）的状态与写入通道。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 6 轮（**方案 A：最小安全范围**，用户确认）。
 * 红线遵守：本文件里的 effect **依赖数组与语句顺序逐字来自 App.tsx**（[] 与 [setDegraded]），
 * 未做任何等价的"优化"重写；`ui` 仍是**单一整体状态**，未按字段拆分。
 * `setDegraded`（帧率降档复位）由调用方以参数传入 —— 该状态属第 7 轮（帧率/玻璃副作用）范围，
 * 本轮**不搬**，以免跨轮合并。
 */

/** 调用方需提供的依赖：帧率降档复位（用于"重选材质档位即复位降档"）。 */
export interface UseUiSettingsDeps {
  setDegraded: (v: boolean) => void
}

export interface UseUiSettingsResult {
  ui: UiSettings | null
  patchUi: (patch: Partial<UiSettings>) => void
}

export function useUiSettings({ setDegraded }: UseUiSettingsDeps): UseUiSettingsResult {
  const [ui, setUi] = useState<UiSettings | null>(null)

''' + effect_src + '''

''' + patch_src + '''

  return { ui, patchUi }
}
'''
os.makedirs(os.path.dirname(HOOK), exist_ok=True)
open(HOOK, "w", encoding="utf-8", newline="\n").write(hook_src)

# 重写 App.tsx：删三段 + 插入 hook 调用 + 挪动赋值语句
out = []
i = 0
while i < len(lines):
    if i == ui_line or (eff_start <= i <= eff_end) or (pl_start <= i <= pl_end):
        i += 1
        continue
    if i == motion_line:
        i += 1
        continue
    out.append(lines[i])
    if lines[i].startswith("  }, [])") and i > 100 and out.count("  }, [])") >= 1 and "setDegraded" in "\n".join(lines[max(0, i - 8):i + 1]):
        pass
    i += 1

text = "\n".join(out)
# 在 setDegraded 定义之后插入 hook 调用，并把挪走的那行放到其后
anchor = "  const setDegraded = useCallback((v: boolean) => {\n    fpsDegradedRef.current = v\n    setFpsDegraded(v)\n  }, [])"
assert anchor in text
text = text.replace(
    anchor,
    anchor + "\n\n  // 第 6 轮：ui 状态 + patchUi + 主题/材质应用 effect 收进 hook（方案 A，最小安全范围）\n"
    "  const { ui, patchUi } = useUiSettings({ setDegraded })\n"
    "  // T-A5：减少动态效果或帧率降档时，收起动画已由 CSS 关闭，卸载延时应为 0\n"
    "  extMotionOffRef.current = (ui?.reduceMotion ?? false) || fpsDegraded",
    1,
)
text = text.replace(
    "import { TitleScreen } from './screens/TitleScreen'",
    "import { TitleScreen } from './screens/TitleScreen'\nimport { useUiSettings } from './hooks/useUiSettings'",
    1,
)
open(APP, "w", encoding="utf-8", newline="\n").write(text)

print("HOOK_LINES=" + str(len(hook_src.split("\n"))))
print("APP_BEFORE=" + str(total) + " APP_AFTER=" + str(len(text.split("\n"))))
