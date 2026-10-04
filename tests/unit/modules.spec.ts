import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import type { ModuleManifest } from '@contracts/module'
import type { IGlobalShortcuts, ShortcutHost } from '@contracts/shortcuts'
import type {
  ExternalWsHandle,
  ExternalWsHooks,
  ExternalWsHost,
  IExternalWs
} from '@contracts/external-ws'
import type { CredentialRecord, ICredentialStore } from '@contracts/credentials'
import type {
  IOverlayWindows,
  OverlayBounds,
  OverlayHostHooks,
  OverlayScreen,
  OverlayWindowHost,
  OverlayWindowSpec
} from '@contracts/overlays'
import { createConfig } from '../../src/main/core/config'
import { createEventBus } from '../../src/main/core/bus'
import { createPermissions } from '../../src/main/core/permissions'
import { createGateway } from '../../src/main/core/gateway'
import { createModules, type ModulesRig } from '../../src/main/core/modules'
import { createShortcuts } from '../../src/main/core/shortcuts'
import { createOverlayWindows } from '../../src/main/core/overlay-windows'
import { createExternalWs } from '../../src/main/core/external-ws'

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

/** 模块入口（真实 JS 文件）通过 globalThis 回传观测数据。 */
type Bucket = Record<string, unknown>
const G = globalThis as unknown as Record<string, Bucket>
beforeEach(() => {
  G.__elT6 = {}
})
function g(): Bucket {
  return G.__elT6
}

async function makeRig(): Promise<ModulesRig> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-mod-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir })
  await config.ready()
  return { modules, logger, config, bus, permissions, gateway, modulesDir, root }
}

/** T23：带全局快捷键服务的 rig（FakeHost + 真实 permissions）。 */
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

async function makeShortcutRig(): Promise<{
  rig: ModulesRig
  host: FakeShortcutHost
  shortcuts: IGlobalShortcuts
}> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-mod-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  const host = new FakeShortcutHost()
  const shortcuts = createShortcuts({ logger, permissions, host })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir, shortcuts })
  await config.ready()
  return { rig: { modules, logger, config, bus, permissions, gateway, modulesDir, root }, host, shortcuts }
}

/** T25：带悬浮窗服务的 rig（FakeOverlayHost + 真实 permissions/gateway）。 */
class FakeOverlayHost implements OverlayWindowHost {
  byHandle = new Map<
    object,
    { spec: OverlayWindowSpec; hooks: OverlayHostHooks; bounds: OverlayBounds; alive: boolean }
  >()
  screens(): OverlayScreen[] {
    return [{ id: 'p1', primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]
  }
  create(spec: OverlayWindowSpec, hooks: OverlayHostHooks): object | null {
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
}

async function makeOverlayRig(): Promise<{
  rig: ModulesRig
  host: FakeOverlayHost
  overlays: IOverlayWindows
}> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-mod-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  // origin 闭集校验需要真实可解析的网关 URL（token/port 就绪）。
  await gateway.start()
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  const host = new FakeOverlayHost()
  const overlays = createOverlayWindows({ logger, permissions, host })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir, overlays })
  await config.ready()
  return { rig: { modules, logger, config, bus, permissions, gateway, modulesDir, root }, host, overlays }
}

interface ModuleSpec {
  manifest?: Partial<ModuleManifest>
  entry?: string
}

/** 写一个真实模块目录：manifest.json + index.js（CJS 入口）。 */
async function writeModule(rig: ModulesRig, id: string, spec: ModuleSpec = {}): Promise<void> {
  const dir = join(rig.modulesDir, id)
  await mkdir(dir, { recursive: true })
  const manifest: ModuleManifest = {
    id,
    name: id,
    version: '0.1.0',
    permissions: [],
    dependencies: [],
    entry: 'index.js',
    ...spec.manifest
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  await writeFile(join(dir, 'index.js'), spec.entry ?? 'module.exports = {}\n', 'utf8')
}

/* ---------- 发现与清单校验 ---------- */

describe('发现与清单校验', () => {
  it('合法模块 discovered；非法清单 invalid 带原因；无清单目录 invalid；点开头目录跳过', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'good-one', {
      manifest: { name: 'Good One', permissions: ['file-read'], events: ['good:ping'] }
    })
    await writeModule(rig, 'bad-version', { manifest: { version: '1.0' } })
    await writeModule(rig, 'wrong-id', { manifest: { id: 'not-the-dir' } })
    await mkdir(join(rig.modulesDir, 'no-manifest'), { recursive: true })
    await mkdir(join(rig.modulesDir, '.hidden'), { recursive: true })

    const infos = await rig.modules.discover()
    expect(infos.map((i) => i.id)).toEqual(['bad-version', 'good-one', 'no-manifest', 'wrong-id'])

    expect(rig.modules.get('good-one')?.status).toBe('discovered')
    expect(rig.modules.get('good-one')?.manifest?.permissions).toEqual(['file-read'])
    expect(rig.modules.get('bad-version')?.status).toBe('invalid')
    expect(rig.modules.get('bad-version')?.error).toContain('version')
    expect(rig.modules.get('wrong-id')?.status).toBe('invalid')
    expect(rig.modules.get('wrong-id')?.error).toContain('directory name')
    expect(rig.modules.get('no-manifest')?.status).toBe('invalid')
    expect(rig.modules.get('.hidden')).toBeUndefined()
  })

  it('entry 逃逸模块目录 → invalid', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'escape', { manifest: { entry: '../escape.js' } })
    await rig.modules.discover()
    expect(rig.modules.get('escape')?.status).toBe('invalid')
    expect(rig.modules.get('escape')?.error).toContain('entry')
  })
})

