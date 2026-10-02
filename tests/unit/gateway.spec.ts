import { createServer as createNetServer, type Server as NetServer } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CoreEvent } from '@contracts/event'
import type { ILogger } from '@contracts/logger'
import { createConfig } from '../../src/main/core/config'
import { createEventBus } from '../../src/main/core/bus'
import { createGateway, type GatewayRig } from '../../src/main/core/gateway'

/* ---------- 测试辅助 ---------- */

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

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'el-gw-'))
}

async function makeRig(preferredPort?: number): Promise<GatewayRig> {
  const logger = testLogger()
  const config = createConfig({ dir: await tempDir(), logger })
  const bus = createEventBus({ logger })
  const gateway = createGateway({ logger, config, bus, preferredPort })
  return { gateway, bus, config, logger }
}

/** 人工占用一个端口，返回占位 server（用于端口冲突测试）。 */
function occupyPort(): Promise<{ server: NetServer; port: number; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const server = createNetServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, port, close: () => new Promise<void>((r) => server.close(() => r())) })
    })
  })
}

const rigs: Array<{ gateway: { stop(): Promise<void> }; config?: unknown }> = []
afterEach(async () => {
  while (rigs.length > 0) {
    const r = rigs.pop()
    if (r) await r.gateway.stop()
  }
})

function track<T extends { gateway: { stop(): Promise<void> } }>(rig: T): T {
  rigs.push(rig)
  return rig
}

/** 等待 WebSocket 连接打开。 */
function wsOpen(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error('ws connect failed'))
  })
}

/** 等待下一条 WS 消息（信封）。 */
function wsNext(ws: WebSocket): Promise<{ channel: string; payload: unknown }> {
  return new Promise((resolve) => {
    ws.onmessage = (ev) => {
      resolve(JSON.parse(String(ev.data)) as { channel: string; payload: unknown })
    }
  })
}

function wsClosed(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) resolve()
    else ws.onclose = () => resolve()
  })
}

/* ---------- 启动 / 端口 / URL ---------- */

describe('启动与端口', () => {
  it('启动前 getPort/URL 为 null；start 后 URL 带端口与 token', async () => {
    const rig = track(await makeRig(0))
    expect(rig.gateway.getPort()).toBeNull()
    expect(rig.gateway.getBrowserSourceUrl()).toBeNull()
    expect(rig.gateway.getWebSocketUrl()).toBeNull()
    await rig.gateway.start()
    const port = rig.gateway.getPort()
    expect(port).toBeTypeOf('number')
    const route = rig.gateway.getRouteUrl('/x')
    const ws = rig.gateway.getWebSocketUrl()
    expect(route?.startsWith(`http://127.0.0.1:${port}/x?token=`)).toBe(true)
    expect(ws?.startsWith(`ws://127.0.0.1:${port}/ws?token=`)).toBe(true)
  })

  it('读取上次端口：重启后优先绑定配置中持久化的端口', async () => {
    const dir = await tempDir()
    const logger = testLogger()
    const bus = createEventBus({ logger })
    const cfgA = createConfig({ dir, logger })
    const g1 = createGateway({ logger, config: cfgA, bus, preferredPort: 0 })
    await g1.start()
    const firstPort = g1.getPort() as number
    await cfgA.flush() // 端口持久化是异步写盘，先落盘再模拟"下一次启动"
    await g1.stop()
    // 新网关不传 preferredPort → 应读配置中上次端口并成功复用（跨实例持久化）
    const g2 = createGateway({ logger, config: createConfig({ dir, logger }), bus })
    track({ gateway: g2 })
    await g2.start()
    expect(g2.getPort()).toBe(firstPort)
  })

  it('端口被占：自动回退随机端口、持久化并广播 port-changed；started 事件可见', async () => {
    const blocker = await occupyPort()
    const logger = testLogger()
    const config = createConfig({ dir: await tempDir(), logger })
    const bus = createEventBus({ logger })
    const events: CoreEvent<unknown>[] = []
    bus.subscribe('gateway:port-changed', (e) => events.push(e as CoreEvent<unknown>))
    bus.subscribe('gateway:started', (e) => events.push(e as CoreEvent<unknown>))
    const gateway = createGateway({ logger, config, bus, preferredPort: blocker.port })
    track({ gateway })
    await gateway.start()
    expect(gateway.getPort()).not.toBe(blocker.port)
    expect(config.get<{ port: number }>('core.gateway')?.port).toBe(gateway.getPort())
    const types = events.map((e) => e.type)
    expect(types).toContain('gateway:started')
    expect(types).toContain('gateway:port-changed')
    await blocker.close()
  })

  it('stop 后端口释放、诊断显示未启动', async () => {
    const rig = await makeRig(0)
    const { gateway } = rig
    await gateway.start()
    const port = gateway.getPort()
    await gateway.stop()
    expect(gateway.getPort()).toBeNull()
    expect(gateway.diagnostics().started).toBe(false)
    await expect(fetch(`http://127.0.0.1:${port}/diagnostics`)).rejects.toThrow()
  })
})

/* ---------- HTTP ---------- */

