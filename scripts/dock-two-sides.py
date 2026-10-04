"""DOCK 三分区（菜单左 / 工具居中 / 常驻+状态右）+ 侧栏"从哪来回哪去"的收放动画。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
R = os.path.join(ROOT, "src", "renderer", "src")
TOOLBAR = os.path.join(R, "shell", "ToolBar.tsx")
CSS = os.path.join(R, "renderer.css")

# ---------- ① ToolBar：三分区结构 ----------
t = open(TOOLBAR, encoding="utf-8").read()

# 菜单按钮：包进 dock-left
t = t.replace('        <div className="dock">', '        <div className="dock">\n          <div className="dock-left">', 1)
t = t.replace('            <span className="dock-item-label">菜单</span>\n          </button>',
              '            <span className="dock-item-label">菜单</span>\n          </button>\n          </div>\n\n          <div className="dock-center">', 1)
# 常驻按钮：从原位置移除，改放 dock-right
pin_start = t.find('          {/* macOS Dock 特性：常驻 / 自动隐藏（隐藏后指针到底边即唤出） */}')
pin_end = t.find('          </button>', pin_start) + len('          </button>\n')
pin_block = t[pin_start:pin_end]
t = t[:pin_start] + '          </div>\n\n          <div className="dock-right">\n' + t[pin_end:]
# 工具项在 dock-center 内结束，然后插入 dock-right 内容
t = t.replace('          {/* 右端状态区（图标化最容易丢掉的信息密度 —— 补充 6 要求保留）。',
              '          </div>\n\n          <div className="dock-right">\n' + pin_block +
              '            {/* 右端状态区（图标化最容易丢掉的信息密度 —— 补充 6 要求保留）。', 1)
t = t.replace('            OBS 未连接\n          </span>\n        </div>',
              '              OBS 未连接\n            </span>\n          </div>\n        </div>', 1)
open(TOOLBAR, "w", encoding="utf-8", newline="\n").write(t)
print("TOOLBAR_GROUPS=" + str(t.count('dock-left') == 1 and t.count('dock-center') == 1 and t.count('dock-right') == 1))

# ---------- ② CSS：三分区布局 + 侧栏"从菜单按钮来、回菜单按钮去" ----------
c = open(CSS, encoding="utf-8").read()
ADD = """

/* DOCK 三分区（用户要求：「菜单和常驻分别放到两侧，否则菜单将无法做到从哪来回哪去」）
   左端＝菜单（侧栏的"来处/去处"锚点）；中间＝工具图标组（真正居中）；右端＝常驻 + 状态区。 */
.dock-left,
.dock-right {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: none;
}

.dock-center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.dock-center::-webkit-scrollbar {
  display: none;
}

.dock-right {
  position: static;
  margin-left: auto;
}
"""
if ".dock-center" not in c:
    c = c.rstrip("\n") + ADD

# 侧栏收放：关闭态朝**左下（菜单按钮方向）**收拢 ⇒ 打开时"从那里长回来"
c = c.replace(""":root[data-focus='1'] .side {
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
}""", """:root[data-focus='1'] .side {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 280px;
  max-width: 82vw;
  z-index: 30; /* 浮在内容面板之上 */
  margin: 0;
  overflow-y: auto;
  /* 「从哪来回哪去」：关闭态朝**左下**（DOCK 左端的「菜单」按钮方向）收拢并淡出，
     打开时反向长回原位。transform-origin 定在左下角，收拢方向与按钮位置一致。 */
  transform-origin: bottom left;
  transform: translate(-18%, 42%) scale(0.42);
  opacity: 0;
  transition:
    transform var(--duration-normal) var(--ease-spring),
    opacity var(--duration-fast) var(--ease-standard);
  pointer-events: none;
}""", 1)
c = c.replace(""":root[data-focus='1']:not([data-sidebar='collapsed']) .side {
  transform: translateX(0);
  pointer-events: auto;
}""", """:root[data-focus='1']:not([data-sidebar='collapsed']) .side {
  transform: translate(0, 0) scale(1);
  opacity: 1;
  pointer-events: auto;
}""", 1)
open(CSS, "w", encoding="utf-8", newline="\n").write(c)
print("CSS_OK=" + str(".dock-center" in c and "transform-origin: bottom left" in c))
