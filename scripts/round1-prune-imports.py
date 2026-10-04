"""第 1 轮辅助：按 tsc 的 TS6133/TS6196/TS6192 报告自动修剪未使用的 import。"""
import io
import os
import re
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FILES = ["src/renderer/src/App.tsx", "src/renderer/src/settings/SettingsPage.tsx"]

def tsc():
    env = dict(os.environ)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    p = subprocess.run(["npx.cmd", "tsc", "--noEmit", "-p", "tsconfig.web.json"],
                       cwd=ROOT, capture_output=True, text=True, shell=True)
    return (p.stdout or "") + (p.stderr or "")

for _ in range(6):
    out = tsc()
    errs = re.findall(r"^(.+?)\((\d+),\d+\): error (TS6133|TS6196|TS6192): (.*)$", out, re.M)
    todo = [e for e in errs if "src/renderer/src/" in e[0].replace("\\", "/")]
    if not todo:
        print("NO_MORE_IMPORT_ERRORS")
        break
    # 按文件+行号**倒序**处理，避免删行后索引漂移
    todo.sort(key=lambda e: (e[0], -int(e[1])))
    for f, lineno, code, msg in todo:
        path = os.path.join(ROOT, f)
        if not os.path.exists(path):
            continue
        txt = open(path, encoding="utf-8").read()
        lines = txt.split("\n")
        i = int(lineno) - 1
        if i >= len(lines):
            continue
        if code == "TS6192":  # 整条 import 声明都没用
            j = i
            limit = min(len(lines) - 1, i + 12)
            while j <= limit and "from '" not in lines[j]:
                j += 1
            if j > limit:
                print("SKIP_TS6192_UNTERMINATED@" + str(i + 1))
                continue
            del lines[i:j + 1]
        else:
            m = re.search(r"'([^']+)'", msg)
            name = m.group(1) if m else None
            # `import type { X } from '…'` 单名导入：整行删除（TS6196 常见形态）
            if name and re.match(r"^\s*import\s+type\s*\{[^}]*\}\s+from", lines[i]) and lines[i].count(",") == 0:
                del lines[i]
                open(path, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
                continue
            if not name:
                continue
            # 单名导入整行删；多名导入只删该标识符
            if re.match(r"^\s*import\s+\{[^}]*\}\s+from", lines[i]) and lines[i].count(",") == 0:
                del lines[i]
            else:
                lines[i] = re.sub(r"(?<![\w$])" + re.escape(name) + r",\s*", "", lines[i])
                lines[i] = re.sub(r",\s*(?<![\w$])" + re.escape(name) + r"(?![\w$])", "", lines[i])
                lines[i] = re.sub(r"\{\s*" + re.escape(name) + r"\s*,\s*", "{ ", lines[i])
                lines[i] = re.sub(r",\s*" + re.escape(name) + r"\s*\}", " }", lines[i])
                if re.match(r"^\s*import\s*\{\s*\}\s*from", lines[i]):
                    del lines[i]
        open(path, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
    print("PRUNED_ROUND=" + str(len(todo)))

out = tsc()
print("REMAINING_ERRORS=" + str(len([l for l in out.split("\n") if ": error " in l])))
print(out[:1500])
