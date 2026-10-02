import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import type { CoreEvent } from '@contracts/event'
import type { ILogger } from '@contracts/logger'
import type { StylePackEnvelope } from '@contracts/styles'
import { createConfig } from '../../src/main/core/config'
import { createEventBus } from '../../src/main/core/bus'
import {
  createStylePacks,
  type StylePacksRig
} from '../../src/main/core/styles'

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

async function makeRig(
  limits?: { maxResourceBytes?: number; maxTotalResourceBytes?: number }
): Promise<StylePacksRig> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-sty-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const styles = await createStylePacks({
    logger,
    config,
    bus,
    resourcesDir: join(root, 'styles'),
    appVersion: '0.1.0',
    maxResourceBytes: limits?.maxResourceBytes,
    maxTotalResourceBytes: limits?.maxTotalResourceBytes
  })
  await config.ready()
  return { styles, config, bus, logger, root }
}

function makeEnvelope(overrides: Partial<StylePackEnvelope> = {}): StylePackEnvelope {
  return {
    type: 'eclipse-style',
    moduleId: 'mod-a',
    styleType: 'theme',
    version: 1,
    createdAt: Date.now(),
    coreVersion: '*',
    payload: {},
    ...overrides
  }
}

/** 写一个 JSON 格式的 .elstyle 文件。 */
async function writeJsonPack(rig: StylePacksRig, envelope: object, name = 'p.elstyle'): Promise<string> {
  const path = join(rig.root, name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(envelope), 'utf8')
  return path
}

/* ---------- 原始 ZIP 构造（zip-slip 测试专用） ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 手工构造最小 ZIP（store 不压缩）——adm-zip addFile 会净化恶意条目名，无法构造攻击样本。 */
function buildRawZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const crc = crc32(f.data)
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(f.data.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)
    locals.push(local, f.data)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(f.data.length, 20)
    central.writeUInt32LE(f.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)

    offset += local.length + f.data.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuf, eocd])
}

/* ---------- 用例 ---------- */

describe('顶层校验与安全', () => {
  it('包类型/版本/coreVersion/moduleId 四态拒绝并说明原因', async () => {
    const rig = await makeRig()
    rig.styles.register('mod-a', 'theme', {})
    const badType = await rig.styles.importPack(
      await writeJsonPack(rig, { ...makeEnvelope(), type: 'other' })
    )
    expect(badType.ok).toBe(false)
    expect(badType.errors.join('; ')).toContain('type')
    const badVersion = await rig.styles.importPack(
      await writeJsonPack(rig, makeEnvelope({ version: 0 }))
    )
    expect(badVersion.errors.join('; ')).toContain('version')
    const badCore = await rig.styles.importPack(
      await writeJsonPack(rig, makeEnvelope({ coreVersion: '>=9.0.0' }))
    )
    expect(badCore.errors.join('; ')).toContain('core version')
    const badModule = await rig.styles.importPack(
      await writeJsonPack(rig, makeEnvelope({ moduleId: 'Not Kebab' }))
    )
    expect(badModule.errors.join('; ')).toContain('moduleId')
  })

  it('敏感键拒绝（顶层与嵌套）', async () => {
    const rig = await makeRig()
    rig.styles.register('mod-a', 'theme', {})
    const flat = await rig.styles.importPack(
      await writeJsonPack(rig, makeEnvelope({ payload: { config: { token: 'abc' } } }))
    )
    expect(flat.ok).toBe(false)
    expect(flat.errors.join('; ')).toContain('sensitive')
    const nested = await rig.styles.importPack(
      await writeJsonPack(
        rig,
        makeEnvelope({ payload: { config: { db: { password: 'x' } } } }),
        'nested.elstyle'
      )
    )
    expect(nested.ok).toBe(false)
    expect(nested.errors.join('; ')).toContain('sensitive')
  })

  it('cssVars 值含 < 或 > 拒绝（防样式标签逃逸）', async () => {
    const rig = await makeRig()
    rig.styles.register('mod-a', 'theme', {})
    const result = await rig.styles.importPack(
      await writeJsonPack(rig, makeEnvelope({ payload: { cssVars: { '--x': '<script>' } } }))
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('; ')).toContain('cssVars')
  })
})

