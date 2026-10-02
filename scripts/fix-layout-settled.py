"""修复：槽位订阅 el:layout-settled（布局落定后强制补报），治"专注态宽矩形残留"。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FILES = ["src/renderer/src/slots/ToolSlot.tsx", "src/renderer/src/slots/ModulePageHost.tsx"]

for rel in FILES:
    p = os.path.join(ROOT, rel)
    t = open(p, encoding="utf-8").read()

    # ① 订阅：布局落定后强制补报（用户报障：从直播中控切到打字机后视图仍停在专注态的宽矩形）
    old_add = "    window.addEventListener('resize', report)"
    new_add = (
        "    window.addEventListener('resize', report)\n"
        "    // ⚠️ 事故修复（用户报障：从「直播中控」切到打字机/网页工具后视图仍停在**专注态的宽矩形**\n"
        "    // ⇒ 越出内容区、盖住侧栏与菜单，嵌入页面按错误宽度排版 =「文字与控件位置不正确」；\n"
        "    // 同时表现为\"一个突出的视图盖住一切 + 一个正常大小的视图叠在上面\"）。\n"
        "    // 成因：槽位只监听**自身**的 animationend/transitionend，而从专注态切回普通页时\n"
        "    // 变化发生在**根属性与栅格**上、槽位自身无动画 ⇒ 没有任何重报 ⇒ 视图停在旧宽矩形。\n"
        "    // useShellLayout 会在布局落定后广播 `el:layout-settled`，这里订阅它做**强制补报**。\n"
        "    window.addEventListener('el:layout-settled', report)"
    )
    assert old_add in t, f"未找到 resize 监听：{rel}"
    t = t.replace(old_add, new_add, 1)

    old_rm = "      window.removeEventListener('resize', report)"
    new_rm = (
        "      window.removeEventListener('resize', report)\n"
        "      window.removeEventListener('el:layout-settled', report)"
    )
    assert old_rm in t, f"未找到 resize 清理：{rel}"
    t = t.replace(old_rm, new_rm, 1)

    open(p, "w", encoding="utf-8", newline="\n").write(t)
    print(f"WIRED {rel}: layout-settled 订阅 + 清理 均已接线")
