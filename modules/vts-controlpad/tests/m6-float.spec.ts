import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import type { ILogger } from '@contracts/logger'
import type { IConfig } from '@contracts/config'
import type { CredentialRecord, ICredentialStore } from '@contracts/credentials'
import type { IEventBus } from '@contracts/event'
import type {
  IOverlayWindows,
  OverlayBounds,
  OverlayHostHooks,
  OverlayScreen,
  OverlayWindowHost,
  OverlayWindowSpec
} from '@contracts/overlays'
import type { IGlobalShortcuts, ShortcutHost } from '@contracts/shortcuts'
import type { IModuleManager } from '@contracts/module'
import { createConfig } from '../../../src/main/core/config'
import { createEventBus } from '../../../src/main/core/bus'
import { createPermissions } from '../../../src/main/core/permissions'
import { createGateway } from '../../../src/main/core/gateway'
import { createExternalWs } from '../../../src/main/core/external-ws'
import { createExternalWsHost } from '../../../src/main/core/external-ws/electron-host'
import { createOverlayWindows } from '../../../src/main/core/overlay-windows'
import { createShortcuts } from '../../../src/main/core/shortcuts'
import { createModules } from '../../../src/main/core/modules'

/**
 * M4 悬浮窗：几何纯函数 + **与打字机模块的严格隔离**（验收 4/5）。
 *
 * 隔离不是本模块自己实现的，而是核心架构给的：归属键 `${moduleId}:${id}`、
 * facade 模块作用域、跨模块快捷键冲突检测。本文件的端到端部分**同时加载两个真实模块**
 * （prologue-live 与 vts-controlpad），用同一个核心服务验证它们互不影响。
 */

const MODULE_SRC = resolve(process.cwd(), 'modules/vts-controlpad')
const SIBLING_SRC = resolve(process.cwd(), 'modules/prologue-live')
const requireModule = createRequire(import.meta.url)
const VTS_PORT = 8031
process.env.EL_VTS_URL = `ws://127.0.0.1:${VTS_PORT}`

const geo = requireModule('../lib/float') as {
  SNAP_THRESHOLD: number
  PERSIST_DEBOUNCE: number
  centerOnScreen(s: OverlayScreen, w: number, h: number): { x: number; y: number }
  containedIn(s: OverlayScreen, b: OverlayBounds): boolean
  snapBounds(
    b: OverlayBounds,
    s: OverlayScreen,
    t?: number
  ): { bounds: OverlayBounds; changed: boolean }
  computeCreateBounds(cfg: Record<string, unknown>, s: OverlayScreen): OverlayBounds
  screenForBounds(screens: OverlayScreen[], b: OverlayBounds): OverlayScreen | null
  clampFloatColumns(v: unknown): number
}

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

/* ---------- 受控宿主 ---------- */

interface FakeWindow {
  moduleId: string
  id: string
  spec: OverlayWindowSpec
  hooks: OverlayHostHooks
  bounds: OverlayBounds
  clickThrough: boolean
}

class FakeOverlayHost implements OverlayWindowHost {
  windows = new Map<object, FakeWindow>()
  screens(): OverlayScreen[] {
    return [
      { id: 'p1', primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 'p2', primary: false, bounds: { x: 1920, y: 0, width: 1080, height: 1920 } }
    ]
  }
  create(spec: OverlayWindowSpec, hooks: OverlayHostHooks): object | null {
    const handle = { n: this.windows.size + 1 }
    this.windows.set(handle, {
      moduleId: '',
      id: '',
      spec,
      hooks,
      bounds: spec.bounds ?? { x: 0, y: 0, width: 400, height: 300 },
      clickThrough: spec.clickThrough ?? false
    })
    return handle
  }
  destroy(handle: object): void {
    this.windows.delete(handle)
  }
  setClickThrough(handle: object, on: boolean): void {
    const w = this.windows.get(handle)
    if (w) w.clickThrough = on
  }
  setAlwaysOnTop(): void {}
  setBounds(handle: object, bounds: OverlayBounds): void {
    const w = this.windows.get(handle)
    if (w) w.bounds = bounds
  }
  getBounds(handle: object): OverlayBounds {
    const w = this.windows.get(handle)
    if (!w) throw new Error('no such window')
    return w.bounds
  }
  /** 测试驱动：模拟用户拖动。 */
  move(handle: object, bounds: OverlayBounds): void {
    const w = this.windows.get(handle)
    if (!w) return
    w.bounds = bounds
    w.hooks.onMoved(bounds)
  }
}

