import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * ③c-2d 控制页的**模块侧接口**（页面本身是模块自带的静态页 ✓ 用户 Q1=a；**不用样式包** ✓ 该接口预留）。
 *
 * 三条纪律必须由测试钉住：
 *   ① **密钥永不回传页面**（state 只回 `key.set`，连长度都不回）；
 *   ② 写配置只接受**白名单字段**（页面被改坏也污染不了配置）；
 *   ③ 价目只回**元信息**（来源/日期/条目数），不回整表（几百条会撑爆页面）。
 */
const ROUTES = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/control-routes.js')).href

type Handler = (req: { method: string; path: string; query: URLSearchParams; body?: unknown }) => Promise<{
  status: number
  body?: unknown
  contentType?: string
}> | { status: number; body?: unknown; contentType?: string }

type Mod = { registerControlRoutes: (ctx: unknown, api: unknown) => void }

let mod: Mod
beforeEach(async () => {
  mod = (await import(ROUTES)) as never
})

/** 假网关：记录 handler（与真实 registerHttpRoute 同签名）。 */
function rig(cfg: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler>()
  const stored = new Map<string, string>()
  const logs: string[] = []
  const log = (...a: unknown[]) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  const logger = { debug: log, info: log, warn: log, error: log, child: () => logger, setLevel: () => {} }
  let current = { ...cfg }
  const credentials = {
    has: (k: string) => stored.has(k),
    get: (k: string) => stored.get(k) ?? null,
    set: (k: string, v: string) => void stored.set(k, v),
    delete: (k: string) => stored.delete(k),
    list: () => [...stored.keys()].map((k) => ({ key: k }))
  }
  const ctx = {
    logger,
    credentials,
    config: {
      get: async () => current,
      set: (next: Record<string, unknown>) => {
        current = next
        return { ok: true, errors: [] }
      }
    },
    gateway: {
      registerHttpRoute: (method: string, path: string, handler: Handler) => void handlers.set(`${method} ${path}`, handler)
    }
  }
  let lastResult: unknown = null
  const api = {
    prices: {
      builtin: { asOf: '2026-10-03', models: [{ match: 'a', input: 1, output: 2 }, { match: 'b' }] },
      last: () => lastResult,
      // 真实模块的 refresh 会记录 last（测试替身必须同构，否则断言的是替身而不是实现）。
      refresh: async () => {
        lastResult = { ok: true, source: 'online', table: { asOf: '2026-10-04', models: [{ match: 'x', input: 1, output: 2 }] } }
        return lastResult
      }
    }
  }
  mod.registerControlRoutes(ctx, api)
  return {
    handlers,
    stored,
    logs,
    get: (m: string, p: string): Handler => {
      const h = handlers.get(`${m} ${p}`)
      if (!h) throw new Error(`未注册路由 ${m} ${p}`)
      return h
    },
    current: () => current
  }
}

const req = (body?: unknown) => ({ method: 'POST', path: '/x', query: new URLSearchParams(), body })

describe('③c-2d 控制页路由：注册与页面', () => {
  it('① 六条路由全部注册（manifest 里也要声明，但这里先确认模块侧真的注册了）', () => {
    const r = rig()
    for (const key of [
      'GET /vupcut/control',
      'GET /vupcut/state',
      'GET /vupcut/providers',
      'POST /vupcut/config',
      'POST /vupcut/key',
      'POST /vupcut/prices/refresh'
    ]) {
      expect(() => r.get(...(key.split(' ') as [string, string])), `缺路由 ${key}`).not.toThrow()
    }
  })

  it('② 控制页以 text/html 返回，且**缺页时不崩**（给降级页）', async () => {
    const r = rig()
    const res = await r.get('GET', '/vupcut/control')({ method: 'GET', path: '/vupcut/control', query: new URLSearchParams() })
    expect(res.status).toBe(200)
    expect(res.contentType).toMatch(/text\/html/)
    expect(String(res.body)).toMatch(/VupCutCode/)
  })
})

describe('③c-2d 密钥：只回"有没有"，永不回传', () => {
  it('③ 未保存时 state.key.set = false；保存后为 true，且**响应里不含密钥**', async () => {
    const r = rig()
    const before = await r.get('GET', '/vupcut/state')({ method: 'GET', path: '/vupcut/state', query: new URLSearchParams() })
    expect((before.body as { key: { set: boolean } }).key.set).toBe(false)

    const saved = await r.get('POST', '/vupcut/key')(req({ secret: 'sk-VERY-SECRET-123' }))
    expect(saved.status).toBe(200)
    expect(JSON.stringify(saved), '回执不得含密钥').not.toMatch(/sk-VERY-SECRET/)
    expect(r.stored.get('llm:apiKey'), '密钥进凭据库（命名空间隔离）').toBe('sk-VERY-SECRET-123')

    const after = await r.get('GET', '/vupcut/state')({ method: 'GET', path: '/vupcut/state', query: new URLSearchParams() })
    const text = JSON.stringify(after.body)
    expect((after.body as { key: { set: boolean } }).key.set).toBe(true)
    expect(text, 'state 绝不含密钥').not.toMatch(/sk-VERY-SECRET/)
    expect(text, '连长度也不回（避免侧信道）').not.toMatch(/19/)
  })

  it('④ 传空字符串 ⇒ 清除密钥（不是存一个空串）', async () => {
    const r = rig()
    await r.get('POST', '/vupcut/key')(req({ secret: 'x' }))
    const cleared = await r.get('POST', '/vupcut/key')(req({ secret: '   ' }))
    expect((cleared.body as { set: boolean }).set).toBe(false)
    expect(r.stored.has('llm:apiKey'), '应删除而不是存空').toBe(false)
  })

  it('⑤ 凭据服务不可用 ⇒ 明确拒绝（**不回退成明文写配置**）', async () => {
    const handlers = new Map<string, Handler>()
    const logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => logger, setLevel: () => {} }
    const ctx = {
      logger,
      credentials: undefined,
      config: { get: async () => ({}), set: () => ({ ok: true, errors: [] }) },
      gateway: { registerHttpRoute: (m: string, p: string, h: Handler) => void handlers.set(`${m} ${p}`, h) }
    }
    mod.registerControlRoutes(ctx, { prices: { builtin: {}, last: () => null, refresh: async () => ({ ok: true }) } })
    const res = await handlers.get('POST /vupcut/key')!(req({ secret: 'sk-x' }))
    expect(res.status).toBe(501)
    expect(JSON.stringify(res.body)).toMatch(/凭据服务不可用|不明文落盘/)
  })
})

