import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { ILogger } from '@contracts/logger'
import type { ShortcutHost } from '@contracts/shortcuts'
import type {
  OverlayBounds,
  OverlayHostHooks,
  OverlayScreen,
  OverlayWindowHost,
  OverlayWindowSpec
} from '@contracts/overlays'
import { createConfig } from '../../../src/main/core/config'
import { createEventBus } from '../../../src/main/core/bus'
import { createPermissions } from '../../../src/main/core/permissions'
import { createGateway } from '../../../src/main/core/gateway'
import { createModules, type ModulesRig } from '../../../src/main/core/modules'
import { createShortcuts } from '../../../src/main/core/shortcuts'
import { createOverlayWindows } from '../../../src/main/core/overlay-windows'

const MODULE_DIR = resolve(process.cwd(), 'modules/prologue-live')
const requireModule = createRequire(import.meta.url)
const configLib = requireModule('../lib/config.js')

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

/** 可注入失败的快捷键宿主（冲突测试用）。 */
class FakeShortcutHost implements ShortcutHost {
  registrations = new Map<string, () => void>()
  failAccelerators = new Set<string>()
  register(accelerator: string, onPress: () => void): boolean {
    if (this.failAccelerators.has(accelerator)) return false
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

class FakeOverlayHost implements OverlayWindowHost {
  byHandle = new Map<
    object,
    { spec: OverlayWindowSpec; hooks: OverlayHostHooks; bounds: OverlayBounds; alive: boolean }
  >()
  clickThroughLog: boolean[] = []
  screens(): OverlayScreen[] {
    return [{ id: 'p1', primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]
  }
  create(spec: OverlayWindowSpec, hooks: OverlayHostHooks): object | null {
    const handle = { h: this.byHandle.size }
    this.byHandle.set(handle, { spec, hooks, bounds: spec.bounds ?? { x: 100, y: 100, width: 320, height: 200 }, alive: true })
    return handle
  }
  destroy(handle: object): void {
    this.byHandle.delete(handle)
  }
  setClickThrough(_h: object, on: boolean): void {
    this.clickThroughLog.push(on)
  }
  setAlwaysOnTop(): void {}
  setBounds(handle: object, bounds: OverlayBounds): void {
    const rec = this.byHandle.get(handle)
    if (rec) rec.bounds = bounds
  }
  getBounds(handle: object): OverlayBounds {
    const rec = this.byHandle.get(handle)
    if (!rec) throw new Error('no such window')
    return rec.bounds
  }
}

const P = { channel: 'prologue-live' }

interface Envelope {
  channel: string
  payload: Record<string, unknown>
}

const rigs: Array<{ gateway: { stop(): Promise<void> }; modules: { stop(id: string): Promise<void> } }> = []
afterEach(async () => {
  while (rigs.length > 0) {
    const r = rigs.pop()
    if (r) {
      await r.modules.stop('prologue-live').catch(() => {})
      await r.gateway.stop().catch(() => {})
    }
  }
})

async function until(fn: () => boolean, timeout = 2500): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('until timeout')
}

async function setupRig(): Promise<{
  rig: ModulesRig
  shortcutHost: FakeShortcutHost
  overlayHost: FakeOverlayHost
  floatEvents: Array<Record<string, unknown>>
}> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-pl-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  await gateway.start()
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  await cp(MODULE_DIR, join(modulesDir, 'prologue-live'), { recursive: true })
  const shortcutHost = new FakeShortcutHost()
  const overlayHost = new FakeOverlayHost()
  const shortcuts = createShortcuts({ logger, permissions, host: shortcutHost })
  const overlays = createOverlayWindows({ logger, permissions, host: overlayHost })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir, shortcuts, overlays })
  await config.ready()
  await modules.discover()
  expect((await modules.load('prologue-live')).ok).toBe(true)
  expect((await modules.start('prologue-live')).ok).toBe(true)
  const floatEvents: Array<Record<string, unknown>> = []
  bus.subscribe('prologue-live:float-changed', (e) => floatEvents.push(e.payload as Record<string, unknown>))
  return { rig: { modules, logger, config, bus, permissions, gateway, modulesDir, root }, shortcutHost, overlayHost, floatEvents }
}

function enableFloat(rig: ModulesRig, extra: Record<string, unknown> = {}): void {
  const d = configLib.PROLOGUE_DEFAULTS
  rig.config.set('prologue-live', { ...d, float: { ...d.float, enabled: true, ...extra } })
}

function wsOpen(url: string): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(url)
    ws.onopen = () => resolvePromise(ws)
    ws.onerror = () => reject(new Error('ws connect failed'))
  })
}

