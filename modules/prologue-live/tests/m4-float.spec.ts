import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
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
import { createOverlayWindows } from '../../../src/main/core/overlay-windows'

const MODULE_DIR = resolve(process.cwd(), 'modules/prologue-live')
const requireModule = createRequire(import.meta.url)
const floatLib = requireModule('../lib/float.js')
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

const P1: OverlayScreen = { id: 'p1', primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
const P2: OverlayScreen = { id: 'p2', primary: false, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }

/* ---------- lib/float.js 纯函数 ---------- */

describe('float 数学（lib/float.js）', () => {
  it('centerOnScreen：主屏与副屏居中', () => {
    expect(floatLib.centerOnScreen(P1, 320, 200)).toEqual({ x: 800, y: 440 })
    expect(floatLib.centerOnScreen(P2, 320, 200)).toEqual({ x: 2720, y: 440 })
  })

  it('containedIn：以窗口中心判定是否位于屏幕内', () => {
    expect(floatLib.containedIn(P1, { x: 100, y: 100, width: 320, height: 200 })).toBe(true)
    expect(floatLib.containedIn(P1, { x: 100, y: 1200, width: 320, height: 200 })).toBe(false)
    expect(floatLib.containedIn(P2, { x: 100, y: 100, width: 320, height: 200 })).toBe(false)
    expect(floatLib.containedIn(P2, { x: 2000, y: 100, width: 320, height: 200 })).toBe(true)
  })

  it('snapBounds：四边 12px 内吸附，远处不变', () => {
    const t = 12
    // 左
    expect(floatLib.snapBounds({ x: 5, y: 300, width: 320, height: 200 }, P1, t)).toEqual({
      bounds: { x: 0, y: 300, width: 320, height: 200 },
      changed: true
    })
    // 右（窗口右缘接近屏幕右缘 → x 左移对齐）
    expect(floatLib.snapBounds({ x: 1605, y: 300, width: 320, height: 200 }, P1, t)).toEqual({
      bounds: { x: 1600, y: 300, width: 320, height: 200 },
      changed: true
    })
    // 上
    expect(floatLib.snapBounds({ x: 500, y: 8, width: 320, height: 200 }, P1, t).bounds.y).toBe(0)
    // 下
    expect(floatLib.snapBounds({ x: 500, y: 872, width: 320, height: 200 }, P1, t).bounds.y).toBe(880)
    // 远距不变
    const far = { x: 400, y: 300, width: 320, height: 200 }
    expect(floatLib.snapBounds(far, P1, t)).toEqual({ bounds: far, changed: false })
  })

  it('computeCreateBounds：rememberPosition+在屏内 → 用记忆位置；否则屏居中', () => {
    const f = configLib.PROLOGUE_DEFAULTS.float
    // 默认 {100,100,320,200} 在 p1 内 → 记忆位置
    expect(floatLib.computeCreateBounds({ ...f, rememberPosition: true }, P1)).toEqual({
      x: 100,
      y: 100,
      width: 320,
      height: 200
    })
    // 切到 p2：记忆位置不在 p2 → 居中
    expect(floatLib.computeCreateBounds({ ...f, rememberPosition: true }, P2)).toEqual({
      x: 2720,
      y: 440,
      width: 320,
      height: 200
    })
    // 不记忆位置 → 始终居中
    expect(floatLib.computeCreateBounds({ ...f, rememberPosition: false }, P1)).toEqual({
      x: 800,
      y: 440,
      width: 320,
      height: 200
    })
  })
})

/* ---------- 悬浮窗生命周期（FakeOverlayHost + 真实服务） ---------- */

class FakeOverlayHost implements OverlayWindowHost {
  byHandle = new Map<
    object,
    { spec: OverlayWindowSpec; hooks: OverlayHostHooks; bounds: OverlayBounds; alive: boolean }
  >()
  screensList: OverlayScreen[] = [P1]
  createCount = 0
  screens(): OverlayScreen[] {
    return this.screensList
  }
  create(spec: OverlayWindowSpec, hooks: OverlayHostHooks): object | null {
    this.createCount += 1
    const handle = { h: this.byHandle.size }
    this.byHandle.set(handle, {
      spec,
      hooks,
      bounds: spec.bounds ?? { x: 800, y: 400, width: 320, height: 200 },
      alive: true
    })
    return handle
  }
  destroy(handle: object): void {
    this.byHandle.delete(handle)
  }
  setClickThrough(): void {}
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
  firstRec() {
    return [...this.byHandle.values()][0]
  }
}

async function until(fn: () => boolean, timeout = 2500): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('until timeout')
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

async function setupFloat(): Promise<{
  rig: ModulesRig
  host: FakeOverlayHost
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
  const host = new FakeOverlayHost()
  const overlays = createOverlayWindows({ logger, permissions, host })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir, overlays })
  await config.ready()
  await modules.discover()
  expect((await modules.load('prologue-live')).ok).toBe(true)
  expect((await modules.start('prologue-live')).ok).toBe(true)
  const floatEvents: Array<Record<string, unknown>> = []
  bus.subscribe('prologue-live:float-changed', (e) => floatEvents.push(e.payload as Record<string, unknown>))
  return { rig: { modules, logger, config, bus, permissions, gateway, modulesDir, root }, host, floatEvents }
}

function enableFloat(rig: ModulesRig, extra: Record<string, unknown> = {}): void {
  const d = configLib.PROLOGUE_DEFAULTS
  rig.config.set('prologue-live', {
    ...d,
    float: { ...d.float, enabled: true, ...extra }
  })
}

