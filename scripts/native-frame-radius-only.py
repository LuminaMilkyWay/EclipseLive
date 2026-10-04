"""按用户口径重做：只裁一个与 UI 对应的圆角（去掉透明底等多余动作）。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HOST = os.path.join(ROOT, "src", "main", "core", "webtools", "electron-host.ts")
GUARD = os.path.join(ROOT, "tests", "unit", "webtools-native-frame.spec.ts")

h = open(HOST, encoding="utf-8").read()

new_css = '''export const NATIVE_FRAME_CSS =
  'html{border-radius:var(--el-native-frame-radius,16px)!important;overflow:hidden!important}' '''
h = re.sub(r"export const NATIVE_FRAME_CSS =\n(?:.*\n)*?.*'body\{background:transparent!important\}'\n", new_css + "\n", h)
# 注释同步：说明"只裁一个圆角"的口径
h = h.replace(
    " * 注入到 guest **根元素**的样式：只做两件事 —— 根元素圆角裁切 + 背景透明。\n"
    " * 明确**不含**任何颜色/灰层（`AI_RULES` 第 24 条红线）；不碰字号、间距、控件与任何站内结构。",
    " * 注入到 guest **根元素**的样式（**用户口径：只裁剪一个与 UI 对应的圆角**）：\n"
    " * 只做「根元素圆角裁切」这一件事 —— 圆角值取宿主设计令牌 `--r-lg`(16px) 的同名镜像\n"
    " *（`--el-native-frame-radius`，默认 16px），**不改背景、不改颜色**（曾试过 `background: transparent`，\n"
    " * 属于多余动作且引入风险，已按用户要求删除）。\n"
    " * 明确**不含**任何颜色/灰层（`AI_RULES` 第 24 条红线）；不碰字号、间距、控件与任何站内结构。",
)
open(HOST, "w", encoding="utf-8", newline="\n").write(h)
print("HOST_CSS_IS_RADIUS_ONLY=" + str("background:transparent" not in h))

g = open(GUARD, encoding="utf-8").read()
g = g.replace(
    "    expect(NATIVE_FRAME_CSS).toContain('border-radius')\n"
    "    expect(NATIVE_FRAME_CSS).toContain('overflow:hidden')\n"
    "    expect(NATIVE_FRAME_CSS).toContain('background:transparent')",
    "    expect(NATIVE_FRAME_CSS).toContain('border-radius')\n"
    "    expect(NATIVE_FRAME_CSS).toContain('overflow:hidden')\n"
    "    // 用户口径：**只裁一个圆角** —— 不得再改背景/颜色（曾试过 background: transparent，已删除）\n"
    "    expect(NATIVE_FRAME_CSS, '只允许裁剪圆角，不得改背景').not.toContain('background')",
)
open(GUARD, "w", encoding="utf-8", newline="\n").write(g)
print("GUARD_UPDATED=" + str("不得改背景" in g))
