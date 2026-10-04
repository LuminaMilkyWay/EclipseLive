"""左侧菜单：把「监控(诊断)」组移到「偏好(设置)」组之后（用户要求：诊断放到设置下面）。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
P = os.path.join(ROOT, "src", "renderer", "src", "shell", "Sidebar.tsx")

t = open(P, encoding="utf-8").read()

# 定位两组（缩进 14 空格，位于 .side-nav 内）
mon_start = t.index('              <div className="nav-group">\n                <span className="nav-group-label">监控</span>')
mon_end = t.index('              <div className="nav-group" ref={sideNavRef}>', mon_start)
mon_block = t[mon_start:mon_end]

pref_start = t.index('              <div className="nav-group">\n                <span className="nav-group-label">偏好</span>')
# 偏好组结束：其后第一个同级 nav-group 起点（关于）
after_pref = t.index('              <div className="nav-group">', pref_start + 10)
pref_block = t[pref_start:after_pref]

assert '诊断' in mon_block and '设置' in pref_block

# 先删监控组，再把监控组插到偏好组之后
t2 = t.replace(mon_block, "", 1)
t2 = t2.replace(pref_block, pref_block + mon_block, 1)
open(P, "w", encoding="utf-8", newline="\n").write(t2)

# 结果核对：模块 → 设置 → 诊断 → 更新日志
order = [t2.index('>模块<'), t2.index('>设置<'), t2.index('>诊断<'), t2.index('>更新日志<')]
print("ORDER_OK=" + str(order == sorted(order)) + " ORDER=" + str(order))
