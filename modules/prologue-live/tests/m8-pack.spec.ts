import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import { createConfig } from '../../../src/main/core/config'
import { createEventBus } from '../../../src/main/core/bus'
import { createPermissions } from '../../../src/main/core/permissions'
import { createGateway } from '../../../src/main/core/gateway'
import { createModules } from '../../../src/main/core/modules'
import { createPackages, type PackagesRig } from '../../../src/main/core/packages'

const MODULE_DIR = resolve(process.cwd(), 'modules/prologue-live')

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

async function makeRig(): Promise<PackagesRig> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-pkg-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir })
  const packages = createPackages({ logger, modules, modulesDir, appVersion: '0.1.4-beta0925' })
  await config.ready()
  return { packages, modules, logger, config, bus, permissions, gateway, modulesDir, root }
}

describe('PrologueType Live .elm 打包链', () => {
  it('pack → .elm（module.json 描述符 + 入口 sha256 + 全文件收集，不含 manifest.json）→ inspect 往返一致', async () => {
    const rig = await makeRig()
    const out = join(rig.root, 'prologue-live-0.1.7.elm')

    const packRes = await rig.packages.pack({ dir: MODULE_DIR, out, coreVersion: '*', license: 'UNLICENSED' })
    expect(packRes.ok).toBe(true)
    expect(packRes.errors).toEqual([])
    expect(packRes.moduleId).toBe('prologue-live')

    // inspect 往返（info 为包级字段；id/version 在 module.json 内校验）
    const info = await rig.packages.inspect(out)
    expect(info.ok).toBe(true)
    expect(info.info?.format).toBe(1)
    expect(info.info?.coreVersion).toBe('*')
    expect(info.info?.license).toBe('UNLICENSED')
    expect(info.info?.entry).toBe('index.js')
    expect(info.info?.signed).toBe(false)

    // sha256 = 入口文件 index.js
    const entry = await readFile(join(MODULE_DIR, 'index.js'))
    expect(info.info?.sha256).toBe(createHash('sha256').update(entry).digest('hex'))

    // 文件收集：含 pages/lib/tests；描述符为 module.json，不得混入 manifest.json
    expect(info.info?.fileCount).toBeGreaterThanOrEqual(12)
    const zip = new AdmZip(out)
    const names = zip.getEntries().map((e) => e.entryName)
    expect(names).toContain('module.json')
    expect(names).toContain('index.js')
    expect(names).toContain('pages/obs.html')
    expect(names).toContain('pages/overlay.html')
    expect(names).toContain('pages/control.html')
    expect(names).toContain('lib/engine.js')
    expect(names).toContain('lib/config.js')
    expect(names).toContain('lib/float.js')
    expect(names).toContain('lib/fonts.js')
    expect(names).not.toContain('manifest.json')

    // module.json 字段完整性（含包级字段与运行时字段）
    const desc = zip.getEntry('module.json')?.getData().toString('utf8') as string
    const moduleJson = JSON.parse(desc) as Record<string, unknown>
    expect(moduleJson).toMatchObject({
      id: 'prologue-live',
      version: (JSON.parse(await readFile(join(MODULE_DIR, 'manifest.json'), 'utf8')) as {
        version: string
      }).version,
      format: 1,
      coreVersion: '*',
      license: 'UNLICENSED',
      permissions: ['window-overlay', 'global-shortcut'],
      routes: [
        { method: 'GET', path: '/prologue-live/obs' },
        { method: 'GET', path: '/prologue-live/overlay' },
        { method: 'GET', path: '/prologue-live/control' },
        { method: 'GET', path: '/prologue-live/state' }
      ],
      channels: ['prologue-live'],
      events: [
        'prologue-live:queue-changed',
        'prologue-live:style-changed',
        'prologue-live:float-changed'
      ],
      // 页面模块声明随包往返（T29 归一化：allowedDomains: []）
      web: {
        url: '/prologue-live/control',
        windowMode: 'embedded',
        pinned: true,
        allowedDomains: []
      }
    })
    expect(typeof moduleJson.sha256).toBe('string')
    expect(moduleJson.sha256).toHaveLength(64)
  })
})
