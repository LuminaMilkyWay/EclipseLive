import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ILogger } from '@contracts/logger'
import type { CredentialRecord, ICredentialStore } from '@contracts/credentials'
import type { IEventBus } from '@contracts/event'
import type { IModuleManager } from '@contracts/module'
import { createConfig } from '../../../src/main/core/config'
import { createEventBus } from '../../../src/main/core/bus'
import { createPermissions } from '../../../src/main/core/permissions'
import { createGateway } from '../../../src/main/core/gateway'
import { createExternalWs } from '../../../src/main/core/external-ws'
import { createExternalWsHost } from '../../../src/main/core/external-ws/electron-host'
import { createModules } from '../../../src/main/core/modules'

/**
 * M1 端到端认证测试：**真实核心服务**（权限/门面/宿主）+ **模拟 VTS 服务端**。
 *
 * 模拟服务端严格按库的协议回包：
 *   请求 { apiName:'VTubeStudioPublicAPI', apiVersion:'1.0', messageType:'<T>Request',
 *          requestID, data }
 *   响应 messageType 变成 '<T>Response'（见 vendor 的 lib/api.js）
 *
 * 注意：本卡在**真实 VTS 缺席**的环境下开发，故这里验证的是"模块与协议实现正确"；
 * 与真机 VTS 的联调属人工验收项（见 TASKS/M1 卡的验收清单）。
 */

const MODULE_SRC = resolve(process.cwd(), 'modules/vts-controlpad')
const requireModule = createRequire(import.meta.url)
/**
 * ⚠️ 端口**必须避开 8001**：那是模块的生产默认端口（VTS 固定端口），
 * 而开发这台的机器上很可能**真的跑着 VTube Studio**。实测踩到：本文件的
 * "VTS 未运行"用例（刻意不启 mock）反而连上了 8001 上的服务，收到真实 VTS 的
 * `TokenRequestCurrentlyOngoing`，于是"应当 unreachable"的断言失败。
 * 用独立端口 ⇒ "没有 mock 在跑"这件事才是确定的。
 */
const VTS_PORT = 8091

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

/** 内存凭据 store：可直接检视原始键空间，证明 token 落在模块命名空间下。 */
class MemoryStore implements ICredentialStore {
  raw = new Map<string, string>()
  get(key: string): string | null {
    return this.raw.get(key) ?? null
  }
  set(key: string, secret: string): void {
    this.raw.set(key, secret)
  }
  delete(key: string): boolean {
    return this.raw.delete(key)
  }
  has(key: string): boolean {
    return this.raw.has(key)
  }
  list(): CredentialRecord[] {
    return [...this.raw.keys()].sort().map((key) => ({ key, weak: false, updatedAt: 0 }))
  }
}

interface MockVts {
  received: string[]
  /** 模拟 VTS 的 API 开关（false → 库判为 "Plugin API is not enabled" 并关连接）。 */
  active: boolean
  /** 模拟用户拒绝授权（AuthenticationResponse.authenticated=false）。 */
  approve: boolean
  /** 主动断开当前所有连接（用于验证库的重连路径）。 */
  drop(): void
  close(): Promise<void>
}

/** 模拟 VTS 服务端：只实现本卡用到的最小协议。 */
async function startMockVts(): Promise<MockVts> {
  const received: string[] = []
  const sockets = new Set<WebSocket>()
  const flags = { active: true, approve: true }
  const wss = new WebSocketServer({ port: VTS_PORT })

  wss.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('message', (raw) => {
      let msg: { messageType?: string; requestID?: string; data?: Record<string, unknown> }
      try {
        msg = JSON.parse(String(raw)) as typeof msg
      } catch {
        return
      }
      const type = String(msg.messageType ?? '')
      received.push(type)
      const base = type.replace(/Request$/, '')
      let data: Record<string, unknown> = {}
      if (base === 'APIState')
        // 库在 open 后**自动**先发这一条；active=false 会被判为"API 未开启"并关连接
        data = {
          active: flags.active,
          vTubeStudioVersion: '1.28.0',
          currentSessionAuthenticated: false,
          port: VTS_PORT
        }
      else if (base === 'AuthenticationToken') data = { authenticationToken: 'MOCK-TOKEN' }
      else if (base === 'Authentication')
        data = { authenticated: flags.approve, reason: flags.approve ? '' : 'the user denied the request' }
      else if (base === 'HotkeysInCurrentModel')
        data = { modelLoaded: true, modelName: 'Mock', modelID: 'm1', availableHotkeys: [] }
      socket.send(
        JSON.stringify({
          apiName: 'VTubeStudioPublicAPI',
          apiVersion: '1.0',
          timestamp: Date.now(),
          messageType: `${base}Response`,
          requestID: msg.requestID,
          data
        })
      )
    })
  })

  await new Promise<void>((res, rej) => {
    wss.once('listening', () => res())
    wss.once('error', rej)
  })

  return {
    received,
    get active() {
      return flags.active
    },
    set active(v: boolean) {
      flags.active = v
    },
    get approve() {
      return flags.approve
    },
    set approve(v: boolean) {
      flags.approve = v
    },
    drop(): void {
      for (const s of sockets) s.close()
      sockets.clear()
    },
    close(): Promise<void> {
      return new Promise<void>((res) => {
        for (const s of sockets) s.terminate()
        sockets.clear()
        wss.close(() => res())
      })
    }
  }
}

