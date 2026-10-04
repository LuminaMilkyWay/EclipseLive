import { WebSocket } from 'ws'
import type { ExternalWsHandle, ExternalWsHooks, ExternalWsHost } from '@contracts/external-ws'

/**
 * Electron 侧宿主：对外 WebSocket 服务里**唯一**接触 socket 的部分
 * （服务本身 Electron-free，测试注入 fake）。
 *
 * 与 `overlay-windows/electron-host.ts`、`credentials/electron-cipher.ts` 同一分层：
 * 宿主只做"把回调搬过去"，**不做任何策略判断**——回环限定与权限闸门全在服务里，
 * 以保证这两条边界只有一个实现点（不会出现两处逻辑漂移）。
 *
 * 因此本宿主**只允许**由 `createExternalWs` 调用；其他调用方绕过服务即等于绕过红线。
 */
export function createExternalWsHost(): ExternalWsHost {
  return {
    connect(url: string, hooks: ExternalWsHooks): ExternalWsHandle | null {
      let socket: WebSocket
      try {
        socket = new WebSocket(url)
      } catch {
        // 同步构造失败（畸形 URL 等）——服务会据此清理登记项。
        return null
      }
      socket.on('open', () => hooks.onOpen())
      // 文本帧：`ws` 给的是 Buffer/RawData，VTS 与我们约定 JSON 文本。
      socket.on('message', (raw) => hooks.onMessage(typeof raw === 'string' ? raw : String(raw)))
      socket.on('close', () => hooks.onClose('closed'))
      socket.on('error', (err) => hooks.onError(String(err)))
      return socket
    },

    send(handle: ExternalWsHandle, data: string): boolean {
      const socket = handle as WebSocket
      if (socket.readyState !== WebSocket.OPEN) return false
      try {
        socket.send(data)
        return true
      } catch {
        return false
      }
    },

    close(handle: ExternalWsHandle): void {
      const socket = handle as WebSocket
      try {
        socket.close()
      } catch {
        // 已断开：关闭是幂等的，不视为错误。
      }
    }
  }
}
