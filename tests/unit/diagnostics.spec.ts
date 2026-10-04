import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import { createConfig } from '../../src/main/core/config'
import { createEventBus } from '../../src/main/core/bus'
import { createPermissions } from '../../src/main/core/permissions'
import { createGateway } from '../../src/main/core/gateway'
import { createModules } from '../../src/main/core/modules'
import { createCredentialStore, type CredentialCipher } from '../../src/main/core/credentials'
import { createNetworkClient } from '../../src/main/core/network'
import { createStylePacks } from '../../src/main/core/styles'
import { createWebTools } from '../../src/main/core/webtools'
import { createObs } from '../../src/main/core/obs'
import { createShortcuts } from '../../src/main/core/shortcuts'
import { createOverlayWindows } from '../../src/main/core/overlay-windows'
import type { WebToolHost } from '@contracts/webtools'
import type { ShortcutHost } from '@contracts/shortcuts'
import type {
  OverlayBounds,
  OverlayHostHooks,
  OverlayScreen,
  OverlayWindowHost,
  OverlayWindowSpec
} from '@contracts/overlays'
import { collectDiagnostics, buildDiagnosticBundle } from '../../src/main/core/diagnostics'
import type { DiagnosticsAppInfo } from '@shared/diagnostics'

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

const APP: DiagnosticsAppInfo = {
  name: 'EclipseLIVE',
  version: '0.1.0',
  platform: 'win32',
  electron: '44.4.3',
  node: '22.0.0'
}

const fakeHost: WebToolHost = {
  createView() {
    return {
      load: async () => {},
      loadUrl: async () => {},
      setBounds: () => {},
      setVisible: () => {},
      setUiTokens: () => {},
      destroy: () => {}
    }
  }
}

const fakeShortcutHost: ShortcutHost = {
  register: () => true,
  unregister: () => {}
}

/** T27：悬浮窗 fake 宿主（最小面：单屏 + 固定 bounds）。 */
const fakeOverlayHost: OverlayWindowHost = {
  screens(): OverlayScreen[] {
    return [{ id: 'p1', primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]
  },
  create(spec: OverlayWindowSpec, hooks: OverlayHostHooks): object | null {
    const rec = {
      spec,
      hooks,
      bounds: (spec.bounds ?? { x: 800, y: 400, width: 320, height: 200 }) as OverlayBounds
    }
    return { rec }
  },
  destroy(): void {},
  setClickThrough(): void {},
  setAlwaysOnTop(): void {},
  setBounds(): void {},
  getBounds(handle: object): OverlayBounds {
    return (handle as { rec: { bounds: OverlayBounds } }).rec.bounds
  }
}

async function makeRig() {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-diag-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  await gateway.start()

  // 模块：普通 + 声明式网页工具
  const modulesDir = join(root, 'modules')
  await mkdir(join(modulesDir, 'plain-mod'), { recursive: true })
  await writeFile(
    join(modulesDir, 'plain-mod', 'manifest.json'),
    JSON.stringify({
      id: 'plain-mod',
      name: 'Plain',
      version: '1.0.0',
      permissions: ['file-read', 'global-shortcut', 'window-overlay'],
      dependencies: [],
      entry: 'index.js'
    }),
    'utf8'
  )
  await writeFile(join(modulesDir, 'plain-mod', 'index.js'), 'module.exports = {}', 'utf8')
  await mkdir(join(modulesDir, 'web-mod'), { recursive: true })
  await writeFile(
    join(modulesDir, 'web-mod', 'manifest.json'),
    JSON.stringify({
      id: 'web-mod',
      name: 'Web',
      version: '0.2.0',
      permissions: ['network-access'],
      dependencies: [],
      web: {
        url: 'https://demo.example/',
        allowedDomains: ['https://demo.example'],
        windowMode: 'embedded',
        pinned: true
      }
    }),
    'utf8'
  )
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir })
  await modules.startAll()

  const obs = createObs({
    logger,
    config,
    bus,
    gateway
  })
  const webtools = createWebTools({ logger, modules, gateway, host: fakeHost })
  const shortcuts = createShortcuts({ logger, permissions, host: fakeShortcutHost })
  const overlays = createOverlayWindows({ logger, permissions, host: fakeOverlayHost })
  const network = createNetworkClient({ logger })
  const styles = await createStylePacks({
    logger,
    config,
    bus,
    resourcesDir: join(root, 'styles'),
    appVersion: '0.1.0'
  })
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
  await config.ready()

  return {
    deps: {
      app: APP,
      config,
      gateway,
      modules,
      permissions,
      obs,
      webtools,
      network,
      credentials,
      shortcuts,
      overlays
    },
    styles,
    config,
    bus,
    gateway,
    modules,
    webtools,
    shortcuts,
    overlays,
    credentials,
    logsDir: join(root, 'logs')
  }
}

/* ---------- 用例 ---------- */

