"""修正 ToolBar 的 DOCK 三分区结构（菜单左 / 工具居中 / 常驻+状态右）。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
P = os.path.join(ROOT, "src", "renderer", "src", "shell", "ToolBar.tsx")

t = open(P, encoding="utf-8").read()
start = t.find('        <div className="dock">')
end = t.find('      </footer>')

NEW = '''        <div className="dock">
          {/* 左端：菜单（侧栏的"来处与去处"锚点 —— 用户要求「否则菜单将无法做到从哪来回哪去」） */}
          <div className="dock-left">
            <button
              type="button"
              className="dock-item dock-side-toggle"
              data-testid="dock-sidebar-toggle"
              aria-label={sidebarCollapsed ? '展开侧栏菜单' : '收起侧栏菜单'}
              aria-pressed={sidebarCollapsed}
              title={sidebarCollapsed ? '展开侧栏菜单' : '收起侧栏菜单'}
              onClick={onToggleSidebar}
            >
              <span className="dock-item-icon" aria-hidden="true">
                ☰
              </span>
              <span className="dock-item-label">菜单</span>
            </button>
          </div>

          {/* 中间：工具图标组（真正居中；图标 = 首字缩写，无需图标库；名称常显） */}
          <div className="dock-center">
            {openTools.map((t) => (
              <span
                key={t.moduleId}
                className={tab === `tool:${t.moduleId}` ? 'dock-item tool-chip active' : 'dock-item tool-chip'}
                data-testid={`tool-chip-${t.moduleId}`}
                title={t.moduleId}
                onClick={() => setTab(`tool:${t.moduleId}`)}
              >
                <span className="dock-item-icon" aria-hidden="true">
                  {t.moduleId.slice(0, 1).toUpperCase()}
                </span>
                <span className="dock-item-label">{t.moduleId}</span>
                {t.state === 'open' && <span className="dock-item-running" aria-hidden="true" />}
                <Btn
                  variant="text"
                  onClick={(e) => {
                    e.stopPropagation()
                    // 关闭的是当前 tool 视图时切回默认页（避免 ToolSlot 残留并重开）
                    if (tab === `tool:${t.moduleId}`) setTab('diagnostics')
                    void run(`关闭 ${t.moduleId}`, () => window.eclipselive.closeWebTool(t.moduleId))
                  }}
                >
                  关闭
                </Btn>
              </span>
            ))}
          </div>

          {/* 右端：常驻开关 + 状态区（macOS Dock 特性：自动隐藏 / 为打开的 App 显示指示灯） */}
          <div className="dock-right">
            <button
              type="button"
              className="dock-item dock-pin"
              data-testid="dock-pin"
              aria-label={dockPinned ? '设为自动隐藏' : '设为常驻显示'}
              aria-pressed={dockPinned}
              title={dockPinned ? '设为自动隐藏' : '设为常驻显示'}
              onClick={onToggleDockPinned}
            >
              <span className="dock-item-icon" aria-hidden="true">
                {dockPinned ? '📌' : '⌄'}
              </span>
              <span className="dock-item-label">{dockPinned ? '常驻' : '自动隐藏'}</span>
            </button>
            <span className="dock-status" aria-live="polite">
              OBS 未连接
            </span>
          </div>
        </div>

'''
t = t[:start] + NEW + t[end:]
open(P, "w", encoding="utf-8", newline="\n").write(t)
print(
    "GROUPS="
    + str(t.count('className="dock-left"') == 1
          and t.count('className="dock-center"') == 1
          and t.count('className="dock-right"') == 1)
)
