"""第 4 轮收尾：修 TitleScreen 的相对导入路径 + 清 Toast + 守卫纳入新文件。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TS = os.path.join(ROOT, "src", "renderer", "src", "screens", "TitleScreen.tsx")
G1 = os.path.join(ROOT, "tests", "unit", "components.spec.ts")

t = open(TS, encoding="utf-8").read()
# ① 多行 import 的相对路径下移一层（TitleScreen 在 screens/ 子目录）
t2 = t.replace("from './", "from '../")
# ② 清单里移除未使用的 Toast
t2 = re.sub(r",\s*\n\s*Toast(?=\s*\n)", "", t2)
t2 = re.sub(r"\n\s*Toast,\s*\n", "\n", t2)
open(TS, "w", encoding="utf-8", newline="\n").write(t2)
print("TS_PATH_FIXED=" + str(t != t2))

# ③ components.spec.ts 再纳入 screens/TitleScreen.tsx（方案 A：目标随拆分前移）
g = open(G1, encoding="utf-8").read()
if "TS_PATH" not in g:
    g = g.replace(
        "const MP_PATH =",
        "const TS_PATH = resolve(__dirname, '../../src/renderer/src/screens/TitleScreen.tsx')\nconst MP_PATH =",
        1,
    )
    g = g.replace("+ (await load(MP_PATH))", "+ (await load(MP_PATH)) + (await load(TS_PATH))")
    g = g.replace("+ (await readFile(MP_PATH, 'utf8'))", "+ (await readFile(MP_PATH, 'utf8')) + (await readFile(TS_PATH, 'utf8'))")
open(G1, "w", encoding="utf-8", newline="\n").write(g)
print("GUARD_PATCHED=" + str("TS_PATH" in g))
