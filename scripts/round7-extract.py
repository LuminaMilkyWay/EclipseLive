"""第 7 轮：抽 useGlassOptics = 烘焙滤镜注入 + 自适应文字色 + 指针光斑（依赖数组逐字保留）。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
HOOK = os.path.join(ROOT, "src", "renderer", "src", "hooks", "useGlassOptics.ts")

lines = open(APP, encoding="utf-8").read().split("\n")
total = len(lines)

def block_of(marker, require):
    """找到注释起点含 marker 的 effect，返回 (起始行, 结束行, 源码)。"""
    s = None
    for i, l in enumerate(lines):
        if marker in l and l.strip().startswith("//"):
            s = i
            break
    assert s is not None, marker
    # 向上吞掉连续的注释行
    while s > 0 and lines[s - 1].strip().startswith("//"):
        s -= 1
    e = None
    for j in range(s, len(lines)):
        if lines[j].startswith("  useEffect(") or lines[j].startswith("  useEffect(() =>"):
            for k in range(j, len(lines)):
                if re.match(r"^  \}, \[", lines[k]):
                    e = k
                    break
            break
    assert e is not None, marker
    src = "\n".join(lines[s:e + 1])
    for r in require:
        assert r in src, (marker, r)
    return s, e, src

b1 = block_of("烘焙折射注入", ["ensureBakedFilter"])
b2 = block_of("自适应文字色", ["sampleWallpaperLuma"])
b3 = block_of("指针光斑", ["--light-x"])
blocks = sorted([b1, b2, b3], key=lambda b: b[0])
print("BLOCKS=" + ",".join(f"{b[0]+1}-{b[1]+1}" for b in blocks))

hook = '''import { useEffect } from 'react'
import { effectiveMaterial, wallpaperUrl, type UiSettings } from '@shared/theme'
import { compositeLuma, pickTextTone, sampleWallpaperLuma, type PanelColor } from '../adaptive-text'
import { ensureBakedFilter, applyHighlightVar } from '../glass-bake'

/**
 * 玻璃光学副作用：烘焙折射滤镜注入 + 自适应文字色 + 指针光斑。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 7 轮。
 * 红线遵守：三个 effect 的**代码与依赖数组逐字来自 App.tsx**（`[]` / `[ui?.wallpaperImage, ui?.themeMode, ui?.material]` / `[ui]`），
 * 未做任何重写；执行顺序与拆分前一致（烘焙 → 自适应文字色 → 指针光斑）。
 * 本轮**不含**帧率降档与渲染值收口（若并入会与 useUiSettings 的参数形成循环顺序 ⇒ 该对留在 App，归后续轮次）。
 */
export function useGlassOptics(ui: UiSettings | null): void {
''' + "\n\n".join(b[2] for b in blocks) + "\n}\n"

os.makedirs(os.path.dirname(HOOK), exist_ok=True)
open(HOOK, "w", encoding="utf-8", newline="\n").write(hook)

out = []
i = 0
remove = set()
for s, e, _ in blocks:
    for k in range(s, e + 1):
        remove.add(k)
while i < len(lines):
    if i in remove:
        i += 1
        continue
    out.append(lines[i])
    i += 1
text = "\n".join(out)
text = text.replace(
    "import { useUiSettings } from './hooks/useUiSettings'",
    "import { useUiSettings } from './hooks/useUiSettings'\nimport { useGlassOptics } from './hooks/useGlassOptics'",
    1,
)
anchor = "  const { ui, setUi, patchUi } = useUiSettings({ setDegraded })"
assert anchor in text
text = text.replace(anchor, anchor + "\n  // 第 7 轮：玻璃光学副作用（烘焙滤镜/自适应文字色/指针光斑）收进 hook\n  useGlassOptics(ui)", 1)
open(APP, "w", encoding="utf-8", newline="\n").write(text)

print("HOOK_LINES=" + str(len(hook.split("\n"))))
print("APP_BEFORE=" + str(total) + " APP_AFTER=" + str(len(text.split("\n"))))