/* ---------- 加载与生命周期 ---------- */

describe('加载与生命周期', () => {
  it('load→start→stop 状态机；init 收到完整 ctx；权限/配置/路由/频道接线', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'demo', {
      manifest: {
        permissions: ['file-read'],
        config: { defaults: { greeting: 'hello' }, version: 1 },
        events: ['demo:greet'],
        routes: [{ method: 'GET', path: '/demo/hello' }],
        channels: ['demo-tick']
      },
      entry: `
module.exports = {
  async init(ctx) {
    globalThis.__elT6.demo = {
      moduleId: ctx.moduleId,
      ctxKeys: Object.keys(ctx).sort(),
      loggerOk: typeof ctx.logger.info === 'function',
      checkType: typeof ctx.permissions.check
    }
    ctx.gateway.registerHttpRoute('GET', '/demo/hello', () => ({ status: 200, body: { ok: true } }))
    ctx.gateway.registerWebSocketChannel('demo-tick', {})
    globalThis.__elT6.cfgBefore = ctx.config.get()
    globalThis.__elT6.cfgSetOk = ctx.config.set({ greeting: 'hi', extra: 1 }).ok
  }
}
`
    })
    await rig.modules.discover()

    const loaded = await rig.modules.load('demo')
    expect(loaded.ok).toBe(true)
    expect(rig.modules.get('demo')?.status).toBe('loaded')

    expect(g().demo).toMatchObject({ moduleId: 'demo', loggerOk: true, checkType: 'function' })
    expect(g().demo).toHaveProperty(
      'ctxKeys',
      expect.arrayContaining(['bus', 'config', 'gateway', 'logger', 'moduleId', 'permissions'])
    )

    // 权限经 permissions.declare、配置经 config.register、路由/频道经 gateway
    expect(rig.permissions.status('demo').declared).toEqual(['file-read'])
    expect(g().cfgBefore).toEqual({ greeting: 'hello' })
    expect(g().cfgSetOk).toBe(true)
    expect(rig.config.get<{ greeting: string }>('demo')).toEqual({ greeting: 'hi', extra: 1 })
    expect(rig.gateway.diagnostics().routes).toContain('GET /demo/hello')
    expect(rig.gateway.diagnostics().channels).toContain('demo-tick')

    expect((await rig.modules.start('demo')).ok).toBe(true)
    expect(rig.modules.get('demo')?.status).toBe('started')
    await rig.modules.stop('demo')
    expect(rig.modules.get('demo')?.status).toBe('stopped')
    expect((await rig.modules.start('demo')).ok).toBe(true)
    expect(rig.modules.get('demo')?.status).toBe('started')
  })
})

/* ---------- 所有权强制（清单闭集） ---------- */

describe('所有权强制', () => {
  it('注册未声明路由/频道 → init 抛错标记 failed；半程注册回滚；其它模块不受影响', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'rogue', {
      manifest: { routes: [{ method: 'GET', path: '/rogue/ok' }] },
      entry: `
module.exports = {
  init(ctx) {
    ctx.gateway.registerHttpRoute('GET', '/rogue/ok', () => ({ status: 200 }))
    ctx.gateway.registerWebSocketChannel('rogue-ch', {})
  }
}
`
    })
    await writeModule(rig, 'calm', {
      manifest: { routes: [{ method: 'GET', path: '/calm/ok' }] },
      entry: `
module.exports = {
  init(ctx) { ctx.gateway.registerHttpRoute('GET', '/calm/ok', () => ({ status: 200 })) }
}
`
    })
    await rig.modules.discover()

    const rogue = await rig.modules.load('rogue')
    expect(rogue.ok).toBe(false)
    expect(rogue.errors[0]).toContain('not declared')
    expect(rig.modules.get('rogue')?.status).toBe('failed')
    // 半程注册（已声明的路由）同样被回滚
    expect(rig.gateway.diagnostics().routes).not.toContain('GET /rogue/ok')
    expect(rig.gateway.diagnostics().channels).not.toContain('rogue-ch')
    expect(rig.permissions.status('rogue').declared).toEqual([])

    const calm = await rig.modules.load('calm')
    expect(calm.ok).toBe(true)
    expect(rig.gateway.diagnostics().routes).toContain('GET /calm/ok')
  })

  it('发布未声明事件抛错；声明事件 source 强制为模块 id', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'noisy', {
      manifest: { events: ['noisy:ok'] },
      entry: `
module.exports = {
  init(ctx) { globalThis.__elT6.noisyCtx = ctx },
  start() {
    const ctx = globalThis.__elT6.noisyCtx
    try { ctx.bus.publish('noisy:bad') } catch (e) { globalThis.__elT6.noisyErr = String(e) }
    ctx.bus.publish('noisy:ok', { n: 1 }, { source: 'spoof' })
  }
}
`
    })
    rig.bus.subscribe('noisy:ok', (e) => {
      g().noisyEvent = { source: e.source, payload: e.payload }
    })
    await rig.modules.discover()
    expect((await rig.modules.load('noisy')).ok).toBe(true)
    expect((await rig.modules.start('noisy')).ok).toBe(true)

    expect(String(g().noisyErr)).toContain('not declared')
    expect(g().noisyEvent).toEqual({ source: 'noisy', payload: { n: 1 } })
  })
})

