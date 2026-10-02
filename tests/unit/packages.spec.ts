import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import type { ILogger } from '@contracts/logger'
import type { ModuleManifest } from '@contracts/module'
import { createConfig } from '../../src/main/core/config'
import { createEventBus } from '../../src/main/core/bus'
import { createPermissions } from '../../src/main/core/permissions'
import { createGateway } from '../../src/main/core/gateway'
import { createModules } from '../../src/main/core/modules'
import { createPackages, seedPresetModules, type PackagesRig } from '../../src/main/core/packages'

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
  const packages = createPackages({ logger, modules, modulesDir, appVersion: '0.1.0' })
  await config.ready()
  return { packages, modules, logger, config, bus, permissions, gateway, modulesDir, root }
}

interface ModuleSpec {
  manifest?: Partial<ModuleManifest>
  entry?: string
  files?: Record<string, string>
}

/** 写一个源模块目录（不在 modulesDir 内）：manifest.json + index.js + 附加文件。 */
async function writeModule(base: string, id: string, spec: ModuleSpec = {}): Promise<string> {
  const dir = join(base, id)
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
  // P3：模块包声明真实协议时必须携带许可证文件 ⇒ 夹具也要有（否则打包被闸门拒绝）
  await writeFile(join(dir, 'LICENSE'), 'MIT\n', 'utf8')
  for (const [name, content] of Object.entries(spec.files ?? {})) {
    await mkdir(dirname(join(dir, name)), { recursive: true })
    await writeFile(join(dir, name), content, 'utf8')
  }
  return dir
}

/** 轮询等待条件成立（watcher 时序）。 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (predicate()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 100))
  }
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

/**
 * 手工构造最小 ZIP（store 不压缩）。adm-zip 的 addFile 会净化恶意条目名
 * （'../evil.js' → 'evil.js'），无法用来构造攻击样本——真实 zip-slip 攻击
 * 来自其它压缩工具，因此这里直接写原始字节，条目名原样保留。
 */
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
    local.writeUInt16LE(0, 8) // method: stored
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

/* ---------- pack / inspect ---------- */

