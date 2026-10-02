import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import AdmZip from 'adm-zip'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import type { ICredentialStore, CredentialRecord } from '@contracts/credentials'
import { createConfig } from '../../../src/main/core/config'
import { createEventBus } from '../../../src/main/core/bus'
import { createPermissions } from '../../../src/main/core/permissions'
import { createGateway } from '../../../src/main/core/gateway'
import { createExternalWs } from '../../../src/main/core/external-ws'
import { createExternalWsHost } from '../../../src/main/core/external-ws/electron-host'
import { createModules } from '../../../src/main/core/modules'
import { createPackages, type PackagesRig } from '../../../src/main/core/packages'

/**
 * M6 `.elm` 打包链：pack → inspect → **真实 install → 加载 → 连上模拟 VTS**。
 *
 * 为什么这条测试对本模块特别重要：模块依赖 vendor 进去的官方库（成品里
 * `resources/modules/` 在 asar 之外，`require('vtubestudio')` 永远解析不到）。
 * 因此必须验证**打包产物自身**包含 vendor，且从产物安装出来的模块能真正跑起来
 * ——而不是只验证源码目录能跑。
 */

const MODULE_DIR = resolve(process.cwd(), 'modules/vts-controlpad')
const VTS_PORT = 8051
process.env.EL_VTS_URL = `ws://127.0.0.1:${VTS_PORT}`

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

async function makeRig(): Promise<PackagesRig & { modules: ReturnType<typeof createModules> }> {
  process.env.EL_VTS_URL = `ws://127.0.0.1:${VTS_PORT}`
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-vts-m6-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  await gateway.start()
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
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
  const packages = createPackages({ logger, modules, modulesDir, appVersion: '0.1.9-beta1.1' })
  await config.ready()
  return { packages, modules, logger, config, bus, permissions, gateway, modulesDir, root }
}

interface MockVts {
  received: string[]
  close(): Promise<void>
}

async function startMockVts(): Promise<MockVts> {
  const received: string[] = []
  const sockets = new Set<WebSocket>()
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
          modelLoaded: true,
          modelName: 'Mock',
          modelID: 'm1',
          availableHotkeys: [
            { hotkeyID: 'hk1', name: '打招呼', type: 'TriggerAnimation', description: '' }
          ]
        }
      else if (base === 'EventSubscription') data = { subscribed: true, eventName: msg.data?.eventName }
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
    close(): Promise<void> {
      return new Promise<void>((res) => {
        for (const s of sockets) s.terminate()
        sockets.clear()
        wss.close(() => res())
      })
    }
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('waitFor 超时')
}

let openVts: MockVts | null = null
afterEach(async () => {
  if (openVts) {
    await openVts.close()
    openVts = null
  }
})

describe('M6 .elm 打包链', () => {
  it('pack → inspect：描述符字段、入口 sha256、全文件收集（含 vendor，不含 manifest.json）', async () => {
    const rig = await makeRig()
    const out = join(rig.root, 'vts-controlpad-0.1.0.elm')

    const packRes = await rig.packages.pack({
      dir: MODULE_DIR,
      out,
      coreVersion: '*',
      license: 'UNLICENSED'
    })
    expect(packRes.ok).toBe(true)
    expect(packRes.errors).toEqual([])
    expect(packRes.moduleId).toBe('vts-controlpad')

    const info = await rig.packages.inspect(out)
    expect(info.ok).toBe(true)
    expect(info.info?.format).toBe(1)
    expect(info.info?.coreVersion).toBe('*')
    expect(info.info?.entry).toBe('index.js')
    expect(info.info?.signed).toBe(false)

    // sha256 = 入口文件 index.js
    const entry = await readFile(join(MODULE_DIR, 'index.js'))
    expect(info.info?.sha256).toBe(createHash('sha256').update(entry).digest('hex'))

    const zip = new AdmZip(out)
    const names = zip.getEntries().map((e) => e.entryName)
    expect(names).toContain('module.json')
    expect(names).toContain('index.js')
    expect(names).toContain('pages/control.html')
    expect(names).toContain('pages/float.html')
    expect(names).toContain('lib/transport.js')
    expect(names).toContain('lib/auth.js')
    expect(names).toContain('lib/hotkeys.js')
    expect(names).toContain('lib/trigger.js')
    expect(names).toContain('lib/float.js')
    expect(names).not.toContain('manifest.json')

    // ★ 自包含的关键：vendor 必须随包（附上游 LICENSE，红线 14 可追溯）
    expect(names, 'vendor 入口必须随包').toContain('vendor/vtubestudio/lib/index.js')
    expect(names).toContain('vendor/vtubestudio/lib/endpoints.js')
    expect(names).toContain('vendor/vtubestudio/LICENSE')
    expect(names).toContain('vendor/vtubestudio/package.json')
    expect(names).toContain('vendor/vtubestudio/README.md')

    const desc = JSON.parse(zip.getEntry('module.json')?.getData().toString('utf8') as string) as Record<
      string,
      unknown
    >
    // 版本从 manifest 读（不要硬编码：模块升版时会挂）
    const manifest = JSON.parse(await readFile(join(MODULE_DIR, 'manifest.json'), 'utf8')) as {
      version: string
      permissions: string[]
      channels: string[]
    }
    expect(desc).toMatchObject({
      id: 'vts-controlpad',
      version: manifest.version,
      format: 1,
      permissions: manifest.permissions,
      channels: manifest.channels
    })
    expect(desc.web).toMatchObject({ url: '/vts-controlpad/control', allowedDomains: [] })
  })

  it('★ install 后模块目录自包含（vendor 在位），且能从产物加载并连上 VTS', async () => {
    const vts = await startMockVts()
    openVts = vts
    const rig = await makeRig()
    const out = join(rig.root, 'vts-controlpad-0.1.0.elm')
    await rig.packages.pack({ dir: MODULE_DIR, out, coreVersion: '*', license: 'UNLICENSED' })

    const installRes = await rig.packages.install(out)
    expect(installRes.ok, `安装失败：${installRes.errors.join('; ')}`).toBe(true)

    // 安装目录按 manifest id 命名，且 vendor 被完整解出
    const installed = join(rig.modulesDir, 'vts-controlpad')
    await expect(stat(join(installed, 'vendor/vtubestudio/lib/index.js'))).resolves.toBeTruthy()
    await expect(stat(join(installed, 'vendor/vtubestudio/LICENSE'))).resolves.toBeTruthy()
    await expect(stat(join(installed, 'manifest.json'))).resolves.toBeTruthy()

    // 从产物加载并启动 → 真的连上模拟 VTS（证明 vendor 解析在"非源码目录"下也成立）
    await rig.modules.discover()
    expect((await rig.modules.load('vts-controlpad')).ok).toBe(true)
    await rig.modules.start('vts-controlpad')
    await waitFor(() => vts.received.includes('AuthenticationTokenRequest'))
    await waitFor(() => vts.received.includes('HotkeysInCurrentModelRequest'))

    // 热键列表经状态路由可读（模块确实跑起来了，而不是"加载成功但一用就崩"）
    const res = await fetch(rig.gateway.getRouteUrl('/vts-controlpad/state'))
    const state = (await res.json()) as Record<string, unknown>
    await waitFor(() => Array.isArray(state.hotkeys) && (state.hotkeys as unknown[]).length === 1)
    expect(state.status).toBe('authenticated')

    await rig.modules.stop('vts-controlpad')
  }, 30000)
})