/* ---------- 卸载与重启 ---------- */

describe('卸载与重启', () => {
  it('unload：注销路由/频道/订阅 + 权限声明移除 + 停机；状态回 discovered', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'wired', {
      manifest: {
        permissions: ['file-read'],
        events: ['wired:tap'],
        routes: [{ method: 'GET', path: '/wired/x' }],
        channels: ['wired-ch']
      },
      entry: `
module.exports = {
  init(ctx) {
    ctx.gateway.registerHttpRoute('GET', '/wired/x', () => ({ status: 200 }))
    ctx.gateway.registerWebSocketChannel('wired-ch', {})
    ctx.bus.subscribe('wired:tap', () => {
      globalThis.__elT6.wiredTap = (globalThis.__elT6.wiredTap ?? 0) + 1
    })
  },
  stop() { globalThis.__elT6.wiredStop = true }
}
`
    })
    await rig.modules.discover()
    await rig.modules.load('wired')
    await rig.modules.start('wired')

    rig.bus.publish('wired:tap')
    expect(g().wiredTap).toBe(1)

    await rig.modules.unload('wired')
    expect(rig.modules.get('wired')?.status).toBe('discovered')
    expect(rig.gateway.diagnostics().routes).not.toContain('GET /wired/x')
    expect(rig.gateway.diagnostics().channels).not.toContain('wired-ch')
    expect(rig.permissions.status('wired').declared).toEqual([])
    expect(g().wiredStop).toBe(true)

    // 订阅已随卸载移除，不再触发
    rig.bus.publish('wired:tap')
    expect(g().wiredTap).toBe(1)
  })

  it('restart：stop → 重新 init → start（import 缓存下同实例计数累加）', async () => {
    const rig = await makeRig()
    await writeModule(rig, 're', {
      manifest: { events: ['re:count'] },
      entry: `
let inits = 0, stops = 0, ctx
module.exports = {
  init(c) { ctx = c; inits++ },
  start() { ctx.bus.publish('re:count', { inits, stops }) },
  stop() { stops++ }
}
`
    })
    const counts: Array<{ inits: number; stops: number }> = []
    rig.bus.subscribe('re:count', (e) => {
      counts.push(e.payload as { inits: number; stops: number })
    })
    await rig.modules.discover()
    await rig.modules.load('re')
    await rig.modules.start('re')

    const restarted = await rig.modules.restart('re')
    expect(restarted.ok).toBe(true)
    expect(rig.modules.get('re')?.status).toBe('started')
    expect(counts).toEqual([
      { inits: 1, stops: 0 },
      { inits: 2, stops: 1 }
    ])
  })
})

/* ---------- 崩溃隔离 ---------- */

describe('崩溃隔离', () => {
  it('init 抛错 / start 抛错 → failed；核心与健康模块不受影响', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'boom-init', {
      entry: 'module.exports = { init() { throw new Error("init kaboom") } }'
    })
    await writeModule(rig, 'boom-start', {
      entry: 'module.exports = { start() { throw new Error("start kaboom") } }'
    })
    await writeModule(rig, 'healthy', {
      manifest: { events: ['healthy:ping'] },
      entry: `
module.exports = {
  init(ctx) { ctx.bus.publish('healthy:ping', { ok: 1 }) }
}
`
    })
    await rig.modules.discover()

    const bad = await rig.modules.load('boom-init')
    expect(bad.ok).toBe(false)
    expect(rig.modules.get('boom-init')?.status).toBe('failed')
    expect(rig.modules.get('boom-init')?.error).toContain('init kaboom')

    expect((await rig.modules.load('healthy')).ok).toBe(true)
    expect((await rig.modules.start('healthy')).ok).toBe(true)
    expect(rig.modules.get('healthy')?.status).toBe('started')

    expect((await rig.modules.load('boom-start')).ok).toBe(true)
    const startBad = await rig.modules.start('boom-start')
    expect(startBad.ok).toBe(false)
    expect(rig.modules.get('boom-start')?.status).toBe('failed')
    expect(rig.modules.get('boom-start')?.error).toContain('start kaboom')

    // 核心服务照常工作
    let coreAlive = false
    rig.bus.subscribe('lifecycle:probe', () => {
      coreAlive = true
    })
    rig.bus.publish('lifecycle:probe')
    expect(coreAlive).toBe(true)
  })
})

/* ---------- 依赖检查 ---------- */

