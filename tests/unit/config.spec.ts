import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import type { ConfigDefinition } from '@contracts/config'
import { createConfig } from '../../src/main/core/config'

/* ---------- 测试辅助 ---------- */

function testLogger() {
  const warnings: string[] = []
  const make = (source: string): ILogger => ({
    debug: () => {},
    info: () => {},
    warn: (m) => { warnings.push(`${source}: ${m}`) },
    error: () => {},
    child: (s) => make(s),
    setLevel: () => {}
  })
  return { logger: make('root'), warnings }
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'el-cfg-'))
}

const SECTION_FORMAT = 'eclipselive-config-section'

const defA: ConfigDefinition<{ host: string; port: number; nested: { x: number; y: number } }> = {
  defaults: { host: '127.0.0.1', port: 23334, nested: { x: 1, y: 2 } },
  version: 1,
  validate: (v) => {
    const o = v as { port?: unknown }
    if (typeof o.port !== 'number') return { ok: false, errors: ['port must be a number'] }
    return { ok: true, errors: [] }
  }
}
const defB: ConfigDefinition<{ theme: string }> = { defaults: { theme: 'dark' }, version: 1 }

/* ---------- 注册与读取 ---------- */

describe('注册与读取', () => {
  it('未持久化时 get 返回默认值（合并副本）', async () => {
    const cfg = createConfig({ dir: await tempDir(), logger: testLogger().logger })
    cfg.register('a', defA)
    await cfg.flush()
    expect(cfg.get<typeof defA.defaults>('a')).toEqual(defA.defaults)
  })

  it('sections()：列出注册分区元数据（按 id 排序）；空配置为空', async () => {
    const empty = createConfig({ dir: await tempDir(), logger: testLogger().logger })
    expect(empty.sections()).toEqual([])

    const cfg = createConfig({ dir: await tempDir(), logger: testLogger().logger })
    cfg.register('core.gateway', { defaults: {}, version: 3 })
    cfg.register('a-mod', { defaults: {}, version: 1 })
    await cfg.flush()
    expect(cfg.sections()).toEqual([
      { id: 'a-mod', version: 1 },
      { id: 'core.gateway', version: 3 }
    ])
  })

  it('未注册 id 返回 undefined；重复注册被忽略并告警', async () => {
    const { logger, warnings } = testLogger()
    const cfg = createConfig({ dir: await tempDir(), logger })
    expect(cfg.get('ghost')).toBeUndefined()
    cfg.register('a', defA)
    cfg.register('a', defB)
    await cfg.flush()
    expect(warnings.join('\n')).toContain('duplicate')
    expect(cfg.get('a')).toEqual(defA.defaults)
  })

  it('深合并：持久化覆盖默认值，缺失键回落默认；重启后读回', async () => {
    const dir = await tempDir()
    const cfg = createConfig({ dir, logger: testLogger().logger })
    cfg.register('a', defA)
    await cfg.flush()
    const r = cfg.set('a', { host: '0.0.0.0', port: 80, nested: { x: 9 } })
    expect(r.ok).toBe(true)
    await cfg.flush()
    const v = cfg.get<typeof defA.defaults>('a')
    expect(v).toEqual({ host: '0.0.0.0', port: 80, nested: { x: 9, y: 2 } })

    const cfg2 = createConfig({ dir, logger: testLogger().logger })
    cfg2.register('a', defA)
    await cfg2.flush()
    expect(cfg2.get('a')).toEqual(v)
  })

  it('set 未注册 id 返回错误且不产生任何副作用', async () => {
    const dir = await tempDir()
    const cfg = createConfig({ dir, logger: testLogger().logger })
    const r = cfg.set('ghost', { a: 1 })
    expect(r.ok).toBe(false)
    await cfg.flush()
    expect(await readdir(dir)).toEqual([])
  })
})

/* ---------- 写入、校验与热更新 ---------- */

