import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * ③b 成本与预算（用户决策：Q1=超限警告并由用户选择是否终止／Q2=未收录模型让用户填单价／
 * Q4=价目优先在线更新但内置兜底）。
 *
 * 这组测试守的是**三条诚实原则**：
 *   ① 价目是**数据**（含 asOf/source），代码里没有写死的价格"事实"；
 *   ② **未知模型不猜**（返回 known:false，请用户填单价）；
 *   ③ 估算**天然是上界**（不含折扣/阶梯），预算以真实 usage 为准；
 * 以及 Q1 的行为：**超限不是硬停**，而是返回 `exceed` + `options:['continue','abort']` 交给用户。
 */
const COST = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/cost.js')).href
const PRICES = resolve(process.cwd(), 'modules/vupcut/prices.json')

type Cost = {
  PRICE_TABLE_VERSION: number
  validatePriceTable: (t: unknown) => { ok: boolean; errors: string[] }
  mergePriceTables: (b: unknown, o: unknown) => { models: Array<{ match: string }> }
  pickPrice: (m: string, t: unknown) => { match: string } | null
  estimateTokens: (s: string) => number
  estimateCost: (a: Record<string, unknown>) => { known: boolean; amountCny: number | null; currency: string | null; note: string }
  budgetVerdict: (a: Record<string, unknown>) => { state: string; message?: string; options?: string[]; note?: string }
  accumulateUsage: (a: Record<string, unknown>) => { spentCny: number; costKnown: boolean }
}

let cost: Cost
let builtin: { models: Array<{ match: string }> }
beforeEach(async () => {
  cost = (await import(COST)) as never
  builtin = JSON.parse(readFileSync(PRICES, 'utf8'))
})