describe('依赖检查', () => {
  it('未加载 / 版本不足 / 未知依赖 → 拒绝加载并说明原因', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'lib-b', { manifest: { version: '1.2.0' } })
    await writeModule(rig, 'app-a', { manifest: { dependencies: [{ id: 'lib-b' }] } })
    await writeModule(rig, 'app-old', {
      manifest: { dependencies: [{ id: 'lib-b', version: '2.0.0' }] }
    })
    await writeModule(rig, 'app-ghost', { manifest: { dependencies: [{ id: 'ghost' }] } })
    await rig.modules.discover()

    const early = await rig.modules.load('app-a')
    expect(early.ok).toBe(false)
    expect(early.errors[0]).toContain('lib-b')

    expect((await rig.modules.load('lib-b')).ok).toBe(true)
    expect((await rig.modules.load('app-a')).ok).toBe(true)

    const old = await rig.modules.load('app-old')
    expect(old.ok).toBe(false)
    expect(old.errors[0]).toContain('2.0.0')

    const ghost = await rig.modules.load('app-ghost')
    expect(ghost.ok).toBe(false)
    expect(ghost.errors[0]).toContain('ghost')
  })
})

/* ---------- 禁用与启用 ---------- */

describe('禁用与启用', () => {
  it('disable 持久化并停机；load 拒绝；enable 恢复 discovered', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'dis', {
      manifest: { routes: [{ method: 'GET', path: '/dis/x' }] },
      entry: `
module.exports = {
  init(ctx) { ctx.gateway.registerHttpRoute('GET', '/dis/x', () => ({ status: 200 })) }
}
`
    })
    await rig.modules.discover()
    await rig.modules.load('dis')
    await rig.modules.start('dis')

    await rig.modules.disable('dis')
    expect(rig.modules.get('dis')?.status).toBe('disabled')
    expect(rig.config.get<{ disabled: string[] }>('core.modules')?.disabled).toContain('dis')
    expect(rig.gateway.diagnostics().routes).not.toContain('GET /dis/x')

    const refused = await rig.modules.load('dis')
    expect(refused.ok).toBe(false)
    expect(refused.errors[0]).toContain('disabled')

    await rig.modules.enable('dis')
    expect(rig.modules.get('dis')?.status).toBe('discovered')
    expect(rig.config.get<{ disabled: string[] }>('core.modules')?.disabled).not.toContain('dis')
    expect((await rig.modules.load('dis')).ok).toBe(true)
  })
})

/* ---------- 网页工具模块（T11） ---------- */

