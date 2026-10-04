import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import type { StylePackEnvelope } from '@contracts/styles'
import { createConfig } from '../../../src/main/core/config'
import { createEventBus } from '../../../src/main/core/bus'
import { createPermissions } from '../../../src/main/core/permissions'
import { createGateway } from '../../../src/main/core/gateway'
import { createModules, type ModulesRig } from '../../../src/main/core/modules'
import { createStylePacks, type StylePacksRig } from '../../../src/main/core/styles'

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

interface StyleRig {
  modules: ModulesRig['modules']
  config: ModulesRig['config']
  styles: StylePacksRig['styles']
  root: string
}

const rigs: StyleRig[] = []
afterEach(async () => {
  while (rigs.length > 0) {
    const r = rigs.pop()
    if (r) await r.modules.unload('prologue-live').catch(() => {})
  }
})

async function setupRig(): Promise<StyleRig> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-pl-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  await cp(MODULE_DIR, join(modulesDir, 'prologue-live'), { recursive: true })
  const styles = await createStylePacks({
    logger,
    config,
    bus,
    resourcesDir: join(root, 'styles'),
    appVersion: '0.1.0'
  })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir, styles })
  await config.ready()
  await modules.discover()
  expect((await modules.load('prologue-live')).ok).toBe(true)
  expect((await modules.start('prologue-live')).ok).toBe(true)
  const rig = { modules, config, styles, root }
  rigs.push(rig)
  return rig
}

function makeEnvelope(styleType: string, config?: unknown, cssVars?: Record<string, string>): StylePackEnvelope {
  return {
    type: 'eclipse-style',
    moduleId: 'prologue-live',
    styleType,
    version: 1,
    createdAt: Date.now(),
    coreVersion: '*',
    payload: { ...(config !== undefined ? { config } : {}), ...(cssVars ? { cssVars } : {}) }
  }
}

async function writePack(rig: StyleRig, envelope: StylePackEnvelope, name = 'p.elstyle'): Promise<string> {
  const path = join(rig.root, name)
  await mkdir(dirname(path), { recursive: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, JSON.stringify(envelope), 'utf8')
  return path
}

describe('M6 样式包（ctx.styles.register：obs / float）', () => {
  it('obs 样式包 apply：只并入 obs 组，float 组原样保留', async () => {
    const rig = await setupRig()
    const path = await writePack(
      rig,
      makeEnvelope('obs', { textColor: '#ff00aa', typingSpeed: 60 })
    )
    const result = await rig.styles.importPack(path)
    expect(result.ok).toBe(true)
    expect(rig.config.get('prologue-live')).toMatchObject({ textColor: '#ff00aa', typingSpeed: 60 })
    expect(rig.config.get('prologue-live').float).toEqual(configLib.PROLOGUE_DEFAULTS.float)
  })

  it('float 样式包 apply：只并入 float 组，OBS 组原样保留', async () => {
    const rig = await setupRig()
    const path = await writePack(rig, makeEnvelope('float', { enabled: true, bgOpacity: 50, textColor: '#aabbcc' }))
    const result = await rig.styles.importPack(path)
    expect(result.ok).toBe(true)
    const cfg = rig.config.get('prologue-live')
    expect(cfg.float).toMatchObject({ enabled: true, bgOpacity: 50, textColor: '#aabbcc' })
    expect(cfg.textColor).toBe(configLib.PROLOGUE_DEFAULTS.textColor)
  })

  it('validate：未知键 / 跨组键（obs 包带 float 键）/ 非法 cssVars → 拒收且配置原样', async () => {
    const rig = await setupRig()
    const before = JSON.stringify(rig.config.get('prologue-live'))

    const unknownKey = await writePack(rig, makeEnvelope('obs', { unknownKey: 1 }), 'u1.elstyle')
    expect((await rig.styles.importPack(unknownKey)).ok).toBe(false)

    const crossGroup = await writePack(rig, makeEnvelope('obs', { float: { enabled: true } }), 'u2.elstyle')
    expect((await rig.styles.importPack(crossGroup)).ok).toBe(false)

    const badVars = await writePack(rig, makeEnvelope('obs', { textColor: '#ffffff' }, { notDashed: '1' }), 'u3.elstyle')
    expect((await rig.styles.importPack(badVars)).ok).toBe(false)

    expect(JSON.stringify(rig.config.get('prologue-live'))).toBe(before)
  })

  it('validate：合法 cssVars（-- 前缀）放行', async () => {
    const rig = await setupRig()
    const path = await writePack(rig, makeEnvelope('float', { enabled: true }, { '--pt-x': '#fff' }), 'ok.elstyle')
    expect((await rig.styles.importPack(path)).ok).toBe(true)
  })

  it('export：导出本组配置（obs 不含 float 键；float 即嵌套组）', async () => {
    const rig = await setupRig()
    const path = await writePack(rig, makeEnvelope('obs', { textColor: '#ff00aa', typingSpeed: 60 }))
    await rig.styles.importPack(path)

    const outPath = join(rig.root, 'export-obs.elstyle')
    const exp = await rig.styles.exportPack('prologue-live', 'obs', outPath)
    expect(exp.ok).toBe(true)
    const pack = JSON.parse(await readFile(outPath, 'utf8')) as { payload: { config: Record<string, unknown> } }
    expect(pack.payload.config.textColor).toBe('#ff00aa')
    expect(Object.keys(pack.payload.config).sort()).not.toContain('float')

    const outFloat = join(rig.root, 'export-float.elstyle')
    await rig.styles.exportPack('prologue-live', 'float', outFloat)
    const floatPack = JSON.parse(await readFile(outFloat, 'utf8')) as { payload: { config: Record<string, unknown> } }
    expect(floatPack.payload.config.enabled).toBe(false)
  })
})
