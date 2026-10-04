/**
 * control-routes：VupCut 控制页的**模块侧接口**（页面是模块自带的静态页 ✓ 用户 Q1=a ✓）。
 *
 * 约定（照抄既有模块 T29/T31 的写法，不发明新协议）：
 *   · manifest 里声明 `web: { url: '/vupcut/control', windowMode:'embedded', pinned:true }`
 *     与 `routes`（GET/POST 都要声明）；
 *   · 页面经网关以 `text/html` 提供；页面里的 fetch 走**同一网关的相对路径**并带上 `?token=`。
 *
 * ⚠️ 两条安全纪律：
 *   ① **密钥永不回传页面**：`/vupcut/state` 只回 `keySet: true/false`（连长度都不回）；
 *      密钥只进 `ctx.credentials`（命名空间隔离 ⇒ 模块读不到核心的 OBS 密码，反之亦然）。
 *   ② 写操作只接受**白名单字段**（network.enabled / allowHosts / limits / provider / baseUrl / model），
 *      页面提交的任何其它字段一律忽略 —— 页面被改坏也不会污染配置。
 */

import { readFileSync } from 'node:fs'
import { listProviders } from './providers.js'

/** 允许页面写入的配置字段（其余一律忽略）。 */
const WRITABLE = new Set(['network', 'limits', 'provider', 'model', 'prices', 'export', 'paths', 'asr', 'score'])

/** 读取控制页；缺文件时给一个**可读的降级页**（不抛异常，页面至少能打开并说明原因）。
 *  降级页同样遵守 MODULE_UI_CONTRACT：零颜色字面量、body 透明、只消费宿主注入令牌。 */
function loadControlPage() {
  try {
    return readFileSync(new URL('../pages/control.html', import.meta.url), 'utf8')
  } catch {
    return (
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>VupCutCode</title><style>' +
      'html,body{margin:0;min-height:100vh}body{background:transparent;color:var(--txt-1);padding:var(--sp-5);font:14px/1.5 system-ui}' +
      'section{background:var(--card-bg);border:1px solid var(--mat-border);border-radius:var(--r-lg);padding:var(--sp-4)}' +
      '</style></head><body><section><h1>VupCutCode 控制页缺失</h1>' +
      '<p>模块包内未找到 <code>pages/control.html</code>。请重新安装模块包。</p></section></body></html>'
    )
  }
}

/** 只保留白名单字段（浅拷贝）。 */
function sanitizePatch(body) {
  const out = {}
  if (body === null || typeof body !== 'object') return out
  for (const [k, v] of Object.entries(body)) {
    if (WRITABLE.has(k)) out[k] = v
  }
  return out
}

/** 价目表的**元信息**（绝不回传整表：几百条会撑爆页面，也没必要）。 */
function priceSummary(api) {
  const r = api.prices.last()
  const table = r?.table ?? api.prices.builtin
  const models = Array.isArray(table?.models) ? table.models.length : 0
  const priced = Array.isArray(table?.models)
    ? table.models.filter((m) => typeof m.input === 'number' || typeof m.perHourAudio === 'number').length
    : 0
  return {
    ok: r?.ok ?? true,
    source: r?.source ?? 'builtin',
    asOf: table?.asOf ?? null,
    sourceUrl: table?.sourceUrl ?? null,
    models,
    priced,
    error: r?.error ?? null
  }
}

/**
 * 注册控制页所需的全部路由。
 * @param {object} ctx 模块上下文（需要 gateway / config / credentials / logger）
 * @param {{ prices: { refresh: Function, builtin: object, last: Function } }} api activate() 的返回值
 */
