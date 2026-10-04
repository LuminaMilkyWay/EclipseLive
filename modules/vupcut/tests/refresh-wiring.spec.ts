import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ③c-2b 模块侧接线（用户决策：Q1=a 开关放本模块配置、Q3=a 模块自己发起启动刷新）。
 *
 * 三条必须钉住的**红线**：
 *   ① 未开开关 / 核心没给门面 ⇒ **一次网络请求都不发**（默认不联网）；
 *   ② 启动刷新是**后台延迟**且**失败静默**（不阻塞 activate、不抛给调用方）；
 *   ③ 联网真正发生时要走 `ctx.network`（模块永不自行 fetch ⇒ 这里用假门面断言**请求形状**）。
 */
const ENTRY = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/index.js')).href

type Activate = (ctx: unknown) => Promise<{
  mode: { enabled: boolean }
  prices: { refresh: (why?: string) => Promise<{ ok: boolean; source: string; error?: string }>; online: boolean; wantNetwork: boolean; canNetwork: boolean }
}>

let activate: Activate
beforeEach(async () => {
  activate = ((await import(ENTRY)) as { activate: Activate }).activate
})

/** 最小 ctx 桩；network 传入假门面（可注入失败）。 */
function stubCtx(cfg: Record<string, unknown>, opts: { withNetwork?: boolean; fail?: boolean } = {}) {
  const calls: Array<{ url: string; options?: Record<string, unknown> }> = []
  const log = { debug() {}, info() {}, warn() {}, error() {}, child: () => log, setLevel() {} }
  const ctx: Record<string, unknown> = {
    logger: log,
    config: { get: async () => cfg },
    proc: undefined
  }
  if (opts.withNetwork) {
    ctx.network = {
      request: async (url: string, options?: Record<string, unknown>) => {
        calls.push({ url, options })
        if (opts.fail) throw new Error('网络不可达')
        return {
          status: 200,
          headers: {},
          body: {
            data: [{ id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', pricing: { prompt: '0.00000027', completion: '0.0000011' } }]
          }
        }
      },
      diagnostics: () => ({ mode: 'enabled', rejected: 0 })
    }
  }
  return { ctx, calls }
}

describe('③c-2b 联网的两把钥匙（默认不联网）', () => {
  it('① 开关关着（默认）⇒ 即使核心给了门面也**一次请求都不发**', async () => {
    const { ctx, calls } = stubCtx({ network: { enabled: false } }, { withNetwork: true })
    const mod = await activate(ctx)
    expect(mod.prices.wantNetwork).toBe(false)
    expect(mod.prices.canNetwork).toBe(true)
    expect(mod.prices.online, '两把钥匙不齐 ⇒ 不联网').toBe(false)
    const r = await mod.prices.refresh('manual')
    expect(calls, '绝不能偷偷联网').toHaveLength(0)
    expect(r.source, '用内置表').toBe('builtin')
  })

  it('② 没有 network-access 权限（核心未注入门面）⇒ 同样不联网，并**如实说明原因**', async () => {
    const { ctx, calls } = stubCtx({ network: { enabled: true } }, { withNetwork: false })
    const mod = await activate(ctx)
    expect(mod.prices.canNetwork).toBe(false)
    expect(mod.prices.online).toBe(false)
    const r = await mod.prices.refresh('manual')
    expect(calls).toHaveLength(0)
    expect(r.source).toBe('builtin')
    expect(r.error, '要告诉用户为什么没联网').toMatch(/未获核心授权|network-access/)
  })

  it('③ 两把钥匙齐 ⇒ 走门面拉取，且用 **GET**（不发送请求体）', async () => {
    const { ctx, calls } = stubCtx({ network: { enabled: true, startupDelayMs: -1 } }, { withNetwork: true })
    const mod = await activate(ctx)
    expect(mod.prices.online).toBe(true)
    const r = await mod.prices.refresh('manual')
    expect(r.source, '成功 ⇒ online').toBe('online')
    expect(calls).toHaveLength(1)
    expect(calls[0].url, '默认数据源').toContain('openrouter.ai/api/v1/models')
    expect(calls[0].options?.method, '只读请求用 GET').toBe('GET')
  })
})

describe('③c-2b 启动刷新：后台、延迟、失败静默', () => {
  it('④ 启动刷新是**延迟后台**执行，且失败**不抛出**（不阻塞 activate）', async () => {
    const { ctx, calls } = stubCtx({ network: { enabled: true, startupDelayMs: 0 } }, { withNetwork: true, fail: true })
    const mod = await activate(ctx)
    expect(mod, 'activate 不得因为网络问题失败').toBeTruthy()
    // 让 0ms 的定时器跑完
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.length, '启动后应尝试过一次').toBeGreaterThan(0)
    const last = mod.prices as unknown as { last: () => { ok: boolean; source: string } | null }
    expect(last.last()?.ok, '失败要如实记录').toBe(false)
    expect(last.last()?.source, '失败回退内置').toBe('builtin')
  })

  it('⑤ 默认延迟 10 秒（用户要求"每次启动联网刷新"，但不能抢启动资源）', async () => {
    const { ctx, calls } = stubCtx({ network: { enabled: true } }, { withNetwork: true })
    const mod = await activate(ctx)
    await new Promise((r) => setTimeout(r, 30))
    expect(calls, '默认 10 秒内不应发起（避免抢启动资源）').toHaveLength(0)
    expect(mod.prices.last(), '尚未刷新过').toBe(null)
  })

  it('⑥ 未联网时**不排定时器**（省电、也避免无意义唤醒）', async () => {
    const { ctx, calls } = stubCtx({ network: { enabled: false, startupDelayMs: 0 } }, { withNetwork: true })
    await activate(ctx)
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toHaveLength(0)
  })
})

describe('③c-2b 缓存目录与用户覆盖', () => {
  it('⑦ 配置了 tmp 路径 ⇒ 在线结果写入 last-good 缓存（供下次离线使用）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vupcut-act-'))
    const { ctx } = stubCtx({ network: { enabled: true, startupDelayMs: -1 }, paths: { tmp: dir } }, { withNetwork: true })
    const mod = await activate(ctx)
    const r = await mod.prices.refresh('manual')
    expect(r.ok).toBe(true)
    const { readFileSync } = await import('node:fs')
    const cached = JSON.parse(readFileSync(join(dir, 'prices.online.json'), 'utf8')) as { models: unknown[] }
    expect(cached.models.length, '应写入缓存').toBeGreaterThan(0)
  })
})
