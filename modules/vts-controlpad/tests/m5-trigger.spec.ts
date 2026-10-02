import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import type { ILogger } from '@contracts/logger'
import type { CredentialRecord, ICredentialStore } from '@contracts/credentials'
import type { IEventBus } from '@contracts/event'
import type { IGateway } from '@contracts/gateway'
import type { IModuleManager } from '@contracts/module'
import { createConfig } from '../../../src/main/core/config'
import { createEventBus } from '../../../src/main/core/bus'
import { createPermissions } from '../../../src/main/core/permissions'
import { createGateway } from '../../../src/main/core/gateway'
import { createExternalWs } from '../../../src/main/core/external-ws'
import { createExternalWsHost } from '../../../src/main/core/external-ws/electron-host'
import { createModules } from '../../../src/main/core/modules'

/**
 * M3 触发与开关态单测 + 端到端。
 *
 * 设计依据全部来自 vendor 源码（不猜）：
 * - 触发：`hotkeyTrigger({ hotkeyID })`
 * - 冷却/队列有**精确错误码**：`HotkeyCooldownNotOver` / `HotkeyQueueFull`
 *   （正好对应任务卡的"5 帧冷却 / 队列上限 32"）
 * - 开关态：订阅 `hotkeyTriggered` 事件（载荷含 `hotkeyID`、`hotkeyAction`、
 *   `hotkeyTriggeredByAPI`）⇒ 连**用户从 VTS 界面触发**也能跟踪到；
 *   无需把热键映射到表达式/道具（那需要真机验证，本卡不猜）
 * - `modelLoaded` 事件 ⇒ 切模型自动刷新热键列表
 */

const MODULE_SRC = resolve(process.cwd(), 'modules/vts-controlpad')
const requireModule = createRequire(import.meta.url)
/**
 * 本文件独立端口（vitest 并行跑文件，同端口会 EADDRINUSE）。
 * env 测试缝**在 makeRig 里设置**（不能放文件顶层）：vitest 会复用 worker，
 * 顶层赋值会被后加载的测试文件覆盖，导致连到别的端口而超时。
 */
const VTS_PORT = 8021

const vendored = requireModule('../vendor/vtubestudio/lib/types') as {
  ErrorCode: Record<string, number>
  HotkeyType: Record<string, string | number>
}
const triggerLib = requireModule('../lib/trigger') as {
  describeTriggerError(errorID: unknown): { result: string; message: string; refresh?: boolean }
  nextToggleState(prev: string | undefined): string
  TRIGGER_RESULT: Record<string, string>
}

function testLogger(sink?: string[]): ILogger {
  const rec = (level: string, message: string, data?: unknown): void => {
    sink?.push(`${level} ${message} ${data === undefined ? '' : JSON.stringify(data)}`)
  }
  const make = (): ILogger => ({
    debug: () => {},
    info: (m, d) => rec('info', m, d),
    warn: (m, d) => rec('warn', m, d),
    error: (m, d) => rec('error', m, d),
    child: () => make(),
    setLevel: () => {}
  })
  return make()
}

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

/* ---------- 纯函数：触发结果归类 ---------- */

