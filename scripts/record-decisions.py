"""记录用户对 Q1–Q4 的决定与 6 条补充到 T38/T39 卡。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = os.path.join(ROOT, "TASKS")

DECISION = """

## ★★ 用户决定（2026-09-30，已拍板）

| 问 | 决定 | 说明 |
| --- | --- | --- |
| **Q1 触发范围** | **A** | 用户先问"Dock 化是否更高效"；评估结论：**不更高效**（全页面自动回缩会让嵌入原生视图的页面逐帧 reflow，性能与操作效率都更差）⇒ **按 A：仅「OBS 直播中控」页自动回缩**，其它页面保持现状，任何页面可手动切换 |
| **Q2 锁定语义** | **A** | 三条全要：① 不自动隐藏 ② 不参与回缩动画 ③ 位置固定 |
| **Q3 Dock 形态** | **B + 名称可见** | 图标化、居中排列、hover 放大；**必须显示模块名称**（见下补充 2） |
| **Q4 手动入口** | **A** | 任务栏**最左端**一个「侧栏」开关按钮 |

## ★★ 随之确定的 6 条实现补充

1. **图标来源**：优先用模块清单自带 icon；**清单无 icon 字段时**用**首字缩写（monogram）+ 名称标签** ⇒ **不引入图标库、不新增依赖**。
2. **名称显示（Q3=B 的硬要求）**：图标**下方常显小字名称**；超长截断 + `title` 悬浮显示全名；hover 放大时名称高亮。
3. **hover 放大不得改变布局**：**只用 `transform: scale`** ⇒ **任务栏高度恒定** ⇒ 原生视图底部内缩值不受影响（**这条写成机械守卫**，因为它直接关系到 `module-view-bounds` 几何契约）。
4. **任务栏溢出**：多于可视宽度时横向滚动 + 两端渐隐提示（不引入"更多"弹层）。
5. **键盘与可访问性**：Dock 项可 `Tab` 聚焦，`aria-label` = 显示名称。
6. **信息密度不回退**：图标化后**仍保留右端状态区**（OBS 连接状态 / 是否推流）—— 这是图标化最容易丢掉的东西。
"""

for f in ("T38-dock-taskbar.md", "T39-expand-layout-capability.md"):
    p = os.path.join(T, f)
    t = open(p, encoding="utf-8").read()
    if "用户决定（2026-09-30，已拍板）" in t:
        print("SKIP=" + f)
        continue
    open(p, "w", encoding="utf-8", newline="\n").write(t.rstrip("\n") + "\n" + DECISION)
    print("UPDATED=" + f)
