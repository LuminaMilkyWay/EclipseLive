import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ④ 评分编排（用户决策：Q1=a 按时间分块**带重叠**／Q2=a 取消**保留已完成块 + 可续跑**／
 * Q3=a 429/5xx/超时**退避重试**、401/403 **立即失败**）。
 *
 * 这组测试守的是"不重复花钱"与"不丢工作"两件对用户最实在的事：
 *   · 续跑只调用剩下的块（断言调用次数 ✓）；
 *   · 取消后已完成的选段仍在（断言 clips 非空 ✓）并给出 resumeFrom ✓；
 *   · 单块彻底失败**不放弃整场**（其它块的结果仍可用 ✓）。
 * 全部依赖注入（call/sleep/random/confirm）⇒ 无网络、无真实等待、结果确定性。
 */
const PIPE = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/pipeline.js')).href

type Pipe = {
  DEFAULTS: Record<string, number>
  chunkWindows: (w: unknown[], o?: Record<string, unknown>) => Array<{ index: number; start: number; end: number; ids: string[] }>
  isRetryable: (e: unknown) => boolean
  backoffDelay: (n: number, o?: Record<string, unknown>) => number
  dedupeClips: (c: unknown[]) => { clips: Array<{ id: string; score?: number }>; dupes: unknown[] }
  runScoring: (a: Record<string, unknown>) => Promise<{
    ok: boolean
    cancelled: boolean
    abortedByBudget?: boolean
    resumeFrom: number | null
    clips: Array<{ id: string; start: number; end: number }>
    dropped: Array<{ id: string; why: string }>
    chunks: Array<{ index: number; ok: boolean; clips: number; attempts?: number }>
    spentCny: number
    creditsUsed: number
    doneChunks: number
    lastError: { message: string } | null
  }>
}

let pipe: Pipe
beforeEach(async () => {
  pipe = (await import(PIPE)) as never
})

/** 造 n 个窗口（id 稳定，密度递增）。 */
const mkWindows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `w${String(i).padStart(4, '0')}`, start: i * 5, end: i * 5 + 5, danmaku: i % 7, density: (i % 7) + 0.5, chars: 0, excerpt: '' }))

/** 假模型：每块回它**第一个**窗口（便于断言"块被调用过"）。 */
const makeCall = (behavior?: { failStatus?: number[]; body?: (i: number) => unknown }) => {
  const seen: number[] = []
  const call = vi.fn(async ({ user, chunkIndex }: { user: string; chunkIndex: number }) => {
    seen.push(chunkIndex)
    const st = behavior?.failStatus?.[0]
    if (st !== undefined) {
      behavior!.failStatus = behavior!.failStatus!.slice(1)
      const e = new Error(`HTTP ${st}`) as Error & { status: number }
      e.status = st
      throw e
    }
    const ids = [...user.matchAll(/"id":"(w\d+)"/g)].map((m) => m[1])
    const payload = behavior?.body ? behavior.body(chunkIndex) : { clips: [{ id: ids[0], score: 90, reason: `块${chunkIndex}` }] }
    return { text: JSON.stringify(payload), usage: { prompt_tokens: 1000, completion_tokens: 200 }, model: 'mimo-v2.6-flash' }
  })
  return { call, seen }
}

const sleepNoop = async (): Promise<void> => {}

describe('④ 分块：按时间切且**带重叠**（Q1=a）', () => {
  it('① 40 个窗口 / 每块 20 / 重叠 4 ⇒ 切缝处有重叠，覆盖完整', () => {
    const w = mkWindows(40)
    const chunks = pipe.chunkWindows(w, { chunkSize: 20, overlap: 4 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].ids.length).toBe(20)
    const first = new Set(chunks[0].ids)
    const overlapIds = chunks[1].ids.filter((id) => first.has(id))
    expect(overlapIds.length, '相邻块必须有重叠（否则高光会被切缝切断）').toBe(4)
    // 覆盖：所有窗口至少出现在某块里
    const all = new Set(chunks.flatMap((c) => c.ids))
    expect(all.size).toBe(40)
  })

  it('② 空输入 ⇒ 零块（不抛）', () => {
    expect(pipe.chunkWindows([])).toEqual([])
    expect(pipe.chunkWindows(null as unknown as unknown[])).toEqual([])
  })
})