describe('网页工具模块', () => {
  const webDecl = {
    url: 'https://demo.example/',
    allowedDomains: ['https://demo.example'],
    windowMode: 'embedded' as const,
    pinned: true
  }

  it('声明式 web 工具：无 entry 可 discover→load→started；权限声明生效；启停卸载禁用同等', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'web-demo', {
      manifest: { entry: undefined, permissions: ['network-access'], web: webDecl }
    })
    await rig.modules.discover()
    expect(rig.modules.get('web-demo')?.status).toBe('discovered')

    expect((await rig.modules.load('web-demo')).ok).toBe(true)
    expect((await rig.modules.start('web-demo')).ok).toBe(true)
    expect(rig.modules.get('web-demo')?.status).toBe('started')
    expect(rig.modules.get('web-demo')?.manifest?.web?.url).toBe('https://demo.example/')
    expect(rig.permissions.status('web-demo').declared).toEqual(['network-access'])

    await rig.modules.stop('web-demo')
    expect(rig.modules.get('web-demo')?.status).toBe('stopped')
    await rig.modules.unload('web-demo')
    expect(rig.modules.get('web-demo')?.status).toBe('discovered')
    expect((await rig.modules.load('web-demo')).ok).toBe(true)

    await rig.modules.disable('web-demo')
    expect(rig.modules.get('web-demo')?.status).toBe('disabled')
    await rig.modules.enable('web-demo')
    expect(rig.modules.get('web-demo')?.status).toBe('discovered')
  })

  it('web + entry → invalid（网页工具不含业务代码）', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'web-entry', { manifest: { web: webDecl } })
    await rig.modules.discover()
    expect(rig.modules.get('web-entry')?.status).toBe('invalid')
    expect(rig.modules.get('web-entry')?.error).toContain('entry')
  })

  it('T29 相对 url 页面模块：web + entry/routes/events 合法加载 started（init 真执行）', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'page-mod', {
      manifest: {
        permissions: [],
        entry: 'index.js',
        web: { url: '/page-mod/panel', windowMode: 'embedded', pinned: true },
        routes: [{ method: 'GET', path: '/page-mod/panel' }],
        events: ['page-mod:ping']
      },
      entry: `
module.exports = {
  init(ctx) {
    ctx.gateway.registerHttpRoute('GET', '/page-mod/panel', () => ({ status: 200, body: { ok: true } }))
  }
}
`
    })
    await rig.modules.discover()
    expect(rig.modules.get('page-mod')?.status).toBe('discovered')
    expect((await rig.modules.load('page-mod')).ok).toBe(true)
    expect((await rig.modules.start('page-mod')).ok).toBe(true)
    expect(rig.modules.get('page-mod')?.manifest?.web).toMatchObject({ url: '/page-mod/panel' })
    // T31 回归铁证：页面模块不是 webTool 短路——init 已跑、路由已注册
    expect(rig.gateway.diagnostics().routes).toContain('GET /page-mod/panel')
  })

  it('T29 相对 url 坏形 → invalid；省略 allowedDomains 合法', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'page-bad-rel', {
      manifest: { entry: undefined, web: { ...webDecl, url: 'page-mod/panel' } }
    })
    await writeModule(rig, 'page-bad-scheme', {
      manifest: { entry: undefined, web: { ...webDecl, url: 'file:///x' } }
    })
    await writeModule(rig, 'page-no-domains', {
      manifest: {
        entry: undefined,
        web: { url: '/x/panel', windowMode: 'embedded', pinned: true }
      }
    })
    await rig.modules.discover()
    expect(rig.modules.get('page-bad-rel')?.status).toBe('invalid')
    expect(rig.modules.get('page-bad-rel')?.error).toContain('web.url')
    expect(rig.modules.get('page-bad-scheme')?.status).toBe('invalid')
    expect(rig.modules.get('page-bad-scheme')?.error).toContain('web.url')
    // 相对 url 可省略 allowedDomains（核心注入网关 origin）
    expect(rig.modules.get('page-no-domains')?.status).toBe('discovered')
    expect(rig.modules.get('page-no-domains')?.manifest?.web?.allowedDomains).toEqual([])
  })

  it('坏声明四态 → invalid 并说明原因', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'web-bad-url', {
      manifest: { entry: undefined, web: { ...webDecl, url: 'ftp://nope.example/' } }
    })
    await writeModule(rig, 'web-bad-domains', {
      manifest: { entry: undefined, web: { ...webDecl, allowedDomains: [] } }
    })
    await writeModule(rig, 'web-foreign-url', {
      manifest: { entry: undefined, web: { ...webDecl, url: 'https://other.example/' } }
    })
    await writeModule(rig, 'web-bad-mode', {
      manifest: {
        entry: undefined,
        web: { ...webDecl, windowMode: 'floating' as 'embedded' }
      }
    })
    await rig.modules.discover()
    expect(rig.modules.get('web-bad-url')?.status).toBe('invalid')
    expect(rig.modules.get('web-bad-url')?.error).toContain('web.url')
    expect(rig.modules.get('web-bad-domains')?.status).toBe('invalid')
    expect(rig.modules.get('web-bad-domains')?.error).toContain('allowedDomains')
    expect(rig.modules.get('web-foreign-url')?.status).toBe('invalid')
    expect(rig.modules.get('web-foreign-url')?.error).toContain('allowedDomains')
    expect(rig.modules.get('web-bad-mode')?.status).toBe('invalid')
    expect(rig.modules.get('web-bad-mode')?.error).toContain('windowMode')
  })
})

/* ---------- 全局快捷键接线（T23） ---------- */

describe('全局快捷键接线（T23）', () => {
  it('声明 global-shortcut 的模块经 ctx.shortcuts 注册成功（归属 moduleId）；未声明权限的模块被拒', async () => {
    const { rig, host, shortcuts } = await makeShortcutRig()
    await writeModule(rig, 'hot-mod', {
      manifest: { permissions: ['global-shortcut'] },
      entry: `
module.exports = {
  init(ctx) {
    globalThis.__elT6.hotKeys = Object.keys(ctx).sort()
    globalThis.__elT6.hotReg = ctx.shortcuts.register('send', 'CommandOrControl+Shift+P', () => {
      globalThis.__elT6.fired = (globalThis.__elT6.fired ?? 0) + 1
    })
  }
}
`
    })
    await writeModule(rig, 'cold-mod', {
      manifest: { permissions: ['clipboard'] },
      entry: `
module.exports = {
  init(ctx) {
    globalThis.__elT6.coldReg = ctx.shortcuts.register('send', 'CommandOrControl+Shift+X', () => {})
  }
}
`
    })
    await rig.modules.discover()
    expect((await rig.modules.load('hot-mod')).ok).toBe(true)
    expect((await rig.modules.load('cold-mod')).ok).toBe(true)

    expect(g().hotKeys).toContain('shortcuts')
    expect(g().hotReg).toEqual({ ok: true, errors: [] })
    expect((g().coldReg as { ok: boolean; errors: string[] }).ok).toBe(false)
    expect((g().coldReg as { ok: boolean; errors: string[] }).errors[0]).toContain('global-shortcut')

    expect(shortcuts.list()).toEqual([
      expect.objectContaining({
        moduleId: 'hot-mod',
        id: 'send',
        accelerator: 'CommandOrControl+Shift+P'
      })
    ])
    host.press('CommandOrControl+Shift+P')
    expect(g().fired).toBe(1)
  })

  it('stop 不清（与 routes 生命周期一致）；unload 自动 removeModule', async () => {
    const { rig, host, shortcuts } = await makeShortcutRig()
    await writeModule(rig, 'sticky', {
      manifest: { permissions: ['global-shortcut'] },
      entry: `
module.exports = {
  init(ctx) {
    ctx.shortcuts.register('pause', 'CommandOrControl+Alt+K', () => {
      globalThis.__elT6.stickyFired = true
    })
  }
}
`
    })
    await rig.modules.discover()
    await rig.modules.load('sticky')
    await rig.modules.start('sticky')

    await rig.modules.stop('sticky')
    expect(shortcuts.list().length).toBe(1)
    host.press('CommandOrControl+Alt+K')
    expect(g().stickyFired).toBe(true)

    await rig.modules.unload('sticky')
    expect(shortcuts.list()).toEqual([])
    expect(host.registrations.size).toBe(0)
  })

  it('未接线 shortcuts 服务时 ctx 不含 shortcuts 键（optional 注入）', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'bare', {
      entry: `
module.exports = {
  init(ctx) { globalThis.__elT6.bareKeys = Object.keys(ctx).sort() }
}
`
    })
    await rig.modules.discover()
    expect((await rig.modules.load('bare')).ok).toBe(true)
    expect(g().bareKeys).not.toContain('shortcuts')
  })
})

