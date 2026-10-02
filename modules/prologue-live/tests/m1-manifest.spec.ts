import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import { MODULE_ID_PATTERN } from '@contracts/module'
import { PERMISSION_TYPES } from '@contracts/permission'
import { createConfig } from '../../../src/main/core/config'
import { createEventBus } from '../../../src/main/core/bus'
import { createPermissions } from '../../../src/main/core/permissions'
import { createGateway } from '../../../src/main/core/gateway'
import { createModules, type ModulesRig } from '../../../src/main/core/modules'

/** 仓库内真实模块目录（测试读取与实载的单一来源）。 */
const MODULE_DIR = resolve(process.cwd(), 'modules/prologue-live')

/** CJS require：直接加载模块内纯逻辑文件（lib/*.js）。 */
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

async function makeRig(): Promise<ModulesRig> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-pl-'))
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

/** 拷贝仓库内真实模块目录到 rig，供实载（M1 起每卡复用）。 */
async function copyModule(rig: ModulesRig): Promise<void> {
  await cp(MODULE_DIR, join(rig.modulesDir, 'prologue-live'), { recursive: true })
}

/* ---------- manifest.json 形状 ---------- */

describe('PrologueType Live manifest.json', () => {
  it('id/name/entry 合法；permissions 为闭集子集且为本需求指定值', async () => {
    const manifest = JSON.parse(await readFile(join(MODULE_DIR, 'manifest.json'), 'utf8'))
    expect(manifest.id).toBe('prologue-live')
    expect(MODULE_ID_PATTERN.test(manifest.id)).toBe(true)
    expect(manifest.name).toBe('PrologueType Live')
    expect(manifest.entry).toBe('index.js')
    expect(manifest.permissions).toEqual(['window-overlay', 'global-shortcut'])
    for (const p of manifest.permissions) {
      expect(PERMISSION_TYPES).toContain(p)
    }
  })

  it('routes 恰为 4 条（obs/overlay/control/state），channels 1 条，events 3 个元数据类型', async () => {
    const manifest = JSON.parse(await readFile(join(MODULE_DIR, 'manifest.json'), 'utf8'))
    expect(manifest.routes).toEqual([
      { method: 'GET', path: '/prologue-live/obs' },
      { method: 'GET', path: '/prologue-live/overlay' },
      { method: 'GET', path: '/prologue-live/control' },
      { method: 'GET', path: '/prologue-live/state' }
    ])
    expect(manifest.channels).toEqual(['prologue-live'])
    expect(manifest.events).toEqual([
      'prologue-live:queue-changed',
      'prologue-live:style-changed',
      'prologue-live:float-changed'
    ])
  })

  it('web 声明为相对路径模块页面（应用内二级菜单入口）', async () => {
    const manifest = JSON.parse(await readFile(join(MODULE_DIR, 'manifest.json'), 'utf8'))
    expect(manifest.web).toEqual({
      url: '/prologue-live/control',
      windowMode: 'embedded',
      pinned: true
    })
  })

  it('config.version = 1；defaults 与 lib/config.js 的 PROLOGUE_DEFAULTS 完全一致（单一来源）', async () => {
    const manifest = JSON.parse(await readFile(join(MODULE_DIR, 'manifest.json'), 'utf8'))
    expect(manifest.config.version).toBe(1)
    expect(manifest.config.defaults).toEqual(configLib.PROLOGUE_DEFAULTS)
  })
})

/* ---------- 配置 schema（lib/config.js） ---------- */

