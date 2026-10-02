import { cp, mkdir, mkdtemp } from 'node:fs/promises'
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
 * M2 热键读取与网格数据单测 + 端到端。
 *
 * ★ 关键修正（任务卡原文与 API 不符，已按 vendor 枚举纠正）：
 * VTS 的 `HotkeyType` 是**动作种类**（`TriggerAnimation=0` … `ToggleModelSound=22`，共 23 项），
 * **不是**「触发式/开关式/按住式」。故本模块把三类按钮降为**两类**（触发式/开关式），
 * 且开关式由动作名以 `Toggle` 开头**派生**（不手写清单，上游增项自动跟随）。
 * **VTS 热键模型里不存在「按住式」** —— 该类别是任务卡的设想。
 */

const requireModule = createRequire(import.meta.url)
const hotkeysLib = requireModule('../lib/hotkeys') as {
  hotkeyKind(type: unknown): 'trigger' | 'toggle'
  normalizeHotkeys(raw: unknown, options?: Record<string, unknown>): Array<{
    id: string
    name: string
    kind: 'trigger' | 'toggle'
    type: string
    description: string
  }>
}
const { hotkeyKind, normalizeHotkeys } = hotkeysLib

const vendoredTypes = requireModule('../vendor/vtubestudio/lib/types') as {
  HotkeyType: Record<string, string | number>
}

const MODULE_SRC = resolve(process.cwd(), 'modules/vts-controlpad')
/**
 * 本文件用**独立端口**：vitest 并行跑测试文件，若与 m3 同绑 8001 会 EADDRINUSE。
 * 端口通过测试缝 `EL_VTS_URL` 传给模块，**必须在每次 load 模块之前设置**
 * （见 makeRig）。放在文件顶层是不安全的：vitest 会复用 worker，后加载的测试文件
 * 会污染先前文件的 env。
 */
const VTS_PORT = 8011

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

/* ---------- 纯函数：动作种类派生 ---------- */

describe('M2 hotkeyKind：从动作种类派生（不是任务卡设想的触发/开关/按住）', () => {
  it('以 Toggle 开头的动作全部归为开关式', () => {
    for (const t of [
      'ToggleExpression',
      'ToggleItemScene',
      'ToggleTracker',
      'ToggleTwitchFeature',
      'ToggleLive2DEditorAPI',
      'ToggleModelSound'
    ]) {
      expect(hotkeyKind(t), `${t} 应为开关式`).toBe('toggle')
    }
  })

  it('其余动作归为触发式（含 RemoveAll / Change* / Move* 等一次性动作）', () => {
    for (const t of [
      'TriggerAnimation',
      'ChangeIdleAnimation',
      'RemoveAllExpressions',
      'RemoveAllItems',
      'MoveModel',
      'ChangeBackground',
      'ReloadMicrophone',
      'CalibrateCam',
      'TakeScreenshot',
      'Unset'
    ]) {
      expect(hotkeyKind(t), `${t} 应为触发式`).toBe('trigger')
    }
  })

  it('未知 / 缺失 / 畸形一律兜底为触发式，且不抛', () => {
    for (const v of [undefined, null, '', 'BrandNewVtsAction', 999, -5, {}, []]) {
      expect(() => hotkeyKind(v)).not.toThrow()
      expect(hotkeyKind(v)).toBe('trigger')
    }
  })

  it('数字码也能派生（用 vendor 枚举的反向映射，不手写数字）', () => {
    // 2 = ToggleExpression、0 = TriggerAnimation（取自 vendored enum 本身）
    expect(hotkeyKind(vendoredTypes.HotkeyType.ToggleExpression)).toBe('toggle')
    expect(hotkeyKind(vendoredTypes.HotkeyType.TriggerAnimation)).toBe('trigger')
  })

  it('派生规则覆盖 vendor 枚举全部成员：开关式恰好 6 种，且与手写清单一致', () => {
    const names = Object.keys(vendoredTypes.HotkeyType).filter((k) => Number.isNaN(Number(k)))
    const toggles = names.filter((n) => hotkeyKind(n) === 'toggle')
    expect(toggles.sort()).toEqual([
      'ToggleExpression',
      'ToggleItemScene',
      'ToggleLive2DEditorAPI',
      'ToggleModelSound',
      'ToggleTracker',
      'ToggleTwitchFeature'
    ])
    // 除这 6 种外全部是触发式
    expect(names.filter((n) => hotkeyKind(n) === 'trigger')).toHaveLength(names.length - 6)
  })
})

/* ---------- 纯函数：归一化 ---------- */