async function wsCollect(rig: ModulesRig): Promise<{ ws: WebSocket; msgs: Envelope[] }> {
  const ws = await wsOpen(rig.gateway.getWebSocketUrl() as string)
  const msgs: Envelope[] = []
  ws.onmessage = (ev) => {
    try {
      msgs.push(JSON.parse(String(ev.data)) as Envelope)
    } catch {
      /* 忽略非 JSON */
    }
  }
  return { ws, msgs }
}

async function waitFor<T>(arr: T[], pred: (m: T) => boolean, timeout = 2000): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const hit = arr.find(pred)
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('waitFor timeout')
}

describe('M5 快捷键接线', () => {
  it('float 启用 → 注册穿透/发送两键；按下穿透键翻转 clickThrough + 浮窗 setClickThrough + float-changed', async () => {
    const { rig, shortcutHost, overlayHost, floatEvents } = await setupRig()
    enableFloat(rig)
    await until(() => shortcutHost.registrations.has('CommandOrControl+Shift+T') && shortcutHost.registrations.has('CommandOrControl+Shift+S'))
    expect(shortcutHost.registrations.size).toBe(2)

    shortcutHost.press('CommandOrControl+Shift+T')
    await until(() => (rig.config.get('prologue-live') as { float: { clickThrough: boolean } }).float.clickThrough === true)
    expect(overlayHost.clickThroughLog).toContain(true)
    expect(floatEvents[floatEvents.length - 1]).toEqual({ enabled: true, clickThrough: true })

    shortcutHost.press('CommandOrControl+Shift+T')
    await until(() => (rig.config.get('prologue-live') as { float: { clickThrough: boolean } }).float.clickThrough === false)
    expect(overlayHost.clickThroughLog).toContain(false)
  })

  it('发送快捷键 → 下行 request-send（悬浮窗页据此提交输入）', async () => {
    const { rig, shortcutHost } = await setupRig()
    enableFloat(rig)
    await until(() => shortcutHost.registrations.has('CommandOrControl+Shift+S'))

    const { ws, msgs } = await wsCollect(rig)
    shortcutHost.press('CommandOrControl+Shift+S')
    await waitFor(msgs, (m) => m.payload.type === 'request-send')
    expect(msgs.filter((m) => m.payload.type === 'request-send').length).toBeGreaterThanOrEqual(1)

    // 模拟悬浮窗页回复 send → 引擎入队（enqueue 下行）
    ws.send(JSON.stringify({ ...P, payload: { type: 'send', text: 'flush文本' } }))
    await waitFor(msgs, (m) => m.payload.type === 'enqueue' && (m.payload as { text?: string }).text === 'flush文本')
    ws.close()
  })

  it('快捷键冲突 → 显式失败上报（floatErrors + /state 展示），另一键不受影响', async () => {
    const { rig, shortcutHost } = await setupRig()
    shortcutHost.failAccelerators.add('CommandOrControl+Shift+T')
    enableFloat(rig)
    await until(() => shortcutHost.registrations.has('CommandOrControl+Shift+S'))
    expect(shortcutHost.registrations.has('CommandOrControl+Shift+T')).toBe(false)

    const url = rig.gateway.getRouteUrl('/prologue-live/state') as string
    const res = (await (await fetch(url)).json()) as { float: { errors: string[] } }
    expect(res.float.errors.join(' ')).toContain('CommandOrControl+Shift+T')
  })

  it('float 禁用 → 两键注销；改键 → upsert 换加速键', async () => {
    const { rig, shortcutHost } = await setupRig()
    enableFloat(rig)
    await until(() => shortcutHost.registrations.size === 2)

    const d = configLib.PROLOGUE_DEFAULTS
    rig.config.set('prologue-live', { ...d, float: { ...d.float, enabled: false } })
    await until(() => shortcutHost.registrations.size === 0)

    enableFloat(rig, { toggleThroughHotkey: 'CommandOrControl+Alt+T' })
    await until(() => shortcutHost.registrations.has('CommandOrControl+Alt+T'))
    expect(shortcutHost.registrations.has('CommandOrControl+Shift+T')).toBe(false)
    expect(shortcutHost.registrations.has('CommandOrControl+Shift+S')).toBe(true)
  })

  it('global-shortcut 权限撤销 → 注册失败入 floatErrors（撤权限即失效）', async () => {
    const { rig, shortcutHost } = await setupRig()
    rig.permissions.revoke('prologue-live', 'global-shortcut')
    enableFloat(rig)
    await until(() => shortcutHost.registrations.size === 0)

    const url = rig.gateway.getRouteUrl('/prologue-live/state') as string
    const res = (await (await fetch(url)).json()) as { float: { errors: string[] } }
    expect(res.float.errors.length).toBeGreaterThanOrEqual(1)
  })
})
