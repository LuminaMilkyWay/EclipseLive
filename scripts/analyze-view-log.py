"""从历史实例日志重建"原生视图可见性时间线"，定位重叠/泄漏窗口。

用法：python scripts/analyze-view-log.py .tmp/dev4.log ...
判据：
  · 任一时刻可见视图 ≥2 ⇒ 打印"重叠窗口"（含区间与涉及模块）
  · 结束时仍 visible 的视图 ⇒ 打印"泄漏"（应无）
  · 同一模块 setBounds 但从未 setVisible(true) ⇒ 提示（可能视图未被正确驱动）
"""

import glob
import io
import json
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

LINE = re.compile(
    r"^(?P<ts>[\d\-T:.Z]+).*?embedded view (?P<kind>setVisible|setBounds) :: (?P<payload>\{.*\})$"
)


def analyze(path: str) -> None:
    events = []
    for raw in open(path, encoding="utf-8", errors="replace"):
        m = LINE.search(raw.strip())
        if not m:
            continue
        try:
            payload = json.loads(m.group("payload"))
        except Exception:
            continue
        events.append((m.group("ts"), m.group("kind"), payload))

    if not events:
        print(f"\n[{path}] 无视图事件")
        return

    visible: dict[str, str] = {}
    overlaps: list[str] = []
    bounds_seen: set[str] = set()
    visible_seen: set[str] = set()

    for ts, kind, p in events:
        mid = str(p.get("moduleId", "?"))
        if kind == "setBounds":
            bounds_seen.add(mid)
            continue
        want = bool(p.get("visible"))
        if want:
            visible_seen.add(mid)
        before = set(visible)
        if want:
            visible.setdefault(mid, ts)
        else:
            visible.pop(mid, None)
        if len(visible) >= 2 and len(before) < 2:
            overlaps.append(
                f"  · {ts} 重叠开始：可见 = {sorted(visible)}（本次事件：{mid} → visible={want}）"
            )

    print(f"\n[{path}] 事件 {len(events)} 条；模块 {sorted(bounds_seen | set(visible))}")
    print(f"  重叠窗口数 = {len(overlaps)}")
    for line in overlaps[:10]:
        print(line)
    print(f"  结束时仍可见（泄漏）= {sorted(visible) if visible else '无'}")
    never_shown = sorted(bounds_seen - visible_seen)
    if never_shown:
        print(f"  有 setBounds 但从未 setVisible(true)：{never_shown}")


for pattern in sys.argv[1:] or [".tmp/dev*.log"]:
    for f in sorted(glob.glob(pattern)):
        analyze(f)