describe('写入与校验', () => {
  it('校验失败三不：不落盘、不通知、缓存不变', async () => {
    const dir = await tempDir()
    const cfg = createConfig({ dir, logger: testLogger().logger })
    cfg.register('a', defA)
    await cfg.flush()
    const events: unknown[] = []
    cfg.onChange('a', (v) => events.push(v))
    const bad = cfg.set('a', { host: 'h', port: 'not-a-number', nested: { x: 1, y: 2 } })
    expect(bad.ok).toBe(false)
    expect(bad.errors).toContain('port must be a number')
    await cfg.flush()
    expect(events).toHaveLength(0)
    expect(cfg.get('a')).toEqual(defA.defaults)
    expect(await readdir(dir)).toEqual([]) // 未注册前无文件，校验失败也不产生
  })

  it('set 成功：文件记录 version/updatedAt，原子写无 .tmp 残留', async () => {
    const dir = await tempDir()
    const cfg = createConfig({ dir, logger: testLogger().logger })
    cfg.register('a', defA)
    await cfg.flush()
    cfg.set('a', { host: 'h', port: 8080, nested: { x: 1, y: 2 } })
    await cfg.flush()
    const files = await readdir(dir)
    expect(files).toEqual(['a.json'])
    const stored = JSON.parse(await readFile(join(dir, 'a.json'), 'utf8'))
    expect(stored.format).toBe(SECTION_FORMAT)
    expect(stored.version).toBe(1)
    expect(typeof stored.updatedAt).toBe('number')
    expect(stored.updatedAt).toBeGreaterThan(0)
    expect(stored.data.port).toBe(8080)
  })

  it('onChange 收到合并值；退订后不再收到', async () => {
    const dir = await tempDir()
    const cfg = createConfig({ dir, logger: testLogger().logger })
    cfg.register('a', defA)
    await cfg.flush()
    const events: Array<Record<string, unknown>> = []
    const off = cfg.onChange('a', (v) => events.push(v as Record<string, unknown>))
    cfg.set('a', { host: 'h1', port: 1, nested: { x: 1, y: 2 } })
    cfg.set('a', { host: 'h2', port: 2, nested: { x: 1, y: 2 } })
    expect(events).toHaveLength(2)
    expect(events[0].host).toBe('h1')
    expect(events[1].host).toBe('h2')
    off()
    cfg.set('a', { host: 'h3', port: 3, nested: { x: 1, y: 2 } })
    expect(events).toHaveLength(2)
  })
})

/* ---------- 损坏与迁移 ---------- */

