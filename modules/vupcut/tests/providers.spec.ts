import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * ③d 套餐（plan）与厂商注册表 —— 用户决策：Q1=a 选择器里选套餐档并显示"本场预计消耗占比"、
 * Q2=a 明确列出「订阅不含 API 额度」的厂商、Q3=a 选中这类厂商必须确认一次。
 *
 * 这一卡要守住的**产品判断**：
 *   套餐用户**已经付过钱** ⇒ 边际成本为 0 ⇒ **不能用人民币上限拦他们** ✗
 *   ⇒ 套餐走**额度百分比**口径；而未核实的订阅（ChatGPT Plus 等）必须**明确警告**，
 *      否则会出现"我买了 Plus 怎么还在扣钱"这类高频误解。
 */
const COST = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/cost.js')).href
const PROV = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/providers.js')).href
const PRICES = resolve(process.cwd(), 'modules/vupcut/prices.json')

type Cost = {
  validatePriceTable: (t: unknown) => { ok: boolean; errors: string[] }
  estimateCost: (a: Record<string, unknown>) => { known: boolean; amountCny: number | null; basis: string; note: string }
  estimatePlanCredits: (a: Record<string, unknown>) => { known: boolean; credits: number | null; basis: string }
  planVerdict: (a: Record<string, unknown>) => { state: string; pct?: number; message?: string; options?: string[]; note?: string }
}
type Prov = {
  PROVIDERS: Array<{ id: string; billing: string; warning?: string; family: string[] }>
  MIMO_PLAN_TIERS: Array<{ id: string; cnyPerMonth: number; creditsPerMonth: number }>
  listProviders: () => unknown[]
  getProvider: (id: string) => { billing: string } | null
  billingOf: (id: string) => string | null
  confirmWarningFor: (id: string) => string | null
  usesPlanQuota: (id: string) => boolean
  providerForModel: (m: string) => string | null
  creditRuleFor: (p: string, m: string) => Record<string, number> | null
  planTier: (p: string, t: string) => { creditsPerMonth: number } | null
}

let cost: Cost
let prov: Prov
beforeEach(async () => {
  cost = (await import(COST)) as never
  prov = (await import(PROV)) as never
})

describe('③d 厂商注册表：billing 三态（plan 用户可识别）', () => {
  it('① 三家订阅类必须明确列出并**带警告**（Q2=a / Q3=a）', () => {
    for (const id of ['openai', 'anthropic', 'google']) {
      expect(prov.billingOf(id), `${id} 应为 subscription`).toBe('subscription')
      const w = prov.confirmWarningFor(id)
      expect(w, `${id} 必须有确认警告`).toBeTruthy()
      expect(w, '警告必须说清"不含 API 额度"').toMatch(/不含 API 额度/)
    }
  })

  it('② API 套餐类（真能抵扣调用）⇒ 走额度口径，无需警告', () => {
    for (const id of ['mimo', 'zhipu', 'zai', 'kimi', 'qwen', 'volcengine']) {
      expect(prov.billingOf(id), `${id} 应为 plan`).toBe('plan')
      expect(prov.usesPlanQuota(id)).toBe(true)
      expect(prov.confirmWarningFor(id), 'plan 不需要额外确认').toBe(null)
    }
  })

  it('③ 纯按量类：无需警告，不走额度', () => {
    for (const id of ['deepseek', 'minimax', 'stepfun', 'openrouter', 'custom']) {
      expect(prov.billingOf(id)).toBe('payg')
      expect(prov.confirmWarningFor(id)).toBe(null)
      expect(prov.usesPlanQuota(id)).toBe(false)
    }
    expect(prov.billingOf('不存在的厂商'), '未知厂商不得瞎猜').toBe(null)
    expect(prov.getProvider('不存在的厂商')).toBe(null)
  })

  it('④ 模型名 → 厂商归属（把"检测到的 provider"对回注册表）', () => {
    expect(prov.providerForModel('mimo-v2.6-pro')).toBe('mimo')
    expect(prov.providerForModel('deepseek-chat')).toBe('deepseek')
    expect(prov.providerForModel('claude-3-5-sonnet-latest')).toBe('anthropic')
    expect(prov.providerForModel('glm-4-plus')).toBe('zhipu')
    expect(prov.providerForModel('')).toBe(null)
  })

  it('⑤ 套餐档与额度折算规则都要能查到', () => {
    expect(prov.MIMO_PLAN_TIERS.map((t) => t.id)).toEqual(['lite', 'standard', 'pro', 'max'])
    expect(prov.planTier('mimo', 'lite')?.creditsPerMonth, 'Lite = 41 亿 Credits').toBe(4_100_000_000)
    expect(prov.planTier('mimo', 'nope')).toBe(null)
    const asr = prov.creditRuleFor('mimo', 'mimo-v2.5-asr')
    expect(asr?.perHourAudio, 'ASR 按音频小时扣额度：30M/小时').toBe(30_000_000)
    const pro = prov.creditRuleFor('mimo', 'mimo-v2.6-pro')
    expect(pro?.input).toBe(300)
    expect(pro?.output).toBe(600)
    expect(prov.creditRuleFor('deepseek', 'deepseek-chat'), '没有规则的厂商返回 null').toBe(null)
  })
})

