"""T38 实现：任务栏常驻 + Dock 化（图标/名称/状态区/hover 放大）+ 高度单一真源。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CSS = os.path.join(ROOT, "src", "renderer", "src", "renderer.css")
MAIN = os.path.join(ROOT, "src", "main", "index.ts")
TOOLBAR = os.path.join(ROOT, "src", "renderer", "src", "shell", "ToolBar.tsx")

# ---------- ① 主进程：内缩值改为读单一真源 ----------
m = open(MAIN, encoding="utf-8").read()
assert "const WEB_TOOLBAR_PX = 48" in m
m2 = m.replace(
    "const WEB_TOOLBAR_PX = 48",
    "// T38：任务栏高度改为**单一真源**（src/shared/layout.ts）—— CSS 与本值由守卫锁定一致。\nconst WEB_TOOLBAR_PX = DOCK_HEIGHT_PX",
    1,
)
if "from '@shared/layout'" not in m2 and "from '../shared/layout'" not in m2:
    # 主进程经 @shared 别名引入
    m2 = m2.replace(
        "import { createElectronWebToolHost, pickParentWindow } from './core/webtools/electron-host'",
        "import { createElectronWebToolHost, pickParentWindow } from './core/webtools/electron-host'\nimport { DOCK_HEIGHT_PX } from '@shared/layout'",
        1,
    )
open(MAIN, "w", encoding="utf-8", newline="\n").write(m2)
print("MAIN_PATCHED=" + str("DOCK_HEIGHT_PX" in m2))

# ---------- ② CSS：令牌 + Dock 样式 ----------
css = open(CSS, encoding="utf-8").read()
if "--dock-h:" not in css:
    css = css.replace("  --r-sm: 8px;", "  /* T38：DOCK 任务栏高度 —— 必须与 src/shared/layout.ts 的 DOCK_HEIGHT_PX 一致（守卫锁定） */\n  --dock-h: 48px;\n  --r-sm: 8px;", 1)

old_bar = """.tool-bar {
  grid-column: 1 / -1;
  grid-row: 2;
  height: 48px;"""
new_bar = """.tool-bar {
  grid-column: 1 / -1;
  grid-row: 2;
  /* T38：高度取单一真源（与主进程的底部内缩同值）—— 不得硬编码 */
  height: var(--dock-h);"""
assert old_bar in css
css = css.replace(old_bar, new_bar, 1)

DOCK_CSS = """

/* ==========================================================================
 * T38 DOCK 任务栏（常驻；参考 macOS Dock）
 * 用户决定：Q3=B（图标化、居中、hover 放大）+ **必须显示模块名称**；Q4=A（最左端侧栏开关）。
 *
 * 铁律（与几何契约直接相关，守卫 tests/unit/dock-height.spec.ts）：
 *   **hover 放大只用 transform: scale** ⇒ 任务栏**高度恒定** ⇒ 原生视图底部内缩值不受影响。
 *   绝不允许在 hover/内容变化时改变 .tool-bar 或 .dock-item 的 height（否则 WebContentsView
 *   的几何会上报错位，甚至盖住任务栏）。
 * 材质：**只消费现有档位令牌**（--card-bg / --mat-* / --ctrl-* / --r-*）⇒ 四档自动跟随，
 *   不新建材质、不重定义任何 --mat-*（用户口径："新布局基于现有材质等级"）。
 * 灰纱红线（AI_RULES 24）：本段不得出现成片半透明灰层/平面渐变承托。
 * ========================================================================== */
.dock {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden; /* 高度恒定：放大用 transform，不撑高 */
  scrollbar-width: none;
}

.dock::-webkit-scrollbar {
  display: none;
}

/* 最左端：侧栏开关（Q4=A）。T39 接入专注模式前先作为占位（禁用态），避免"点了没反应"。 */
.dock-side-toggle {
  flex: none;
}

/* 中间：图标化入口（Q3=B）—— 图标 + 常显小字名称（名称是硬要求） */
.dock-item {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 2px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  color: var(--txt-2);
  cursor: pointer;
  /* 放大只用 transform ⇒ 不改变布局与高度 */
  transition: transform var(--duration-fast) var(--ease-standard);
  transform-origin: bottom center;
}

.dock-item:hover {
  transform: scale(1.12);
}

.dock-item.active {
  color: var(--txt-1);
  border-color: var(--acc-line);
  background: var(--acc-fill);
}

.dock-item-icon {
  width: 22px;
  height: 22px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  background: var(--ctrl-bg);
  border: 1px solid var(--ctrl-line);
  box-shadow: var(--ctrl-specular);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

/* 名称：常显、超长截断（title 提供全名） */
.dock-item-label {
  max-width: 72px;
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dock-item:hover .dock-item-label {
  color: var(--txt-1);
}

/* 右端：状态区（图标化最容易丢掉的信息密度 —— 补充 6 要求保留） */
.dock-status {
  flex: none;
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding-left: var(--sp-3);
  color: var(--txt-3);
  font-size: 11px;
  font-family: 'Rajdhani', Consolas, monospace;
  white-space: nowrap;
}
"""
if ".dock {" not in css:
    css = css.rstrip("\n") + DOCK_CSS
open(CSS, "w", encoding="utf-8", newline="\n").write(css)
print("CSS_PATCHED=" + str("--dock-h:" in css and ".dock-item {" in css))