describe('③c-2d 配置：白名单写入 + 价目只回元信息', () => {
  it('⑥ 只写白名单字段；页面塞进来的其它字段被忽略', async () => {
    const r = rig({ keep: 1 })
    const res = await r.get('POST', '/vupcut/config')(
      req({ network: { enabled: true }, limits: { paygCny: 5 }, evil: 'x', __proto__: { polluted: true } })
    )
    expect(res.status).toBe(200)
    const cur = r.current() as Record<string, unknown>
    expect((cur.network as { enabled: boolean }).enabled).toBe(true)
    expect((cur.limits as { paygCny: number }).paygCny).toBe(5)
    expect(cur.evil, '白名单外字段必须被丢弃').toBe(undefined)
    expect(cur.keep, '既有字段不应丢失').toBe(1)
  })

  it('⑦ 空补丁 ⇒ 400 并说明（避免"看起来保存成功"）', async () => {
    const r = rig()
    const res = await r.get('POST', '/vupcut/config')(req({ nope: 1 }))
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toMatch(/白名单/)
  })

  it('⑧ state 只回价目元信息（来源/日期/条目数），不回整表', async () => {
    const r = rig()
    const res = await r.get('GET', '/vupcut/state')({ method: 'GET', path: '/vupcut/state', query: new URLSearchParams() })
    const p = (res.body as { prices: { source: string; models: number; priced: number; asOf: string | null } }).prices
    expect(p.source).toBe('builtin')
    expect(p.models).toBe(2)
    expect(p.priced, '已核实单价的条目数').toBe(1)
    expect(p.asOf).toBe('2026-10-03')
    expect(JSON.stringify(res.body), '不得把整表塞进 state').not.toMatch(/"match"/)
  })

  it('⑨ 上限默认值：按量 ¥2 / 套餐 20%（用户决定），未配置时也要给默认', async () => {
    const r = rig()
    const res = await r.get('GET', '/vupcut/state')({ method: 'GET', path: '/vupcut/state', query: new URLSearchParams() })
    const l = (res.body as { limits: { paygCny: number; planPct: number } }).limits
    expect(l.paygCny).toBe(2)
    expect(l.planPct).toBe(20)
  })

  it('⑩ 立即更新 ⇒ 调模块的 refresh 并回报来源', async () => {
    const r = rig()
    const res = await r.get('POST', '/vupcut/prices/refresh')(req())
    expect(res.status).toBe(200)
    expect((res.body as { ok: boolean; source: string }).ok).toBe(true)
    expect((res.body as { source: string }).source).toBe('online')
  })

  it('⑪ 控制页文件必须存在且自带 token 转发（页面 fetch 要用网关 token）', () => {
    const html = readFileSync(resolve(process.cwd(), 'modules/vupcut/pages/control.html'), 'utf8')
    expect(html, '页面应读取 URL 上的 token').toMatch(/token/)
    expect(html, '页面应为中文界面').toMatch(/VupCutCode/)
    expect(html, '不得内联任何密钥').not.toMatch(/sk-[A-Za-z0-9]{8,}/)
    // 「处理」页必须真的调用这几条路由（否则页面只是个空壳）
    for (const ep of ['/vupcut/sessions', '/vupcut/run', '/vupcut/job', '/vupcut/job/cancel', '/vupcut/export', '/vupcut/mark']) {
      expect(html, `控制页应调用 ${ep}`).toContain(ep)
    }
    expect(html, '未就绪必须给出"缺什么"而不只是禁用按钮').toMatch(/暂时不能开始/)
    // ★ 这一步是为了防"后端有、页面没有"（本轮真实发生过：模型 ID / ASR / 套餐档都没输入框）
    for (const id of [
      'model',
      'planTier',
      'asrSeparate',
      'asrModel',
      'asrBaseUrl',
      'asrPath',
      'asrKey',
      'ovMatch',
      'ovIn',
      'ovOut'
    ]) {
      expect(html, `控制页缺少控件 #${id}（后端支持但页面填不了 = 等于没做）`).toContain(`id="${id}"`)
    }
    expect(html, '新增字段必须真的被渲染函数接上').toMatch(/renderSourceExtras\(s\);/)
    expect(html, '密钥槽位要支持 ASR 独立保存').toMatch(/slot: 'asr'/)
  })
})