describe('config schema', () => {
  it('默认值形状完整：OBS 组平铺 + float 组嵌套，全键清单', () => {
    const d = configLib.PROLOGUE_DEFAULTS
    expect(Object.keys(d).sort()).toEqual(
      [
        'textColor',
        'fontFamily',
        'fontSize',
        'typingSpeed',
        'scrollSpeed',
        'prefixSymbol',
        'suffixSymbol',
        'styleType',
        'bgColor',
        'borderColor',
        'borderWidth',
        'blurStrength',
        'opacity',
        'float'
      ].sort()
    )
    expect(Object.keys(d.float).sort()).toEqual(
      [
        'enabled',
        'screen',
        'x',
        'y',
        'width',
        'height',
        'bgOpacity',
        'textOpacity',
        'clickThrough',
        'toggleThroughHotkey',
        'sendHotkey',
        'bgColor',
        'textColor',
        'borderColor',
        'blurStrength',
        'fontFamily',
        'fontSize',
        'snapEdges',
        'rememberPosition',
        'showHistory'
      ].sort()
    )
  })

  it('默认值通过校验', () => {
    expect(configLib.validateConfig(configLib.PROLOGUE_DEFAULTS)).toEqual({ ok: true, errors: [] })
  })

  it.each([
    ['textColor', 'red', 'hex'],
    ['typingSpeed', 5, 'typingSpeed'],
    ['typingSpeed', 501, 'typingSpeed'],
    ['scrollSpeed', 20, 'scrollSpeed'],
    ['styleType', 'glass', 'styleType'],
    ['fontFamily', '   ', 'fontFamily'],
    ['fontSize', 4, 'fontSize'],
    ['borderWidth', -1, 'borderWidth'],
    ['blurStrength', 999, 'blurStrength'],
    ['opacity', 101, 'opacity']
  ])('OBS 组非法值 %s=%s → 校验失败（%s）', (key, value, hint) => {
    const bad = { ...configLib.PROLOGUE_DEFAULTS, [key]: value }
    const res = configLib.validateConfig(bad)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toContain(hint)
  })

  it.each([
    ['textOpacity', 10, 'textOpacity'],
    ['bgOpacity', -1, 'bgOpacity'],
    ['width', 10, 'width'],
    ['height', 99999, 'height'],
    ['fontFamily', '', 'fontFamily'],
    ['enabled', 'yes', 'enabled'],
    ['clickThrough', 1, 'clickThrough'],
    ['bgColor', 'black', 'hex']
  ])('float 组非法值 %s=%s → 校验失败（%s）', (key, value, hint) => {
    const bad = { ...configLib.PROLOGUE_DEFAULTS, float: { ...configLib.PROLOGUE_DEFAULTS.float, [key]: value } }
    const res = configLib.validateConfig(bad)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toContain(hint)
  })

  it('float 组 textOpacity 保底 30（文字必须始终可读）', () => {
    const d = configLib.PROLOGUE_DEFAULTS
    const ok = { ...d, float: { ...d.float, textOpacity: 30 } }
    expect(configLib.validateConfig(ok).ok).toBe(true)
    const bad = { ...d, float: { ...d.float, textOpacity: 29 } }
    expect(configLib.validateConfig(bad).ok).toBe(false)
  })

  it('applyGroup：obs 组部分合并，float 组不受影响', () => {
    const d = configLib.PROLOGUE_DEFAULTS
    const res = configLib.applyGroup(d, 'obs', { textColor: '#ff0000', typingSpeed: 80 })
    expect(res.ok).toBe(true)
    expect(res.next.textColor).toBe('#ff0000')
    expect(res.next.typingSpeed).toBe(80)
    expect(res.next.float).toEqual(d.float)
  })

  it('applyGroup：float 组部分合并，OBS 组不受影响', () => {
    const d = configLib.PROLOGUE_DEFAULTS
    const res = configLib.applyGroup(d, 'float', { enabled: true, x: 200, bgOpacity: 50 })
    expect(res.ok).toBe(true)
    expect(res.next.float).toMatchObject({ enabled: true, x: 200, bgOpacity: 50 })
    expect(res.next.textColor).toBe(d.textColor)
    expect(res.next.styleType).toBe(d.styleType)
  })

  it('applyGroup：非法变更 → ok=false 且不产出 next', () => {
    const d = configLib.PROLOGUE_DEFAULTS
    const res = configLib.applyGroup(d, 'obs', { textColor: 'nope' })
    expect(res.ok).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.next).toBeUndefined()
  })

  it('applyGroup：未知分组 → ok=false', () => {
    const res = configLib.applyGroup(configLib.PROLOGUE_DEFAULTS, 'theme', {})
    expect(res.ok).toBe(false)
  })
})

/* ---------- 实载接线（ModulesRig） ---------- */

describe('M1 骨架实载接线', () => {
  it('load 后：权限声明、4 路由、频道、配置分区全部就位', async () => {
    const rig = await makeRig()
    await copyModule(rig)
    await rig.modules.discover()

    const loaded = await rig.modules.load('prologue-live')
    expect(loaded.ok).toBe(true)
    expect(rig.modules.get('prologue-live')?.status).toBe('loaded')

    // 权限声明（闭集校验通过 = 权限名合法）
    expect(rig.permissions.status('prologue-live').declared).toEqual([
      'window-overlay',
      'global-shortcut'
    ])
    expect(rig.permissions.status('prologue-live').granted).toEqual([
      'window-overlay',
      'global-shortcut'
    ])

    // 4 路由注册
    const routes = rig.gateway.diagnostics().routes
    for (const path of [
      '/prologue-live/obs',
      '/prologue-live/overlay',
      '/prologue-live/control',
      '/prologue-live/state'
    ]) {
      expect(routes).toContain(`GET ${path}`)
    }

    // 频道注册
    expect(rig.gateway.diagnostics().channels).toContain('prologue-live')

    // 配置分区 = 清单 defaults
    expect(rig.config.get('prologue-live')).toEqual(configLib.PROLOGUE_DEFAULTS)
  })

  it('start/stop 正常往返，stop 不注销路由/频道（与 routes/channels 生命周期一致）', async () => {
    const rig = await makeRig()
    await copyModule(rig)
    await rig.modules.discover()
    await rig.modules.load('prologue-live')

    expect((await rig.modules.start('prologue-live')).ok).toBe(true)
    await rig.modules.stop('prologue-live')
    expect(rig.modules.get('prologue-live')?.status).toBe('stopped')
    expect(rig.gateway.diagnostics().routes).toContain('GET /prologue-live/state')
    expect(rig.gateway.diagnostics().channels).toContain('prologue-live')

    expect((await rig.modules.start('prologue-live')).ok).toBe(true)
    expect(rig.modules.get('prologue-live')?.status).toBe('started')
  })
})