interface Rig {
  modules: IModuleManager
  bus: IEventBus
  store: MemoryStore
}

async function makeRig(): Promise<Rig> {
  // 显式钉住本文件的端口：vitest 复用 worker，其他测试文件可能留下别的 EL_VTS_URL。
  // 模块每次从新的临时目录加载 ⇒ 重新求值并重新读取该 env，故此处设置即生效。
  process.env.EL_VTS_URL = `ws://127.0.0.1:${VTS_PORT}`
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-vts-mod-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  await gateway.start()
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  // 与真实加载一致：模块目录连同 vendor 一起复制到临时 modulesDir
  await cp(MODULE_SRC, join(modulesDir, 'vts-controlpad'), { recursive: true })

  const externalWs = createExternalWs({ logger, permissions, host: createExternalWsHost() })
  const store = new MemoryStore()
  const modules = createModules({
    logger,
    config,
    bus,
    permissions,
    gateway,
    modulesDir,
    externalWs,
    credentials: store
  })
  await config.ready()
  return { modules, bus, store }
}

async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('waitFor 超时')
}

/* ---------- 纯函数：错误码归类（含真实发生过的误判回归） ---------- */

const { STATUS, classifyAuthError } = requireModule('../lib/auth') as {
  STATUS: Record<string, string>
  classifyAuthError(errorID: unknown): string
}
const vendoredErrorCode = (
  requireModule('../vendor/vtubestudio/lib/types') as { ErrorCode: Record<string, unknown> }
).ErrorCode

describe('M1 错误码归类', () => {
  it('不带 errorID 的普通错误一律 other（曾被误判为 token 失效）', () => {
    for (const v of [undefined, null, NaN, Infinity, '100', {}, [], true]) {
      expect(classifyAuthError(v), `${String(v)} 应为 other`).toBe('other')
    }
  })

  it('按 vendor 枚举精确归类（不手写数字）', () => {
    expect(classifyAuthError(vendoredErrorCode.AuthenticationTokenMissing)).toBe('token-invalid')
    expect(classifyAuthError(vendoredErrorCode.AuthenticationPluginNameMissing)).toBe('token-invalid')
    expect(classifyAuthError(vendoredErrorCode.RequestRequiresAuthetication)).toBe('token-invalid')
    expect(classifyAuthError(vendoredErrorCode.TokenRequestDenied)).toBe('denied')
    expect(classifyAuthError(vendoredErrorCode.TokenRequestCurrentlyOngoing)).toBe('pending')
    expect(classifyAuthError(9999)).toBe('other')
  })

  it('★ 机械检查：auth.js 引用的每个 ErrorCode 成员都必须真实存在于 vendor 枚举', async () => {
    const raw = await readFile(resolve(process.cwd(), 'modules/vts-controlpad/lib/auth.js'), 'utf8')
    // 必须先剥离注释：注释里出现的示例名不是代码引用（否则会误报）
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const names = [...src.matchAll(/ErrorCode\.(\w+)/g)].map((m) => m[1])
    expect(names.length, '至少应引用若干成员').toBeGreaterThan(0)
    for (const n of names) {
      expect(
        Object.prototype.hasOwnProperty.call(vendoredErrorCode, n),
        `vendor 枚举没有 ErrorCode.${n} —— 拼写漂移会被 undefined === undefined 静默命中`
      ).toBe(true)
    }
  })

  it('STATUS 常量齐备（页面与状态机共用）', () => {
    expect(Object.values(STATUS).sort()).toEqual([
      'authenticated',
      'awaiting-approval',
      'connecting',
      'denied',
      'failed',
      'idle',
      'unreachable'
    ])
  })
})

let openVts: MockVts | null = null
afterEach(async () => {
  if (openVts) {
    await openVts.close()
    openVts = null
  }
})

