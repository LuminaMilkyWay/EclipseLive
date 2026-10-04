"""T39/T43 修订：专注态侧栏改为**覆盖层**（不挤回布局）+ DOCK 自动隐藏/底边唤出/运行指示 + 非线性（弹簧）缓动。

依据（研究）：
- Apple 官方 Dock 偏好项：大小 / **放大** / 位置 / **自动隐藏与显示 Dock** / 为打开的 App 显示指示灯 / 最小化效果
  （https://support.apple.com/ml-in/guide/mac-help/mchlp1119/11.0/mac/11.0 、
   https://support.apple.com/mr-in/guide/mac-help/mchlp1119/14.0/mac/14.0 、
   https://developer.apple.com/documentation/devicemanagement/dock ）
- 揭示动画范式："rail reveal slides in from its own edge"（https://github.com/neomjs/neo/pull/18079 ）
- 缓动生成/参考：https://github.com/satishkumarsajjan/ease-master ；Dock 组件参考：
  https://registry.directory/DavidHDev/react-bits/Dock-JS-TW
零新依赖：只用 CSS `cubic-bezier` 与 `linear()`（Chromium 已支持）表达弹簧。
"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CSS = os.path.join(ROOT, "src", "renderer", "src", "renderer.css")
HOOK_FOCUS = os.path.join(ROOT, "src", "renderer", "src", "hooks", "useFocusMode.ts")
HOOK_DOCK = os.path.join(ROOT, "src", "renderer", "src", "hooks", "useDockBar.ts")

# ---------- ① 缓动令牌 + 专注覆盖层 + Dock 行为 ----------
css = open(CSS, encoding="utf-8").read()
if "--ease-spring" not in css:
    css = css.replace(
        "  --dock-h: 48px;",
        """  --dock-h: 48px;
  /* 非线性（弹簧类）缓动 —— 零依赖：overshoot 用 cubic-bezier，真弹簧用采样后的 linear()。
     参考 ease-master（https://github.com/satishkumarsajjan/ease-master）与 neo 的揭示动画范式。 */
  --ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-spring: linear(
    0, 0.009, 0.035, 0.078, 0.136, 0.207, 0.289, 0.38, 0.477, 0.577, 0.677, 0.774, 0.865, 0.947,
    1.018, 1.077, 1.123, 1.155, 1.174, 1.181, 1.176, 1.161, 1.137, 1.107, 1.072, 1.035, 0.999,
    0.964, 0.933, 0.906, 0.885, 0.87, 0.861, 0.857, 0.859, 0.865, 0.875, 0.888, 0.903, 0.919,
    0.936, 0.952, 0.967, 0.98, 0.991, 0.999, 1.005, 1.008, 1.009, 1.008, 1.006, 1.003, 1.001, 1
  );
  /* 揭示/收起（Dock 从底边滑出）：入场略过冲、退场快而稳 */
  --dock-reveal: var(--ease-out-back);""",
        1,
    )

ADD = """

/* ==========================================================================
 * T39/T43 修订：① 专注态侧栏 = **覆盖层**（浮在浮动面板之上，不挤回布局）
 * 用户口径：「进入专注布局后，菜单栏开启会展开到浮动面板上面，而不是缩回原来的布局」。
 *
 * 实现：专注态下 `.side` 脱离网格流（absolute），内容区保持扩展（列宽仍为 0 1fr）；
 * 开启菜单 = 覆盖层从左侧滑入（spring 缓动）；关闭 = 滑出。**内容区位置始终不变**。
 * ========================================================================== */
:root[data-focus='1'] .side {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 280px;
  max-width: 82vw;
  z-index: 30; /* 浮在内容面板之上 */
  margin: 0;
  overflow-y: auto;
  transform: translateX(-104%);
  transition: transform var(--duration-normal) var(--ease-spring);
  pointer-events: none;
}

:root[data-focus='1']:not([data-sidebar='collapsed']) .side {
  transform: translateX(0);
  pointer-events: auto;
}

/* 专注态下侧栏覆盖层与内容区之间给一道柔和分界（纯描边，不是灰层） */
:root[data-focus='1'] .side {
  border-right: 1px solid var(--mat-border);
}