describe('打包与检视', () => {
  it('pack → inspect 往返：信息字段齐全，format/signed/coreVersion/sha256 如实', async () => {
    const rig = await makeRig()
    const src = await writeModule(rig.root, 'round-trip', {
      manifest: {
        permissions: ['file-read'],
        events: ['rt:ping'],
        routes: [{ method: 'GET', path: '/rt/x' }],
        channels: ['rt-ch']
      },
      entry: 'module.exports = {}',
      files: { 'README.md': '# rt\n' }
    })
    const out = join(rig.root, 'round-trip.elm')
    const packed = await rig.packages.pack({ dir: src, out, coreVersion: '>=0.0.1', license: 'MIT' })
    expect(packed.ok).toBe(true)
    expect(packed.moduleId).toBe('round-trip')

    const inspected = await rig.packages.inspect(out)
    expect(inspected.ok).toBe(true)
    expect(inspected.info).toMatchObject({
      moduleId: 'round-trip',
      name: 'round-trip',
      version: '0.1.0',
      format: 1,
      coreVersion: '>=0.0.1',
      entry: 'index.js',
      license: 'MIT',
      signed: false
    })
    expect(inspected.info?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(inspected.info?.fileCount).toBe(3) // P3：夹具现在含 LICENSE（index.js + LICENSE + 附加文件，manifest.json 不入包）
  })
})

/* ---------- install ---------- */

describe('安装', () => {
  it('端到端：manifest.json 映射剥离包级字段；T6 管理器 discover→load→start 全通', async () => {
    const rig = await makeRig()
    const entryCode =
      'module.exports = { init(ctx){ ctx.gateway.registerHttpRoute("GET", "/ins/x", () => ({ status: 200 })) } }'
    const src = await writeModule(rig.root, 'ins-mod', {
      manifest: {
        permissions: ['file-read'],
        routes: [{ method: 'GET', path: '/ins/x' }],
        config: { defaults: { a: 1 }, version: 1 }
      },
      entry: entryCode,
      files: { 'README.md': '# ins\n' }
    })
    const out = join(rig.root, 'ins-mod.elm')
    await rig.packages.pack({ dir: src, out })

    const installed = await rig.packages.install(out)
    expect(installed.ok).toBe(true)
    expect(installed.moduleId).toBe('ins-mod')

    const dir = join(rig.modulesDir, 'ins-mod')
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(manifest).toMatchObject({ id: 'ins-mod', version: '0.1.0', permissions: ['file-read'] })
    expect(manifest).not.toHaveProperty('sha256')
    expect(manifest).not.toHaveProperty('format')
    expect(manifest).not.toHaveProperty('coreVersion')
    expect(manifest).not.toHaveProperty('license')
    expect(await readFile(join(dir, 'index.js'), 'utf8')).toBe(entryCode)
    expect(existsSync(join(dir, 'README.md'))).toBe(true)

    await rig.modules.discover()
    expect((await rig.modules.load('ins-mod')).ok).toBe(true)
    expect((await rig.modules.start('ins-mod')).ok).toBe(true)
    expect(rig.permissions.status('ins-mod').declared).toEqual(['file-read'])
    expect(rig.gateway.diagnostics().routes).toContain('GET /ins/x')
    expect(rig.config.get<{ a: number }>('ins-mod')).toEqual({ a: 1 })
  })

  it('pack→install 保留 web 声明（页面模块二级菜单数据源）', async () => {
    const rig = await makeRig()
    const web = { url: '/ins-web/page', windowMode: 'embedded', pinned: true } as const
    const src = await writeModule(rig.root, 'web-mod', {
      manifest: { web },
      entry: 'module.exports = {}'
    })
    const out = join(rig.root, 'web-mod.elm')
    await rig.packages.pack({ dir: src, out })
    expect((await rig.packages.install(out)).ok).toBe(true)

    const manifest = JSON.parse(await readFile(join(rig.modulesDir, 'web-mod/manifest.json'), 'utf8')) as {
      web?: unknown
    }
    // T29 归一化：模块页校验器为 web 补 allowedDomains: []（导航闭集由核心注入网关 origin）
    expect(manifest.web).toEqual({ ...web, allowedDomains: [] })
  })

  it('版本守卫：同版本重装 ok；降级拒绝；force 旁路', async () => {
    const rig = await makeRig()
    const srcHigh = await writeModule(join(rig.root, 'a'), 'ver-mod', {
      manifest: { version: '1.2.0' }
    })
    const srcLow = await writeModule(join(rig.root, 'b'), 'ver-mod', {
      manifest: { version: '1.0.0' }
    })
    const highElm = join(rig.root, 'high.elm')
    const lowElm = join(rig.root, 'low.elm')
    await rig.packages.pack({ dir: srcHigh, out: highElm })
    await rig.packages.pack({ dir: srcLow, out: lowElm })

    expect((await rig.packages.install(highElm)).ok).toBe(true)
    // 重装同版本 → ok
    expect((await rig.packages.install(highElm)).ok).toBe(true)
    // 降级 → 拒绝
    const refused = await rig.packages.install(lowElm)
    expect(refused.ok).toBe(false)
    expect(refused.errors[0]).toContain('downgrade')
    // force → 旁路
    const forced = await rig.packages.install(lowElm, { force: true })
    expect(forced.ok).toBe(true)
    const m = JSON.parse(
      await readFile(join(rig.modulesDir, 'ver-mod', 'manifest.json'), 'utf8')
    ) as { version: string }
    expect(m.version).toBe('1.0.0')
  })

  it('coreVersion 守卫：>=9.0.0 拒绝；* 放行；非法语法 pack 拒绝', async () => {
    const rig = await makeRig()
    const src = await writeModule(rig.root, 'core-mod', {})
    const hi = join(rig.root, 'hi.elm')
    await rig.packages.pack({ dir: src, out: hi, coreVersion: '>=9.0.0' })
    const refused = await rig.packages.install(hi)
    expect(refused.ok).toBe(false)
    expect(refused.errors.join('; ')).toContain('core version')

    const any = join(rig.root, 'any.elm')
    await rig.packages.pack({ dir: src, out: any, coreVersion: '*' })
    expect((await rig.packages.install(any)).ok).toBe(true)

    const bad = await rig.packages.pack({
      dir: src,
      out: join(rig.root, 'bad.elm'),
      coreVersion: '~1.0'
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors[0]).toContain('coreVersion')
  })

  it('sha256 篡改：zip 内替换入口字节 → 拒绝', async () => {
    const rig = await makeRig()
    const src = await writeModule(rig.root, 'hash-mod', {})
    const out = join(rig.root, 'hash.elm')
    await rig.packages.pack({ dir: src, out })

    const zip = new AdmZip(out)
    zip.updateFile('index.js', Buffer.from('module.exports = { tampered: true }'))
    const tampered = join(rig.root, 'tampered.elm')
    zip.writeZip(tampered)

    const result = await rig.packages.install(tampered)
    expect(result.ok).toBe(false)
    expect(result.errors.join('; ')).toContain('sha256')
    expect(existsSync(join(rig.modulesDir, 'hash-mod'))).toBe(false)
  })

  it('zip-slip：../ 与绝对路径条目拒绝且不落盘', async () => {
    const rig = await makeRig()
    const entryContent = 'module.exports = {}'
    const moduleJson = {
      id: 'evil-mod',
      name: 'evil-mod',
      version: '0.1.0',
      permissions: [],
      dependencies: [],
      entry: 'index.js',
      events: [],
      routes: [],
      channels: [],
      format: 1,
      coreVersion: '*',
      license: 'MIT',
      sha256: createHash('sha256').update(entryContent).digest('hex')
    }
    const evilBuffer = buildRawZip([
      { name: 'module.json', data: Buffer.from(JSON.stringify(moduleJson)) },
      { name: 'index.js', data: Buffer.from(entryContent) },
      { name: '../evil.js', data: Buffer.from('pwned') },
      { name: '/abs/evil2.js', data: Buffer.from('pwned') }
    ])
    const evil = join(rig.root, 'evil.elm')
    await writeFile(evil, evilBuffer)

    const result = await rig.packages.install(evil)
    expect(result.ok).toBe(false)
    const errors = result.errors.join('; ')
    expect(errors).toContain('traversal')
    expect(errors).toContain('absolute')
    expect(existsSync(join(rig.root, 'evil.js'))).toBe(false)
    expect(existsSync(join(rig.modulesDir, 'evil-mod'))).toBe(false)
    const leftovers = (await readdir(rig.modulesDir)).filter((n) => n.startsWith('.staging-'))
    expect(leftovers).toEqual([])
  })

  it('format 99 拒绝；缺 module.json 拒绝', async () => {
    const rig = await makeRig()
    const src = await writeModule(rig.root, 'fmt-mod', {})
    const out = join(rig.root, 'fmt.elm')
    await rig.packages.pack({ dir: src, out })

    const zip = new AdmZip(out)
    const desc = JSON.parse(zip.readAsText('module.json')) as { format: number }
    desc.format = 99
    zip.updateFile('module.json', Buffer.from(JSON.stringify(desc)))
    const badFormat = join(rig.root, 'fmt-99.elm')
    zip.writeZip(badFormat)
    const refused = await rig.packages.install(badFormat)
    expect(refused.ok).toBe(false)
    expect(refused.errors.join('; ')).toContain('format')

    const noJson = new AdmZip()
    noJson.addFile('index.js', Buffer.from('module.exports = {}'))
    const noJsonPath = join(rig.root, 'no-json.elm')
    noJson.writeZip(noJsonPath)
    const missing = await rig.packages.install(noJsonPath)
    expect(missing.ok).toBe(false)
    expect(missing.errors.join('; ')).toContain('module.json')
  })
})

/* ---------- uninstall ---------- */

describe('卸载', () => {
  it('uninstall：目录删除、记录清除、配置保留', async () => {
    const rig = await makeRig()
    const src = await writeModule(rig.root, 'un-mod', {
      manifest: { config: { defaults: { a: 1 }, version: 1 } }
    })
    const out = join(rig.root, 'un.elm')
    await rig.packages.pack({ dir: src, out })
    await rig.packages.install(out)
    await rig.modules.discover()
    await rig.modules.load('un-mod')
    expect(rig.config.set('un-mod', { a: 2 }).ok).toBe(true)

    await rig.packages.uninstall('un-mod')
    expect(existsSync(join(rig.modulesDir, 'un-mod'))).toBe(false)
    expect(rig.modules.get('un-mod')).toBeUndefined()
    // 卸载可保留配置
    expect(rig.config.get<{ a: number }>('un-mod')).toEqual({ a: 2 })
  })
})

/* ---------- 预置模块播种（T13 打包版） ---------- */

describe('预置模块播种', () => {
  async function makeSource(root: string): Promise<string> {
    const src = join(root, 'resources', 'modules')
    const mod = join(src, 'example-mod')
    await mkdir(join(mod, 'sub'), { recursive: true })
    await writeFile(
      join(mod, 'manifest.json'),
      JSON.stringify({ id: 'example-mod', name: 'E', version: '0.1.0', permissions: [], dependencies: [], entry: 'index.js' }),
      'utf8'
    )
    await writeFile(join(mod, 'index.js'), 'module.exports = {}', 'utf8')
    await writeFile(join(mod, 'sub', 'res.txt'), 'data', 'utf8')
    return src
  }

  it('目标空 → 复制全部（含嵌套文件）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'el-seed-'))
    const src = await makeSource(root)
    const target = join(root, 'userData', 'modules')
    await mkdir(target, { recursive: true })

    await seedPresetModules(src, target)
    expect((await readdir(target)).sort()).toEqual(['example-mod'])
    expect((await readFile(join(target, 'example-mod', 'sub', 'res.txt'), 'utf8'))).toBe('data')
  })

  it('目标非空 → 跳过不动', async () => {
    const root = await mkdtemp(join(tmpdir(), 'el-seed-'))
    const src = await makeSource(root)
    const target = join(root, 'userData', 'modules')
    await mkdir(join(target, 'user-mod'), { recursive: true })
    await writeFile(join(target, 'user-mod', 'keep.txt'), 'x', 'utf8')

    await seedPresetModules(src, target)
    expect((await readdir(target)).sort()).toEqual(['user-mod']) // 未播种
  })

  it('源缺失 → 静默 no-op', async () => {
    const root = await mkdtemp(join(tmpdir(), 'el-seed-'))
    const target = join(root, 'userData', 'modules')
    await mkdir(target, { recursive: true })

    await seedPresetModules(join(root, 'nope'), target)
    expect(await readdir(target)).toEqual([])
  })
})

/* ---------- watcher ---------- */

describe('目录监听', () => {
  it('.elm 落入 modules 目录 → 自动安装并启动；删模块目录 → 自动卸载并清除记录', async () => {
    const rig = await makeRig()
    const src = await writeModule(rig.root, 'watch-mod', {
      manifest: { events: ['watch:ping'] }
    })
    try {
      await rig.packages.watch()
      await rig.packages.pack({ dir: src, out: join(rig.modulesDir, 'watch-mod.elm') })
      await waitFor(() => rig.modules.get('watch-mod')?.status === 'started')

      await rm(join(rig.modulesDir, 'watch-mod'), { recursive: true, force: true })
      await waitFor(() => rig.modules.get('watch-mod') === undefined)
    } finally {
      rig.packages.unwatch()
    }
  })
})
