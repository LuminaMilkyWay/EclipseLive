'use strict'

/**
 * 核心门面 → `vtubestudio` 库 的传输适配器。
 *
 * 为什么需要它：官方库自己 `new WebSocket(url)`，而 AI_RULES 第 3 条禁止模块自行开
 * WebSocket。库在 `ApiClient` 构造选项里提供了 `webSocketFactory`，于是我们**用它提供的
 * 扩展点**把传输换成核心门面 `ctx.externalWs` —— 既用官方库（不重写协议），又不绕开核心。
 *
 * 库期望的形状（从 vendor 源码读出）：
 *   - `readyState`：与 WebSocketReadyState.open(1) 比较后才 `send`
 *   - `send(string)` / `close()`
 *   - `addEventListener('open'|'message'|'close'|'error', handler)`；message 事件形如 `{ data }`
 *
 * 两个必须处理的行为（都有测试）：
 * 1. **库每 5 秒自动重连，会再次调用工厂并复用同一 URL/id** —— 门面契约规定重复 id 失败，
 *    所以工厂进来先 `close(id)` 清掉上一次登记，再 `connect`。否则 VTS 重启后永久连不上。
 * 2. **`close` 必须恰好派发一次 `close` 事件**：库在 `error` 处理里主动调 `close()` 并依赖
 *    `close` 事件去安排重连；而门面的 `close()` 会先把登记标记为已关闭，宿主随后的 close
 *    回调会被门面吞掉（服务契约：终态后不再回调）。故适配器自己**幂等**派发，谁先到算谁。
 */

/** 与库的 WebSocketReadyState 对齐（0/1/2/3）。 */
const READY_STATE = { connecting: 0, open: 1, closing: 2, closed: 3 }

/**
 * @param {object} options
 * @param {object} options.externalWs `ctx.externalWs` 门面
 * @param {string} options.url 连接地址（必须回环，由核心门面校验）
 * @param {string} options.id 连接 id（本模块内固定）
 * @param {{warn: Function}} [options.logger]
 */
function createFacadeSocket(options) {
  const { externalWs, url, id } = options
  const log = options.logger
  /** @type {Map<string, Function[]>} */
  const listeners = new Map()

  const socket = {
    readyState: READY_STATE.connecting,
    send(data) {
      return externalWs.send(id, String(data)) === true
    },
    close() {
      externalWs.close(id)
      markClosed('client closed')
    },
    addEventListener(type, handler) {
      if (typeof handler !== 'function') return
      const list = listeners.get(type)
      if (list) list.push(handler)
      else listeners.set(type, [handler])
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type)
      if (!list) return
      const i = list.indexOf(handler)
      if (i >= 0) list.splice(i, 1)
    }
  }

  function dispatch(type, event) {
    const list = listeners.get(type)
    if (!list) return
    // 复制一份：监听器内部可能增删监听
    for (const handler of [...list]) {
      try {
        handler(event)
      } catch (e) {
        log?.warn('socket listener threw', { type, error: String(e) })
      }
    }
  }

  /** 幂等终态：保证 `close` 事件恰好派发一次。 */
  function markClosed(reason) {
    if (socket.readyState === READY_STATE.closed) return
    socket.readyState = READY_STATE.closed
    dispatch('close', { code: 1000, reason })
  }

  // 见文件头第 1 点：重连复用同一 id，先清登记再连接
  externalWs.close(id)
  const result = externalWs.connect(id, {
    url,
    onOpen() {
      socket.readyState = READY_STATE.open
      dispatch('open', {})
    },
    onMessage(data) {
      dispatch('message', { data })
    },
    onClose(detail) {
      markClosed(detail)
    },
    onError(detail) {
      dispatch('error', { message: detail })
    }
  })
  if (!result.ok) {
    // 不抛：库会按 5 秒周期重试，模块状态由门面诊断与事件反映
    log?.warn('facade refused external websocket', { url, errors: result.errors })
  }

  return socket
}

module.exports = { createFacadeSocket, READY_STATE }