class FakeShortcutHost implements ShortcutHost {
  registrations = new Map<string, () => void>()
  register(accelerator: string, onPress: () => void): boolean {
    this.registrations.set(accelerator, onPress)
    return true
  }
  unregister(accelerator: string): void {
    this.registrations.delete(accelerator)
  }
  press(accelerator: string): void {
    this.registrations.get(accelerator)?.()
  }
}

/* ---------- 纯函数 ---------- */

const SCREEN: OverlayScreen = {
  id: 'p1',
  primary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 }
}

describe('M4 悬浮窗几何（纯函数）', () => {
  it('吸附：四边 12px 内对齐，超出阈值不动', () => {
    const near = geo.snapBounds({ x: 8, y: 400, width: 300, height: 200 }, SCREEN)
    expect(near.changed).toBe(true)
    expect(near.bounds.x).toBe(0)

    const far = geo.snapBounds({ x: 200, y: 400, width: 300, height: 200 }, SCREEN)
    expect(far.changed).toBe(false)
    expect(far.bounds.x).toBe(200)

    // 右/下边也吸附
    const right = geo.snapBounds({ x: 1920 - 300 - 5, y: 1080 - 200 - 3, width: 300, height: 200 }, SCREEN)
    expect(right.bounds.x).toBe(1920 - 300)
    expect(right.bounds.y).toBe(1080 - 200)
  })

  it('创建位置：记忆位置在目标屏内则沿用，否则居中', () => {
    const remembered = geo.computeCreateBounds(
      { x: 100, y: 100, width: 360, height: 240, rememberPosition: true },
      SCREEN
    )
    expect(remembered).toEqual({ x: 100, y: 100, width: 360, height: 240 })

    // 记忆位置在屏幕外（换屏后）→ 居中
    const offscreen = geo.computeCreateBounds(
      { x: 5000, y: 5000, width: 360, height: 240, rememberPosition: true },
      SCREEN
    )
    expect(offscreen).toEqual({ x: 780, y: 420, width: 360, height: 240 })

    // 不记忆 → 居中
    const noRemember = geo.computeCreateBounds(
      { x: 100, y: 100, width: 360, height: 240, rememberPosition: false },
      SCREEN
    )
    expect(noRemember.x).toBe(780)
  })

  it('屏选择：按窗口中心归属，找不到则 primary', () => {
    const second: OverlayScreen = {
      id: 'p2',
      primary: false,
      bounds: { x: 1920, y: 0, width: 1080, height: 1920 }
    }
    expect(geo.screenForBounds([SCREEN, second], { x: 2000, y: 100, width: 300, height: 200 })?.id).toBe('p2')
    expect(geo.screenForBounds([SCREEN, second], { x: 100, y: 100, width: 300, height: 200 })?.id).toBe('p1')
    expect(geo.screenForBounds([SCREEN], { x: -9999, y: -9999, width: 10, height: 10 })?.id).toBe('p1')
  })

  it('悬浮窗列数钳制到 2–4（比主界面紧凑）', () => {
    expect(geo.clampFloatColumns(3)).toBe(3)
    expect(geo.clampFloatColumns(1)).toBe(2)
    expect(geo.clampFloatColumns(9)).toBe(4)
    expect(geo.clampFloatColumns(undefined)).toBe(3)
    expect(geo.clampFloatColumns('x')).toBe(3)
  })
})

/* ---------- 端到端：两个真实模块的悬浮窗隔离 ---------- */

interface Rig {
  modules: IModuleManager
  config: IConfig
  overlays: IOverlayWindows
  shortcuts: IGlobalShortcuts
  gateway: ReturnType<typeof createGateway>
  permissions: ReturnType<typeof createPermissions> extends Promise<infer T> ? T : never
}

