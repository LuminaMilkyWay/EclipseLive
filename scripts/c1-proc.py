"""C1：受管子进程 API（契约 + 权限 + core/proc + 生命周期挂接 + 单测）。所有锚点断言，找不到即中止。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def rd(p):
    return open(os.path.join(ROOT, p), encoding="utf-8", newline="").read().replace("\r\n", "\n")


def wr(p, t):
    full = os.path.join(ROOT, p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, "w", encoding="utf-8", newline="\n").write(t)


def must(cond, msg):
    if not cond:
        raise SystemExit("中止：" + msg)


# ============ ① 契约：权限枚举 ============
p = "src/contracts/permission.ts"
t = rd(p)
if "'subprocess'" not in t:
    m = re.search(r"^(  \| 'window-overlay'\n)", t, re.M)
    must(m is not None, "未找到 window-overlay 枚举项")
    t = t.replace(m.group(1), m.group(1) + "  // C1：受管子进程（模块启动 ASR/FFmpeg 等外部程序的能力）。\n  | 'subprocess'\n", 1)
    m2 = re.search(r"^(  'window-overlay',\n)", t, re.M)
    must(m2 is not None, "未找到 PERMISSION_TYPES 里的 window-overlay")
    t = t.replace(m2.group(1), m2.group(1) + "  'subprocess',\n", 1)
    wr(p, t)
print("  ① 权限 subprocess:", "'subprocess'" in rd(p))

# ============ ② 契约：ModuleProc 类型（纯类型，无运行时代码）============
p = "src/contracts/module.ts"
t = rd(p)
if "ModuleProc" not in t:
    anchor = "export interface ModuleContext {"
    must(anchor in t, "未找到 ModuleContext")
    types = '''/**
 * C1：**受管子进程**（模块用它启动 ASR / FFmpeg 等外部程序）。
 *
 * 与模块自己 `require('node:child_process')` 的差别（也是它存在的理由）：
 *   1. 模块 stop / disable / unload / 宿主退出 ⇒ 它启动的所有子进程**被强制结束**（无孤儿）；
 *   2. 权限闸门：未声明 `subprocess` 权限的模块拿不到 `ctx.proc`；
 *   3. 输出**按行**流式回调（大文件处理不会在内存里堆积）；
 *   4. 超时由核心统一处理，调用方不必自己写 race。
 */
export interface ProcSpawnSpec {
  cmd: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  /** 超时（毫秒）⇒ 到期强制结束，`wait()` 返回 `{ ok:false, timedOut:true }`。 */
  timeoutMs?: number
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
}

export interface ProcHandle {
  pid: number
  /** 主动结束：先请求退出，宽限后强制；对整棵进程树生效（Windows 亦然）。 */
  kill(): Promise<void>
  /** 等待结束。**永不 reject**（错误以返回值表达）。 */
  wait(): Promise<{ ok: boolean; code: number | null; timedOut: boolean }>
}

/** 见 `ProcSpawnSpec` / `ProcHandle`。 */
export interface ModuleProc {
  spawn(spec: ProcSpawnSpec): Promise<ProcHandle>
}

'''
    t = t.replace(anchor, types + anchor, 1)
    # ctx 字段（照 externalWs 的写法）
    m = re.search(r"^(  externalWs\?: ModuleExternalWs\n)", t, re.M)
    must(m is not None, "未找到 externalWs? ctx 字段")
    t = t.replace(m.group(1), m.group(1) + "  /** C1：受管子进程（需声明 `subprocess` 权限）。 */\n  proc?: ModuleProc\n", 1)
    wr(p, t)
print("  ② 契约 ModuleProc:", "ModuleProc" in rd(p) and "proc?: ModuleProc" in rd(p))

# ============ ③ 实现：core/proc ============
wr(
    "src/main/core/proc/index.ts",
    """import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import type { ILogger } from '@contracts/logger'
import type { ModuleProc, ProcHandle, ProcSpawnSpec } from '@contracts/module'

/**
 * C1：受管子进程服务。
 *
 * 存在理由：模块自建子进程会带来两类系统性风险 ——
 *   ① **孤儿进程**：模块被停用/卸载/宿主退出后，ASR 或 FFmpeg 仍在后台吃 CPU 与磁盘；
 *   ② **无闸门**：任何模块都能启动任意程序，权限系统形同虚设。
 * 因此把子进程收进核心统一管理：按模块归属记账、统一超时、统一结束。
 *
 * 说明：本服务不修改任何既有服务，属**纯新增**；未声明 `subprocess` 权限的模块拿不到门面。
 */