describe('M3 describeTriggerError：把 VTS 错误码翻译成用户能照做的提示', () => {
  const E = vendored.ErrorCode

  it('冷却中 / 队列满：不是失败而是节流提示（不谎报成功、也不吓用户）', () => {
    const cool = triggerLib.describeTriggerError(E.HotkeyCooldownNotOver)
    expect(cool.result).toBe(triggerLib.TRIGGER_RESULT.COOLDOWN)
    expect(cool.message).toContain('冷却')

    const full = triggerLib.describeTriggerError(E.HotkeyQueueFull)
    expect(full.result).toBe(triggerLib.TRIGGER_RESULT.QUEUE_FULL)
    expect(full.message.length).toBeGreaterThan(0)
  })

  it('热键已不存在 → 标记需要刷新列表（换模型后点旧按钮的路径）', () => {
    const stale = triggerLib.describeTriggerError(E.HotkeyIDNotFoundInModel)
    expect(stale.result).toBe(triggerLib.TRIGGER_RESULT.STALE)
    expect(stale.refresh).toBe(true)
  })

  it('模型未加载 / 状态不符 / 道具缺失 / 数据无效 各有专门文案', () => {
    expect(triggerLib.describeTriggerError(E.HotkeyExecutionFailedBecauseNoModelLoaded).result).toBe(
      triggerLib.TRIGGER_RESULT.NO_MODEL
    )
    for (const code of [
      E.HotkeyExecutionFailedBecauseBadState,
      E.HotkeyExecutionFailedBecauseLive2DItemNotFound,
      E.HotkeyExecutionFailedBecauseLive2DItemsDoNotSupportThisHotkeyType,
      E.HotkeyIDFoundButHotkeyDataInvalid,
      E.HotkeyUnknownExecutionFailure
    ]) {
      const d = triggerLib.describeTriggerError(code)
      expect(d.result).toBe(triggerLib.TRIGGER_RESULT.FAILED)
      expect(d.message.length, '每种失败都要有可读文案').toBeGreaterThan(0)
    }
  })

  it('未知码 / 不带 errorID 一律 failed 且不抛', () => {
    for (const v of [undefined, null, NaN, 'x', 999999, {}]) {
      expect(() => triggerLib.describeTriggerError(v)).not.toThrow()
      expect(triggerLib.describeTriggerError(v).result).toBe(triggerLib.TRIGGER_RESULT.FAILED)
    }
  })

  it('★ 机械检查：trigger.js 引用的每个 ErrorCode 成员都必须存在于 vendor 枚举', async () => {
    const raw = await readFile(resolve(process.cwd(), 'modules/vts-controlpad/lib/trigger.js'), 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const names = [...src.matchAll(/ErrorCode\.(\w+)/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(0)
    for (const n of names) {
      expect(
        Object.prototype.hasOwnProperty.call(vendored.ErrorCode, n),
        `vendor 枚举没有 ErrorCode.${n} —— 拼写漂移会被 undefined === undefined 静默命中`
      ).toBe(true)
    }
  })
})

describe('M3 nextToggleState：开关态只有事件驱动，不做乐观猜测', () => {
  it('未知 → 开 → 关 → 开', () => {
    expect(triggerLib.nextToggleState(undefined)).toBe('on')
    expect(triggerLib.nextToggleState('on')).toBe('off')
    expect(triggerLib.nextToggleState('off')).toBe('on')
  })
  it('畸形输入兜底为 on', () => {
    for (const v of ['', 'wat', 'ON']) expect(triggerLib.nextToggleState(v)).toBe('on')
  })
})

/* ---------- 端到端 ---------- */

interface MockVts {
  received: string[]
  receivedTriggers: string[]
  hotkeys: Array<Record<string, unknown>>
  /** 下一次 hotkeyTrigger 返回的错误码（null = 成功）。 */
  triggerError: number | null
  /** 主动推送一个事件给已订阅的客户端。 */
  emitEvent(messageType: string, data: Record<string, unknown>): void
  close(): Promise<void>
}

async function startMockVts(): Promise<MockVts> {
  const received: string[] = []
  const receivedTriggers: string[] = []
  const sockets = new Set<WebSocket>()
  const state = {
    hotkeys: [
      { hotkeyID: 'hk1', name: '打招呼', type: 'TriggerAnimation', description: '挥手' },
      { hotkeyID: 'hk2', name: '眨眼', type: 'ToggleExpression', description: '' }
    ] as Array<Record<string, unknown>>,
    triggerError: null as number | null
  }
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
        data = {
          active: true,
          vTubeStudioVersion: '1.28.0',
          currentSessionAuthenticated: false,
          port: VTS_PORT
        }
      else if (base === 'AuthenticationToken') data = { authenticationToken: 'MOCK-TOKEN' }
      else if (base === 'Authentication') data = { authenticated: true, reason: '' }
      else if (base === 'HotkeysInCurrentModel')
        data = { modelLoaded: true, modelName: 'Mock', modelID: 'm1', availableHotkeys: state.hotkeys }
      else if (base === 'EventSubscription') data = { subscribed: true, eventName: msg.data?.eventName }
      else if (base === 'HotkeyTrigger') {
        receivedTriggers.push(String(msg.data?.hotkeyID ?? ''))
        if (state.triggerError !== null) {
          // 用 APIError 回包（库会转成带 data.errorID 的 VTubeStudioError）
          socket.send(
            JSON.stringify({
              apiName: 'VTubeStudioPublicAPI',
              apiVersion: '1.0',
              timestamp: Date.now(),
              messageType: 'APIError',
              requestID: msg.requestID,
              data: { errorID: state.triggerError, message: 'mock trigger error' }
            })
          )
          return
        }
        data = { hotkeyID: msg.data?.hotkeyID }
      }
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
    receivedTriggers,
    get hotkeys() {
      return state.hotkeys
    },
    set hotkeys(v) {
      state.hotkeys = v
    },
    get triggerError() {
      return state.triggerError
    },
    set triggerError(v) {
      state.triggerError = v
    },
    emitEvent(messageType, data) {
      for (const s of sockets) {
        s.send(
          JSON.stringify({
            apiName: 'VTubeStudioPublicAPI',
            apiVersion: '1.0',
            timestamp: Date.now(),
            messageType,
            data
          })
        )
      }
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
  gateway: IGateway
  logs: string[]
}

async function makeRig(): Promise<Rig> {
  // 模块每次从新的临时目录加载 ⇒ 重新求值并重新读取该 env（见 VTS_PORT 处说明）
  process.env.EL_VTS_URL = `ws://127.0.0.1:${VTS_PORT}`
  const logs: string[] = []
  const logger = testLogger(logs)
  const root = await mkdtemp(join(tmpdir(), 'el-vts-m3-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  await gateway.start()
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  await cp(MODULE_SRC, join(modulesDir, 'vts-controlpad'), { recursive: true })
  const externalWs = createExternalWs({ logger, permissions, host: createExternalWsHost() })
  const modules = createModules({
    logger,
    config,
    bus,
    permissions,
    gateway,
    modulesDir,
    externalWs,
    credentials: new MemoryStore()
  })
  await config.ready()
  return { modules, bus, gateway, logs }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('waitFor 超时')
}

async function fetchState(gateway: IGateway): Promise<Record<string, unknown>> {
  const res = await fetch(gateway.getRouteUrl('/vts-controlpad/state'))
  return (await res.json()) as Record<string, unknown>
}

/**
 * 以**页面身份**连模块通道：与真实页面一致——先 fetch 一次初始状态，再订阅后续推送。
 * （只订阅会永远看不到连接之前已发出的广播，真页面正是靠那次 fetch 拿到初始快照。）
 */
async function openChannel(gateway: IGateway): Promise<{
  send(payload: Record<string, unknown>): void
  states: Array<Record<string, unknown>>
  close(): void
}> {
  const u = new URL(gateway.getRouteUrl('/vts-controlpad/state'))
  const ws = new WebSocket(
    `ws://${u.host}/ws?token=${encodeURIComponent(u.searchParams.get('token') ?? '')}`
  )
  const states: Array<Record<string, unknown>> = []
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as { channel?: string; payload?: Record<string, unknown> }
      if (msg.channel === 'vts-controlpad' && msg.payload && msg.payload.type === 'state') {
        states.push(msg.payload)
      }
    } catch {
      /* ignore */
    }
  })
  await new Promise<void>((res) => ws.once('open', () => res()))
  states.push(await fetchState(gateway)) // 初始快照（等价于页面的首次 fetch）
  return {
    send(payload) {
      ws.send(JSON.stringify({ channel: 'vts-controlpad', payload }))
    },
    states,
    close() {
      ws.close()
    }
  }
}

let openVts: MockVts | null = null
afterEach(async () => {
  if (openVts) {
    await openVts.close()
    openVts = null
  }
})

describe('M3 触发（端到端）', () => {
  it('页面点按钮 → 触发对应的 hotkeyID，成功后回执 ok', async () => {
    const vts = await startMockVts()
    openVts = vts
    const rig = await makeRig()
    await rig.modules.discover()
    expect((await rig.modules.load('vts-controlpad')).ok).toBe(true)
    await rig.modules.start('vts-controlpad')
    await waitFor(() => vts.received.includes('HotkeysInCurrentModelRequest'))

    const ch = await openChannel(rig.gateway)
    await waitFor(() => ch.states.some((s) => s.status === 'authenticated'))
    ch.states.length = 0

    ch.send({ type: 'trigger', id: 'hk1' })
    await waitFor(() => vts.receivedTriggers.length === 1)
    expect(vts.receivedTriggers).toEqual(['hk1'])
    await waitFor(() => ch.states.some((s) => s.lastResult && s.lastResult.id === 'hk1' && s.lastResult.result === 'ok'))

    ch.close()
    await rig.modules.stop('vts-controlpad')
  }, 20000)

  it('冷却中（HotkeyCooldownNotOver）→ 提示"稍候"而不是报错，也不谎报成功', async () => {
    const vts = await startMockVts()
    openVts = vts
    vts.triggerError = vendored.ErrorCode.HotkeyCooldownNotOver
    const rig = await makeRig()
    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')
    await waitFor(() => vts.received.includes('HotkeysInCurrentModelRequest'))

    const ch = await openChannel(rig.gateway)
    await waitFor(() => ch.states.some((s) => s.status === 'authenticated'))
    ch.states.length = 0

    ch.send({ type: 'trigger', id: 'hk1' })
    await waitFor(() => ch.states.some((s) => s.lastResult && s.lastResult.result === 'cooldown'))
    const last = ch.states.find((s) => s.lastResult)?.lastResult as Record<string, unknown>
    expect(String(last.message)).toContain('冷却')

    ch.close()
    await rig.modules.stop('vts-controlpad')
  }, 20000)

  it('队列满（HotkeyQueueFull）→ 明确提示过快', async () => {
    const vts = await startMockVts()
    openVts = vts
    vts.triggerError = vendored.ErrorCode.HotkeyQueueFull
    const rig = await makeRig()
    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')
    await waitFor(() => vts.received.includes('HotkeysInCurrentModelRequest'))

    const ch = await openChannel(rig.gateway)
    await waitFor(() => ch.states.some((s) => s.status === 'authenticated'))
    ch.states.length = 0

    ch.send({ type: 'trigger', id: 'hk2' })
    await waitFor(() => ch.states.some((s) => s.lastResult && s.lastResult.result === 'queue-full'))

    ch.close()
    await rig.modules.stop('vts-controlpad')
  }, 20000)
})

describe('M3 开关态与自动刷新（端到端）', () => {
  it('★ 订阅 hotkeyTriggered：开关式热键收到事件即翻转状态（含用户从 VTS 界面触发）', async () => {
    const vts = await startMockVts()
    openVts = vts
    const rig = await makeRig()
    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')
    await waitFor(() => vts.received.includes('EventSubscriptionRequest'))

    const ch = await openChannel(rig.gateway)
    await waitFor(() => ch.states.some((s) => s.status === 'authenticated'))
    // 未收到任何事件前，开关态是"未知"而非猜一个值
    await waitFor(() => {
      const s = ch.states[ch.states.length - 1]
      return s && Array.isArray(s.hotkeys) && (s.hotkeys as unknown[]).length === 2
    })

    // 模拟"用户在 VTS 界面点了开关式热键"（hotkeyTriggeredByAPI=false）
    vts.emitEvent('HotkeyTriggeredEvent', {
      hotkeyID: 'hk2',
      hotkeyName: '眨眼',
      hotkeyAction: 'ToggleExpression',
      hotkeyFile: '',
      hotkeyTriggeredByAPI: false,
      modelID: 'm1',
      modelName: 'Mock',
      isLive2DItem: false
    })

    await waitFor(() => {
      const s = ch.states[ch.states.length - 1]
      const st = s?.states as Record<string, string> | undefined
      return st?.hk2 === 'on'
    })

    // 再触发一次 → 关
    vts.emitEvent('HotkeyTriggeredEvent', {
      hotkeyID: 'hk2',
      hotkeyName: '眨眼',
      hotkeyAction: 'ToggleExpression',
      hotkeyFile: '',
      hotkeyTriggeredByAPI: true,
      modelID: 'm1',
      modelName: 'Mock',
      isLive2DItem: false
    })
    await waitFor(() => {
      const s = ch.states[ch.states.length - 1]
      const st = s?.states as Record<string, string> | undefined
      return st?.hk2 === 'off'
    })

    // 触发式热键不参与开关态
    vts.emitEvent('HotkeyTriggeredEvent', {
      hotkeyID: 'hk1',
      hotkeyName: '打招呼',
      hotkeyAction: 'TriggerAnimation',
      hotkeyFile: '',
      hotkeyTriggeredByAPI: false,
      modelID: 'm1',
      modelName: 'Mock',
      isLive2DItem: false
    })
    await new Promise((r) => setTimeout(r, 200))
    const st = ch.states[ch.states.length - 1]?.states as Record<string, string>
    expect(st.hk1).toBeUndefined()

    ch.close()
    await rig.modules.stop('vts-controlpad')
  }, 20000)

  it('★ 订阅 modelLoaded：在 VTS 里换模型后自动重新读取热键（无需手动刷新）', async () => {
    const vts = await startMockVts()
    openVts = vts
    const rig = await makeRig()
    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')
    await waitFor(() => vts.received.includes('HotkeysInCurrentModelRequest'))
    await waitFor(async () => {
      const s = await fetchState(rig.gateway)
      return (s.hotkeys as unknown[])?.length === 2
    })

    // 换模型：内容变了，随后 VTS 推 ModelLoadedEvent
    vts.hotkeys = [{ hotkeyID: 'n1', name: '新模型热键', type: 'ToggleTracker', description: '' }]
    const before = vts.received.filter((t) => t === 'HotkeysInCurrentModelRequest').length
    vts.emitEvent('ModelLoadedEvent', { modelLoaded: true, modelName: 'Another', modelID: 'm2' })

    await waitFor(() => vts.received.filter((t) => t === 'HotkeysInCurrentModelRequest').length > before)
    await waitFor(async () => {
      const s = await fetchState(rig.gateway)
      const hk = s.hotkeys as Array<Record<string, unknown>>
      return Array.isArray(hk) && hk.length === 1 && hk[0].id === 'n1'
    })

    await rig.modules.stop('vts-controlpad')
  }, 20000)
})