/* ---------- 悬浮窗接线（T25） ---------- */

describe('悬浮窗接线（T25）', () => {
  it('声明 window-overlay 的模块经 ctx.overlays.create 成功（网关 URL）；非网关 origin 被拒', async () => {
    const { rig, host, overlays } = await makeOverlayRig()
    await writeModule(rig, 'float-mod', {
      manifest: {
        permissions: ['window-overlay'],
        routes: [{ method: 'GET', path: '/float/panel' }]
      },
      entry: `
module.exports = {
  init(ctx) {
    globalThis.__elT6.floatKeys = Object.keys(ctx).sort()
    const url = ctx.gateway.getRouteUrl('/float/panel')
    globalThis.__elT6.floatUrl = url
    globalThis.__elT6.floatReg = ctx.overlays.create('panel', { url })
    globalThis.__elT6.evilReg = ctx.overlays.create('evil', { url: 'https://evil.example/x' })
  }
}
`
    })
    await rig.modules.discover()
    expect((await rig.modules.load('float-mod')).ok).toBe(true)

    expect(g().floatKeys).toContain('overlays')
    expect(String(g().floatUrl)).toContain('/float/panel')
    expect(g().floatReg).toEqual({ ok: true, errors: [] })
    const evil = g().evilReg as { ok: boolean; errors: string[] }
    expect(evil.ok).toBe(false)
    expect(evil.errors[0]).toContain('gateway')

    expect(host.byHandle.size).toBe(1)
    expect(overlays.list()).toEqual([
      expect.objectContaining({ moduleId: 'float-mod', id: 'panel' })
    ])
  })

  it('未声明权限的模块 create 被拒', async () => {
    const { rig, overlays } = await makeOverlayRig()
    await writeModule(rig, 'no-perm', {
      manifest: { permissions: ['clipboard'] },
      entry: `
module.exports = {
  init(ctx) {
    globalThis.__elT6.noPermReg = ctx.overlays.create('panel', {
      url: ctx.gateway.getRouteUrl('/x')
    })
  }
}
`
    })
    await rig.modules.discover()
    expect((await rig.modules.load('no-perm')).ok).toBe(true)
    const reg = g().noPermReg as { ok: boolean; errors: string[] }
    expect(reg.ok).toBe(false)
    expect(reg.errors[0]).toContain('window-overlay')
    expect(overlays.list()).toEqual([])
  })

  it('stop 不清（与 routes 生命周期一致）；unload 自动 removeModule', async () => {
    const { rig, host, overlays } = await makeOverlayRig()
    await writeModule(rig, 'sticky', {
      manifest: { permissions: ['window-overlay'] },
      entry: `
module.exports = {
  init(ctx) {
    ctx.overlays.create('panel', { url: ctx.gateway.getRouteUrl('/sticky') })
  }
}
`
    })
    await rig.modules.discover()
    await rig.modules.load('sticky')
    await rig.modules.start('sticky')

    await rig.modules.stop('sticky')
    expect(overlays.list().length).toBe(1)

    await rig.modules.unload('sticky')
    expect(overlays.list()).toEqual([])
    expect(host.byHandle.size).toBe(0)
  })
})

/* ---------- startAll ---------- */

/* ---------- C0：对外 WebSocket / 凭据门面接线 ---------- */

class FakeWsHost implements ExternalWsHost {
  live = new Map<ExternalWsHandle, { url: string; hooks: ExternalWsHooks }>()
  connect(url: string, hooks: ExternalWsHooks): ExternalWsHandle | null {
    const handle: ExternalWsHandle = { n: this.live.size }
    this.live.set(handle, { url, hooks })
    return handle
  }
  send(): boolean {
    return true
  }
  close(handle: ExternalWsHandle): void {
    this.live.delete(handle)
  }
  openByUrl(url: string): void {
    for (const c of this.live.values()) if (c.url === url) c.hooks.onOpen()
  }
}

