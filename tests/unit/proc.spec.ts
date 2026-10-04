import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProc } from '../../src/main/core/proc'
import type { ILogger } from '../../src/contracts/logger'

/**
 * C1 守卫：受管子进程的四条承诺。
 *
 * 前三条是"受管"与"自己 spawn"的差别，第四条是这项能力**存在的理由**：
 *   ① 输出按行回调（大文件处理不会把内存吃满）；
 *   ② 退出码如实回报；
 *   ③ 超时会被**强制结束**并如实标记 timedOut；
 *   ④ **removeModule 后不再有活动子进程** ⇒ 模块停用/卸载/宿主退出后无孤儿
 *      （否则 ASR/FFmpeg 会在模块消失后继续吃 CPU 与磁盘）。
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

/** 用 Node 自身当被测程序：跨平台、零依赖、可精确控制生命周期。 */
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
  }, 20000)

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
  }, 25000)

  it('⑥ 接线守卫：卸载路径必须结束子进程，且权限闸门必须用真实 API', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/main/core/modules/index.ts'), 'utf8')
    expect(src, '卸载路径必须结束该模块的子进程（否则产生孤儿）').toContain('options.proc?.removeModule(rec.id)')
    expect(src, '权限闸门必须用真实的 permissions.check 判定').toContain("permissions.check(rec.id, 'subprocess')")
    expect(src, '未注入 proc 服务时不得给出 ctx.proc').toContain('options.proc &&')
  })
})