async function makeRig(): Promise<{ rig: Rig; host: FakeOverlayHost; shortHost: FakeShortcutHost }> {
  process.env.EL_VTS_URL = `ws://127.0.0.1:${VTS_PORT}`
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-vts-m4-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  await gateway.start()
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  await cp(MODULE_SRC, join(modulesDir, 'vts-controlpad'), { recursive: true })
  await cp(SIBLING_SRC, join(modulesDir, 'prologue-live'), { recursive: true })

  const host = new FakeOverlayHost()
  const shortHost = new FakeShortcutHost()
  const overlays = createOverlayWindows({ logger, permissions, host })
  const shortcuts = createShortcuts({ logger, permissions, host: shortHost })
  const externalWs = createExternalWs({ logger, permissions, host: createExternalWsHost() })
  const modules = createModules({
    logger,
    config,
    bus,
    permissions,
    gateway,
    modulesDir,
    overlays,
    shortcuts,
    externalWs,
    credentials: new MemoryStore()
  })
  await config.ready()
  return {
    rig: { modules, config, overlays, shortcuts, gateway, permissions },
    host,
    shortHost
  }
}

/** 打开某模块的悬浮窗（通过配置，与真实设置页同路径）。 */
function enableFloat(config: IConfig, moduleId: string, extra: Record<string, unknown> = {}): void {
  const current = (config.get<Record<string, unknown>>(moduleId) ?? {}) as Record<string, unknown>
  const float = (current.float ?? {}) as Record<string, unknown>
  const res = config.set(moduleId, { ...current, float: { ...float, enabled: true, ...extra } })
  expect(res.ok, `${moduleId} 配置写入失败：${res.errors.join('; ')}`).toBe(true)
}

let mocks: WebSocketServer | null = null
afterEach(async () => {
  if (mocks) {
    await new Promise<void>((res) => mocks?.close(() => res()))
    mocks = null
  }
})

