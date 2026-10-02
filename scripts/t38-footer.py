"""T38 收尾：重写 ToolBar 的 footer 段为 DOCK 结构（常驻 + 菜单开关 + 图标/名称 + 状态区）。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
P = os.path.join(ROOT, "src", "renderer", "src", "shell", "ToolBar.tsx")

lines = open(P, encoding="utf-8").read().split("\n")
# 定位 footer 段：从 '<footer className="tool-bar">' 到其后的孤立 ')}'
start = next(i for i, l in enumerate(lines) if '<footer className="tool-bar">' in l)
end = next(i for i in range(start, len(lines)) if lines[i].strip() == ")}")

DOCK = '''      <footer className="tool-bar">
        <div className="dock">
          {/* T38 补充（用户口径）：**所有页面**都常驻这个「菜单」控件按钮 ——
              不需要自动回缩的页面也能手动收起/展开侧栏。 */}
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

          {/* 工具入口：图标（首字缩写，无需图标库）+ **常显名称**（Q3=B 的硬要求） */}
          {openTools.map((t) => (
            <span
              key={t.moduleId}
              role="button"
              tabIndex={0}
              className={tab === `tool:${t.moduleId}` ? 'dock-item tool-chip active' : 'dock-item tool-chip'}
              data-testid={`tool-chip-${t.moduleId}`}
              title={t.moduleId}
              onClick={() => setTab(`tool:${t.moduleId}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setTab(`tool:${t.moduleId}`)
              }}
            >
              <span className="dock-item-icon" aria-hidden="true">
                {t.moduleId.slice(0, 1).toUpperCase()}
              </span>
              <span className="dock-item-label">{t.moduleId}</span>
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

          {/* 右端状态区（图标化最容易丢掉的信息密度 —— 补充 6 要求保留）。
              数据源在 T40/T43 接入 OBS 状态；此处先给中性且真实的默认值。 */}
          <span className="dock-status" aria-live="polite">
            OBS 未连接
          </span>
        </div>
      </footer>'''

lines[start:end + 1] = DOCK.split("\n")
open(P, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print("FOOTER_REWRITTEN=True")