describe('JSON 导入', () => {
  it('全链路：config 落模块分区 + cssVars 落 core.styles + styles:applied 事件', async () => {
    const rig = await makeRig()
    rig.styles.register('mod-a', 'theme', {})
    rig.config.register('mod-a', { defaults: { theme: 'plain' }, version: 1 })
    const events: CoreEvent<unknown>[] = []
    rig.bus.subscribe('styles:applied', (e) => events.push(e))

    const result = await rig.styles.importPack(
      await writeJsonPack(
        rig,
        makeEnvelope({ payload: { config: { theme: 'dark' }, cssVars: { '--accent': '#fff' } } })
      )
    )
    expect(result.ok).toBe(true)
    expect(rig.config.get<{ theme: string }>('mod-a')).toEqual({ theme: 'dark' })
    const applied = rig.styles.getApplied('mod-a', 'theme')
    expect(applied).toMatchObject({
      moduleId: 'mod-a',
      styleType: 'theme',
      version: 1,
      cssVars: { '--accent': '#fff' }
    })
    expect(applied?.appliedAt).toBeGreaterThan(0)
    expect(events.length).toBe(1)
    expect(events[0].source).toBe('styles')
    expect(events[0].payload).toEqual({ moduleId: 'mod-a', styleType: 'theme', version: 1 })
  })

  it('未注册/已注销处理器拒绝', async () => {
    const rig = await makeRig()
    rig.config.register('mod-a', { defaults: {}, version: 1 })
    const ghost = await rig.styles.importPack(await writeJsonPack(rig, makeEnvelope()))
    expect(ghost.ok).toBe(false)
    expect(ghost.errors.join('; ')).toContain('handler')

    rig.styles.register('mod-a', 'theme', {})
    expect((await rig.styles.importPack(await writeJsonPack(rig, makeEnvelope(), 'ok.elstyle'))).ok).toBe(true)
    rig.styles.unregisterModule('mod-a')
    const gone = await rig.styles.importPack(await writeJsonPack(rig, makeEnvelope(), 'gone.elstyle'))
    expect(gone.ok).toBe(false)
    expect(gone.errors.join('; ')).toContain('handler')
  })

  it('模块 validate 失败拒绝且零写入', async () => {
    const rig = await makeRig()
    rig.config.register('mod-a', { defaults: { theme: 'plain' }, version: 1 })
    rig.styles.register('mod-a', 'theme', {
      validate: (p) =>
        (p.config as { theme?: string } | undefined)?.theme === 'dark'
          ? []
          : ['theme must be dark']
    })
    const result = await rig.styles.importPack(
      await writeJsonPack(rig, makeEnvelope({ payload: { config: { theme: 'light' } } }))
    )
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toBe('theme must be dark')
    expect(rig.config.get<{ theme: string }>('mod-a')).toEqual({ theme: 'plain' })
    expect(rig.styles.getApplied('mod-a', 'theme')).toBeUndefined()
  })

  it('版本迁移：旧版本经 migrate 应用；新版本拒绝', async () => {
    const rig = await makeRig()
    rig.config.register('mod-a', { defaults: {}, version: 1 })
    rig.styles.register('mod-a', 'theme', {
      version: 2,
      migrate: (payload, fromVersion) => ({
        config: { ...(payload as { config?: object }).config, migrated: fromVersion }
      })
    })
    const migrated = await rig.styles.importPack(
      await writeJsonPack(
        rig,
        makeEnvelope({ version: 1, payload: { config: { theme: 'x' } } }),
        'v1.elstyle'
      )
    )
    expect(migrated.ok).toBe(true)
    expect(rig.config.get('mod-a')).toEqual({ theme: 'x', migrated: 1 })

    const newer = await rig.styles.importPack(
      await writeJsonPack(rig, makeEnvelope({ version: 3 }), 'v3.elstyle')
    )
    expect(newer.ok).toBe(false)
    expect(newer.errors.join('; ')).toContain('not supported')
  })

  it('应用失败自动回滚（config 分区与 applied 记录恢复、无事件）', async () => {
    const rig = await makeRig()
    rig.config.register('mod-a', { defaults: { theme: 'plain' }, version: 1 })
    rig.config.set('mod-a', { theme: 'current' })
    const events: CoreEvent<unknown>[] = []
    rig.bus.subscribe('styles:applied', (e) => events.push(e))
    rig.styles.register('mod-a', 'theme', {
      apply: (payload) => {
        // 模拟自定义应用：先写入再抛错
        void rig.config.set('mod-a', (payload as { config?: unknown }).config ?? {})
        throw new Error('apply boom')
      }
    })

    const result = await rig.styles.importPack(
      await writeJsonPack(rig, makeEnvelope({ payload: { config: { theme: 'new' } } }))
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('; ')).toContain('apply boom')
    expect(rig.config.get<{ theme: string }>('mod-a')).toEqual({ theme: 'current' })
    expect(rig.styles.getApplied('mod-a', 'theme')).toBeUndefined()
    expect(events.length).toBe(0)
  })

  it('自定义 apply 接收负载；自定义 export 进入 envelope', async () => {
    const rig = await makeRig()
    rig.config.register('mod-a', { defaults: {}, version: 1 })
    const appliedPayloads: unknown[] = []
    rig.styles.register('mod-a', 'theme', {
      apply: (payload) => {
        appliedPayloads.push(payload)
      },
      export: () => ({ config: { custom: 1 }, cssVars: { '--c': '2' } })
    })
    const imported = await rig.styles.importPack(
      await writeJsonPack(rig, makeEnvelope({ payload: { config: { theme: 'x' } } }))
    )
    expect(imported.ok).toBe(true)
    expect(appliedPayloads.length).toBe(1)
    expect(rig.config.get('mod-a')).toEqual({}) // 自定义 apply 不写配置分区

    const out = join(rig.root, 'exported.elstyle')
    const exported = await rig.styles.exportPack('mod-a', 'theme', out)
    expect(exported.ok).toBe(true)
    const envelope = JSON.parse(await readFile(out, 'utf8')) as StylePackEnvelope
    expect(envelope).toMatchObject({
      type: 'eclipse-style',
      moduleId: 'mod-a',
      styleType: 'theme',
      coreVersion: '*'
    })
    expect(envelope.payload).toEqual({ config: { custom: 1 }, cssVars: { '--c': '2' } })
    expect(envelope.createdAt).toBeGreaterThan(0)
  })
})