describe('损坏与迁移', () => {
  it('损坏文件回落默认值，不覆盖原文件并告警', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.json'), 'NOT JSON {{{', 'utf8')
    const { logger, warnings } = testLogger()
    const cfg = createConfig({ dir, logger })
    cfg.register('a', defA)
    await cfg.flush()
    expect(cfg.get('a')).toEqual(defA.defaults)
    expect(warnings.join('\n')).toContain('corrupt')
    expect(await readFile(join(dir, 'a.json'), 'utf8')).toBe('NOT JSON {{{')
  })

  it('旧版本触发迁移：迁移数据生效、文件升版本、原文件备份 .bak', async () => {
    const dir = await tempDir()
    await writeFile(
      join(dir, 'a.json'),
      JSON.stringify({ format: SECTION_FORMAT, version: 1, updatedAt: 1, data: { oldPort: 1234 } }),
      'utf8'
    )
    const defV2: ConfigDefinition<typeof defA.defaults> = {
      ...defA,
      version: 2,
      migrate: (data) => ({ host: '127.0.0.1', port: (data as { oldPort: number }).oldPort, nested: { x: 1, y: 2 } })
    }
    const cfg = createConfig({ dir, logger: testLogger().logger })
    cfg.register('a', defV2)
    await cfg.flush()
    const v = cfg.get<typeof defA.defaults>('a')
    expect(v?.port).toBe(1234)
    expect(v?.nested).toEqual({ x: 1, y: 2 })
    const stored = JSON.parse(await readFile(join(dir, 'a.json'), 'utf8'))
    expect(stored.version).toBe(2)
    const bak = JSON.parse(await readFile(join(dir, 'a.json.bak'), 'utf8'))
    expect(bak.version).toBe(1)
    expect(bak.data.oldPort).toBe(1234)
  })

  it('无迁移器的旧版本：保留原始数据并告警（不丢用户配置）', async () => {
    const dir = await tempDir()
    await writeFile(
      join(dir, 'b.json'),
      JSON.stringify({ format: SECTION_FORMAT, version: 1, updatedAt: 1, data: { theme: 'user-theme' } }),
      'utf8'
    )
    const { logger, warnings } = testLogger()
    const defBv2: ConfigDefinition<{ theme: string; accent?: string }> = { defaults: { theme: 'dark', accent: 'cyan' }, version: 2 }
    const cfg = createConfig({ dir, logger })
    cfg.register('b', defBv2)
    await cfg.flush()
    expect(warnings.join('\n')).toContain('no migrator')
    expect(cfg.get('b')).toEqual({ theme: 'user-theme', accent: 'cyan' })
  })
})

/* ---------- 导入导出 ---------- */

describe('导出导入', () => {
  it('exportAll / importAll 全量往返；未注册 id 进入 skipped', async () => {
    const dir1 = await tempDir()
    const cfg1 = createConfig({ dir: dir1, logger: testLogger().logger })
    cfg1.register('a', defA)
    cfg1.register('b', defB)
    await cfg1.flush()
    cfg1.set('a', { host: 'h', port: 80, nested: { x: 3, y: 4 } })
    cfg1.set('b', { theme: 'light' })
    const envelope = cfg1.exportAll()
    expect(JSON.parse(envelope).format).toBe('eclipselive-config')

    const dir2 = await tempDir()
    const cfg2 = createConfig({ dir: dir2, logger: testLogger().logger })
    cfg2.register('a', defA)
    await cfg2.flush()
    const r = cfg2.importAll(envelope)
    expect(r.ok).toBe(true)
    expect(r.applied).toEqual(['a'])
    expect(r.skipped).toEqual(['b'])
    await cfg2.flush()
    expect(cfg2.get('a')).toEqual({ host: 'h', port: 80, nested: { x: 3, y: 4 } })
    expect(cfg2.get('a')).not.toEqual(cfg1.get('b'))
  })

  it('importAll 原子性：任一注册分区校验失败整体拒绝，无部分应用', async () => {
    const dir = await tempDir()
    const cfg = createConfig({ dir, logger: testLogger().logger })
    cfg.register('a', defA)
    cfg.register('b', defB)
    await cfg.flush()
    const badEnvelope = JSON.stringify({
      format: 'eclipselive-config',
      exportedAt: 1,
      sections: {
        a: { version: 1, data: { host: 'h', port: 'BAD', nested: { x: 1, y: 2 } } },
        b: { version: 1, data: { theme: 'light' } }
      }
    })
    const r = cfg.importAll(badEnvelope)
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
    await cfg.flush()
    expect(cfg.get('b')).toEqual(defB.defaults) // 未被部分应用
    expect(await readdir(dir)).toEqual([]) // 无任何落盘
  })

  it('importSection 仅接受指定 id；信封缺该 id 报错', async () => {
    const dir = await tempDir()
    const cfg = createConfig({ dir, logger: testLogger().logger })
    cfg.register('a', defA)
    await cfg.flush()
    const jsonOfB = JSON.stringify({ format: 'eclipselive-config', exportedAt: 1, sections: { b: { version: 1, data: { theme: 'x' } } } })
    const miss = cfg.importSection('a', jsonOfB)
    expect(miss.ok).toBe(false)
    const jsonOfA = JSON.stringify({ format: 'eclipselive-config', exportedAt: 1, sections: { a: { version: 1, data: { host: 'h', port: 99, nested: { x: 0, y: 0 } } } } })
    const r = cfg.importSection('a', jsonOfA)
    expect(r.ok).toBe(true)
    expect(cfg.get('a')).toMatchObject({ port: 99 })
  })

  it('导入比当前定义更新的版本被拒绝（不支持降级迁移）', async () => {
    const dir = await tempDir()
    const cfg = createConfig({ dir, logger: testLogger().logger })
    cfg.register('a', defA) // version 1
    await cfg.flush()
    const fromFuture = JSON.stringify({ format: 'eclipselive-config', exportedAt: 1, sections: { a: { version: 9, data: { anything: true } } } })
    const r = cfg.importAll(fromFuture)
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toContain('newer')
  })
})

/* ---------- 预设 ---------- */

describe('预设', () => {
  it('保存 / 列出 / 应用 / 删除', async () => {
    const dir = await tempDir()
    const cfg = createConfig({ dir, logger: testLogger().logger })
    cfg.register('a', defA)
    await cfg.flush()
    cfg.set('a', { host: 'saved', port: 7000, nested: { x: 1, y: 2 } })
    expect(cfg.savePreset('a', '开播配置')).toBe(true)
    cfg.set('a', { host: 'other', port: 8000, nested: { x: 1, y: 2 } })
    expect(cfg.listPresets('a')).toEqual(['开播配置'])
    const r = cfg.applyPreset('a', '开播配置')
    expect(r.ok).toBe(true)
    expect(cfg.get('a')).toMatchObject({ host: 'saved', port: 7000 })
    expect(cfg.deletePreset('a', '开播配置')).toBe(true)
    expect(cfg.listPresets('a')).toEqual([])
    expect(cfg.applyPreset('a', '开播配置').ok).toBe(false)
  })

  it('非法预设名被拒绝；applyPreset 强制走校验', async () => {
    const dir = await tempDir()
    const { logger } = testLogger()
    const cfg = createConfig({ dir, logger })
    cfg.register('a', defA)
    await cfg.flush()
    expect(cfg.savePreset('a', '')).toBe(false)
    expect(cfg.savePreset('a', '   ')).toBe(false)
    expect(cfg.savePreset('a', 'x'.repeat(65))).toBe(false)
    // 手工植入非法数据预设：应用必须被校验拦下
    await writeFile(
      join(dir, 'presets.json'),
      JSON.stringify({ a: { bad: { version: 1, savedAt: 1, data: { host: 'h', port: 'NOT-NUMBER', nested: { x: 1, y: 2 } } } } }),
      'utf8'
    )
    const cfg2 = createConfig({ dir, logger: testLogger().logger })
    cfg2.register('a', defA)
    await cfg2.flush()
    const r = cfg2.applyPreset('a', 'bad')
    expect(r.ok).toBe(false)
    expect(cfg2.get('a')).toEqual(defA.defaults)
  })
})
