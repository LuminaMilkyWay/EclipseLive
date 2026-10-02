import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLogger, maskData } from '../../src/main/core/logger'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'el-log-'))
}

/** Read the single (or named) log file content after flush. */
async function readLog(dir: string, name?: string): Promise<string> {
  if (name) return readFile(join(dir, name), 'utf8')
  const files = (await readdir(dir)).sort()
  return readFile(join(dir, files[0]), 'utf8')
}

describe('maskData — 脱敏管道', () => {
  it('敏感键脱敏，普通字段保留（含嵌套与数组）', () => {
    const out = maskData({
      user: 'luna',
      password: 'hunter2',
      nested: { token: 'abc', count: 1 },
      list: [{ apiKey: 'k' }, { ok: true }]
    }) as Record<string, unknown>
    expect(out.user).toBe('luna')
    expect(out.password).toBe('[MASKED]')
    const nested = out.nested as Record<string, unknown>
    expect(nested.token).toBe('[MASKED]')
    expect(nested.count).toBe(1)
    const list = out.list as Array<Record<string, unknown>>
    expect(list[0].apiKey).toBe('[MASKED]')
    expect(list[1].ok).toBe(true)
  })

  it('用户输入键 text/content/body 脱敏（需求红线：用户文本不落盘）', () => {
    const out = maskData({ text: '主播打了这句话', content: 'x', body: 'y', keep: 1 }) as Record<string, unknown>
    expect(out.text).toBe('[MASKED]')
    expect(out.content).toBe('[MASKED]')
    expect(out.body).toBe('[MASKED]')
    expect(out.keep).toBe(1)
  })

  it('复合键与分隔符键（userToken / api_key / refreshToken）', () => {
    const out = maskData({ userToken: 1, api_key: 2, refreshToken: 3, ordinary: 4 }) as Record<string, unknown>
    expect(out.userToken).toBe('[MASKED]')
    expect(out.api_key).toBe('[MASKED]')
    expect(out.refreshToken).toBe('[MASKED]')
    expect(out.ordinary).toBe(4)
  })

  it('深度超限返回 [DEPTH]，防日志炸弹', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } }
    const out = maskData(deep) as unknown as Record<string, never>
    expect(JSON.stringify(out)).toContain('[DEPTH]')
  })

  it('超长字符串截断（≤200 + 省略标记）', () => {
    const out = maskData({ s: 'a'.repeat(500) }) as Record<string, unknown>
    const s = out.s as string
    expect(s.length).toBeLessThanOrEqual(202)
    expect(s).toContain('…')
  })
})

describe('createLogger — 分级 / 格式 / 来源', () => {
  it('默认级别 info：debug 被过滤', async () => {
    const dir = await tempDir()
    const log = createLogger({ dir, echoConsole: false })
    log.debug('suppressed')
    log.info('emitted')
    await log.flush()
    const content = await readLog(dir)
    expect(content).toContain('emitted')
    expect(content).not.toContain('suppressed')
  })

  it('setLevel 运行时生效，且影响整棵 child 树', async () => {
    const dir = await tempDir()
    const log = createLogger({ dir, echoConsole: false })
    const child = log.child('gateway')
    child.debug('before')
    log.setLevel('debug')
    child.debug('after')
    await log.flush()
    const content = await readLog(dir)
    expect(content).not.toContain('before')
    expect(content).toContain('after')
  })

  it('四级行格式统一：<ISO> [level] [source] message', async () => {
    const t = new Date('2026-09-22T12:00:00.000Z')
    const dir = await tempDir()
    const log = createLogger({ dir, level: 'debug', echoConsole: false, clock: () => t })
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    await log.flush()
    const lines = (await readLog(dir)).trim().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('2026-09-22T12:00:00.000Z [debug] [core] d')
    expect(lines[1]).toBe('2026-09-22T12:00:00.000Z [info] [core] i')
    expect(lines[2]).toBe('2026-09-22T12:00:00.000Z [warn] [core] w')
    expect(lines[3]).toBe('2026-09-22T12:00:00.000Z [error] [core] e')
  })

  it('child 嵌套来源与 data JSON 附加（脱敏后单行）', async () => {
    const t = new Date('2026-09-22T12:00:00.000Z')
    const dir = await tempDir()
    const log = createLogger({ dir, echoConsole: false, clock: () => t })
    log.child('gateway').child('ws').info('hi', { port: 23334, token: 'secret!', multi: 'a\nb' })
    await log.flush()
    const content = await readLog(dir)
    expect(content).toContain('[gateway:ws] hi')
    expect(content).toContain('"port":23334')
    expect(content).toContain('"token":"[MASKED]"')
    expect(content.trim().split('\n')).toHaveLength(1)
  })

  it('消息换行被压缩为单行', async () => {
    const dir = await tempDir()
    const log = createLogger({ dir, echoConsole: false })
    log.info('line1\nline2')
    await log.flush()
    const content = await readLog(dir)
    expect(content.trim().split('\n')).toHaveLength(1)
    expect(content).toContain('line1 line2')
  })
})

describe('createLogger — 轮转与清理', () => {
  it('跨日自动轮转：新日期写新文件', async () => {
    let fake = new Date('2026-09-22T23:59:00.000Z')
    const dir = await tempDir()
    const log = createLogger({ dir, echoConsole: false, clock: () => fake })
    log.info('day1')
    await log.flush()
    fake = new Date('2026-09-23T00:01:00.000Z')
    log.info('day2')
    await log.flush()
    const files = (await readdir(dir)).sort()
    expect(files).toEqual(['eclipselive-2026-09-22.log', 'eclipselive-2026-09-23.log'])
    expect(await readLog(dir, 'eclipselive-2026-09-22.log')).toContain('day1')
    expect(await readLog(dir, 'eclipselive-2026-09-23.log')).toContain('day2')
  })

  it('保留期清理：仅删自家前缀的过期文件，其余不动', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'eclipselive-2026-09-01.log'), 'old\n')
    await writeFile(join(dir, 'eclipselive-2026-09-20.log'), 'keep\n')
    await writeFile(join(dir, 'notes.txt'), 'keep.txt\n')
    const t = new Date('2026-09-22T12:00:00.000Z')
    const log = createLogger({ dir, clock: () => t, retentionDays: 3, echoConsole: false })
    log.info('today')
    await log.flush()
    const files = await readdir(dir)
    expect(files).toContain('eclipselive-2026-09-20.log')
    expect(files).toContain('eclipselive-2026-09-22.log')
    expect(files).toContain('notes.txt')
    expect(files).not.toContain('eclipselive-2026-09-01.log')
  })

  it('写入失败不崩溃（dir 指向文件）', async () => {
    const base = await tempDir()
    const notADir = join(base, 'not-a-dir')
    await writeFile(notADir, 'x')
    const log = createLogger({ dir: join(notADir, 'logs'), echoConsole: false })
    log.info('boom')
    await log.flush()
  })
})