/* ==========================================================================
 * ② DOCK：macOS 特性对齐（自动隐藏 + 底边唤出 + 运行指示 + 放大）
 * 研究依据：Apple 官方 Dock 偏好项包含"自动隐藏与显示 Dock""为打开的 App 显示指示灯""放大"。
 *
 * ⚠️ 关键取舍（几何契约）：自动隐藏时**仍然保留 48px 的底部空间**（不做"收回空间"）——
 * 因为原生视图的内缩值由主进程按固定高度计算，收回空间会让视图与任务栏错位。
 * 视觉上 Dock 滑出屏幕，该区域显示应用底色。
 * ========================================================================== */
:root[data-dock='hidden'] .tool-bar .dock {
  transform: translateY(120%);
  pointer-events: none;
}

.dock {
  transition: transform var(--duration-normal) var(--dock-reveal);
}

/* 底边唤出热区：仅在自动隐藏时生效（指针到达窗口底边即唤出） */
.dock-hotzone {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 8px;
  z-index: 29;
  display: none;
}

:root[data-dock='hidden'] .dock-hotzone {
  display: block;
}

/* 运行指示（对齐 macOS"为打开的 App 显示指示灯"）：有打开的工具时图标下方一个小圆点 */
.dock-item-running {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  margin-top: -1px;
}

/* 放大：非线性（过冲）缓动；仍然只改 transform ⇒ 高度恒定 */
.dock-item {
  transition: transform var(--duration-fast) var(--ease-out-back);
}
"""
if "data-focus='1'" not in css:
    css = css.rstrip("\n") + ADD
open(CSS, "w", encoding="utf-8", newline="\n").write(css)
print("CSS_PATCHED=" + str("--ease-spring" in css and "data-focus='1'" in css))

# ---------- ② useFocusMode：写 data-focus（专注态 = 覆盖层语义） ----------
t = open(HOOK_FOCUS, encoding="utf-8").read()
if "data-focus" not in t:
    t = t.replace(
        "    root.setAttribute('data-layout-tier', state)",
        "    root.setAttribute('data-layout-tier', state)\n"
        "    // 专注态：侧栏改为**覆盖层**（浮在面板之上，展开时不再挤回布局）\n"
        "    root.setAttribute('data-focus', '1')",
        1,
    )
    t = t.replace(
        "      root.removeAttribute('data-layout-tier')",
        "      root.removeAttribute('data-layout-tier')\n      root.removeAttribute('data-focus')",
        1,
    )
open(HOOK_FOCUS, "w", encoding="utf-8", newline="\n").write(t)
print("FOCUS_ATTR=" + str("data-focus" in t))

# ---------- ③ useDockBar：常驻/自动隐藏 + 底边唤出 ----------
open(HOOK_DOCK, "w", encoding="utf-8", newline="\n").write('''import { useCallback, useEffect, useState } from 'react'

/**
 * DOCK 行为（T43 前置）：**常驻 / 自动隐藏 + 底边唤出**。
 *
 * 研究依据（Apple 官方 Dock 偏好项）：Dock 支持"自动隐藏与显示 Dock"，隐藏后
 * **指针移到屏幕底边即滑出**；并支持"放大"与"为打开的 App 显示指示灯"。
 * 参考实现范式："rail reveal slides in from its own edge"（neomjs/neo#18079）。
 *
 * 几何契约（红线）：本 hook **只改根属性**（`data-dock`），**不改变任务栏高度** ⇒
 * 原生视图的底部内缩值恒定不变（否则 WebContentsView 会与任务栏错位）。
 * 持久化：pin 状态目前仅内存（写入配置结构需单独批准）；UI 上提供切换按钮。
 */
export function useDockBar(): {
  pinned: boolean
  togglePinned: () => void
  reveal: () => void
  conceal: () => void
} {
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    const root = document.documentElement
    if (!pinned) root.setAttribute('data-dock', 'hidden')
    else root.setAttribute('data-dock', 'pinned')
    return () => {
      root.removeAttribute('data-dock')
    }
  }, [pinned])

  const reveal = useCallback(() => {
    document.documentElement.setAttribute('data-dock', 'pinned')
  }, [])
  const conceal = useCallback(() => {
    if (!pinned) document.documentElement.setAttribute('data-dock', 'hidden')
  }, [pinned])
  const togglePinned = useCallback(() => setPinned((v) => !v), [])

  return { pinned, togglePinned, reveal, conceal }
}
''')
print("DOCK_HOOK_WRITTEN=True")