describe('③b 价目表：结构、校验与"数据而非事实"', () => {
  it('① 内置价目表本身必须通过校验（且带 asOf/source/note）', () => {
    const t = JSON.parse(readFileSync(PRICES, 'utf8'))
    const v = cost.validatePriceTable(t)
    expect(v.errors, `内置表不合格：${v.errors.join('；')}`).toEqual([])
    expect(t.version).toBe(cost.PRICE_TABLE_VERSION)
    expect(t.source, '必须标明来源（界面要显示）').toBeTruthy()
    expect(Object.prototype.hasOwnProperty.call(t, 'asOf'), '必须带 asOf 字段（可为 null 表示未填）').toBe(true)
    expect(t.note, '必须带"以官方价目为准"的说明').toMatch(/官方|易变/)
  })

  it('② 覆盖你点名的模型家族，且**单价一律留空**（不许把价格写成事实）', () => {
    const matches = builtin.models.map((m) => m.match).join(' ')
    for (const family of ['deepseek', 'MiniMax', 'qwen', 'moonshot', 'kimi', 'glm', 'step', 'gpt', 'claude', 'gemini']) {
      expect(matches.toLowerCase(), `应覆盖 ${family}`).toContain(family.toLowerCase())
    }
    // 规则升级（③d 起）：**允许**内置已核实的价格，但凡是带价格的条目**必须**带
    // `asOf` + `sourceUrl`（来源可追溯）—— 这比"一律留空"更实用，同时仍不许把价格写成无源事实。
    const priced = (builtin.models as Array<{ match: string; input?: unknown; output?: unknown; perHourAudio?: unknown; asOf?: string; sourceUrl?: string }>).filter(
      (m) => typeof m.input === 'number' || typeof m.output === 'number' || typeof m.perHourAudio === 'number'
    )
    expect(priced.length, 'MiMo 的已核实价格应当在场（否则说明数据被清空）').toBeGreaterThan(0)
    for (const m of priced) {
      expect(m.asOf, `${m.match} 带价格就必须带 asOf（价格是易变数据）`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(m.sourceUrl, `${m.match} 带价格就必须带 sourceUrl（来源可追溯）`).toMatch(/^https?:\/\//)
    }
    const unpriced = (builtin.models as Array<{ match: string; input?: unknown; output?: unknown; perHourAudio?: unknown }>).filter(
      (m) => typeof m.input !== 'number' && typeof m.output !== 'number' && typeof m.perHourAudio !== 'number'
    )
    expect(unpriced.length, '未核实的厂商仍应留空（等用户填写或在线更新）').toBeGreaterThan(0)
  })

  it('③ 校验能挡住**远程坏数据**（在线更新时必须先过这一关）', () => {
    expect(cost.validatePriceTable(null).ok).toBe(false)
    expect(cost.validatePriceTable({ currency: 'CNY' }).ok, '缺 models').toBe(false)
    expect(cost.validatePriceTable({ currency: 'CNY', models: [] }).ok, '空 models').toBe(false)
    expect(cost.validatePriceTable({ currency: 'CNY', models: [{ match: '' }] }).ok, '空 match').toBe(false)
    expect(cost.validatePriceTable({ currency: 'CNY', models: [{ match: 'x', input: -1 }] }).ok, '负价格').toBe(false)
    expect(cost.validatePriceTable({ currency: 'CNY', models: [{ match: 'x', output: 'free' }] }).ok, '价格必须是数字').toBe(false)
    expect(cost.validatePriceTable({ currency: 'CNY', models: [{ match: 'x' }], fxToCny: { USD: 0 } }).ok, '汇率必须为正').toBe(false)
    expect(cost.validatePriceTable({ currency: 'CNY', models: [{ match: 'x', input: 1, output: 2 }] }).ok).toBe(true)
  })

  it('④ 用户覆盖优先（换价、代理商折扣价都能自己改）', () => {
    const base = { currency: 'CNY', models: [{ match: 'qwen*', input: 1, output: 2 }, { match: 'glm*', input: 3, output: 4 }] }
    const over = { currency: 'CNY', models: [{ match: 'qwen*', input: 0.5, output: 1 }] }
    const merged = cost.mergePriceTables(base, over)
    const qwen = merged.models.find((m) => m.match === 'qwen*') as { input: number }
    expect(qwen.input, '用户价应覆盖内置价').toBe(0.5)
    expect(merged.models.some((m) => m.match === 'glm*'), '未覆盖的条目要保留').toBe(true)
  })

  it('⑤ 匹配：更具体的 match 优先；找不到 ⇒ null（**不猜**）', () => {
    const table = { currency: 'CNY', models: [{ match: 'deepseek*', input: 1, output: 1 }, { match: 'deepseek-chat', input: 2, output: 2 }] }
    expect(cost.pickPrice('deepseek-chat', table)?.match, '具体模式应胜出').toBe('deepseek-chat')
    expect(cost.pickPrice('deepseek-reasoner', table)?.match).toBe('deepseek*')
    expect(cost.pickPrice('some-unknown-llm', table), '未收录必须返回 null').toBe(null)
  })
})

describe('③b 估算与预算（Q1：超限警告 + 用户决定）', () => {
  it('⑥ 未收录模型 ⇒ known:false + 明确请用户填单价（Q2=a）', () => {
    const r = cost.estimateCost({ model: 'brand-new-llm', table: builtin, inputTokens: 1000, outputTokens: 500 })
    expect(r.known).toBe(false)
    expect(r.amountCny, '不许猜金额').toBe(null)
    expect(r.note, '要告诉用户怎么办').toMatch(/填写.*单价|单价/)
  })

  it('⑦ 收录但单价为空 ⇒ 同样不猜，并指向在线价目/填写', () => {
    const table = { currency: 'CNY', models: [{ match: 'glm*', input: null, output: null }] }
    const r = cost.estimateCost({ model: 'glm-4-plus', table, inputTokens: 10, outputTokens: 10 })
    expect(r.known).toBe(false)
    expect(r.basis).toMatch(/单价为空/)
  })

  it('⑧ 有单价时按 1M token 计价；跨币种缺汇率 ⇒ **不换算**（不假装知道汇率）', () => {
    const cny = { currency: 'CNY', models: [{ match: 'qwen*', input: 2, output: 8 }] }
    const r = cost.estimateCost({ model: 'qwen-max', table: cny, inputTokens: 1_000_000, outputTokens: 500_000 })
    expect(r.amountCny, '2 + 4 = 6 元').toBe(6)
    expect(r.note, '必须说明是上界').toMatch(/上界|不高于/)

    const usd = { currency: 'USD', models: [{ match: 'gpt-4o*', input: 5, output: 15 }] }
    const r2 = cost.estimateCost({ model: 'gpt-4o', table: usd, inputTokens: 1_000_000, outputTokens: 0 })
    expect(r2.amount).toBe(5)
    expect(r2.amountCny, '没有汇率就不换算').toBe(null)
    expect(r2.note).toMatch(/汇率|未换算/)
  })

  it('⑨ token 估算：只用于提前警告（中文按字数、其它按字符），且非零', () => {
    expect(cost.estimateTokens('你好世界')).toBeGreaterThan(0)
    expect(cost.estimateTokens('hello world')).toBeGreaterThan(0)
    expect(cost.estimateTokens('')).toBe(0)
    // 中文应比同样长度的英文估得更多 token
    expect(cost.estimateTokens('中文中中文中')).toBeGreaterThan(cost.estimateTokens('abcdef'))
  })

  it('⑩ Q1：超限**不是硬停** —— 返回 exceed 并把选择权交给用户', () => {
    const v = cost.budgetVerdict({ spentCny: 2.5, limitCny: 2, estimateCny: 0.1 })
    expect(v.state).toBe('exceed')
    expect(v.options, '必须提供"继续/终止"两个选项').toEqual(['continue', 'abort'])
    expect(v.message, '要给用户看得懂的话').toMatch(/是否终止|是否继续/)
  })

  it('⑪ Q1：确认过就不再反复打断（每场只问一次）', () => {
    const v = cost.budgetVerdict({ spentCny: 2.5, limitCny: 2, estimateCny: 0.1, acknowledged: true })
    expect(v.state, '已确认 ⇒ 不再打断').toBe('ok')
    expect(v.note).toMatch(/不再打断/)
  })

  it('⑫ 90% 时提前警告；未知费用时如实说"无法判断是否会超限"', () => {
    const warn = cost.budgetVerdict({ spentCny: 1.0, limitCny: 2, estimateCny: 0.7 })
    expect(warn.state, '预计 1.7/2 = 85% ⇒ warn').toBe('warn')
    const unknown = cost.budgetVerdict({ spentCny: 0.5, limitCny: 2, estimateCny: null })
    expect(unknown.state).toBe('ok')
    expect(unknown.note, '未知费用必须如实说明').toMatch(/未知|无法判断/)
  })

  it('⑬ 累加以**真实 usage** 为准（预算判断不看估算）', () => {
    const table = { currency: 'CNY', models: [{ match: 'qwen*', input: 2, output: 8 }] }
    const r = cost.accumulateUsage({
      spentCny: 1,
      table,
      model: 'qwen-max',
      usage: { prompt_tokens: 1_000_000, completion_tokens: 0 }
    })
    expect(r.spentCny, '1 + 2 = 3').toBe(3)
    expect(r.inTok).toBe(1_000_000)
    expect(r.costKnown).toBe(true)

    const unknown = cost.accumulateUsage({ spentCny: 3, table, model: 'unknown-model', usage: { prompt_tokens: 10, completion_tokens: 1 } })
    expect(unknown.costKnown, '未收录 ⇒ 记 token 但不编金额').toBe(false)
    expect(unknown.spentCny, '金额不变').toBe(3)
  })
})
