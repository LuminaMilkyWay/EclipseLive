import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
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
          let idx = buf.indexOf('\n')
          while (idx >= 0) {
            onLine(buf.slice(0, idx).replace(/\r$/, ''))
            buf = buf.slice(idx + 1)
            idx = buf.indexOf('\n')
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
