import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ③c(1/2) 在线价目（用户：a 全量下载但只留主流家族 / a 不自动拉汇率 / a 固定家族白名单；
 * Q4=b 优先在线更新、内置兜底；每次启动刷新 + 手动刷新）。
 *
 * 三条纪律必须有测试钉住：
 *   ① **未获同意 ⇒ 一次请求都不发**（local-first 红线）；
 *   ② **外部数据不可信** ⇒ 坏条目跳过并计数、整表不合格则丢弃并回退缓存/内置；
 *   ③ **失败永不抛异常**（启动路径不能被网络拖垮）。
 */
const PO = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/prices-online.js')).href
const PRICES = resolve(process.cwd(), 'modules/vupcut/prices.json')

type Po = {
  DEFAULT_MODELS_URL: string
  DEFAULT_FAMILIES: readonly string[]
  toPerMillion: (v: unknown) => number | null
  isMainstream: (id: string, f?: readonly string[]) => boolean
  parseOpenRouterModels: (j: unknown, o?: Record<string, unknown>) => {
    table: { models: Array<{ match: string; input: number; output: number; currency: string }>; source: string; asOf: string | null }
    stats: { total: number; kept: number; skipped: number; families: string[] }
  }
  refreshPrices: (a: Record<string, unknown>) => Promise<{ ok: boolean; source: string; table: unknown; error?: string; stats?: unknown }>
  loadCachedTable: (d: string | null) => Promise<unknown>
  saveCachedTable: (d: string, t: unknown) => Promise<boolean>
}

let po: Po
let builtin: unknown
beforeEach(async () => {
  po = (await import(PO)) as never
  builtin = JSON.parse(readFileSync(PRICES, 'utf8'))
})

/** 造一份"像 OpenRouter"的响应：两家主流 + 一条非主流 + 三条坏数据。 */
function openRouterLike(): unknown {
  return {
    data: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', pricing: { prompt: '0.00000027', completion: '0.0000011' } },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
      { id: 'zhipu/glm-4-plus', name: 'GLM-4 Plus', pricing: { prompt: '0.0000005', completion: '0.0000005' } },
      { id: 'meta-llama/llama-3.1-8b', name: 'Llama 8B', pricing: { prompt: '0.00000005', completion: '0.00000005' } },
      { id: 'acme/internal-model', name: '内部模型', pricing: { prompt: '0.001', completion: '0.001' } }, // 非主流
      { id: 'broken/no-price', name: '无价' }, // 坏：缺 pricing
      { id: 'broken/negative', name: '负价', pricing: { prompt: '-1', completion: '1' } }, // 坏：负价
      { id: 'broken/free', name: '零价', pricing: { prompt: '0', completion: '0' } }, // 坏：零价（无意义）
      { id: 'deepseek/deepseek-chat', name: '重复条目', pricing: { prompt: '0.00000027', completion: '0.0000011' } } // 重复
    ]
  }
}

describe('③c 在线价目：防御式解析（外部数据不可信）', () => {
  it('① USD/token → 每 1M token；非法值返回 null', () => {
    expect(po.toPerMillion('0.00000027')).toBeCloseTo(0.27, 6)
    expect(po.toPerMillion(0.0000011)).toBeCloseTo(1.1, 6)
    expect(po.toPerMillion('-1')).toBe(null)
    expect(po.toPerMillion('abc')).toBe(null)
    expect(po.toPerMillion(undefined)).toBe(null)
  })

  it('② 主流家族判定：认厂商前缀与模型名；未知厂商不算主流', () => {
    expect(po.isMainstream('deepseek/deepseek-chat')).toBe(true)
    expect(po.isMainstream('openai/gpt-4o-mini')).toBe(true)
    expect(po.isMainstream('moonshotai/kimi-k2')).toBe(true)
    expect(po.isMainstream('meta-llama/llama-3.1-8b')).toBe(true)
    expect(po.isMainstream('acme/internal-model')).toBe(false)
  })

  it('③ 坏条目**跳过并计数**，好条目照常入表（一条坏数据不能让整表作废）', () => {
    const { table, stats } = po.parseOpenRouterModels(openRouterLike(), { asOf: '2026-10-03' })
    expect(stats.total, '原始条目数').toBe(9)
    expect(stats.kept, '主流且合法：deepseek / gpt-4o-mini / glm-4-plus / llama').toBe(4)
    expect(stats.skipped, '非主流 1 + 坏数据 3 + 重复 1').toBe(5)
    expect(table.asOf).toBe('2026-10-03')
    expect(table.source).toBe('openrouter')
    expect(table.models.some((m) => m.match === 'deepseek-chat'), '补一条去前缀的短模式便于命中').toBe(true)
    const ds = table.models.find((m) => m.match === 'deepseek-chat') as { input: number; output: number; currency: string }
    expect(ds.input).toBeCloseTo(0.27, 6)
    expect(ds.output).toBeCloseTo(1.1, 6)
    expect(ds.currency, '如实标注 USD（不是人民币官方价）').toBe('USD')
  })

  it('④ 完全不是那个结构 ⇒ 空表 + 计数（不抛异常）', () => {
    const { table, stats } = po.parseOpenRouterModels({ nope: 1 })
    expect(table.models).toEqual([])
    expect(stats.total).toBe(0)
    expect(po.parseOpenRouterModels(null).table.models).toEqual([])
  })
})

