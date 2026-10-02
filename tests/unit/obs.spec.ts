import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer as createNetServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, WebSocket } from 'ws'
import type { CoreEvent } from '@contracts/event'
import type { ILogger } from '@contracts/logger'
import { createConfig } from '../../src/main/core/config'
import { createEventBus } from '../../src/main/core/bus'
import { createGateway } from '../../src/main/core/gateway'
import {
  createCredentialStore,
  type CredentialCipher
} from '../../src/main/core/credentials'
import { createObs, type ObsRig } from '../../src/main/core/obs'

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

async function makeRig(): Promise<ObsRig> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-obs-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  await gateway.start()
  // 明文密码器即可——obs 用例只关心取存，不关心加密强度。
  const plainCipher: CredentialCipher = {
    protection: 'weak',
    encrypt: (s) => Buffer.from(s, 'utf8'),
    decrypt: (b) => b.toString('utf8')
  }
  const credentials = await createCredentialStore({
    logger,
    dir: join(root, 'credentials'),
    cipher: plainCipher
  })
  const obs = createObs({
    logger,
    config,
    bus,
    gateway,
    credentials,
    retryBaseMs: 50,
    retryCapMs: 200,
    requestTimeoutMs: 300
  })
  await config.ready()
  return { obs, bus, config, gateway, logger, root, credentials }
}

const rigs: ObsRig[] = []
const fakes: FakeObs[] = []
afterEach(async () => {
  while (rigs.length > 0) {
    const rig = rigs.pop()
    if (!rig) break
    rig.obs.disconnect()
    await rig.gateway.stop()
  }
  while (fakes.length > 0) {
    const f = fakes.pop()
    if (f) await f.close()
  }
})

function trackRig(rig: ObsRig): ObsRig {
  rigs.push(rig)
  return rig
}

async function setObsConfig(rig: ObsRig, patch: Record<string, unknown>): Promise<void> {
  const current = (rig.config.get<Record<string, unknown>>('core.obs') ?? {}) as Record<string, unknown>
  const result = rig.config.set('core.obs', { ...current, ...patch })
  expect(result.ok).toBe(true)
}

/** 轮询等待条件成立（重连/同步时序）。 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (predicate()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 50))
  }
}

/* ---------- 模拟 obs-websocket v5 服务 ---------- */

interface FakeHandlerOut {
  result: boolean
  code: number
  responseData?: unknown
}

interface FakeObs {
  server: WebSocketServer
  port: number
  identifies: Array<Record<string, unknown>>
  requests: Array<{ requestType: string; requestId: string; requestData?: unknown }>
  expectedAuth: string
  handler: (requestType: string, requestData: unknown) => FakeHandlerOut | null
  emitEvent(eventType: string, eventData: unknown): void
  close(): Promise<void>
}

/** 起一个说 v5 协议的假 OBS（Hello→Identify→Identified / op6→op7 / op5）。 */
async function startFakeObs(password?: string, fixedPort = 0): Promise<FakeObs> {
  const challenge = 'test-challenge'
  const salt = 'test-salt'
  const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest()
  const expectedAuth = createHash('sha256')
    .update(sha256(`${password ?? ''}${salt}`).toString('base64') + challenge)
    .digest('base64')

  const server = new WebSocketServer({ host: '127.0.0.1', port: fixedPort })
  const sockets: WebSocket[] = []
  const fake: FakeObs = {
    server,
    port: 0,
    identifies: [],
    requests: [],
    expectedAuth,
    handler: () => ({ result: true, code: 100, responseData: {} }),
    emitEvent(eventType, eventData) {
      for (const ws of sockets) {
        ws.send(JSON.stringify({ op: 5, d: { eventIntent: 1, eventType, eventData } }))
      }
    },
    close: async () => {
      for (const ws of sockets) ws.terminate()
      sockets.length = 0
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  server.on('connection', (ws) => {
    sockets.push(ws)
    const hello: Record<string, unknown> = {
      op: 0,
      d: { obsWebSocketVersion: '5.4.2', rpcVersion: 1 }
    }
    if (password !== undefined) {
      ;(hello.d as Record<string, unknown>).authentication = { challenge, salt }
    }
    ws.send(JSON.stringify(hello))
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { op: number; d: Record<string, unknown> }
      if (msg.op === 1) {
        fake.identifies.push(msg.d)
        if (password !== undefined && msg.d.authentication !== expectedAuth) {
          ws.close(4009, 'authentication failed')
          return
        }
        ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
      } else if (msg.op === 6) {
        const d = msg.d as unknown as {
          requestType: string
          requestId: string
          requestData?: unknown
        }
        fake.requests.push(d)
        const out = fake.handler(d.requestType, d.requestData)
        if (out) {
          ws.send(
            JSON.stringify({
              op: 7,
              d: {
                requestType: d.requestType,
                requestId: d.requestId,
                requestStatus: { result: out.result, code: out.code },
                responseData: out.responseData
              }
            })
          )
        }
      }
    })
  })

  await new Promise<void>((resolve) => server.on('listening', resolve))
  fake.port = (server.address() as { port: number }).port
  return fake
}

