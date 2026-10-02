import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * M1 传输适配器单测：把核心门面 `ctx.externalWs` 适配成 `vtubestudio` 库期望的
 * WebSocket 形状。
 *
 * 库的期望是**从 vendor 源码读出**的（非猜测）：
 *   - `readyState`（与 WebSocketReadyState.open === 1 比较后才 send）
 *   - `send(string)` / `close()`
 *   - `addEventListener('open'|'message'|'close'|'error', handler)`，message 事件形如 `{ data }`
 *   - **库在 5 秒后自动重连，会再次调用 webSocketFactory 传同一 URL** —— 于是适配器必须
 *     处理"同一 id 的重复 connect"（门面契约规定重复 id 失败；天真写法会导致永久无法重连）
 */

const requireModule = createRequire(import.meta.url)
const { createFacadeSocket, READY_STATE } = requireModule('../lib/transport') as {
  createFacadeSocket(opts: {
    externalWs: Record<string, unknown>
    url: string
    id: string
    logger?: { warn: (...a: unknown[]) => void }
  }): {
    readyState: number
    send(data: string): boolean
    close(): void
    addEventListener(type: string, handler: (ev: { data?: string }) => void): void
  }
  READY_STATE: { connecting: number; open: number; closing: number; closed: number }
}

interface ConnectCall {
  id: string
  url: string
}
interface Hooks {
  onOpen(): void
  onMessage(data: string): void
  onClose(detail: string): void
  onError(detail: string): void
}

/** 受控门面替身：记录调用，并允许测试手动驱动事件。 */
function fakeFacade(): {
  calls: { connect: ConnectCall[]; close: string[] }
  externalWs: Record<string, unknown>
  fire(type: 'open' | 'message' | 'close' | 'error', data?: string): void
} {
  const calls: { connect: ConnectCall[]; close: string[] } = { connect: [], close: [] }
  let hooks: Hooks | null = null
  const externalWs = {
    connect(id: string, spec: Hooks & { url: string }) {
      calls.connect.push({ id, url: spec.url })
      hooks = spec
      return { ok: true, errors: [] }
    },
    close(id: string) {
      calls.close.push(id)
      return true
    },
    send() {
      return true
    }
  }
  return {
    calls,
    externalWs,
    fire(type, data) {
      if (!hooks) return
      if (type === 'open') hooks.onOpen()
      else if (type === 'message') hooks.onMessage(data ?? '')
      else if (type === 'close') hooks.onClose(data ?? '')
      else hooks.onError(data ?? '')
    }
  }
}

const URL = 'ws://localhost:8001'

describe('M1 传输适配器', () => {
  it('工厂返回 WebSocket 形状：readyState / send / close / addEventListener', () => {
    const f = fakeFacade()
    const socket = createFacadeSocket({ externalWs: f.externalWs, url: URL, id: 'vts' })
    expect(typeof socket.send).toBe('function')
    expect(typeof socket.close).toBe('function')
    expect(typeof socket.addEventListener).toBe('function')
    expect(socket.readyState).toBe(READY_STATE.connecting)
  })

  it('状态迁移：connecting(0) → open(1) → closed(3)', () => {
    const f = fakeFacade()
    const socket = createFacadeSocket({ externalWs: f.externalWs, url: URL, id: 'vts' })
    expect(socket.readyState).toBe(0)
    f.fire('open')
    expect(socket.readyState).toBe(1)
    f.fire('close', 'closed')
    expect(socket.readyState).toBe(3)
  })

  it('事件按库的约定投递（message 形如 { data }）', () => {
    const f = fakeFacade()
    const socket = createFacadeSocket({ externalWs: f.externalWs, url: URL, id: 'vts' })
    const seen: string[] = []
    socket.addEventListener('open', () => seen.push('open'))
    socket.addEventListener('message', (ev) => seen.push(`msg:${ev.data}`))
    socket.addEventListener('close', () => seen.push('close'))

    f.fire('open')
    f.fire('message', '{"a":1}')
    f.fire('close', 'x')

    expect(seen).toEqual(['open', 'msg:{"a":1}', 'close'])
  })

  it('send / close 透传到门面', () => {
    const f = fakeFacade()
    const sent: Array<{ id: string; data: string }> = []
    ;(f.externalWs as { send: unknown }).send = (id: string, data: string) => {
      sent.push({ id, data })
      return true
    }
    const socket = createFacadeSocket({ externalWs: f.externalWs, url: URL, id: 'vts' })
    const closesAtConstruction = f.calls.close.length

    socket.send('{"t":1}')
    socket.close()

    expect(sent).toEqual([{ id: 'vts', data: '{"t":1}' }])
    expect(f.calls.close.length, 'close() 应再清一次登记').toBe(closesAtConstruction + 1)
  })

  it('★ 库重连复用同一 id：每次构造都先清旧登记再连接，不得因 id 冲突永久失败', () => {
    const f = fakeFacade()
    createFacadeSocket({ externalWs: f.externalWs, url: URL, id: 'vts' })
    createFacadeSocket({ externalWs: f.externalWs, url: URL, id: 'vts' }) // 库 5s 后的重连

    expect(f.calls.connect.length, '第二次仍应发起 connect').toBe(2)
    // 每次构造都先 close 一次（清理上一次的同 id 登记），否则门面判重复 id 直接失败
    expect(f.calls.close, '两次构造各清一次登记').toEqual(['vts', 'vts'])
  })

  it('门面拒绝连接时不抛：readyState 停在 connecting，等库下次重试', () => {
    const f = fakeFacade()
    ;(f.externalWs as { connect: unknown }).connect = () => ({
      ok: false,
      errors: ['missing permission: external-websocket']
    })
    let socket: ReturnType<typeof createFacadeSocket> | null = null
    expect(() => {
      socket = createFacadeSocket({ externalWs: f.externalWs, url: URL, id: 'vts' })
    }).not.toThrow()
    expect(socket!.readyState).toBe(READY_STATE.connecting)
  })

  it('监听器抛错被隔离，不影响其他监听器', () => {
    const f = fakeFacade()
    const socket = createFacadeSocket({ externalWs: f.externalWs, url: URL, id: 'vts' })
    const seen: string[] = []
    socket.addEventListener('message', () => {
      throw new Error('listener exploded')
    })
    socket.addEventListener('message', (ev) => seen.push(ev.data ?? ''))

    expect(() => f.fire('message', 'ok')).not.toThrow()
    expect(seen).toEqual(['ok'])
  })

  it('★ close 事件恰好派发一次（库在 error 里主动 close，并依赖 close 事件安排重连）', () => {
    const f = fakeFacade()
    const socket = createFacadeSocket({ externalWs: f.externalWs, url: URL, id: 'vts' })
    let closes = 0
    socket.addEventListener('close', () => {
      closes += 1
    })

    f.fire('open')
    // 库的 error 处理：先 close()（适配器立即派发 close），宿主随后也会报 close
    socket.close()
    f.fire('close', 'host also reports closed')

    expect(closes, '重复派发会让库重复安排重连').toBe(1)
    expect(socket.readyState).toBe(READY_STATE.closed)
  })

  it('宿主先报 close 时，之后的 close() 不再重复派发', () => {
    const f = fakeFacade()
    const socket = createFacadeSocket({ externalWs: f.externalWs, url: URL, id: 'vts' })
    let closes = 0
    socket.addEventListener('close', () => {
      closes += 1
    })

    f.fire('open')
    f.fire('close', 'dropped by peer')
    socket.close()

    expect(closes).toBe(1)
  })
})
