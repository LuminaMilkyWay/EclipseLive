import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type { ILogger } from '@contracts/logger'

/**
 * 外部进程服务（T41，**新增的独立服务**，用户明确批准）。
 *
 * 边界（严格遵守）：
 * - 只提供三件事：**启动**、**查询是否在运行**、**终止**；
 * - 不碰任何既有服务与接口；不引入新依赖（只用 `node:child_process`）；
 * - **绝不用 shell**（只传可执行文件路径 + 参数数组）⇒ 不拼接命令行，避免注入；
 * - 启动的进程 `detached + unref`：本软件退出**不会**连带杀死它（默认保留 OBS）。
 */
export interface ProcessService {
  launch(exePath: string, args: readonly string[]): Promise<{ ok: boolean; pid?: number; errors?: string[] }>
  isRunning(pid: number): boolean
  terminate(pid: number): boolean
  /**
   * 执行一个**短命令**并取回 stdout（T41 增量 2：用于 `reg query` 定位 OBS 安装目录）。
   * 约束：不使用 shell、参数以数组传入、带超时、只回传 stdout 文本（不解析成命令）。
   */
  query(exePath: string, args: readonly string[], timeoutMs?: number): Promise<{ ok: boolean; stdout: string }>
}

export function createProcessService(options: { logger: ILogger }): ProcessService {
  const { logger } = options

  return {
    async launch(exePath, args) {
      if (exePath.trim() === '') return { ok: false, errors: ['可执行文件路径为空'] }
      try {
        const child = spawn(exePath, [...args], {
          // ⚠️ OBS（尤其 Steam 版）要求**工作目录 = 自己的 bin\64bit**，否则会静默退出
          // （实测：不设 cwd 时 spawn 成功但进程立刻消失，pid 也拿不到）。
          cwd: dirname(exePath),
          detached: true, // 与本软件进程组解耦 ⇒ 默认"关软件不关 OBS"
          stdio: 'ignore',
          windowsHide: false
        })
        // spawn 的失败是**异步**的（ENOENT/EACCES 等）⇒ 必须监听 error，否则会静默失败
        const spawnError = await new Promise<string | null>((resolveError) => {
          const timer = setTimeout(() => resolveError(null), 1200)
          child.once('error', (e) => {
            clearTimeout(timer)
            resolveError(String(e).slice(0, 200))
          })
          child.once('spawn', () => {
            clearTimeout(timer)
            resolveError(null)
          })
        })
        if (spawnError !== null) {
          logger.warn('external process spawn error', { exe: exePath, error: spawnError })
          return { ok: false, errors: [spawnError] }
        }
        child.unref()
        const pid = child.pid
        logger.info('external process launched', { exe: exePath, pid: pid ?? -1 })
        return pid === undefined ? { ok: false, errors: ['未能获得进程号'] } : { ok: true, pid }
      } catch (e) {
        logger.warn('external process launch failed', { exe: exePath, error: String(e).slice(0, 200) })
        return { ok: false, errors: [String(e).slice(0, 200)] }
      }
    },

    isRunning(pid) {
      if (!Number.isInteger(pid) || pid <= 0) return false
      try {
        // 信号 0：只探测存在性，不真的发信号
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },

    query(exePath, args, timeoutMs = 3000) {
      return new Promise((resolveResult) => {
        try {
          const child = spawn(exePath, [...args], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
          let out = ''
          const timer = setTimeout(() => {
            try {
              child.kill()
            } catch {
              /* 忽略 */
            }
            resolveResult({ ok: false, stdout: out })
          }, timeoutMs)
          child.stdout?.on('data', (d: Buffer) => {
            out += d.toString('utf8')
            if (out.length > 8192) out = out.slice(0, 8192) // 防御：输出上限
          })
          child.on('error', () => {
            clearTimeout(timer)
            resolveResult({ ok: false, stdout: '' })
          })
          child.on('close', () => {
            clearTimeout(timer)
            resolveResult({ ok: true, stdout: out })
          })
        } catch {
          resolveResult({ ok: false, stdout: '' })
        }
      })
    },

    terminate(pid) {
      if (!Number.isInteger(pid) || pid <= 0) return false
      try {
        process.kill(pid)
        logger.info('external process terminated', { pid })
        return true
      } catch (e) {
        logger.warn('external process terminate failed', { pid, error: String(e).slice(0, 200) })
        return false
      }
    }
  }
}