describe('M2 normalizeHotkeys：容错归一化', () => {
  const raw = [
    { hotkeyID: 'a', name: '打招呼', type: 'TriggerAnimation', description: '挥手' },
    { hotkeyID: 'b', name: '眨眼', type: 'ToggleExpression', description: '' },
    { hotkeyID: 'c', name: '道具', type: 'ToggleItemScene', description: '帽子' }
  ]

  it('保留顺序、映射字段、派生 kind', () => {
    const out = normalizeHotkeys(raw)
    expect(out.map((h) => h.id)).toEqual(['a', 'b', 'c'])
    expect(out.map((h) => h.kind)).toEqual(['trigger', 'toggle', 'toggle'])
    expect(out[0]).toMatchObject({ name: '打招呼', description: '挥手', type: 'TriggerAnimation' })
  })

  it('非数组输入返回空列表（VTS 未连接/模型未加载时的常态）', () => {
    for (const v of [undefined, null, 'x', 42, {}]) {
      expect(normalizeHotkeys(v)).toEqual([])
    }
  })

  it('畸形条目不抛：缺 id 跳过、缺 name 用 id 兜底、缺 description 用空串', () => {
    const out = normalizeHotkeys([
      null,
      'garbage',
      42,
      { name: '没有 id' },
      { hotkeyID: '', name: '空 id' },
      { hotkeyID: 'ok' }
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'ok', name: 'ok', description: '', kind: 'trigger' })
  })

  it('按 id 去重（先到先得）', () => {
    const out = normalizeHotkeys([
      { hotkeyID: 'dup', name: '第一个', type: 'TriggerAnimation' },
      { hotkeyID: 'dup', name: '第二个', type: 'ToggleExpression' }
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('第一个')
  })

  it('应用 hiddenHotkeyIds（UI 内隐藏）', () => {
    const out = normalizeHotkeys(raw, { hidden: ['b'] })
    expect(out.map((h) => h.id)).toEqual(['a', 'c'])
  })

  it('应用 hotkeyOrder：列出的按给定顺序在前，其余保持原顺序在后', () => {
    const out = normalizeHotkeys(raw, { order: ['c', 'a'] })
    expect(out.map((h) => h.id)).toEqual(['c', 'a', 'b'])
  })

  it('1 到 100 个热键都能处理（不硬编码数量）', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      hotkeyID: `h${i}`,
      name: `热键${i}`,
      type: 'TriggerAnimation',
      description: ''
    }))
    expect(normalizeHotkeys(many)).toHaveLength(100)
    expect(normalizeHotkeys([many[0]])).toHaveLength(1)
    expect(normalizeHotkeys([])).toHaveLength(0)
  })
})

describe('M2 列数不再由配置决定（列表按可用宽度自动排布）', () => {
  it('hotkeys 模块不再导出列数钳制（改用 CSS auto-fill，见 control.html 的 .grid）', () => {
    expect(Object.keys(hotkeysLib).sort()).toEqual(['hotkeyKind', 'normalizeHotkeys'])
  })
})

/* ---------- 端到端：读取热键 ---------- */

interface MockVts {
  received: string[]
  /** 下次 HotkeysInCurrentModel 的返回载荷（可变，用于模拟切模型）。 */
  hotkeys: Array<Record<string, unknown>>
  modelLoaded: boolean
  close(): Promise<void>
}