function trackFake(f: FakeObs): FakeObs {
  fakes.push(f)
  return f
}

/** 找一个确定没有服务监听的端口（占用后释放）。 */
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createNetServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close(() => resolve(port))
    })
  })
}

/* ---------- 握手与请求 ---------- */

describe('握手与请求', () => {
  it('握手成功 → connected；identify 参数正确；未连接时 send 拒绝', async () => {
    const rig = trackRig(await makeRig())
    await expect(rig.obs.send('GetVersion')).rejects.toThrow('not connected')

    const fake = trackFake(await startFakeObs())
    await setObsConfig(rig, { port: fake.port })
    await rig.obs.connect()

    expect(rig.obs.diagnostics().status).toBe('connected')
    expect(rig.obs.diagnostics().lastConnectedAt).toBeGreaterThan(0)
    expect(rig.obs.diagnostics().attempts).toBe(0)
    expect(fake.identifies[0]).toMatchObject({ rpcVersion: 1, eventSubscriptions: 65535 })
  })

  it('请求往返：成功/未知请求；超时拒绝', async () => {
    const rig = trackRig(await makeRig())
    const fake = trackFake(await startFakeObs())
    fake.handler = (type) =>
      type === 'GetVersion'
        ? { result: true, code: 100, responseData: { version: '30.0' } }
        : { result: false, code: 604 }
    await setObsConfig(rig, { port: fake.port })
    await rig.obs.connect()

    const res = await rig.obs.send<{ version: string }>('GetVersion')
    expect(res.ok).toBe(true)
    expect(res.status.code).toBe(100)
    expect(res.data).toEqual({ version: '30.0' })

    const bad = await rig.obs.send('NoSuchRequest')
    expect(bad.ok).toBe(false)
    expect(bad.status.code).toBe(604)
    expect(fake.requests.map((r) => r.requestType)).toEqual(['GetVersion', 'NoSuchRequest'])

    // 假服务不回包 → 超时拒绝（requestTimeoutMs=300）
    fake.handler = () => null
    await expect(rig.obs.send('NeverAnswer')).rejects.toThrow('timeout')
  })

  it('密码认证：challenge/salt SHA-256 串正确 → connected', async () => {
    const rig = trackRig(await makeRig())
    const fake = trackFake(await startFakeObs('secret-password'))
    await setObsConfig(rig, { port: fake.port, password: 'secret-password' })
    await rig.obs.connect()

    expect(rig.obs.diagnostics().status).toBe('connected')
    expect(fake.identifies[0].authentication).toBe(fake.expectedAuth)
  })

  it('OBS 需要密码但未配置 → disconnected + lastError 提示', async () => {
    const rig = trackRig(await makeRig())
    const fake = trackFake(await startFakeObs('secret-password'))
    await setObsConfig(rig, { port: fake.port })
    await rig.obs.connect()

    expect(rig.obs.diagnostics().status).toBe('disconnected')
    expect(rig.obs.diagnostics().lastError).toContain('password')
  })

  it('OBS 密码优先读凭据库（obs:password 胜过配置明文）', async () => {
    const rig = trackRig(await makeRig())
    const fake = trackFake(await startFakeObs('store-password'))
    await setObsConfig(rig, { port: fake.port, password: 'config-password' })
    rig.credentials.set('obs:password', 'store-password')
    await rig.obs.connect()

    expect(rig.obs.diagnostics().status).toBe('connected')
    expect(fake.identifies[0].authentication).toBe(fake.expectedAuth)
  })

  it('op5 事件转发为总线 obs:<eventType>（source=obs）', async () => {
    const rig = trackRig(await makeRig())
    const fake = trackFake(await startFakeObs())
    await setObsConfig(rig, { port: fake.port })
    await rig.obs.connect()

    const got: CoreEvent<unknown>[] = []
    rig.bus.subscribe('obs:SceneChanged', (e) => got.push(e))
    fake.emitEvent('SceneChanged', { sceneName: 'Live' })
    await new Promise((r) => setTimeout(r, 150))

    expect(got.length).toBe(1)
    expect(got[0].source).toBe('obs')
    expect(got[0].payload).toEqual({ sceneName: 'Live' })
  })
})

/* ---------- 断线与重连 ---------- */

