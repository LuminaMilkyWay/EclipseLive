/**
 * cost：**成本估算与预算护栏**（用户决策：Q1=超限时警告并由用户决定是否终止／
 * Q2=未收录模型让用户填单价／Q3=开关与预算放在 VupCut 自己的页面／Q4=价目优先在线更新，
 * 但内置表兜底）。
 *
 * ⚠️ 三条诚实原则（否则这个功能会害人）：
 *   ① **价格是易变数据** ⇒ 价目表只是"数据文件"，必须带 `asOf`/`source`，界面必须显示日期与
 *      "以官方价目为准"；**代码里绝不把任何价格写成事实**。
 *   ② **未知模型不猜** ⇒ `pickPrice` 找不到就返回 null，`estimateCost` 返回 `known:false`，
 *      由界面请用户填写单价（Q2=a）—— 绝不"用同族价格偷偷代估"。
 *   ③ **估算天然是上界** ⇒ 不含缓存折扣/批处理折扣/阶梯价 ⇒ 只用来**提前警告**；
 *      预算的最终判断以响应里的 `usage`（**真实值**）为准。
 *
 * 币种：价目表条目自带 `currency`；预算以 **CNY** 表示，跨币种用表里的 `fxToCny` 显式换算
 * （没有汇率 ⇒ 不换算，如实标记"未换算"，而不是假装知道汇率）。
 */

/** 价目表版本：结构变更时递增；`validatePriceTable` 会校验。 */
export const PRICE_TABLE_VERSION = 1