describe('M1 连接与两步认证（端到端）', () => {
  it('无 token：走 AuthenticationTokenRequest → 存 token → AuthenticationRequest → authenticated', async () => {
    const vts = await startMockVts()
    openVts = vts
    const rig = await makeRig()
    const states: Array<Record<string, unknown>> = []
    rig.bus.subscribe('vts-controlpad:state-changed', (e) => {
      states.push(e.payload as Record<string, unknown>)
    })

    await rig.modules.discover()
    expect((await rig.modules.load('vts-controlpad')).ok).toBe(true)
    await rig.modules.start('vts-controlpad')

    await waitFor(() => vts.received.includes('AuthenticationTokenRequest'))
    await waitFor(() => vts.received.includes('AuthenticationRequest'))
    await waitFor(() => states.some((s) => s.status === 'authenticated'))

    // token 存入**核心加密存储的模块命名空间**（不是模块自有文件、不是内存变量）
    expect(rig.store.raw.get('module:vts-controlpad:auth-token')).toBe('MOCK-TOKEN')

    // 两步顺序正确：先请求 token，再认证
    const ti = vts.received.indexOf('AuthenticationTokenRequest')
    const ai = vts.received.indexOf('AuthenticationRequest')
    expect(ti).toBeGreaterThanOrEqual(0)
    expect(ai).toBeGreaterThan(ti)

    await rig.modules.stop('vts-controlpad')
  }, 20000)

  it('已有 token：直接认证，不重复请求 token', async () => {
    const vts = await startMockVts()
    openVts = vts
    const rig = await makeRig()
    rig.store.set('module:vts-controlpad:auth-token', 'EXISTING-TOKEN')
    const states: Array<Record<string, unknown>> = []
    rig.bus.subscribe('vts-controlpad:state-changed', (e) => {
      states.push(e.payload as Record<string, unknown>)
    })

    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')

    await waitFor(() => states.some((s) => s.status === 'authenticated'))
    expect(vts.received).toContain('AuthenticationRequest')
    expect(vts.received, '已有 token 时不应再打扰用户').not.toContain('AuthenticationTokenRequest')
    // 原 token 未被覆盖
    expect(rig.store.raw.get('module:vts-controlpad:auth-token')).toBe('EXISTING-TOKEN')

    await rig.modules.stop('vts-controlpad')
  })

  it('VTS 未运行：加载与启动都不抛，状态落到 unreachable（不阻塞软件启动）', async () => {
    // 刻意不启 mock server
    const rig = await makeRig()
    const states: Array<Record<string, unknown>> = []
    rig.bus.subscribe('vts-controlpad:state-changed', (e) => {
      states.push(e.payload as Record<string, unknown>)
    })

    await rig.modules.discover()
    expect((await rig.modules.load('vts-controlpad')).ok).toBe(true)
    await expect(rig.modules.start('vts-controlpad')).resolves.toBeTruthy()

    await waitFor(() => states.some((s) => s.status === 'unreachable'))
    expect(states.some((s) => s.status === 'authenticated')).toBe(false)

    // 模块状态仍可查询（路由注册在 init）
    await rig.modules.stop('vts-controlpad')
  })

  it('VTS 的 API 未开启（APIState.active=false）→ unreachable 且说明原因，绝不谎报已授权', async () => {
    const vts = await startMockVts()
    openVts = vts
    vts.active = false
    const rig = await makeRig()
    const states: Array<Record<string, unknown>> = []
    rig.bus.subscribe('vts-controlpad:state-changed', (e) => {
      states.push(e.payload as Record<string, unknown>)
    })

    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')

    await waitFor(() =>
      states.some((s) => s.status === 'unreachable' && String(s.detail).includes('API 未开启'))
    )
    expect(states.some((s) => s.status === 'authenticated')).toBe(false)

    await rig.modules.stop('vts-controlpad')
  }, 20000)

  it('用户拒绝授权 → 状态为失败并带上 VTS 给的原因（不静默、不谎报）', async () => {
    const vts = await startMockVts()
    openVts = vts
    vts.approve = false
    const rig = await makeRig()
    const states: Array<Record<string, unknown>> = []
    rig.bus.subscribe('vts-controlpad:state-changed', (e) => {
      states.push(e.payload as Record<string, unknown>)
    })

    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')

    await waitFor(() =>
      states.some((s) => s.status === 'failed' && String(s.detail).includes('denied the request'))
    )
    expect(states.some((s) => s.status === 'authenticated')).toBe(false)

    await rig.modules.stop('vts-controlpad')
  }, 20000)

  it('连接被 VTS 侧断开后库会自动重连（复用同一 id 不冲突）', async () => {
    const vts = await startMockVts()
    openVts = vts
    const rig = await makeRig()
    const states: Array<Record<string, unknown>> = []
    rig.bus.subscribe('vts-controlpad:state-changed', (e) => {
      states.push(e.payload as Record<string, unknown>)
    })

    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')
    await waitFor(() => states.some((s) => s.status === 'authenticated'))

    const before = vts.received.length
    vts.drop() // VTS 掉了

    // 库 5 秒后重连；重连会再次调用工厂 → 适配器先清登记再 connect，故不会卡在重复 id
    await waitFor(() => vts.received.length > before, 12000)
    expect(vts.received.length).toBeGreaterThan(before)

    await rig.modules.stop('vts-controlpad')
  }, 20000)
})