describe('导出', () => {
  it('默认导出往返：envelope 字段齐 + payload.config=分区值', async () => {
    const rig = await makeRig()
    rig.styles.register('mod-a', 'theme', {})
    rig.config.register('mod-a', { defaults: { theme: 'plain' }, version: 1 })
    rig.config.set('mod-a', { theme: 'exported' })

    const out = join(rig.root, 'out.elstyle')
    const result = await rig.styles.exportPack('mod-a', 'theme', out)
    expect(result.ok).toBe(true)
    const envelope = JSON.parse(await readFile(out, 'utf8')) as StylePackEnvelope
    expect(envelope).toMatchObject({
      type: 'eclipse-style',
      moduleId: 'mod-a',
      styleType: 'theme',
      version: 1,
      coreVersion: '*'
    })
    expect(envelope.payload).toEqual({ config: { theme: 'exported' } })
  })
})

describe('ZIP 格式', () => {
  function buildZip(entries: Array<{ name: string; data: Buffer | string }>): Buffer {
    const zip = new AdmZip()
    for (const e of entries) zip.addFile(e.name, Buffer.from(e.data))
    return zip.toBuffer()
  }

  async function writeZipPack(rig: StylePacksRig, buffer: Buffer, name = 'p.elstyle'): Promise<string> {
    const path = join(rig.root, name)
    await writeFile(path, buffer)
    return path
  }

  it('资源导入落位：style.json + png/woff/css 各就各位', async () => {
    const rig = await makeRig()
    rig.styles.register('mod-a', 'theme', {})
    rig.config.register('mod-a', { defaults: {}, version: 1 })
    const buffer = buildZip([
      { name: 'style.json', data: JSON.stringify(makeEnvelope({ payload: { cssVars: { '--a': 'b' } } })) },
      { name: 'img/logo.png', data: Buffer.alloc(10) },
      { name: 'fonts/main.woff', data: Buffer.alloc(10) },
      { name: 'css/theme.css', data: '* { color: red }' }
    ])
    const result = await rig.styles.importPack(await writeZipPack(rig, buffer))
    expect(result.ok).toBe(true)
    const base = join(rig.root, 'styles', 'mod-a', 'theme')
    expect(existsSync(join(base, 'img', 'logo.png'))).toBe(true)
    expect(existsSync(join(base, 'fonts', 'main.woff'))).toBe(true)
    expect(existsSync(join(base, 'css', 'theme.css'))).toBe(true)
    expect(rig.styles.getApplied('mod-a', 'theme')?.cssVars).toEqual({ '--a': 'b' })
  })

  it('zip-slip：恶意条目拒绝且不落盘（原始字节构造）', async () => {
    const rig = await makeRig()
    rig.styles.register('mod-a', 'theme', {})
    const buffer = buildRawZip([
      { name: 'style.json', data: Buffer.from(JSON.stringify(makeEnvelope())) },
      { name: '../evil.css', data: Buffer.from('pwned') }
    ])
    const result = await rig.styles.importPack(await writeZipPack(rig, buffer))
    expect(result.ok).toBe(false)
    expect(result.errors.join('; ')).toContain('traversal')
    expect(existsSync(join(rig.root, 'evil.css'))).toBe(false)
  })

  it('白名单/大小/CSS 红线：.exe 拒、超限拒、@import 与 url(http:) 拒', async () => {
    const rig = await makeRig({ maxResourceBytes: 10, maxTotalResourceBytes: 100 })
    rig.styles.register('mod-a', 'theme', {})

    const exe = await rig.styles.importPack(
      await writeZipPack(
        rig,
        buildZip([
          { name: 'style.json', data: JSON.stringify(makeEnvelope()) },
          { name: 'evil.exe', data: Buffer.alloc(4) }
        ])
      )
    )
    expect(exe.ok).toBe(false)
    expect(exe.errors.join('; ')).toContain('not allowed')

    const oversize = await rig.styles.importPack(
      await writeZipPack(
        rig,
        buildZip([
          { name: 'style.json', data: JSON.stringify(makeEnvelope()) },
          { name: 'img/big.png', data: Buffer.alloc(20) }
        ]),
        'big.elstyle'
      )
    )
    expect(oversize.ok).toBe(false)
    expect(oversize.errors.join('; ')).toContain('too large')

    // CSS 红线子例用默认上限的 rig（避免小上限提前触发大小检查）
    const cssRig = await makeRig()
    cssRig.styles.register('mod-a', 'theme', {})
    const imported = await cssRig.styles.importPack(
      await writeZipPack(
        cssRig,
        buildZip([
          { name: 'style.json', data: JSON.stringify(makeEnvelope()) },
          { name: 'css/a.css', data: '@import url("other.css")' }
        ]),
        'import.elstyle'
      )
    )
    expect(imported.ok).toBe(false)
    expect(imported.errors.join('; ')).toContain('@import')

    const remote = await cssRig.styles.importPack(
      await writeZipPack(
        cssRig,
        buildZip([
          { name: 'style.json', data: JSON.stringify(makeEnvelope()) },
          { name: 'css/b.css', data: 'body { background: url(http://evil/x.png) }' }
        ]),
        'remote.elstyle'
      )
    )
    expect(remote.ok).toBe(false)
    expect(remote.errors.join('; ')).toContain('url(')
  })

  it('资源导出 ZIP 往返（PK 魔数 + 条目齐）', async () => {
    const rig = await makeRig()
    rig.styles.register('mod-a', 'theme', {})
    rig.config.register('mod-a', { defaults: {}, version: 1 })
    const imported = await rig.styles.importPack(
      await writeZipPack(
        rig,
        buildZip([
          { name: 'style.json', data: JSON.stringify(makeEnvelope()) },
          { name: 'img/logo.png', data: Buffer.alloc(5) }
        ])
      )
    )
    expect(imported.ok).toBe(true)

    const out = join(rig.root, 're-exported.elstyle')
    const exported = await rig.styles.exportPack('mod-a', 'theme', out)
    expect(exported.ok).toBe(true)
    const buf = await readFile(out)
    expect(buf[0]).toBe(0x50) // 'P'
    expect(buf[1]).toBe(0x4b) // 'K'
    const zip = new AdmZip(buf)
    expect(zip.getEntries().map((e) => e.entryName).sort()).toEqual([
      'img/logo.png',
      'style.json'
    ])
  })
})

describe('模板', () => {
  it('仓库模板包 default.elstyle 可导入（example-empty:theme）', async () => {
    const rig = await makeRig()
    rig.config.register('example-empty', { defaults: {}, version: 1 })
    // 与 modules/example-empty/index.js 相同的参考处理器语义
    rig.styles.register('example-empty', 'theme', {
      validate: (payload) =>
        Object.keys(payload.cssVars ?? {})
          .filter((name) => !name.startsWith('--'))
          .map((name) => `css var must start with "--": ${name}`)
    })
    const templatePath = join(process.cwd(), 'templates', 'style-pack', 'default.elstyle')
    const result = await rig.styles.importPack(templatePath)
    expect(result.ok).toBe(true)
    expect(rig.styles.getApplied('example-empty', 'theme')?.cssVars).toMatchObject({
      '--example-accent': '#66d9ff'
    })
  })
})
