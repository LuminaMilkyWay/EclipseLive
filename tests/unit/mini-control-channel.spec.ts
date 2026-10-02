import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * T43 增量 2 守卫：内置「迷你中控」悬浮窗的公共通道契约（用户已批准新增这 4 个通道）。
 * 钉住：① 通道名与 preload 一一对应；② 主进程复用既有 overlay 服务、不自造窗口原语；
 *       ③ 窗口注册在 builtin 下（与模块悬浮窗隔离）；④ 渲染层入口按 #mini 分流。
 */
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('迷你中控悬浮窗通道（T43 增量 2）', () => {
  it('① preload 暴露 4 个方法，且通道名与主进程 handler 一一对应', () => {
    const preload = read('src/preload/index.ts')
    const main = read('src/main/index.ts')
    for (const [method, channel] of [
      ['overlayMiniOpen', 'overlay:mini:open'],
      ['overlayMiniClose', 'overlay:mini:close'],
      ['overlayMiniState', 'overlay:mini:state'],
      ['overlayMiniSet', 'overlay:mini:set']
    ] as Array<[string, string]>) {
      expect(preload, 'preload 缺 ' + method).toContain(method)
      expect(preload, 'preload 缺通道 ' + channel).toContain(channel)
      expect(main, '主进程缺 handler ' + channel).toContain("ipcMain.handle('" + channel + "'")
    }
  })

  it('② 复用既有 overlay 服务、不自造窗口原语；③ 注册在 builtin 下以隔离模块悬浮窗', () => {
    const main = read('src/main/index.ts')
    const start = main.indexOf('T43 增量 2')
    expect(start, '未找到 T43 增量 2 代码块').toBeGreaterThan(0)
    const seg = main.slice(start, main.indexOf("ipcMain.handle('obs:reconnect'", start))
    expect(seg, '应当调用既有 overlay 服务的 create').toContain('overlays.create(')
    expect(seg, '不得自造 BrowserWindow（窗口原语属核心 overlay 服务）').not.toContain('new BrowserWindow')
    expect(seg, '窗口应注册在 builtin 模块下').toContain("MINI_MODULE = 'builtin'")
  })

  it('④ 渲染层入口按 #mini 分流（同一 bundle、独立窗口）', () => {
    const entry = read('src/renderer/src/main.tsx')
    expect(entry).toContain('MiniControl')
    expect(entry, '入口应按 #mini 分流').toContain("'#mini'")
  })
})