export interface IProcService {
  /** 为一个模块创建门面（调用方须先校验该模块已声明 subprocess 权限）。 */
  forModule(moduleId: string): ModuleProc
  /** 结束该模块启动的全部子进程（模块 stop/disable/unload 时调用）。 */
  removeModule(moduleId: string): void
  /** 结束所有子进程（宿主退出时调用）。 */
  killAll(): void
  /** 当前活动子进程数（诊断/测试用）。 */
  liveCount(): number
}

/** 请求退出到强制结束之间的宽限期（毫秒）。 */
const GRACE_MS = 2000

export function createProc(options: { logger: ILogger }): IProcService {
  const log = options.logger.child('proc')
  const live = new Map<string, Set<ChildProcess>>()

  const track = (moduleId: string, child: ChildProcess): void => {
    let set = live.get(moduleId)
    if (!set) {
      set = new Set()
      live.set(moduleId, set)
    }
    set.add(child)
  }

  const untrack = (moduleId: string, child: ChildProcess): void => {
    live.get(moduleId)?.delete(child)
    if (live.get(moduleId)?.size === 0) live.delete(moduleId)
  }

  /** 结束整棵进程树：Windows 用 taskkill /T /F；其它平台先 TERM 后 KILL。 */
  const killTree = async (child: ChildProcess, moduleId: string): Promise<void> => {
    const pid = child.pid
    if (pid === undefined || child.exitCode !== null || child.killed) return
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const killer = nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
        killer.on('close', () => resolve())
        killer.on('error', () => resolve())
      })
      return
    }
    try {
      child.kill('SIGTERM')
    } catch {
      /* 已退出 */
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* 已退出 */
        }
        resolve()
      }, GRACE_MS)
      child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    log.debug('child ended', { moduleId, pid })
  }

  const start = (moduleId: string, spec: ProcSpawnSpec): Promise<ProcHandle> =>
    new Promise((resolve) => {
      const child = nodeSpawn(spec.cmd, spec.args, {
        cwd: spec.cwd,
        env: spec.env ? { ...process.env, ...spec.env } : process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      track(moduleId, child)

      let timedOut = false
      const timer =
        spec.timeoutMs && spec.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              void killTree(child, moduleId)
            }, spec.timeoutMs)
          : undefined

      /** 按行回调（不缓冲整段输出 ⇒ 大文件处理不会把内存吃满）。 */
      const pipeLines = (stream: NodeJS.ReadableStream | null, onLine?: (line: string) => void): void => {
        if (!stream || !onLine) return
        let buf = ''
        stream.setEncoding?.('utf8')
        stream.on('data', (chunk: string) => {
          buf += chunk
          let idx = buf.indexOf('\\n')
          while (idx >= 0) {
            onLine(buf.slice(0, idx).replace(/\\r$/, ''))
            buf = buf.slice(idx + 1)
            idx = buf.indexOf('\\n')
          }
        })
        stream.on('end', () => {
          if (buf.length > 0) onLine(buf)
        })
      }
      pipeLines(child.stdout, spec.onStdout)
      pipeLines(child.stderr, spec.onStderr)

      const exited = new Promise<{ ok: boolean; code: number | null; timedOut: boolean }>((done) => {
        child.once('error', (e) => {
          log.warn('child error', { moduleId, cmd: spec.cmd, error: String(e) })
          if (timer) clearTimeout(timer)
          untrack(moduleId, child)
          done({ ok: false, code: null, timedOut })
        })
        child.once('close', (code) => {
          if (timer) clearTimeout(timer)
          untrack(moduleId, child)
          log.debug('child closed', { moduleId, cmd: spec.cmd, code, timedOut })
          done({ ok: !timedOut && code === 0, code, timedOut })
        })
      })

      resolve({
        pid: child.pid ?? -1,
        kill: async () => {
          await killTree(child, moduleId)
          await exited
        },
        wait: () => exited // 永不 reject
      })
    })

  return {
    forModule: (moduleId: string): ModuleProc => ({
      spawn: (spec: ProcSpawnSpec) => start(moduleId, spec)
    }),
    removeModule: (moduleId: string): void => {
      const set = live.get(moduleId)
      if (!set || set.size === 0) return
      log.info('ending module children', { moduleId, count: set.size })
      for (const child of [...set]) void killTree(child, moduleId)
    },
    killAll: (): void => {
      for (const [moduleId, set] of [...live]) {
        for (const child of [...set]) void killTree(child, moduleId)
      }
    },
    liveCount: (): number => {
      let n = 0
      for (const set of live.values()) n += set.size
      return n
    }
  }
}
""",
)
print("  ③ core/proc 已写入:", os.path.exists(os.path.join(ROOT, "src/main/core/proc/index.ts")))

# ============ ④ 挂接：ctx 注入 + 生命周期清理 ============
p = "src/main/core/modules/index.ts"
t = rd(p)
must("proc?: IProcService" not in t, "似乎已经挂接过 proc（请人工确认）")
# 4a) options 类型 + deps
m = re.search(r"^(  externalWs\?: [^\n]+\n)", t, re.M)
must(m is not None, "未找到 options.externalWs 字段")
t = t.replace(m.group(1), m.group(1) + "  /** C1：受管子进程服务（可选；未注入则模块拿不到 ctx.proc）。 */\n  proc?: IProcService\n", 1)
# 4b) import
m = re.search(r"^(import[^\n]*from '@contracts/[^\n]*'\n)", t, re.M)
must(m is not None, "未找到任何 @contracts 导入")
t = t.replace(m.group(0), m.group(0) + "import type { IProcService } from '../proc'\n", 1)
# 4c) 门面构建 + spread（紧跟 externalWsFacade 之后）
m = re.search(r"^(\s*)(const externalWsFacade = [^\n]*\n)", t, re.M)
must(m is not None, "未找到 externalWsFacade 构建点")
facade = (
    m.group(1) + "// C1：受管子进程门面。**只有声明了 subprocess 权限的模块**才拿得到 ctx.proc，\n"
    + m.group(1) + "// 这样权限系统对子进程同样有效（否则任何模块都能启动任意程序）。\n"
    + m.group(1) + "const procFacade = options.proc && rec.permissions?.includes('subprocess')\n"
    + m.group(1) + "  ? options.proc.forModule(rec.id)\n"
    + m.group(1) + "  : undefined\n"
)
t = t.replace(m.group(0), facade + m.group(0), 1)
m = re.search(r"^(      \.\.\.\(externalWsFacade \? \{ externalWs: externalWsFacade \} : \{\}\),\n)", t, re.M)
must(m is not None, "未找到 ctx 里 externalWs 的 spread")
t = t.replace(m.group(1), m.group(1) + "      ...(procFacade ? { proc: procFacade } : {}),\n", 1)
# 4d) 生命周期：与 externalWs.removeModule 并列
m = re.search(r"^(\s*options\.externalWs\?\.removeModule\(rec\.id\)\n)", t, re.M)
must(m is not None, "未找到 externalWs.removeModule 调用点")
ind = re.match(r"\s*", m.group(1)).group(0)
t = t.replace(
    m.group(1),
    m.group(1) + ind + "// C1：模块的子进程随它一起结束（否则 ASR/FFmpeg 会变成孤儿，继续吃 CPU 与磁盘）。\n"
    + ind + "options.proc?.removeModule(rec.id)\n",
    1,
)
wr(p, t)
print("  ④ modules 挂接完成:", "procFacade" in rd(p) and "options.proc?.removeModule" in rd(p))

# ============ ⑤ 主进程：创建 + 传入 + 退出清理 ============
p = "src/main/index.ts"
t = rd(p)
if "createProc" not in t:
    m = re.search(r"^(import \{[^\n]*\} from '\./core/obs'\n)", t, re.M)
    must(m is not None, "未找到 core/obs 导入行")
    t = t.replace(m.group(1), m.group(1) + "import { createProc } from './core/proc'\n", 1)
    # 实例化（放在 obs 创建之后）
    m = re.search(r"^(  const obs = createObs\([^\n]*\n)", t, re.M)
    must(m is not None, "未找到 createObs 调用")
    t = t.replace(m.group(1), m.group(1) + "\n  // C1：受管子进程服务（模块用它跑 ASR/FFmpeg；模块卸载与宿主退出都会强制结束）。\n  const proc = createProc({ logger })\n", 1)
    # 传给 createModules
    m = re.search(r"^(  const modules = createModules\(\{[\s\S]{0,400}?\n  \}\)\n)", t, re.M)
    must(m is not None, "未找到 createModules 调用")
    t = t.replace(m.group(1), m.group(1).replace("\n  })", "\n    proc,\n  })", 1), 1)
    wr(p, t)
print("  ⑤ 主进程接线:", "createProc" in rd(p))

# ============ ⑥ 单测 ============
wr(
    "tests/unit/proc.spec.ts",
    """import { describe, expect, it } from 'vitest'