/** 校验一份价目表（内置表与**在线表**都要过这一关 ⇒ 远程坏数据一律丢弃）。 */
export function validatePriceTable(t) {
  const errors = []
  if (t === null || typeof t !== 'object' || Array.isArray(t)) return { ok: false, errors: ['价目表必须是对象'] }
  if (t.version !== undefined && typeof t.version !== 'number') errors.push('version 必须是数字')
  if (typeof t.currency !== 'string' || t.currency.trim() === '') errors.push('必须声明默认币种 currency')
  if (!Array.isArray(t.models) || t.models.length === 0) errors.push('models 必须是非空数组')
  else {
    t.models.forEach((m, i) => {
      if (m === null || typeof m !== 'object') {
        errors.push(`models[${i}] 必须是对象`)
        return
      }
      if (typeof m.match !== 'string' || m.match.trim() === '') errors.push(`models[${i}].match 必须是非空字符串`)
      if (m.currency !== undefined && typeof m.currency !== 'string') errors.push(`models[${i}].currency 必须是字符串`)
      if (m.unit !== undefined && !['perMTokens', 'perHourAudio'].includes(m.unit)) {
        errors.push(`models[${i}].unit 只能是 perMTokens 或 perHourAudio`)
      }
      for (const k of ['input', 'output', 'cachedInput', 'perHourAudio']) {
        const v = m[k]
        if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
          errors.push(`models[${i}].${k} 必须是非负数字或 null`)
        }
      }
      // 计价单位必须与字段自洽：按音频小时计价的条目不该出现 token 单价，反之亦然
      if (m.unit === 'perHourAudio' && typeof m.perHourAudio !== 'number' && (typeof m.input === 'number' || typeof m.output === 'number')) {
        errors.push(`models[${i}] 标为 perHourAudio 却只给了 token 单价`)
      }
      if (m.unit === 'perMTokens' && typeof m.perHourAudio === 'number') {
        errors.push(`models[${i}] 标为 perMTokens 却给了 perHourAudio`)
      }
    })
  }
  if (t.fxToCny !== undefined) {
    if (t.fxToCny === null || typeof t.fxToCny !== 'object' || Array.isArray(t.fxToCny)) {
      errors.push('fxToCny 必须是对象')
    } else {
      for (const [k, v] of Object.entries(t.fxToCny)) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) errors.push(`fxToCny.${k} 必须是正数`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 合并价目表：**用户覆盖优先**（Q2=a 的落点）。
 * 同一 `match` ⇒ 覆盖条目完全替换；否则追加到最前（更具体的 match 先命中）。
 */
export function mergePriceTables(base, override) {
  const b = base?.models ?? []
  const o = override?.models ?? []
  const byMatch = new Map()
  for (const m of b) byMatch.set(m.match, m)
  for (const m of o) byMatch.set(m.match, m) // 覆盖
  return {
    version: PRICE_TABLE_VERSION,
    currency: override?.currency ?? base?.currency ?? 'CNY',
    asOf: override?.asOf ?? base?.asOf ?? null,
    source: override?.source ?? base?.source ?? 'builtin',
    note: override?.note ?? base?.note ?? '',
    fxToCny: { ...(base?.fxToCny ?? {}), ...(override?.fxToCny ?? {}) },
    // 用户条目排前面（更具体优先命中）
    models: [...o, ...b.filter((bm) => !o.some((om) => om.match === bm.match))]
  }
}

/** 简易模式匹配：`*` 通配，大小写不敏感。 */
function matches(pattern, model) {
  const p = String(pattern).toLowerCase()
  const m = String(model).toLowerCase()
  if (!p.includes('*')) return m === p || m.startsWith(`${p}-`) || m.startsWith(p)
  const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return re.test(m)
}

/**
 * 取某模型的单价。**找不到 ⇒ null**（不猜）。
 * 多条命中时取 `match` 最长的那条（更具体优先）。
 */
export function pickPrice(model, table) {
  const list = table?.models ?? []
  const hits = list.filter((m) => matches(m.match, model))
  if (hits.length === 0) return null
  hits.sort((a, b) => String(b.match).length - String(a.match).length)
  return hits[0]
}

/**
 * 粗略 token 估算（**标注为估算**）：中文按 ~1.6 字/token，其它按 ~4 字符/token 混合口径。
 * 只用于**发送前**的提前警告；真实值一律以响应 `usage` 为准。
 */
export function estimateTokens(text) {
  const s = typeof text === 'string' ? text : ''
  if (s === '') return 0
  let cjk = 0
  for (const ch of s) if (/[\u3400-\u9fff\u3040-\u30ff\uff00-\uffef]/.test(ch)) cjk += 1
  const other = s.length - cjk
  return Math.max(1, Math.ceil(cjk / 1.6 + other / 4))
}

/** 金额四舍五入到 4 位小数（分以下也要看得见，避免"显示 0 元但实际在花钱"）。 */
const round4 = (n) => Math.round(n * 10000) / 10000

/**
 * 估算一次调用的费用。
 * @returns {{known:boolean, currency:string|null, amountCny:number|null, amount:number|null,
 *            basis:string, note:string}}
 */
export function estimateCost({ model, table, inputTokens = 0, outputTokens = 0, audioHours = null, overrideEntry = null }) {
  const entry = overrideEntry ?? pickPrice(model, table)
  if (entry === null) {
    return {
      known: false,
      currency: null,
      amount: null,
      amountCny: null,
      basis: `价目表未收录模型 ${model}`,
      note: '请填写该模型的单价（每 1M token 输入/输出），否则无法估算费用'
    }
  }
  const cur = entry.currency ?? table?.currency ?? 'CNY'
  const fx = table?.fxToCny?.[cur]
  const toCny = (amount) => (cur === 'CNY' ? amount : typeof fx === 'number' && fx > 0 ? round4(amount * fx) : null)
  const fxNote =
    cur === 'CNY'
      ? '估算不含缓存/批处理折扣与阶梯价，实际通常不高于此值'
      : `缺少 ${cur}→CNY 汇率，未换算（可在价目表里补 fxToCny.${cur}）`

  // ── 按**音频时长**计价（ASR 类：单位与语言模型不同，不能按 token 算）
  if (typeof entry.perHourAudio === 'number') {
    if (audioHours === null || !Number.isFinite(audioHours)) {
      return {
        known: false,
        currency: cur,
        amount: null,
        amountCny: null,
        basis: `${entry.match} 按音频时长计价（${entry.perHourAudio}/小时），但未提供音频时长`,
        note: 'ASR 需要先知道音频小时数（可由录像时长推出）'
      }
    }
    const amount = round4(audioHours * entry.perHourAudio)
    return {
      known: true,
      currency: cur,
      amount,
      amountCny: toCny(amount),
      basis: `按 ${entry.match}（**音频时长**计价：${entry.perHourAudio} ${cur} / 小时 × ${audioHours.toFixed(2)} 小时）估算`,
      note: fxNote
    }
  }

  if (typeof entry.input !== 'number' || typeof entry.output !== 'number') {
    return {
      known: false,
      currency: cur,
      amount: null,
      amountCny: null,
      basis: `价目表收录了 ${entry.match}，但单价为空`,
      note: entry.note || '请填写单价或使用在线价目'
    }
  }
  const perInput = (inputTokens / 1_000_000) * entry.input
  const perOutput = (outputTokens / 1_000_000) * entry.output
  const amount = round4(perInput + perOutput)
  return {
    known: true,
    currency: cur,
    amount,
    amountCny: toCny(amount),
    basis: `按 ${entry.match}（输入 ${entry.input}/1M、输出 ${entry.output}/1M，币种 ${cur}）估算`,
    note: fxNote
  }
}

/**
 * 预算判定（Q1=a：**超限时警告并由用户决定是否终止**，不硬停）。
 *
 * @param {object} a
 * @param {number} a.spentCny 本场已花（真实值累加）
 * @param {number} a.limitCny 本场上限（默认由调用方给 2）
 * @param {number} a.estimateCny 本次预估（可空：未知模型时为 null）
 * @param {boolean} a.acknowledged 本场是否已确认过超限（每场只问一次）
 */
export function budgetVerdict({ spentCny = 0, limitCny = 2, estimateCny = null, acknowledged = false }) {
  const spent = round4(spentCny)
  const limit = round4(limitCny)
  if (spent >= limit) {
    if (acknowledged) return { state: 'ok', spent, estimate: estimateCny, limit, note: '本场已确认超限，不再打断' }
    return {
      state: 'exceed',
      spent,
      estimate: estimateCny,
      limit,
      overBy: round4(spent - limit),
      options: ['continue', 'abort'],
      message: `本场已花费 ¥${spent.toFixed(2)}，超过上限 ¥${limit.toFixed(2)}（超出 ¥${round4(spent - limit).toFixed(2)}）。是否终止本场任务？`
    }
  }
  if (estimateCny === null) {
    return {
      state: 'ok',
      spent,
      estimate: null,
      limit,
      note: '本次费用未知（模型单价未填）⇒ 无法判断是否会超限'
    }
  }
  const projected = round4(spent + estimateCny)
  if (projected >= limit) {
    if (acknowledged) {
      return { state: 'ok', spent, estimate: estimateCny, limit, note: '本场已确认超限，不再打断' }
    }
    return {
      state: 'exceed',
      spent,
      estimate: estimateCny,
      limit,
      overBy: round4(projected - limit),
      projected,
      options: ['continue', 'abort'],
      message: `本次调用后将花费约 ¥${projected.toFixed(2)}，超过上限 ¥${limit.toFixed(2)}。是否继续？`
    }
  }
  const ratio = projected / limit
  if (ratio >= 0.8) {
    return {
      state: 'warn',
      spent,
      estimate: estimateCny,
      limit,
      projected,
      message: `本次调用后约 ¥${projected.toFixed(2)}，已达上限的 ${Math.round(ratio * 100)}%`
    }
  }
  return { state: 'ok', spent, estimate: estimateCny, limit, projected }
}

/** 用**真实 usage** 累加花费（预算以真实值为准；未知单价 ⇒ 不记金额但记 token）。 */
export function accumulateUsage({ spentCny = 0, table, model, usage }) {
  const inTok = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0
  const outTok = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0
  const cost = estimateCost({ model, table, inputTokens: inTok, outputTokens: outTok })
  const add = cost.amountCny ?? 0
  return { spentCny: round4(spentCny + add), inTok, outTok, costKnown: cost.known, added: add }
}

/* ────────────────────────── 套餐额度（plan）口径 ──────────────────────────
 * 为什么必须单列一套（用户指出的真实问题）：**订阅/套餐用户已经付过钱** ⇒ 对他们而言
 * 边际成本是 0 ⇒ 用"人民币上限"去拦他们是荒谬的。套餐改用**额度百分比**：
 *   · 语言模型：Credits/token（未命中缓存输入、输出、命中缓存输入各不同）；
 *   · ASR：Credits/**音频小时**（与 token 无关 ⇒ 单位不同，必须分开算）。
 * 折算规则由调用方从 providers.js 注入（cost 不依赖注册表，保持可测）。
 */

/**
 * 估算一次调用消耗的套餐额度（Credits）。
 * @param {object} a
 * @param {{input?:number, output?:number, cachedInput?:number, perHourAudio?:number}} a.creditRule
 */
export function estimatePlanCredits({ creditRule, inputTokens = 0, outputTokens = 0, cachedInputTokens = 0, audioHours = null }) {
  if (creditRule === null || typeof creditRule !== 'object') {
    return { known: false, credits: null, basis: '未提供该模型的套餐额度折算规则' }
  }
  if (typeof creditRule.perHourAudio === 'number') {
    if (!Number.isFinite(audioHours) || audioHours === null) {
      return { known: false, credits: null, basis: '该模型按音频时长扣额度，但未提供音频时长' }
    }
    const credits = Math.round(audioHours * creditRule.perHourAudio)
    return {
      known: true,
      credits,
      basis: `按套餐规则 ${creditRule.perHourAudio} Credits/音频小时 × ${audioHours.toFixed(2)} 小时`
    }
  }
  if (typeof creditRule.input !== 'number' || typeof creditRule.output !== 'number') {
    return { known: false, credits: null, basis: '该模型的套餐额度折算规则不完整' }
  }
  const cached = typeof creditRule.cachedInput === 'number' ? creditRule.cachedInput : creditRule.input
  const credits = Math.round(
    cachedInputTokens * cached + Math.max(0, inputTokens - cachedInputTokens) * creditRule.input + outputTokens * creditRule.output
  )
  return {
    known: true,
    credits,
    basis: `按套餐规则（未命中输入 ${creditRule.input}、输出 ${creditRule.output}、命中缓存 ${cached} Credits/token）`
  }
}

/**
 * 套餐额度判定（**百分比口径**，用户 Q1=a：显示"本场预计消耗占比"）。
 * 与人民币口径同样遵守 Q1 的决定：**超限只警告并由用户选择继续或终止**，不硬停。
 *
 * @param {object} a
 * @param {number} a.creditsUsed 本场已消耗额度
 * @param {number} a.quotaTotal 套餐总额度（如 MiMo Lite = 41 亿）
 * @param {number|null} a.creditsNext 本次预计消耗（未知 ⇒ null）
 * @param {number} a.limitPct 上限百分比（默认 100 = 套餐耗尽；可设更保守，如 20）
 * @param {boolean} a.acknowledged 本场是否已确认过
 */
export function planVerdict({ creditsUsed = 0, quotaTotal, creditsNext = null, limitPct = 100, acknowledged = false }) {
  if (!Number.isFinite(quotaTotal) || quotaTotal <= 0) {
    return { state: 'unknown', note: '未填写套餐总额度 ⇒ 无法按百分比判断，请选择套餐档位' }
  }
  const used = Math.max(0, Math.round(creditsUsed))
  const pct = round4((used / quotaTotal) * 100)
  const limitCredits = (Math.max(1, limitPct) / 100) * quotaTotal
  const fmt = (n) => `${(n / 1e8).toFixed(1)} 亿`

  if (used >= limitCredits) {
    if (acknowledged) return { state: 'ok', pct, used, quotaTotal, note: '本场已确认超出套餐上限，不再打断' }
    return {
      state: 'exceed',
      pct,
      used,
      quotaTotal,
      overByPct: round4(pct - limitPct),
      options: ['continue', 'abort'],
      message: `本场已消耗套餐额度约 ${pct.toFixed(2)}%（${fmt(used)} / ${fmt(quotaTotal)}），超过上限 ${limitPct}%。是否终止本场任务？`
    }
  }
  if (creditsNext === null) {
    return { state: 'ok', pct, used, quotaTotal, next: null, note: '本次额度未知（模型规则未填）⇒ 无法判断是否会超限' }
  }
  const projectedPct = round4(((used + creditsNext) / quotaTotal) * 100)
  if (projectedPct >= limitPct) {
    if (acknowledged) return { state: 'ok', pct, used, quotaTotal, next: projectedPct, note: '本场已确认超出套餐上限，不再打断' }
    return {
      state: 'exceed',
      pct,
      used,
      quotaTotal,
      next: projectedPct,
      overByPct: round4(projectedPct - limitPct),
      options: ['continue', 'abort'],
      message: `本次调用后约消耗套餐额度 ${projectedPct.toFixed(2)}%（上限 ${limitPct}%）。是否继续？`
    }
  }
  if (projectedPct >= limitPct * 0.8) {
    return {
      state: 'warn',
      pct,
      used,
      quotaTotal,
      next: projectedPct,
      message: `本次调用后约消耗套餐额度 ${projectedPct.toFixed(2)}%（上限 ${limitPct}%）`
    }
  }
  return { state: 'ok', pct, used, quotaTotal, next: projectedPct }
}