/** 内存凭据 store：检视**原始键空间**以证明命名空间隔离。 */
class MemoryCredStore implements ICredentialStore {
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

async function makeC0Rig(): Promise<{
  rig: ModulesRig
  host: FakeWsHost
  store: MemoryCredStore
  externalWs: IExternalWs
}> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-mod-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  await gateway.start()
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  const host = new FakeWsHost()
  const externalWs = createExternalWs({ logger, permissions, host })
  const store = new MemoryCredStore()
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
  return { rig: { modules, logger, config, bus, permissions, gateway, modulesDir, root }, host, store, externalWs }
}

describe('对外 WebSocket 接线（C0）', () => {
  it('声明 external-websocket 的模块可建回环连接；非回环被拒；list 只含自己', async () => {
    const { rig, host, externalWs } = await makeC0Rig()
    await writeModule(rig, 'vts-mod', {
      manifest: { permissions: ['external-websocket'] },
      entry: `
module.exports = {
  init(ctx) {
    globalThis.__elT6.c0keys = Object.keys(ctx).sort()
    globalThis.__elT6.c0ok = ctx.externalWs.connect('vts', { url: 'ws://127.0.0.1:8001' })
    globalThis.__elT6.c0bad = ctx.externalWs.connect('bad', { url: 'ws://evil.example.com:8001' })
    globalThis.__elT6.c0mine = ctx.externalWs.list().map((c) => c.id)
  }
}
`
    })
    await rig.modules.discover()
    expect((await rig.modules.load('vts-mod')).ok).toBe(true)

    expect(g().c0keys).toContain('externalWs')
    expect(g().c0keys).toContain('credentials')
    expect(g().c0ok).toEqual({ ok: true, errors: [] })
    const bad = g().c0bad as { ok: boolean; errors: string[] }
    expect(bad.ok).toBe(false)
    expect(bad.errors[0]).toContain('loopback')
    expect(g().c0mine).toEqual(['vts'])

    expect(host.live.size, '只有回环那条建立了 socket').toBe(1)
    expect(externalWs.list()).toEqual([expect.objectContaining({ moduleId: 'vts-mod', id: 'vts' })])
  })

  it('未声明权限的模块连接被拒，且不触碰宿主', async () => {
    const { rig, host } = await makeC0Rig()
    await writeModule(rig, 'no-perm-ws', {
      manifest: { permissions: ['clipboard'] },
      entry: `
module.exports = {
  init(ctx) {
    globalThis.__elT6.c0noPerm = ctx.externalWs.connect('vts', { url: 'ws://127.0.0.1:8001' })
  }
}
`
    })
    await rig.modules.discover()
    expect((await rig.modules.load('no-perm-ws')).ok).toBe(true)

    const res = g().c0noPerm as { ok: boolean; errors: string[] }
    expect(res.ok).toBe(false)
    expect(res.errors[0]).toContain('external-websocket')
    expect(host.live.size).toBe(0)
  })

  it('两个模块的连接互不可见、互不可操作（facade 作用域）', async () => {
    const { rig, host, externalWs } = await makeC0Rig()
    const manifest = { permissions: ['external-websocket' as const] }
    await writeModule(rig, 'mod-a', {
      manifest,
      entry: `
module.exports = {
  init(ctx) {
    ctx.externalWs.connect('shared', { url: 'ws://127.0.0.1:8001' })
    globalThis.__elT6.aMine = ctx.externalWs.list().map((c) => c.id)
  }
}
`
    })
    await writeModule(rig, 'mod-b', {
      manifest,
      entry: `
module.exports = {
  init(ctx) {
    ctx.externalWs.connect('shared', { url: 'ws://127.0.0.1:8002' })
    globalThis.__elT6.bMine = ctx.externalWs.list().map((c) => c.id)
  }
}
`
    })
    // 第三个模块用**同名 id** 尝试操作前两者的连接 —— 必须全部落空
    await writeModule(rig, 'mod-c', {
      manifest,
      entry: `
module.exports = {
  init(ctx) {
    globalThis.__elT6.cMine = ctx.externalWs.list().map((c) => c.id)
    globalThis.__elT6.cCloseOthers = ctx.externalWs.close('shared')
    globalThis.__elT6.cSendOthers = ctx.externalWs.send('shared', 'hijack')
    globalThis.__elT6.cStatusOthers = ctx.externalWs.status('shared')
  }
}
`
    })
    await rig.modules.discover()
    expect((await rig.modules.load('mod-a')).ok).toBe(true)
    expect((await rig.modules.load('mod-b')).ok).toBe(true)
    expect((await rig.modules.load('mod-c')).ok).toBe(true)

    // 同名 id 在三个模块下并存（命名空间不交叉），各自只看得到自己
    expect(g().aMine).toEqual(['shared'])
    expect(g().bMine).toEqual(['shared'])
    expect(g().cMine, 'C 自己没有连接').toEqual([])

    // C 无法关/发/查别人的连接
    expect(g().cCloseOthers, 'close 不得命中他人的连接').toBe(false)
    expect(g().cSendOthers, 'send 不得命中他人的连接').toBe(false)
    expect(g().cStatusOthers, 'status 不得看到他人的连接').toBeNull()

    // A / B 的连接完好无损
    expect(externalWs.list().map((s) => s.moduleId).sort()).toEqual(['mod-a', 'mod-b'])
    expect(host.live.size).toBe(2)
  })

  it('unload 关闭该模块全部连接，其他模块不受影响', async () => {
    const { rig, host, externalWs } = await makeC0Rig()
    const manifest = { permissions: ['external-websocket' as const] }
    await writeModule(rig, 'mod-a', {
      manifest,
      entry: `
module.exports = {
  init(ctx) {
    ctx.externalWs.connect('c1', { url: 'ws://127.0.0.1:8001' })
    ctx.externalWs.connect('c2', { url: 'ws://127.0.0.1:8001' })
  }
}
`
    })
    await writeModule(rig, 'mod-b', {
      manifest,
      entry: `
module.exports = {
  init(ctx) {
    ctx.externalWs.connect('c3', { url: 'ws://127.0.0.1:8001' })
  }
}
`
    })
    await rig.modules.discover()
    await rig.modules.load('mod-a')
    await rig.modules.load('mod-b')
    expect(host.live.size).toBe(3)

    await rig.modules.unload('mod-a')

    expect(host.live.size, 'A 的两条应被关闭').toBe(1)
    expect(externalWs.list().map((s) => s.moduleId)).toEqual(['mod-b'])
  })
})