describe('诊断聚合快照', () => {
  let rig: Awaited<ReturnType<typeof makeRig>>

  it('聚合形状：网关 started、模块含元数据与 web 标记、权限、OBS disconnected、网页工具、network', async () => {
    rig = await makeRig()
    const snap = collectDiagnostics(rig.deps)

    expect(snap.generatedAt).toBeGreaterThan(0)
    expect(snap.app).toEqual(APP)
    expect(snap.gateway.started).toBe(true)
    expect(snap.gateway.port).toBeGreaterThan(0)
    expect(snap.gateway.tokenPresent).toBe(true)
    expect(snap.gateway.routes).toContain('GET /diagnostics')

    const plain = snap.modules.find((m) => m.id === 'plain-mod')
    expect(plain).toMatchObject({
      status: 'started',
      name: 'Plain',
      version: '1.0.0',
      permissions: ['file-read', 'global-shortcut', 'window-overlay'],
      web: false,
      pinned: false
    })
    const web = snap.modules.find((m) => m.id === 'web-mod')
    expect(web).toMatchObject({
      status: 'started',
      web: true,
      page: false,
      pinned: true,
      permissions: ['network-access']
    })

    expect(snap.permissions.find((p) => p.moduleId === 'plain-mod')?.declared).toEqual([
      'file-read',
      'global-shortcut',
      'window-overlay'
    ])
    expect(snap.obs.status).toBe('disconnected')
    expect(snap.obs.port).toBe(4455)
    expect(snap.webtools.tools).toBe(1)
    expect(snap.webtools.statuses[0]).toMatchObject({ moduleId: 'web-mod', state: 'closed' })
    expect(snap.network).toMatchObject({ mode: 'local-empty', rejected: 0 })
    // T24：快捷键节点默认空形状
    expect(snap.shortcuts).toEqual({ registered: 0, byModule: [], conflicts: [] })
    // T27：悬浮窗节点默认空形状（URL 红线：节点不含窗口 URL 字段）
    expect(snap.overlays).toEqual({ open: 0, byModule: [], clickThroughCount: 0 })
    expect(JSON.stringify(snap.overlays)).not.toContain('url')
  })

  it('快捷键节点：注册后出现在快照（byModule 分组）', async () => {
    const result = rig.shortcuts.register('plain-mod', 'send', 'CommandOrControl+Shift+P', () => {})
    expect(result.ok).toBe(true)
    const snap = collectDiagnostics(rig.deps)
    expect(snap.shortcuts.registered).toBe(1)
    expect(snap.shortcuts.byModule).toEqual([{ moduleId: 'plain-mod', ids: ['send'] }])
  })

  it('悬浮窗节点：创建并开启穿透后出现在快照（open/byModule/clickThroughCount）', async () => {
    const result = rig.overlays.create('plain-mod', 'panel', {
      url: 'http://127.0.0.1:1/plain?token=t',
      clickThrough: true
    })
    expect(result.ok).toBe(true)
    const snap = collectDiagnostics(rig.deps)
    expect(snap.overlays).toEqual({
      open: 1,
      byModule: [{ moduleId: 'plain-mod', ids: ['panel'] }],
      clickThroughCount: 1
    })
  })

  it('凭据元数据：count/weak/keys，无值', async () => {
    rig.credentials.set('service:key', 'secret-value')
    const snap = collectDiagnostics(rig.deps)
    expect(snap.credentials).toEqual({ count: 1, weak: 1, keys: ['service:key'] })
    expect(JSON.stringify(snap)).not.toContain('secret-value')
  })

  it('样式已应用：importPack 后出现在快照', async () => {
    rig.config.register('plain-mod', { defaults: {}, version: 1 })
    rig.styles.register('plain-mod', 'theme', {})
    const path = join(rig.logsDir, '..', 'pack.elstyle')
    await writeFile(
      path,
      JSON.stringify({
        type: 'eclipse-style',
        moduleId: 'plain-mod',
        styleType: 'theme',
        version: 1,
        createdAt: Date.now(),
        coreVersion: '*',
        payload: { config: { theme: 'x' }, cssVars: { '--a': 'b' } }
      }),
      'utf8'
    )
    const result = await rig.styles.importPack(path)
    expect(result.ok).toBe(true)

    const snap = collectDiagnostics(rig.deps)
    expect(snap.styles.applied).toEqual([
      { moduleId: 'plain-mod', styleType: 'theme', version: 1, appliedAt: expect.any(Number) }
    ])
  })

  it('配置摘要：core.gateway / core.styles / core.modules 在列', () => {
    const snap = collectDiagnostics(rig.deps)
    const ids = snap.config.sections.map((s) => s.id)
    expect(ids).toContain('core.gateway')
    expect(ids).toContain('core.styles')
    expect(ids).toContain('core.modules')
    expect(snap.config.sections.every((s) => typeof s.version === 'number')).toBe(true)
  })

  it('诊断包：含日志尾部且 JSON 可解析', async () => {
    await mkdir(rig.logsDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const lines = Array.from({ length: 300 }, (_, i) => `log-line-${i}`)
    await writeFile(join(rig.logsDir, `eclipselive-${today}.log`), lines.join('\n'), 'utf8')

    const bundle = await buildDiagnosticBundle(rig.deps, rig.logsDir, 200)
    expect(bundle.logs.length).toBe(200)
    expect(bundle.logs[0]).toBe('log-line-100')
    expect(bundle.logs[199]).toBe('log-line-299')
    const parsed = JSON.parse(JSON.stringify(bundle))
    expect(parsed.gateway.started).toBe(true)
    expect(parsed.modules.length).toBeGreaterThan(0)
  })
})