describe('③d 按音频时长计价（ASR 的单位与语言模型不同）', () => {
  it('⑥ ASR 按小时计价：¥0.5/小时；缺时长 ⇒ 不猜', () => {
    const table = JSON.parse(readFileSync(PRICES, 'utf8'))
    const v = cost.validatePriceTable(table)
    expect(v.errors, `内置表不合格：${v.errors.join('；')}`).toEqual([])

    const r = cost.estimateCost({ model: 'mimo-v2.5-asr', table, audioHours: 4 })
    expect(r.known).toBe(true)
    expect(r.amountCny, '4 小时 × ¥0.5 = ¥2').toBe(2)
    expect(r.basis).toMatch(/音频/)

    const noHours = cost.estimateCost({ model: 'mimo-v2.5-asr', table })
    expect(noHours.known, '没有音频时长就不给数字').toBe(false)
  })

  it('⑦ MiMo 语言模型单价已核实（¥3/¥6），且单位校验能挡住自相矛盾的条目', () => {
    const table = JSON.parse(readFileSync(PRICES, 'utf8'))
    const r = cost.estimateCost({ model: 'mimo-v2.6-pro', table, inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(r.amountCny, '3 + 6 = 9 元').toBe(9)

    const bad = { currency: 'CNY', models: [{ match: 'x', unit: 'perHourAudio', input: 1, output: 2 }] }
    expect(cost.validatePriceTable(bad).ok, '标为按小时却给 token 价 ⇒ 必须拒绝').toBe(false)
    const bad2 = { currency: 'CNY', models: [{ match: 'x', unit: 'perMTokens', perHourAudio: 1 }] }
    expect(cost.validatePriceTable(bad2).ok).toBe(false)
    expect(cost.validatePriceTable({ currency: 'CNY', models: [{ match: 'x', unit: 'perHourAudio', perHourAudio: 0.5 }] }).ok).toBe(true)
  })
})

describe('③d 套餐额度口径（Q1=a：显示占比；超限同样交给用户决定）', () => {
  it('⑧ 语言模型按 Credits/token 折算（官方例子：10M 未命中输入 ≈ 3000M Credits）', () => {
    const rule = prov.creditRuleFor('mimo', 'mimo-v2.6-pro') as Record<string, number>
    const r = cost.estimatePlanCredits({ creditRule: rule, inputTokens: 10_000_000, outputTokens: 0 })
    expect(r.known).toBe(true)
    expect(r.credits, '官方例子：10M × 300 = 3000M Credits').toBe(3_000_000_000)
  })

  it('⑨ ASR 按音频小时折算（官方：30M Credits/小时；Lite 可跑 136.6 小时）', () => {
    const rule = prov.creditRuleFor('mimo', 'mimo-v2.5-asr') as Record<string, number>
    const r = cost.estimatePlanCredits({ creditRule: rule, audioHours: 4 })
    expect(r.credits, '4 小时 × 30M = 120M Credits').toBe(120_000_000)
    const lite = prov.planTier('mimo', 'lite') as { creditsPerMonth: number }
    const hours = lite.creditsPerMonth / (rule.perHourAudio ?? 1)
    expect(Math.round(hours), '官方口径：Lite 全用于 ASR ≈ 136.6 小时').toBe(137)
  })

  it('⑩ 占比判定：先预警后警告，超限给"继续/终止"两个选项（与人民币口径一致的策略）', () => {
    const quota = 4_100_000_000
    const warn = cost.planVerdict({ creditsUsed: quota * 0.7, quotaTotal: quota, creditsNext: quota * 0.15 })
    expect(warn.state, '70% + 15% = 85% ≥ 80% ⇒ warn').toBe('warn')
    expect(warn.pct, '当前占比要显示').toBeCloseTo(70, 1)

    const over = cost.planVerdict({ creditsUsed: quota * 0.95, quotaTotal: quota, creditsNext: quota * 0.1 })
    expect(over.state).toBe('exceed')
    expect(over.options).toEqual(['continue', 'abort'])
    expect(over.message).toMatch(/是否继续|是否终止/)

    const ack = cost.planVerdict({ creditsUsed: quota * 0.95, quotaTotal: quota, creditsNext: quota * 0.1, acknowledged: true })
    expect(ack.state, '确认过就不再打断').toBe('ok')
  })

  it('⑪ 自定义更保守的上限（如 20%）也能生效；未填总额度 ⇒ 如实说无法判断', () => {
    const quota = 4_100_000_000
    const v = cost.planVerdict({ creditsUsed: quota * 0.25, quotaTotal: quota, creditsNext: 0, limitPct: 20 })
    expect(v.state, '已用 25% > 上限 20% ⇒ exceed').toBe('exceed')
    const unknown = cost.planVerdict({ creditsUsed: 1, quotaTotal: 0 })
    expect(unknown.state).toBe('unknown')
    expect(unknown.note).toMatch(/套餐档位|总额度/)
  })

  it('⑫ 缺折算规则/缺时长 ⇒ 一律不猜（known:false）', () => {
    expect(cost.estimatePlanCredits({ creditRule: null }).known).toBe(false)
    expect(cost.estimatePlanCredits({ creditRule: { input: 1, output: 2 } }).known).toBe(true)
    expect(cost.estimatePlanCredits({ creditRule: { perHourAudio: 30_000_000 } }).known, '缺音频时长').toBe(false)
    expect(cost.estimatePlanCredits({ creditRule: { unknown: 1 } }).known, '规则不完整').toBe(false)
  })
})