describe('凭据门面接线（C0）', () => {
  it('ctx.credentials 命名空间隔离：读不到核心密钥与其他模块的密钥', async () => {
    const { rig, store } = await makeC0Rig()
    store.set('obs:password', 'OBS-SECRET')

    await writeModule(rig, 'cred-a', {
      entry: `
module.exports = {
  init(ctx) {
    ctx.credentials.set('auth-token', 'A-TOKEN')
    globalThis.__elT6.aToken = ctx.credentials.get('auth-token')
    globalThis.__elT6.aCoreLeak = ctx.credentials.get('password')
    globalThis.__elT6.aKeys = ctx.credentials.list().map((r) => r.key)
  }
}
`
    })
    await writeModule(rig, 'cred-b', {
      entry: `
module.exports = {
  init(ctx) {
    globalThis.__elT6.bToken = ctx.credentials.get('auth-token')
    globalThis.__elT6.bCoreLeak = ctx.credentials.get('password')
  }
}
`
    })
    await rig.modules.discover()
    await rig.modules.load('cred-a')
    await rig.modules.load('cred-b')

    expect(g().aToken, '自己的密钥可读').toBe('A-TOKEN')
    expect(g().aCoreLeak, '不得读到核心 obs:password').toBeNull()
    expect(g().bToken, '同名短名跨模块不可见').toBeNull()
    expect(g().bCoreLeak).toBeNull()
    expect(g().aKeys, 'list 只含本模块且前缀已剥离').toEqual(['auth-token'])

    // 落盘键在模块命名空间下，核心密钥未被触碰
    expect([...store.raw.keys()].sort()).toEqual(['module:cred-a:auth-token', 'obs:password'])
  })

  it('未注入服务时 ctx 不含这两个键（既有模块零影响）', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'plain-mod', {
      entry: `
module.exports = {
  init(ctx) {
    globalThis.__elT6.plainKeys = Object.keys(ctx).sort()
  }
}
`
    })
    await rig.modules.discover()
    expect((await rig.modules.load('plain-mod')).ok).toBe(true)

    expect(g().plainKeys).not.toContain('externalWs')
    expect(g().plainKeys).not.toContain('credentials')
  })
})

describe('startAll', () => {
  it('拓扑序加载启动；损坏 entry 进 failed；禁用模块跳过', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'sa-lib', {})
    await writeModule(rig, 'sa-app', { manifest: { dependencies: [{ id: 'sa-lib' }] } })
    await writeModule(rig, 'sa-broken', { manifest: { entry: 'missing.js' } })
    await writeModule(rig, 'sa-off', {})
    await rig.modules.discover()
    await rig.modules.disable('sa-off')

    const summary = await rig.modules.startAll()
    expect(summary).toEqual({ discovered: 4, started: 2, failed: ['sa-broken'] })
    expect(rig.modules.get('sa-lib')?.status).toBe('started')
    expect(rig.modules.get('sa-app')?.status).toBe('started')
    expect(rig.modules.get('sa-broken')?.status).toBe('failed')
    expect(rig.modules.get('sa-broken')?.error).toContain('missing.js')
    expect(rig.modules.get('sa-off')?.status).toBe('disabled')
  })

  it('依赖环 → 环上模块全部 failed，不阻塞他人', async () => {
    const rig = await makeRig()
    await writeModule(rig, 'cy-a', { manifest: { dependencies: [{ id: 'cy-b' }] } })
    await writeModule(rig, 'cy-b', { manifest: { dependencies: [{ id: 'cy-a' }] } })
    await writeModule(rig, 'cy-ok', {})
    await rig.modules.discover()

    const summary = await rig.modules.startAll()
    expect(summary.started).toBe(1)
    expect([...summary.failed].sort()).toEqual(['cy-a', 'cy-b'])
    expect(rig.modules.get('cy-a')?.error).toContain('cycle')
    expect(rig.modules.get('cy-ok')?.status).toBe('started')
  })
})