async function startMockVts(): Promise<MockVts> {
  const received: string[] = []
  const sockets = new Set<WebSocket>()
  const state = {
    hotkeys: [
      { hotkeyID: 'hk1', name: '打招呼', type: 'TriggerAnimation', description: '挥手' },
      { hotkeyID: 'hk2', name: '眨眼', type: 'ToggleExpression', description: '' }
    ] as Array<Record<string, unknown>>,
    modelLoaded: true
  }
  const wss = new WebSocketServer({ port: VTS_PORT })
  wss.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('message', (raw) => {
      let msg: { messageType?: string; requestID?: string }
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
          active: true,
          vTubeStudioVersion: '1.28.0',
          currentSessionAuthenticated: false,
          port: VTS_PORT
        }
      else if (base === 'AuthenticationToken') data = { authenticationToken: 'MOCK-TOKEN' }
      else if (base === 'Authentication') data = { authenticated: true, reason: '' }
      else if (base === 'HotkeysInCurrentModel')
        data = {
          modelLoaded: state.modelLoaded,
          modelName: state.modelLoaded ? 'MockModel' : '',
          modelID: state.modelLoaded ? 'm1' : '',
          availableHotkeys: state.hotkeys
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
    get hotkeys() {
      return state.hotkeys
    },
    set hotkeys(v) {
      state.hotkeys = v
    },
    get modelLoaded() {
      return state.modelLoaded
    },
    set modelLoaded(v) {
      state.modelLoaded = v
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
}

async function makeRig(): Promise<Rig> {
  // 模块每次从新的临时目录加载 ⇒ 会重新求值并重新读取该 env；此处设置才不会被其他
  // 测试文件（同一 worker 内先后执行）留存的取值污染。
  process.env.EL_VTS_URL = `ws://127.0.0.1:${VTS_PORT}`
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-vts-m2-'))
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
  return { modules, bus, gateway }
}

async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('waitFor 超时')
}

async function fetchState(gateway: IGateway): Promise<Record<string, unknown>> {
  const url = gateway.getRouteUrl('/vts-controlpad/state')
  const res = await fetch(url)
  return (await res.json()) as Record<string, unknown>
}

let openVts: MockVts | null = null
afterEach(async () => {
  if (openVts) {
    await openVts.close()
    openVts = null
  }
})

describe('M2 热键读取（端到端）', () => {
  it('认证后自动读取当前模型热键，状态路由可读、通道有广播', async () => {
    const vts = await startMockVts()
    openVts = vts
    const rig = await makeRig()
    const pushed: Array<Record<string, unknown>> = []
    rig.bus.subscribe('vts-controlpad:state-changed', (e) => {
      pushed.push(e.payload as Record<string, unknown>)
    })

    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')
    await waitFor(() => vts.received.includes('HotkeysInCurrentModelRequest'))
    await waitFor(async () => {
      const s = await fetchState(rig.gateway)
      return Array.isArray(s.hotkeys) && (s.hotkeys as unknown[]).length === 2
    })

    const state = await fetchState(rig.gateway)
    expect(state.status).toBe('authenticated')
    expect(state.model).toMatchObject({ loaded: true, name: 'MockModel' })
    const hotkeys = state.hotkeys as Array<Record<string, unknown>>
    expect(hotkeys.map((h) => h.id)).toEqual(['hk1', 'hk2'])
    expect(hotkeys.map((h) => h.kind)).toEqual(['trigger', 'toggle'])
    expect(state.gridColumns).toBeUndefined()

    await rig.modules.stop('vts-controlpad')
  }, 20000)

  it('模型未加载 / 无热键 → 空列表且 modelLoaded=false（页面据此显示空状态）', async () => {
    const vts = await startMockVts()
    openVts = vts
    vts.modelLoaded = false
    vts.hotkeys = []
    const rig = await makeRig()

    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')
    await waitFor(() => vts.received.includes('HotkeysInCurrentModelRequest'))
    await waitFor(async () => {
      const s = await fetchState(rig.gateway)
      return s.status === 'authenticated'
    })

    const state = await fetchState(rig.gateway)
    expect(state.hotkeys).toEqual([])
    expect(state.model).toMatchObject({ loaded: false })

    await rig.modules.stop('vts-controlpad')
  }, 20000)

  it('页面经通道请求 refresh → 重新读取（切换模型后手动刷新路径）', async () => {
    const vts = await startMockVts()
    openVts = vts
    const rig = await makeRig()

    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')
    await waitFor(() => vts.received.includes('HotkeysInCurrentModelRequest'))

    // 模拟用户在 VTS 里换了模型
    vts.hotkeys = [{ hotkeyID: 'new1', name: '新模型热键', type: 'ToggleTracker', description: '' }]

    // 用网关 URL 里的 token 连模块通道（与页面同路径）
    const stateUrl = new URL(rig.gateway.getRouteUrl('/vts-controlpad/state'))
    const wsUrl = `ws://${stateUrl.host}/ws?token=${encodeURIComponent(stateUrl.searchParams.get('token') ?? '')}`
    const sock = new WebSocket(wsUrl)
    await new Promise<void>((res) => sock.once('open', () => res()))
    const before = vts.received.filter((t) => t === 'HotkeysInCurrentModelRequest').length
    sock.send(JSON.stringify({ channel: 'vts-controlpad', payload: { type: 'refresh' } }))

    await waitFor(
      () => vts.received.filter((t) => t === 'HotkeysInCurrentModelRequest').length > before
    )
    await waitFor(async () => {
      const s = await fetchState(rig.gateway)
      const hk = s.hotkeys as Array<Record<string, unknown>>
      return Array.isArray(hk) && hk.length === 1 && hk[0].id === 'new1'
    })
    const state = await fetchState(rig.gateway)
    expect((state.hotkeys as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'new1',
      kind: 'toggle'
    })

    sock.close()
    await rig.modules.stop('vts-controlpad')
  }, 20000)
})