describe('断线与重连', () => {
  it('OBS 未运行：connect 不抛、disconnected、attempts 自动增长、手动 disconnect 后冻结', async () => {
    const rig = trackRig(await makeRig())
    await setObsConfig(rig, { port: await freePort() })

    await expect(rig.obs.connect()).resolves.toBeUndefined()
    expect(rig.obs.diagnostics().status).toBe('disconnected')
    expect(rig.obs.diagnostics().lastError).toBeTruthy()

    // 自动重连：attempts 增长
    await waitFor(() => rig.obs.diagnostics().attempts >= 2)

    // 手动断开后停止重试
    rig.obs.disconnect()
    const frozen = rig.obs.diagnostics().attempts
    await new Promise((r) => setTimeout(r, 300))
    expect(rig.obs.diagnostics().attempts).toBe(frozen)
    expect(rig.obs.diagnostics().status).toBe('disconnected')
  })

  it('断线自动重连：关旧服务起同端口新服务 → 重新 connected', async () => {
    const rig = trackRig(await makeRig())
    const fakeA = trackFake(await startFakeObs())
    await setObsConfig(rig, { port: fakeA.port })
    await rig.obs.connect()
    expect(rig.obs.diagnostics().status).toBe('connected')

    await fakeA.close()
    await waitFor(() => rig.obs.diagnostics().status === 'disconnected')

    const fakeB = trackFake(await startFakeObs(undefined, fakeA.port))
    await waitFor(() => rig.obs.diagnostics().status === 'connected')
    expect(fakeB.identifies.length).toBe(1)
  })
})

/* ---------- 浏览器源绑定 ---------- */

describe('浏览器源绑定', () => {
  it('自动写入：bind → 连接即同步（不存在则建于当前场景，URL=网关浏览器源 URL）', async () => {
    const rig = trackRig(await makeRig())
    const fake = trackFake(await startFakeObs())
    fake.handler = (type) => {
      if (type === 'GetInputSettings') return { result: false, code: 604 }
      if (type === 'GetSceneList') {
        return { result: true, code: 100, responseData: { currentProgramSceneName: 'Live' } }
      }
      return { result: true, code: 100, responseData: {} }
    }
    await setObsConfig(rig, { port: fake.port })
    rig.obs.bindBrowserSource('Overlay', '/ov/')
    await rig.obs.connect()

    await waitFor(() => rig.obs.diagnostics().browserSources.some((b) => b.synced))
    const created = fake.requests.find((r) => r.requestType === 'CreateInput')
    expect(created?.requestData).toMatchObject({
      sceneName: 'Live',
      inputName: 'Overlay',
      inputKind: 'browser_source'
    })
    const requestData = created?.requestData as { inputSettings: { url: string } }
    expect(requestData.inputSettings.url).toBe(rig.gateway.getBrowserSourceUrl('/ov/'))
    expect(rig.obs.diagnostics().browserSources[0]).toMatchObject({
      sourceName: 'Overlay',
      path: '/ov/',
      synced: true
    })
    expect(rig.obs.listBrowserSources()).toEqual([{ sourceName: 'Overlay', path: '/ov/' }])
  })

  it('端口变化更新 + 解绑：旧 URL → port-changed → SetInputSettings 新 URL；解绑后不再同步', async () => {
    const rig = trackRig(await makeRig())
    const fake = trackFake(await startFakeObs())
    fake.handler = (type) => {
      if (type === 'GetInputSettings') return { result: false, code: 604 }
      if (type === 'GetSceneList') {
        return { result: true, code: 100, responseData: { currentProgramSceneName: 'Live' } }
      }
      return { result: true, code: 100, responseData: {} }
    }
    await setObsConfig(rig, { port: fake.port })
    rig.obs.bindBrowserSource('Overlay', '/ov/')
    await rig.obs.connect()
    await waitFor(() => rig.obs.diagnostics().browserSources.some((b) => b.synced))

    // OBS 里已存在该源，但 URL 是旧的
    fake.handler = (type) => {
      if (type === 'GetInputSettings') {
        return {
          result: true,
          code: 100,
          responseData: { inputSettings: { url: 'http://old.example/' } }
        }
      }
      return { result: true, code: 100, responseData: {} }
    }
    rig.bus.publish('gateway:port-changed', { port: 12345, previous: 1234 }, { source: 'gateway' })
    await waitFor(() => fake.requests.some((r) => r.requestType === 'SetInputSettings'))

    const setReq = fake.requests.find((r) => r.requestType === 'SetInputSettings')
    const setData = setReq?.requestData as { inputName: string; inputSettings: { url: string }; overlay: boolean }
    expect(setData.inputName).toBe('Overlay')
    expect(setData.overlay).toBe(true)
    expect(setData.inputSettings.url).toBe(rig.gateway.getBrowserSourceUrl('/ov/'))
    expect(rig.obs.diagnostics().browserSources[0].synced).toBe(true)

    // 解绑 → 端口再变也不同步
    rig.obs.unbindBrowserSource('Overlay')
    expect(rig.obs.listBrowserSources()).toEqual([])
    fake.requests.length = 0
    rig.bus.publish('gateway:port-changed', { port: 12345, previous: 1234 }, { source: 'gateway' })
    await new Promise((r) => setTimeout(r, 400))
    expect(fake.requests.filter((r) => r.requestType === 'GetInputSettings').length).toBe(0)
  })
})