describe('M4 悬浮窗生命周期', () => {
  it('float.enabled=true → 创建网关 origin 悬浮窗（置顶/透明/可聚焦/可缩放默认形态）', async () => {
    const { rig, host, floatEvents } = await setupFloat()
    enableFloat(rig)
    await until(() => host.byHandle.size === 1)

    const rec = host.firstRec()
    expect(rec.spec.url).toContain('/prologue-live/overlay')
    expect(new URL(rec.spec.url).origin).toBe(new URL(rig.gateway.getRouteUrl('/x') as string).origin)
    expect(rec.spec.alwaysOnTop).not.toBe(false)
    expect(rec.spec.transparent).not.toBe(false)
    expect(rec.spec.skipTaskbar).not.toBe(false)
    expect(rec.spec.focusable).not.toBe(false)
    expect(rec.spec.clickThrough).toBe(false)
    expect(floatEvents[floatEvents.length - 1]).toEqual({ enabled: true, clickThrough: false })
  })

  it('float.enabled=false → 窗口销毁 + float-changed', async () => {
    const { rig, host, floatEvents } = await setupFloat()
    enableFloat(rig)
    await until(() => host.byHandle.size === 1)
    const d = configLib.PROLOGUE_DEFAULTS
    rig.config.set('prologue-live', { ...d, float: { ...d.float, enabled: false } })
    await until(() => host.byHandle.size === 0)
    expect(floatEvents[floatEvents.length - 1]).toEqual({ enabled: false, clickThrough: false })
  })

  it('onMoved → 吸附边缘（setBounds 对齐）+ 位置 debounce 落配置', async () => {
    const { rig, host } = await setupFloat()
    enableFloat(rig)
    await until(() => host.byHandle.size === 1)

    host.firstRec().hooks.onMoved({ x: 5, y: 300, width: 320, height: 200 })
    await until(() => host.firstRec().bounds.x === 0)
    // debounce 500ms 后记忆位置
    await until(() => (rig.config.get('prologue-live') as { float: { x: number } }).float.x === 0)
    expect((rig.config.get('prologue-live') as { float: { x: number; y: number } }).float.y).toBe(300)
  })

  it('onResized → 尺寸 debounce 落配置', async () => {
    const { rig, host } = await setupFloat()
    enableFloat(rig)
    await until(() => host.byHandle.size === 1)

    host.firstRec().hooks.onResized({ x: 0, y: 300, width: 400, height: 250 })
    await until(
      () => (rig.config.get('prologue-live') as { float: { width: number } }).float.width === 400
    )
    expect((rig.config.get('prologue-live') as { float: { height: number } }).float.height).toBe(250)
  })

  it('onClosed → enabled 复位 false，窗口移除', async () => {
    const { rig, host } = await setupFloat()
    enableFloat(rig)
    await until(() => host.byHandle.size === 1)

    host.firstRec().hooks.onClosed()
    await until(() => (rig.config.get('prologue-live') as { float: { enabled: boolean } }).float.enabled === false)
    expect(host.byHandle.size).toBe(0)
  })

  it('onCrashed → enabled 复位 false + /state float.errors 记录（不记 URL）', async () => {
    const { rig, host } = await setupFloat()
    enableFloat(rig)
    await until(() => host.byHandle.size === 1)

    host.firstRec().hooks.onCrashed('crashed')
    await until(() => (rig.config.get('prologue-live') as { float: { enabled: boolean } }).float.enabled === false)

    const url = rig.gateway.getRouteUrl('/prologue-live/state') as string
    const res = (await (await fetch(url)).json()) as { float: { errors: string[] } }
    expect(res.float.errors.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(res).toLowerCase()).not.toContain('token=')
  })

  it('权限撤销 → 创建失败并记录 float.errors；不自动恢复', async () => {
    const { rig, host } = await setupFloat()
    rig.permissions.revoke('prologue-live', 'window-overlay')
    enableFloat(rig)
    await until(() => host.createCount > 0 || host.byHandle.size === 0)

    const url = rig.gateway.getRouteUrl('/prologue-live/state') as string
    const res = (await (await fetch(url)).json()) as { float: { errors: string[] } }
    expect(res.float.errors.length).toBeGreaterThanOrEqual(1)
    expect(host.byHandle.size).toBe(0)
  })

  it('多屏：screens 透传 /state；切屏 → 窗口重建并居中到新屏', async () => {
    const { rig, host } = await setupFloat()
    host.screensList = [P1, P2]
    enableFloat(rig)
    await until(() => host.byHandle.size === 1)
    expect(host.firstRec().bounds).toEqual({ x: 100, y: 100, width: 320, height: 200 })

    const d = configLib.PROLOGUE_DEFAULTS
    rig.config.set('prologue-live', { ...d, float: { ...d.float, enabled: true, screen: 'p2' } })
    await until(() => host.createCount >= 2)
    await until(() => host.firstRec().bounds.x === 2720)
    expect(host.firstRec().bounds.y).toBe(440)

    const url = rig.gateway.getRouteUrl('/prologue-live/state') as string
    const res = (await (await fetch(url)).json()) as { screens: Array<{ id: string }> }
    expect(res.screens.map((s) => s.id).sort()).toEqual(['p1', 'p2'])
  })

  it('模块卸载 → 悬浮窗随所有权清理', async () => {
    const { rig, host } = await setupFloat()
    enableFloat(rig)
    await until(() => host.byHandle.size === 1)
    await rig.modules.unload('prologue-live')
    expect(host.byHandle.size).toBe(0)
  })
})