describe('④ 重试判定（Q3=a：可重试的才重试）', () => {
  it('③ 429/5xx/超时 ⇒ 可重试；401/403/400 ⇒ 不可重试（密钥错重试也是白等）', () => {
    expect(pipe.isRetryable({ status: 429 })).toBe(true)
    expect(pipe.isRetryable({ status: 503 })).toBe(true)
    expect(pipe.isRetryable('请求超时（60000 ms）')).toBe(true)
    expect(pipe.isRetryable({ status: 401 })).toBe(false)
    expect(pipe.isRetryable({ status: 403 })).toBe(false)
    expect(pipe.isRetryable({ status: 400 })).toBe(false)
    expect(pipe.isRetryable('HTTP 401 未授权')).toBe(false)
    expect(pipe.isRetryable('invalid api key')).toBe(false)
  })

  it('④ 退避是指数级且有抖动（注入固定 random ⇒ 结果确定）', () => {
    const fixed = { random: () => 1, baseDelayMs: 100, maxDelayMs: 10_000 }
    expect(pipe.backoffDelay(1, fixed)).toBe(100)
    expect(pipe.backoffDelay(2, fixed)).toBe(200)
    expect(pipe.backoffDelay(3, fixed)).toBe(400)
    expect(pipe.backoffDelay(99, fixed), '不得超过上限').toBe(10_000)
    const half = { random: () => 0, baseDelayMs: 100, maxDelayMs: 10_000 }
    expect(pipe.backoffDelay(1, half), '抖动下限 50%').toBe(50)
  })
})

describe('④ 去重：跨块重复选中只留一条', () => {
  it('⑤ 同 id 只保留一条，分数取更高者，并记录去重原因', () => {
    const { clips, dupes } = pipe.dedupeClips([
      { id: 'a', score: 70, reason: '短' },
      { id: 'a', score: 95, reason: '更长的理由说明' },
      { id: 'b', score: 60, reason: 'x' }
    ])
    expect(clips.map((c) => c.id).sort()).toEqual(['a', 'b'])
    expect(clips.find((c) => c.id === 'a')?.score).toBe(95)
    expect(dupes).toHaveLength(1)
  })
})

describe('④ 取消与续跑（Q2=a：保留已完成 → 下次不重复花钱）', () => {
  it('⑥ 取消后**保留**已完成块的选段，并给出续跑起点', async () => {
    const windows = mkWindows(60)
    const signal = { aborted: false }
    const { call, seen } = makeCall()
    const r = await pipe.runScoring({
      windows,
      call,
      sleep: sleepNoop,
      signal,
      opts: { chunkSize: 20, overlap: 0 },
      onProgress: (p: { chunkIndex: number }) => {
        if (p.chunkIndex === 0) signal.aborted = true // 跑完第一块后用户点取消
      }
    })
    expect(r.cancelled, '应报告已取消').toBe(true)
    expect(r.clips.length, '第一块的成果必须保留（不能白花钱）').toBeGreaterThan(0)
    expect(r.resumeFrom, '必须给出续跑起点').toBe(1)
    expect(seen).toEqual([0])
  })

  it('⑦ 续跑：跳过已完成块 ⇒ **只调用剩下的块**（这是"不重复花钱"的硬承诺）', async () => {
    const windows = mkWindows(60)
    const { call, seen } = makeCall()
    const r = await pipe.runScoring({
      windows,
      call,
      sleep: sleepNoop,
      fromChunk: 1,
      priorClips: [{ id: 'w0000', start: 0, end: 5, score: 99, reason: '上一轮选的' }],
      opts: { chunkSize: 20, overlap: 0 }
    })
    expect(seen, '不得重新调用第 0 块').toEqual([1, 2])
    expect(r.clips.some((c) => c.id === 'w0000'), '上一轮的结果要保留').toBe(true)
  })

  it('⑧ 单块彻底失败 ⇒ **不放弃整场**（其它块照常出结果，并记明是哪块失败）', async () => {
    const windows = mkWindows(40)
    // 第 0 块连续 401 ⇒ 立即失败（不重试）；第 1 块正常
    const calls: number[] = []
    const call = vi.fn(async ({ chunkIndex }: { chunkIndex: number }) => {
      calls.push(chunkIndex)
      if (chunkIndex === 0) {
        const e = new Error('HTTP 401 unauthorized') as Error & { status: number }
        e.status = 401
        throw e
      }
      return { text: JSON.stringify({ clips: [{ id: 'w0025', score: 80, reason: '好' }] }), usage: { prompt_tokens: 10, completion_tokens: 5 } }
    })
    const r = await pipe.runScoring({ windows, call, sleep: sleepNoop, opts: { chunkSize: 20, overlap: 0, maxRetries: 3 } })
    expect(calls.filter((c) => c === 0), '401 ⇒ 不得重试').toHaveLength(1)
    expect(r.chunks.find((c) => c.index === 0)?.ok).toBe(false)
    expect(r.clips.length, '另一块的结果仍应可用').toBeGreaterThan(0)
    expect(r.doneChunks).toBe(1)
  })

  it('⑨ 429 ⇒ 退避重试后成功（attempts 记录在块报告里）', async () => {
    const windows = mkWindows(20)
    const { call } = makeCall({ failStatus: [429, 429] })
    const sleeps: number[] = []
    const r = await pipe.runScoring({
      windows,
      call,
      sleep: async (ms: number) => void sleeps.push(ms),
      random: () => 1,
      opts: { chunkSize: 20, overlap: 0, baseDelayMs: 100 }
    })
    expect(r.ok).toBe(true)
    expect(r.chunks[0].attempts, '第 3 次成功').toBe(3)
    expect(sleeps, '两次退避：100ms、200ms').toEqual([100, 200])
  })
})

