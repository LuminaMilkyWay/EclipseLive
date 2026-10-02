import { contextBridge, ipcRenderer } from 'electron'

/**
 * T26 悬浮窗专属最小桥——与主窗 preload 富桥（index.ts）完全隔离。
 *
 * 悬浮窗载入的是模块网关页面（含 token 的模块内容）：模块页面不得获得
 * window.eclipselive（诊断/模块管理等主窗能力面），因此本桥**只**暴露
 * 一个 resize 入口——透明窗在 Windows 上没有系统 resize（Electron 平台
 * 限制），模块页面用 resize 手柄经此调整窗口自身（sender 校验 + 主进程
 * 侧 minSize 钳制，见 main/index.ts 'overlay:resize'）。
 *
 * 页面拖动不走 IPC：CSS `-webkit-app-region: drag` 由 Electron 原生处理。
 */

contextBridge.exposeInMainWorld('eclipseliveOverlay', {
  /**
   * 按增量调整窗口自身（仅本悬浮窗；其它 sender 一律被主进程忽略）。
   * 例：resize({ dw: 8, dh: -4 })。
   */
  resize(delta: { dx?: number; dy?: number; dw?: number; dh?: number }): void {
    if (typeof delta !== 'object' || delta === null) return
    ipcRenderer.send('overlay:resize', {
      dx: typeof delta.dx === 'number' ? delta.dx : 0,
      dy: typeof delta.dy === 'number' ? delta.dy : 0,
      dw: typeof delta.dw === 'number' ? delta.dw : 0,
      dh: typeof delta.dh === 'number' ? delta.dh : 0
    })
  }
})
