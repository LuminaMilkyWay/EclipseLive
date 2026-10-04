"""C1 收尾：按【已核对】的真实锚点挂接 proc（门面 + ctx spread + 生命周期 + 主进程 + 单测）。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def rd(p):
    return open(os.path.join(ROOT, p), encoding="utf-8", newline="").read().replace("\r\n", "\n")


def wr(p, t):
    open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="\n").write(t)


def must(c, m):
    if not c:
        raise SystemExit("中止：" + m)


# ---------- ④ modules/index.ts ----------
p = "src/main/core/modules/index.ts"
t = rd(p)

# 4a) options 类型
if "proc?: IProcService" not in t:
    m = re.search(r"^  externalWs\?: [^\n]+\n", t, re.M)
    must(m is not None, "options.externalWs 字段未找到")
    t = t.replace(m.group(0), m.group(0) + "  /** C1：受管子进程服务（可选；未注入则模块拿不到 ctx.proc）。 */\n  proc?: IProcService\n", 1)

# 4b) import（放在 logger 契约导入之后，确保在文件顶部）
if "from '../proc'" not in t:
    m = re.search(r"^import type \{[^\n]*\} from '@contracts/logger'\n", t, re.M)
    must(m is not None, "未找到 @contracts/logger 导入")
    t = t.replace(m.group(0), m.group(0) + "import type { IProcService } from '../proc'\n", 1)

# 4c) 门面（插在已验证的 externalWs 构建之前；权限闸门用真实 API）
if "procFacade" not in t:
    m = re.search(r"^(    const externalWs = options\.externalWs\n)", t, re.M)
    must(m is not None, "未找到 externalWs 构建锚点")
    fac = (
        "    // C1: managed subprocess — module scoping here, and the **permission gate** is explicit:\n"
        "    // a module without `subprocess` simply never receives ctx.proc (so it cannot start programs).\n"
        "    const procFacade = options.proc && options.permissions.check(rec.id, 'subprocess')\n"
        "      ? options.proc.forModule(rec.id)\n"
        "      : undefined\n"
    )
    t = t.replace(m.group(0), fac + m.group(0), 1)

# 4d) ctx spread（紧跟已验证的 externalWs spread）
if "{ proc: procFacade }" not in t:
    m = re.search(r"^(      \.\.\.\(externalWsFacade \? \{ externalWs: externalWsFacade \} : \{\}\),\n)", t, re.M)
    must(m is not None, "ctx 的 externalWs spread 未找到")
    t = t.replace(m.group(1), m.group(1) + "      ...(procFacade ? { proc: procFacade } : {}),\n", 1)

# 4e) 生命周期（与已验证的 externalWs.removeModule 并列）
if "options.proc?.removeModule" not in t:
    m = re.search(r"^(    options\.externalWs\?\.removeModule\(rec\.id\)\n)", t, re.M)
    must(m is not None, "externalWs.removeModule 调用点未找到")
    t = t.replace(
        m.group(1),
        m.group(1)
        + "    // C1: the module's child processes end with it (otherwise ASR/FFmpeg become orphans\n"
        + "    // that keep eating CPU and disk after the module is gone).\n"
        + "    options.proc?.removeModule(rec.id)\n",
        1,
    )
wr(p, t)
print("  ④ modules:", "procFacade" in rd(p) and "options.proc?.removeModule" in rd(p) and "{ proc: procFacade }" in rd(p))

# ---------- ⑤ 主进程 ----------
p = "src/main/index.ts"
t = rd(p)
if "createProc" not in t:
    m = re.search(r"^import \{[^\n]*\} from '\./core/obs'\n", t, re.M)
    must(m is not None, "core/obs 导入行未找到")
    t = t.replace(m.group(0), m.group(0) + "import { createProc } from './core/proc'\n", 1)
    m = re.search(r"^(  const obs = createObs\([^\n]*\n)", t, re.M)
    must(m is not None, "createObs 调用未找到")
    t = t.replace(
        m.group(1),
        m.group(1) + "\n  // C1: managed subprocess (module stop/unload and app quit end their children).\n  const proc = createProc({ logger })\n",
        1,
    )
    m = re.search(r"^(  const modules = createModules\(\{[\s\S]{0,500}?\n  \}\)\n)", t, re.M)
    must(m is not None, "createModules 调用未找到")
    block = m.group(1)
    must("proc," not in block, "createModules 里似已含 proc")
    t = t.replace(block, block.replace("\n  })", "\n    proc,\n  })", 1), 1)
    wr(p, t)
print("  ⑤ main:", "createProc" in rd(p))

# ---------- ⑥ 单测（断言改为真实 API） ----------
guard = rd("tests/unit/proc.spec.ts") if os.path.exists(os.path.join(ROOT, "tests/unit/proc.spec.ts")) else ""
if "permissions.check(rec.id, 'subprocess')" not in guard:
    g = guard if guard else ""
    if g and "includes('subprocess')" in g:
        g = g.replace("expect(src, '未声明 subprocess 权限的模块不得拿到 ctx.proc').toContain(\"includes('subprocess')\")",
                      "expect(src, '权限闸门必须用真实的 permissions.check 判定').toContain(\"permissions.check(rec.id, 'subprocess')\")")
        wr("tests/unit/proc.spec.ts", g)
        print("  ⑥ 单测断言已修正")
    elif not g:
        print("  · 单测不存在（上一轮已中止）⇒ 需另行写入")
print("READY")