describe('HTTP 语义', () => {
  it('无 token / 错 token 一律 401；正确 token 可访问', async () => {
    const rig = track(await makeRig(0))
    const { gateway } = rig
    gateway.registerHttpRoute('GET', '/hello', () => ({ status: 200, body: { ok: true } }))
    await gateway.start()
    const port = gateway.getPort() as number
    expect((await fetch(`http://127.0.0.1:${port}/hello`)).status).toBe(401)
    expect((await fetch(`http://127.0.0.1:${port}/hello?token=wrong`)).status).toBe(401)
    const url = gateway.getRouteUrl('/hello') as string
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('GET query 与 POST JSON body 正确传递；未注册路由 404', async () => {
    const rig = track(await makeRig(0))
    const { gateway } = rig
    let seen: { q?: string | null; b?: { n?: number } } = {}
    gateway.registerHttpRoute('GET', '/q', (req) => {
      seen.q = req.query.get('name')
      return { status: 200, body: { echo: req.query.get('name') } }
    })
    gateway.registerHttpRoute('POST', '/b', (req) => {
      seen.b = req.json<{ n: number }>()
      return { status: 201, body: { doubled: (req.json<{ n: number }>()?.n ?? 0) * 2 } }
    })
    await gateway.start()
    const base = `http://127.0.0.1:${gateway.getPort()}`
    const token = (gateway.getRouteUrl('/q') as string).split('token=')[1]
    const g = await fetch(`${base}/q?name=aya&token=${token}`)
    expect(await g.json()).toEqual({ echo: 'aya' })
    expect(seen.q).toBe('aya')
    const p = await fetch(`${base}/b?token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 21 })
    })
    expect(p.status).toBe(201)
    expect(await p.json()).toEqual({ doubled: 42 })
    expect((await fetch(`${base}/nope?token=${token}`)).status).toBe(404)
  })

  it('handler 抛错 → 500 且网关存活（隔离）；路由注销后 404', async () => {
    const rig = track(await makeRig(0))
    const { gateway } = rig
    gateway.registerHttpRoute('GET', '/boom', () => {
      throw new Error('kaboom')
    })
    gateway.registerHttpRoute('GET', '/fine', () => ({ status: 200, body: { fine: true } }))
    await gateway.start()
    const base = `http://127.0.0.1:${gateway.getPort()}`
    const token = (gateway.getRouteUrl('/fine') as string).split('token=')[1]
    expect((await fetch(`${base}/boom?token=${token}`)).status).toBe(500)
    const after = await fetch(`${base}/fine?token=${token}`)
    expect(after.status).toBe(200)
    expect(gateway.diagnostics().recentErrors.length).toBeGreaterThan(0)
    gateway.unregisterHttpRoute('GET', '/fine')
    expect((await fetch(`${base}/fine?token=${token}`)).status).toBe(404)
  })

  it('内置 /diagnostics 路由（token 保护）返回诊断', async () => {
    const rig = track(await makeRig(0))
    const { gateway } = rig
    await gateway.start()
    const url = gateway.getRouteUrl('/diagnostics') as string
    const res = await fetch(url)
    const body = (await res.json()) as { started: boolean; routes: string[]; tokenPresent: boolean }
    expect(body.started).toBe(true)
    expect(body.tokenPresent).toBe(true)
    expect(body.routes).toContain('GET /diagnostics')
  })
})

/* ---------- WebSocket ---------- */

describe('WebSocket 语义', () => {
  it('无 token 拒绝连接；正确 token 连接成功', async () => {
    const rig = track(await makeRig(0))
    const { gateway } = rig
    await gateway.start()
    const port = gateway.getPort() as number
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong`)
    await wsClosed(bad)
    const ws = await wsOpen(gateway.getWebSocketUrl() as string)
    expect(gateway.diagnostics().wsClients).toBe(1)
    ws.close()
    await new Promise((r) => setTimeout(r, 100))
    expect(gateway.diagnostics().wsClients).toBe(0)
  })

  it('频道消息路由到注册 handler；未注册频道被忽略不崩溃', async () => {
    const rig = track(await makeRig(0))
    const { gateway } = rig
    const got: Array<{ payload: unknown; clientId: number }> = []
    gateway.registerWebSocketChannel('demo', {
      onMessage: (payload, client) => got.push({ payload, clientId: client.id })
    })
    await gateway.start()
    const ws = await wsOpen(gateway.getWebSocketUrl() as string)
    // handler 只在服务端本地落账，不回发客户端 —— 等待落账即可
    ws.send(JSON.stringify({ channel: 'demo', payload: { x: 1 } }))
    ws.send(JSON.stringify({ channel: 'not-registered', payload: 'ignored' }))
    ws.send('not-json')
    await new Promise((r) => setTimeout(r, 250))
    expect(got).toEqual([{ payload: { x: 1 }, clientId: expect.any(Number) }])
    ws.close()
  })

  it('广播：所有客户端收到 {channel,payload}；handler 抛错不影响广播', async () => {
    const rig = track(await makeRig(0))
    const { gateway } = rig
    gateway.registerWebSocketChannel('tick', {})
    await gateway.start()
    const ws1 = await wsOpen(gateway.getWebSocketUrl() as string)
    const ws2 = await wsOpen(gateway.getWebSocketUrl() as string)
    const p1 = wsNext(ws1)
    const p2 = wsNext(ws2)
    gateway.broadcast('tick', { n: 7 })
    expect(await p1).toEqual({ channel: 'tick', payload: { n: 7 } })
    expect(await p2).toEqual({ channel: 'tick', payload: { n: 7 } })
    // 未注册频道不可广播
    gateway.broadcast('ghost', {})
    // handler 抛错：连接与后续广播不受影响
    gateway.registerWebSocketChannel('boom', {
      onMessage: () => { throw new Error('boom') }
    })
    ws1.send(JSON.stringify({ channel: 'boom', payload: {} }))
    await new Promise((r) => setTimeout(r, 100))
    const p3 = wsNext(ws1)
    gateway.broadcast('tick', { n: 8 })
    expect(await p3).toEqual({ channel: 'tick', payload: { n: 8 } })
    ws1.close()
    ws2.close()
  })
})
