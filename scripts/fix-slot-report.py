"""修复：两个槽位接入 report-rect（动画中跳过 + 夹取窗口），并在动画结束后补报。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# ---------- ToolSlot ----------
p = os.path.join(ROOT, "src", "renderer", "src", "slots", "ToolSlot.tsx")
t = open(p, encoding="utf-8").read()

old_report = """    const report = (): void => {
      const r = el?.getBoundingClientRect()
      if (!r) return
      void window.eclipselive.reportModulePageRect(moduleId, {
        x: r.x + TOOL_SLOT_PAD,
        y: r.y + TOOL_SLOT_PAD,
        width: Math.max(r.width - TOOL_SLOT_PAD * 2, 0),
        height: Math.max(r.height - TOOL_SLOT_PAD * 2, 0)
      })
    }"""
new_report = """    // 上报几何：纯逻辑在 slots/report-rect（**动画中跳过 + 夹取到窗口可视区**）。
    // 回归背景：工具槽在档 4 入场动画（缩放）期间上报过 x677 w1846 的包围盒 —— 比窗口还大，
    // 视图被画到窗口外盖住一切（见 report-rect.ts 头注释与 tests/unit/slot-rect-report.spec.ts）。
    const report = (): void => {
      const r = el?.getBoundingClientRect()
      if (!el || !r) return
      const out = computeSlotReport({
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        offsetWidth: el.offsetWidth,
        offsetHeight: el.offsetHeight,
        pad: TOOL_SLOT_PAD,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      })
      if (!out) return // 动画进行中（或尺寸非法）⇒ 等动画结束的补报
      void window.eclipselive.reportModulePageRect(moduleId, out)
    }
    // 动画结束补报：入场/退场动画（档 4 materialize）结束后 transform 归位，此时再报一次才是最终几何。
    const onAnimEnd = (): void => report()"""
assert old_report in t
t = t.replace(old_report, new_report, 1)
t = t.replace(
    "    window.addEventListener('resize', report)\n",
    "    window.addEventListener('resize', report)\n"
    "    el?.addEventListener('animationend', onAnimEnd)\n"
    "    el?.addEventListener('transitionend', onAnimEnd)\n",
    1,
)
t = t.replace(
    "      window.removeEventListener('resize', report)\n",
    "      window.removeEventListener('resize', report)\n"
    "      el?.removeEventListener('animationend', onAnimEnd)\n"
    "      el?.removeEventListener('transitionend', onAnimEnd)\n",
    1,
)
t = t.replace(
    "import { EmptyState } from '../ui'",
    "import { EmptyState } from '../ui'\nimport { computeSlotReport } from './report-rect'",
    1,
)
open(p, "w", encoding="utf-8", newline="\n").write(t)
print("TOOLSLOT_PATCHED=" + str("computeSlotReport" in t and "onAnimEnd" in t))

# ---------- ModulePageHost ----------
p2 = os.path.join(ROOT, "src", "renderer", "src", "slots", "ModulePageHost.tsx")
t2 = open(p2, encoding="utf-8").read()
old2 = """    const report = (): void => {
      const r = el?.getBoundingClientRect()
      if (!r) return
      void window.eclipselive.reportModulePageRect(moduleId, {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height
      })
    }"""
new2 = """    // 同 ToolSlot：纯逻辑在 slots/report-rect（动画中跳过 + 夹取到窗口可视区；模块页槽 pad=0）。
    const report = (): void => {
      const r = el?.getBoundingClientRect()
      if (!el || !r) return
      const out = computeSlotReport({
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        offsetWidth: el.offsetWidth,
        offsetHeight: el.offsetHeight,
        pad: 0,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      })
      if (!out) return
      void window.eclipselive.reportModulePageRect(moduleId, out)
    }
    const onAnimEnd = (): void => report()"""
assert old2 in t2
t2 = t2.replace(old2, new2, 1)
t2 = t2.replace(
    "    window.addEventListener('resize', report)\n",
    "    window.addEventListener('resize', report)\n"
    "    el?.addEventListener('animationend', onAnimEnd)\n"
    "    el?.addEventListener('transitionend', onAnimEnd)\n",
    1,
)
t2 = t2.replace(
    "      window.removeEventListener('resize', report)\n",
    "      window.removeEventListener('resize', report)\n"
    "      el?.removeEventListener('animationend', onAnimEnd)\n"
    "      el?.removeEventListener('transitionend', onAnimEnd)\n",
    1,
)
# 引入（放在既有 import 之后）
lines = t2.split("\n")
last_imp = max(i for i, l in enumerate(lines[:30]) if l.startswith("import ") or l.startswith("} from"))
lines.insert(last_imp + 1, "import { computeSlotReport } from './report-rect'")
t2 = "\n".join(lines)
open(p2, "w", encoding="utf-8", newline="\n").write(t2)
print("HOST_PATCHED=" + str("computeSlotReport" in t2 and "onAnimEnd" in t2))
