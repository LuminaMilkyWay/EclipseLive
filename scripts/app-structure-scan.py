"""App.tsx 结构分析（只读）：组件 / 钩子 / JSX 分区 / 行数占比。"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
P = os.path.join(ROOT, "src", "renderer", "src", "App.tsx")
lines = open(P, encoding="utf-8").read().split("\n")
total = len(lines)

def find(pat, flags=0):
    rx = re.compile(pat, flags)
    return [i + 1 for i, l in enumerate(lines) if rx.search(l)]

# 顶层函数 / 组件
top_fns = []
fn_rx = re.compile(r"^(export\s+)?function\s+([A-Za-z_$][\w$]*)")
for i, l in enumerate(lines):
    m = fn_rx.match(l)
    if m:
        top_fns.append({"line": i + 1, "name": m.group(2), "exported": bool(m.group(1))})

# 顶层 const 组件（const X = (… ) => 或 const X = memo(...)）
const_rx = re.compile(r"^(export\s+)?const\s+([A-Z][\w$]*)\s*[:=]")
for i, l in enumerate(lines):
    m = const_rx.match(l)
    if m:
        top_fns.append({"line": i + 1, "name": m.group(2), "exported": bool(m.group(1)), "kind": "const"})

top_fns.sort(key=lambda x: x["line"])
# 计算每个顶层定义的行范围（到下一个顶层定义/文件尾）
for idx, fn in enumerate(top_fns):
    fn["end"] = (top_fns[idx + 1]["line"] - 1) if idx + 1 < len(top_fns) else total
    fn["lines"] = fn["end"] - fn["line"] + 1

hooks = {}
for h in ("useState", "useEffect", "useLayoutEffect", "useRef", "useCallback", "useMemo",
          "useReducer", "useContext", "useSyncExternalStore"):
    hits = []
    for i, l in enumerate(lines):
        if re.search(r"\b" + h + r"\s*[<(]", l):
            # 取该行的变量名（尽量）
            m = re.search(r"(?:const|let)\s*\[?\s*([A-Za-z_$][\w$]*)", l)
            hits.append({"line": i + 1, "name": m.group(1) if m else "", "text": l.strip()[:110]})
    hooks[h] = hits

# JSX 分区（renderer 返回块内的注释标题）
jsx_comments = []
in_return = False
for i, l in enumerate(lines):
    if re.search(r"^\s*return\s*\(", l):
        in_return = True
    if in_return and re.search(r"\{\s*/\*", l):
        jsx_comments.append({"line": i + 1, "text": l.strip()[:120]})

# 导入区
imp_end = 0
for i, l in enumerate(lines):
    if l.startswith("import "):
        imp_end = i + 1
    elif imp_end and l.strip() == "":
        break

summary = {
    "total": total,
    "importsEnd": imp_end,
    "topLevel": top_fns,
    "hookCounts": {k: len(v) for k, v in hooks.items()},
    "hooks": hooks,
    "jsxComments": jsx_comments,
}

with open(os.path.join(ROOT, ".tmp", "app-scan.json"), "w", encoding="utf-8") as fh:
    json.dump(summary, fh, ensure_ascii=False, indent=1)

print("APP_TOTAL=" + str(total))
print("IMPORTS_END=" + str(imp_end))
print("TOP_LEVEL=" + json.dumps([{ "n": f["name"], "l": f["line"], "e": f["end"], "c": f["lines"]} for f in top_fns], ensure_ascii=True))
print("HOOKS=" + json.dumps(summary["hookCounts"], ensure_ascii=True))
print("JSX_SECTIONS=" + json.dumps(summary["jsxComments"], ensure_ascii=True))