describe('④ 预算：超限**问用户**，用户选终止则停下但保留成果', () => {
  it('⑩ 超限 ⇒ confirm 被调用；选 abort ⇒ 停止且保留已完成结果', async () => {
    const windows = mkWindows(60)
    const { call, seen } = makeCall()
    const confirm = vi.fn(async () => 'abort' as const)
    const r = await pipe.runScoring({
      windows,
      call,
      sleep: sleepNoop,
      confirm,
      budget: { table: { currency: 'CNY', models: [{ match: 'm', input: 0, output: 0 }] }, model: 'm', limitCny: 0, spentCny: 0 },
      opts: { chunkSize: 20, overlap: 0 }
    })
    expect(confirm, '超限必须问用户（不是硬停）').toHaveBeenCalled()
    expect(r.abortedByBudget).toBe(true)
    expect(r.resumeFrom, '给出续跑起点').toBe(0)
    expect(seen, '用户终止后不得再调用').toHaveLength(0)
  })

  it('⑪ 套餐口径：按额度百分比提示，且确认后不再反复打断', async () => {
    const windows = mkWindows(40)
    const { call } = makeCall()
    const confirm = vi.fn(async () => 'continue' as const)
    const r = await pipe.runScoring({
      windows,
      call,
      sleep: sleepNoop,
      confirm,
      budget: { quotaTotal: 1_000_000, limitPct: 1, creditRule: { input: 300, output: 600 }, creditsUsed: 0 },
      opts: { chunkSize: 20, overlap: 0 }
    })
    expect(confirm.mock.calls.length, '确认一次后不再打断（acknowledged）').toBe(1)
    expect(r.creditsUsed, '真实 usage 折算的额度要累加').toBeGreaterThan(0)
    expect(r.ok).toBe(true)
  })

  it('⑫ 手动标记恒优先（编排层与 marks.js 的语义一致）', async () => {
    const windows = mkWindows(20)
    const { call } = makeCall()
    const r = await pipe.runScoring({
      windows,
      call,
      sleep: sleepNoop,
      manualMarks: [{ id: 'm1', start: 100, end: 110 }],
      opts: { chunkSize: 20, overlap: 0, maxClips: 2 }
    })
    expect(r.clips.some((c) => c.id === 'm1'), '手动标记必须保留').toBe(true)
    expect(r.manualCount).toBe(1)
  })
})