describe('M4 与打字机模块的悬浮窗隔离（端到端，两个真实模块）', () => {
  it('★ 两模块各自创建悬浮窗并独立存在；关掉一个不影响另一个', async () => {
    const { rig, host } = await makeRig()
    await rig.modules.discover()
    expect((await rig.modules.load('prologue-live')).ok).toBe(true)
    expect((await rig.modules.load('vts-controlpad')).ok).toBe(true)
    await rig.modules.start('prologue-live')
    await rig.modules.start('vts-controlpad')

    // 只开打字机的悬浮窗
    enableFloat(rig.config, 'prologue-live')
    await new Promise((r) => setTimeout(r, 30))
    const afterSibling = rig.overlays.list()
    expect(afterSibling.map((w) => w.moduleId)).toEqual(['prologue-live'])

    // 再开控制台的悬浮窗 → 两个并存，id 各自独立
    enableFloat(rig.config, 'vts-controlpad', { hotkeyIds: [] })
    await new Promise((r) => setTimeout(r, 30))
    const both = rig.overlays.list()
    expect(both.map((w) => `${w.moduleId}:${w.id}`).sort()).toEqual([
      'prologue-live:float',
      'vts-controlpad:pad'
    ])
    expect(host.windows.size).toBe(2)

    // 关掉控制台的 → 打字机的仍在
    const cur = rig.config.get<Record<string, unknown>>('vts-controlpad') as Record<string, unknown>
    rig.config.set('vts-controlpad', {
      ...cur,
      float: { ...(cur.float as Record<string, unknown>), enabled: false }
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(rig.overlays.list().map((w) => w.moduleId)).toEqual(['prologue-live'])
    expect(host.windows.size).toBe(1)

    await rig.modules.stop('vts-controlpad')
    await rig.modules.stop('prologue-live')
  }, 20000)

  it('★ 移动/穿透互不影响：改一个的 bounds 与穿透，另一个原样', async () => {
    const { rig, host } = await makeRig()
    await rig.modules.discover()
    await rig.modules.load('prologue-live')
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('prologue-live')
    await rig.modules.start('vts-controlpad')
    enableFloat(rig.config, 'prologue-live', { clickThrough: false })
    await new Promise((r) => setTimeout(r, 30))
    enableFloat(rig.config, 'vts-controlpad', { clickThrough: false })
    await new Promise((r) => setTimeout(r, 30))

    const handles = [...host.windows.keys()]
    expect(handles).toHaveLength(2)
    const padHandle = handles.find((h) => {
      const w = host.windows.get(h)
      return w?.spec.url.includes('/vts-controlpad/')
    })
    const floatHandle = handles.find((h) => {
      const w = host.windows.get(h)
      return w?.spec.url.includes('/prologue-live/')
    })
    expect(padHandle, '控制台悬浮窗应使用本模块网关页').toBeTruthy()
    expect(floatHandle, '打字机悬浮窗应使用其自身网关页').toBeTruthy()

    const before = { ...(host.windows.get(floatHandle!) as FakeWindow).bounds }

    // 拖动控制台的悬浮窗（远离吸附区，避免吸附改写）
    host.move(padHandle!, { x: 600, y: 500, width: 360, height: 240 })
    await new Promise((r) => setTimeout(r, 30))

    // 打字机的 bounds 完全没变
    expect((host.windows.get(floatHandle!) as FakeWindow).bounds).toEqual(before)

    // 只把控制台设为穿透
    const cur = rig.config.get<Record<string, unknown>>('vts-controlpad') as Record<string, unknown>
    rig.config.set('vts-controlpad', {
      ...cur,
      float: { ...(cur.float as Record<string, unknown>), clickThrough: true }
    })
    await new Promise((r) => setTimeout(r, 30))
    expect((host.windows.get(padHandle!) as FakeWindow).clickThrough).toBe(true)
    expect((host.windows.get(floatHandle!) as FakeWindow).clickThrough, '不得影响另一模块').toBe(false)

    await rig.modules.stop('vts-controlpad')
    await rig.modules.stop('prologue-live')
  }, 20000)

  it('★ 快捷键跨模块冲突被显式拒绝并指名持有者（任务卡验收 5）', async () => {
    const { rig } = await makeRig()
    await rig.modules.discover()
    await rig.modules.load('prologue-live')
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('prologue-live')
    await rig.modules.start('vts-controlpad')

    // 默认值本就不冲突：打字机用 Shift+T/S，控制台用 Shift+V
    enableFloat(rig.config, 'prologue-live')
    await new Promise((r) => setTimeout(r, 30))
    enableFloat(rig.config, 'vts-controlpad', { toggleThroughHotkey: 'CommandOrControl+Shift+V' })
    await new Promise((r) => setTimeout(r, 30))
    expect(rig.shortcuts.diagnostics().conflicts ?? []).toHaveLength(0)
    expect(rig.shortcuts.list().map((s) => s.accelerator).sort()).toEqual([
      'CommandOrControl+Shift+S',
      'CommandOrControl+Shift+T',
      'CommandOrControl+Shift+V'
    ])

    // 把控制台的穿透键改成与打字机相同 → 后者注册失败并记录冲突持有者
    const cur = rig.config.get<Record<string, unknown>>('vts-controlpad') as Record<string, unknown>
    rig.config.set('vts-controlpad', {
      ...cur,
      float: {
        ...(cur.float as Record<string, unknown>),
        enabled: true,
        toggleThroughHotkey: 'CommandOrControl+Shift+T'
      }
    })
    await new Promise((r) => setTimeout(r, 50))

    const diag = rig.shortcuts.diagnostics()
    expect(diag.conflicts.length, '冲突必须被记录').toBeGreaterThan(0)
    expect(diag.conflicts[diag.conflicts.length - 1].heldBy).toContain('prologue-live')
    // 持有者仍是打字机（未被静默覆盖）
    const owner = rig.shortcuts.list().find((s) => s.accelerator === 'CommandOrControl+Shift+T')
    expect(owner?.moduleId).toBe('prologue-live')

    await rig.modules.stop('vts-controlpad')
    await rig.modules.stop('prologue-live')
  }, 20000)

  it('未声明 window-overlay 时核心拒绝创建，且失败被上报到界面（不静默）', async () => {
    const { rig } = await makeRig()
    await rig.modules.discover()
    await rig.modules.load('vts-controlpad')
    await rig.modules.start('vts-controlpad')
    // 撤销权限后即使配置要求开启，也不得出现窗口
    rig.permissions.revoke('vts-controlpad', 'window-overlay')
    enableFloat(rig.config, 'vts-controlpad')
    await new Promise((r) => setTimeout(r, 30))
    expect(rig.overlays.list()).toHaveLength(0)

    // 关键是"不静默"：状态快照里要能看到失败原因，用户才知道为什么没出现悬浮窗
    const res = await fetch(rig.gateway.getRouteUrl('/vts-controlpad/state'))
    const state = (await res.json()) as { float?: { enabled?: boolean; error?: string } }
    expect(state.float?.error ?? '').toContain('悬浮窗创建失败')
    expect(String(state.float?.error)).toContain('window-overlay')

    await rig.modules.stop('vts-controlpad')
  }, 20000)
})