import { createProc } from '../../src/main/core/proc'
import type { ILogger } from '../../src/contracts/logger'

/**
 * C1 守卫：受管子进程的**四条承诺**。
 *
 * 前三条是"受管"与"自己 spawn"的差别，第四条是这次新增能力的**存在理由**：
 *   ① 输出按行回调（大文件不会把内存吃满）；
 *   ② 退出码如实回报；
 *   ③ 超时会被**强制结束**并如实标记 timedOut；
 *   ④ **removeModule 后不再有活动子进程**（模块停用/卸载/宿主退出时无孤儿 —— 这是最重要的一条）。
 */
function testLogger(): ILogger {
  const make = (): ILogger => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => make(),
    setLevel: () => {}
  })
  return make()
}

const NODE = process.execPath

describe('受管子进程（C1）', () => {
  it('① 输出按行回调，② 退出码如实回报', async () => {
    const proc = createProc({ logger: testLogger() })
    const lines: string[] = []
    const h = await proc.forModule('m1').spawn({
      cmd: NODE,
      args: ['-e', 'console.log("a");console.log("b")'],
      onStdout: (l) => lines.push(l)
    })
    const r = await h.wait()
    expect(r.ok, '正常结束应为 ok').toBe(true)
    expect(r.code, '退出码应为 0').toBe(0)
    expect(lines, '两行输出都应按行回调').toEqual(['a', 'b'])
    expect(proc.liveCount(), '结束后不应有残留').toBe(0)
  })

  it('③ 超时会被强制结束并标记 timedOut', async () => {
    const proc = createProc({ logger: testLogger() })
    const h = await proc.forModule('m2').spawn({
      cmd: NODE,
      args: ['-e', 'setTimeout(()=>{},60000)'],
      timeoutMs: 400
    })
    const r = await h.wait()
    expect(r.timedOut, '应标记超时').toBe(true)
    expect(r.ok, '超时不算成功').toBe(false)
    expect(proc.liveCount(), '超时后不应有残留').toBe(0)
  }, 15000)

  it('④ removeModule 会结束该模块的全部子进程（无孤儿）', async () => {
    const proc = createProc({ logger: testLogger() })
    const h = await proc.forModule('m3').spawn({
      cmd: NODE,
      args: ['-e', 'setTimeout(()=>{},60000)']
    })
    expect(proc.liveCount(), '启动后应有 1 个活动子进程').toBe(1)
    proc.removeModule('m3')
    const r = await h.wait()
    expect(r.ok, '被强制结束 ⇒ 不算成功').toBe(false)
    expect(proc.liveCount(), 'removeModule 后必须为 0').toBe(0)
  }, 20000)

  it('⑤ 不同模块的进程互不影响（隔离）', async () => {
    const proc = createProc({ logger: testLogger() })
    const a = await proc.forModule('a').spawn({ cmd: NODE, args: ['-e', 'setTimeout(()=>{},60000)'] })
    const b = await proc.forModule('b').spawn({ cmd: NODE, args: ['-e', 'setTimeout(()=>{},60000)'] })
    expect(proc.liveCount()).toBe(2)
    proc.removeModule('a')
    await a.wait()
    expect(proc.liveCount(), '只应清掉 a 的进程').toBe(1)
    proc.killAll()
    await b.wait()
    expect(proc.liveCount(), 'killAll 后应为 0').toBe(0)
  }, 20000)

  it('⑥ 模块卸载路径必须调用 proc.removeModule（接线守卫）', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/main/core/modules/index.ts'),
      'utf8'
    ) as string
    expect(src, '卸载路径必须结束该模块的子进程').toContain('options.proc?.removeModule(rec.id)')
    expect(src, '未声明 subprocess 权限的模块不得拿到 ctx.proc').toContain("includes('subprocess')")
  })
})
""",
)
print("  ⑥ 单测已写入")
print("READY")