export function registerControlRoutes(ctx, api) {
  const { gateway, config, credentials, logger } = ctx

  gateway.registerHttpRoute('GET', '/vupcut/control', () => ({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: loadControlPage()
  }))

  // 厂商注册表：页面据此渲染选择器与 **billing 三态徽标**（含"订阅不含 API 额度"的警告文案）。
  // 只回页面需要的字段；额度折算规则（creditRules）不出页面（属实现细节）。
  gateway.registerHttpRoute('GET', '/vupcut/providers', () => ({
    status: 200,
    body: {
      providers: listProviders().map((p) => ({
        id: p.id,
        label: p.label,
        billing: p.billing,
        warning: p.warning ?? null,
        baseUrl: p.baseUrl ?? null,
        plans: Array.isArray(p.plans) ? p.plans.map((t) => ({ id: t.id, label: t.label, cnyPerMonth: t.cnyPerMonth, creditsPerMonth: t.creditsPerMonth })) : []
      }))
    }
  }))

  gateway.registerHttpRoute('GET', '/vupcut/state', async () => {    const cfg = (await config.get()) ?? {}
    let keySet = false
    let asrKeySet = false
    try {
      keySet = credentials ? credentials.has('llm:apiKey') === true : false
      asrKeySet = credentials ? credentials.has('asr:apiKey') === true : false
    } catch {
      keySet = false
      asrKeySet = false
    }
    return {
      status: 200,
      body: {
        // ⚠️ 只回"有没有密钥"，绝不回密钥本身。
        key: { set: keySet },
        network: {
          enabled: cfg.network?.enabled === true,
          allowHosts: Array.isArray(cfg.network?.allowHosts) ? cfg.network.allowHosts : [],
          startupDelayMs: Number.isFinite(cfg.network?.startupDelayMs) ? cfg.network.startupDelayMs : 10_000
        },
        provider: cfg.provider ?? null,
        model: cfg.model ?? null,
        limits: {
          paygCny: Number.isFinite(cfg.limits?.paygCny) ? cfg.limits.paygCny : 2,
          planPct: Number.isFinite(cfg.limits?.planPct) ? cfg.limits.planPct : 20
        },
        prices: priceSummary(api),
        // 模型 ID 建议（来自当前价目表；**可搜可填** ⇒ 收录不到的新模型也能用）
        modelSuggestions: (() => {
          const t = api.prices.last()?.table ?? api.prices.builtin
          const list = Array.isArray(t?.models) ? t.models : []
          return list
            .filter((m) => typeof m.match === 'string' && !m.match.includes('*'))
            .map((m) => ({ id: m.match, priced: typeof m.input === 'number' || typeof m.perHourAudio === 'number' }))
            .slice(0, 300)
        })(),
        // ASR 独立配置（默认"与 LLM 相同" ⇒ 页面勾选后才单独填）
        asr: {
          model: cfg.asr?.model ?? '',
          baseUrl: cfg.asr?.baseUrl ?? '',
          path: cfg.asr?.path ?? '',
          language: cfg.asr?.language ?? 'zh',
          sliceSec: Number.isFinite(cfg.asr?.sliceSec) ? cfg.asr.sliceSec : 600,
          keySet: asrKeySet
        },
        // 套餐档（plan 口径必需：额度总量用来算"本场占比"）
        plan: { provider: cfg.plan?.provider ?? null, tier: cfg.plan?.tier ?? null, quotaTotal: cfg.plan?.quotaTotal ?? null },
        // 未收录模型的单价覆盖（每 1M token；用户自填 ⇒ 预算护栏才算得准）
        priceOverride: Array.isArray(cfg.prices?.override) ? cfg.prices.override : [],
        pricingFamilies: Array.isArray(cfg.prices?.families) ? cfg.prices.families : null
      }
    }
  })

  gateway.registerHttpRoute('POST', '/vupcut/config', async (req) => {
    const patch = sanitizePatch(req.body)
    if (Object.keys(patch).length === 0) {
      return { status: 400, body: { ok: false, error: '没有可写入的字段（仅接受白名单字段）' } }
    }
    const current = (await config.get()) ?? {}
    const next = { ...current, ...patch }
    const res = config.set(next)
    logger.info('vupcut config updated', { fields: Object.keys(patch), ok: res?.ok !== false })
    return { status: res?.ok === false ? 400 : 200, body: { ok: res?.ok !== false, fields: Object.keys(patch), errors: res?.errors ?? [] } }
  })

  gateway.registerHttpRoute('POST', '/vupcut/key', async (req) => {
    const secret = typeof req.body?.secret === 'string' ? req.body.secret.trim() : ''
    // 槽位：llm（评分）或 asr（转写可单独用另一家的密钥）。
    const slot = req.body?.slot === 'asr' ? 'asr:apiKey' : 'llm:apiKey'
    if (!credentials || typeof credentials.set !== 'function') {
      return { status: 501, body: { ok: false, error: '凭据服务不可用：为保证密钥不明文落盘，本次不保存' } }
    }
    if (secret === '') {
      credentials.delete(slot)
      return { status: 200, body: { ok: true, set: false, slot } }
    }
    credentials.set(slot, secret)
    // ⚠️ 回执里**不含密钥**，连长度都不含（避免侧信道）。
    logger.info('vupcut api key stored', { slot, provider: (await config.get())?.provider ?? null })
    return { status: 200, body: { ok: true, set: true, slot } }
  })

  gateway.registerHttpRoute('POST', '/vupcut/prices/refresh', async () => {
    const r = await api.prices.refresh('manual')
    // 直接用**本次返回**的来源/成败（不依赖 last() 是否已被更新 ⇒ 更稳健）。
    const summary = priceSummary(api)
    return {
      status: 200,
      body: { ...summary, ok: r.ok === true, source: r.source ?? summary.source, error: r.error ?? summary.error }
    }
  })

  logger.info('vupcut control routes registered', {
    routes: ['GET /vupcut/control', 'GET /vupcut/state', 'POST /vupcut/config', 'POST /vupcut/key', 'POST /vupcut/prices/refresh']
  })
}