describe('③c 在线价目：同意、回退与缓存', () => {
  it('⑤ **未获同意 ⇒ 一次请求都不发**（local-first 红线）', async () => {
    const spy = vi.fn(async () => openRouterLike())
    const r = await po.refreshPrices({ enabled: false, fetchJson: spy, builtin })
    expect(spy, '绝不能偷偷联网').not.toHaveBeenCalled()
    expect(r.source).toBe('builtin')
    expect(r.ok).toBe(true)
  })

  it('⑥ 成功拉取 ⇒ source=online 且写入 last-good 缓存', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vupcut-prices-'))
    const r = await po.refreshPrices({ enabled: true, fetchJson: async () => openRouterLike(), builtin, cacheDir: dir })
    expect(r.source).toBe('online')
    expect(r.ok).toBe(true)
    const cached = (await po.loadCachedTable(dir)) as { source: string; models: unknown[] }
    expect(cached, 'last-good 应被写入').toBeTruthy()
    expect(cached.source).toBe('openrouter')
    expect(cached.models.length).toBeGreaterThan(0)
  })

  it('⑦ 网络失败 ⇒ 回退缓存（有）或内置（无），且**永不抛异常**', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vupcut-prices-'))
    await po.refreshPrices({ enabled: true, fetchJson: async () => openRouterLike(), builtin, cacheDir: dir })

    const fail = async (): Promise<unknown> => {
      throw new Error('网络不可达')
    }
    const r = await po.refreshPrices({ enabled: true, fetchJson: fail, builtin, cacheDir: dir })
    expect(r.ok, '失败但不阻塞').toBe(false)
    expect(r.source, '有缓存就用缓存').toBe('cache')
    expect(r.error).toMatch(/网络不可达/)

    const noCache = await po.refreshPrices({ enabled: true, fetchJson: fail, builtin, cacheDir: null })
    expect(noCache.source, '没有缓存就退内置').toBe('builtin')
  })

  it('⑧ 在线表**不合格**（结构被改坏）⇒ 丢弃并回退，绝不让坏数据进预算判断', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vupcut-prices-'))
    // 人工构造一个"解析出来但校验不过"的场景：所有条目都被过滤 ⇒ 空表
    const r = await po.refreshPrices({
      enabled: true,
      fetchJson: async () => ({ data: [{ id: 'acme/whatever', pricing: { prompt: '1', completion: '1' } }] }),
      builtin,
      cacheDir: dir
    })
    expect(r.ok).toBe(false)
    expect(r.source).toBe('builtin')
    expect(r.error).toMatch(/没有可用条目|不合格/)
  })

  it('⑨ 用户覆盖优先级最高（可填官方人民币价或代理商折扣价）', async () => {
    const userOverride = {
      currency: 'CNY',
      source: 'user',
      models: [{ match: 'deepseek-chat', currency: 'CNY', input: 1, output: 2 }]
    }
    const r = await po.refreshPrices({ enabled: true, fetchJson: async () => openRouterLike(), builtin, userOverride })
    const models = (r.table as { models: Array<{ match: string; input?: number; currency?: string }> }).models
    const hit = models.find((m) => m.match === 'deepseek-chat') as { input: number; currency: string }
    expect(hit.input, '用户价应覆盖在线价').toBe(1)
    expect(hit.currency).toBe('CNY')
  })

  it('⑩ 缓存损坏 ⇒ 视为没有缓存（返回 null，不抛）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vupcut-prices-'))
    writeFileSync(join(dir, 'prices.online.json'), '{ 坏 JSON', 'utf8')
    expect(await po.loadCachedTable(dir)).toBe(null)
    writeFileSync(join(dir, 'prices.online.json'), JSON.stringify({ currency: 'CNY' }), 'utf8')
    expect(await po.loadCachedTable(dir), '缺 models 的缓存也不可用').toBe(null)
  })
})
