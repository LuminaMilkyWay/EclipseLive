import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * 控制页"处理"这一条链（用户 Q1=a 先接一条；Q2=a 结果列表；Q3=a 进度 + 取消）。
 *
 * 注入面（与 job.js 同源）：假 FFmpeg 端口 + 假网络门面 + 假凭据 + 临时录像目录
 * ⇒ **不联网、不转码**，但走的是**真实的路由与编排**。
 *
 * 重点守三件事：
 *   ① 任务**异步**（立刻 202 返回，不阻塞 HTTP）；
 *   ② 进度/warning/花费**如实回报**（含"未校准时间轴"这类必须显眼提示的 warning）；
 *   ③ **取消**保留已完成部分并给出续跑起点（不丢工作、不重复花钱）。
 */
const RUNTIME = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/runtime.js')).href
const RUN = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/run-routes.js')).href

type Handler = (req: { method: string; path: string; query: URLSearchParams; body?: unknown }) => Promise<{
  status: number
  body?: Record<string, unknown>
}> | { status: number; body?: Record<string, unknown> }

let createRuntime: (ctx: unknown, cfg: unknown) => Record<string, unknown>
let registerRunRoutes: (ctx: unknown, api: unknown, runtime: unknown) => void
beforeEach(async () => {
  createRuntime = ((await import(RUNTIME)) as { createRuntime: typeof createRuntime }).createRuntime
  registerRunRoutes = ((await import(RUN)) as { registerRunRoutes: typeof registerRunRoutes }).registerRunRoutes
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 组装一个"能真跑"的模块环境（录像目录里放一个假 mp4 + 同名弹幕）。 */
async function rig({ withAsr = false, ready = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vupcut-run-'))
  const recDir = join(root, 'rec')
  const outDir = join(root, 'out')
  await mkdir(recDir, { recursive: true })
  await mkdir(outDir, { recursive: true })
  await writeFile(join(recDir, 's01.mp4'), 'fake')
  const lines: string[] = []
  for (let s = 0; s < 400; s += 1) {
    const burst = s >= 300 && s < 305 ? 10 : 1
    for (let k = 0; k < burst; k += 1) lines.push(JSON.stringify({ time: s, text: `d${s}` }))
  }
  await writeFile(join(recDir, 's01.jsonl'), lines.join('\n'))

  const cfg: Record<string, unknown> = {
    paths: { recordings: recDir, output: outDir, danmaku: recDir, models: '', tmp: root },
    offsetSec: 0,
    bucketMs: 5000,
    model: ready ? 'mimo-v2.6-flash' : '',
    limits: { paygCny: 2, planPct: 20 },
    asr: withAsr ? { model: 'mimo-v2.5-asr', sliceSec: 200, language: 'zh' } : { model: '' },
    score: { chunkSize: 40, overlap: 4, maxClips: 5 },
    export: { mode: 'copy' }
  }

  const handlers = new Map<string, Handler>()
  const secrets = new Map<string, string>()
  if (ready) secrets.set('llm:apiKey', 'sk-test')

  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => logger,
    setLevel() {}
  }

  const ffmpegCalls: string[][] = []
  const ctx: Record<string, unknown> = {
    logger,
    gateway: { registerHttpRoute: (m: string, p: string, h: Handler) => void handlers.set(`${m} ${p}`, h) },
    config: { get: async () => cfg, set: () => ({ ok: true, errors: [] }) },
    credentials: {
      get: (k: string) => secrets.get(k) ?? null,
      set: (k: string, v: string) => void secrets.set(k, v),
      has: (k: string) => secrets.has(k),
      delete: (k: string) => secrets.delete(k),
      list: () => []
    },
    proc: {
      spawn: async () => ({ pid: 1, kill: async () => {}, wait: async () => ({ ok: true, code: 0 }) })
    }
  }

  // 用假 FFmpeg 端口替换掉 ports 里的真实实现（测试不转码）
  const runtime = createRuntime(ctx, cfg) as Record<string, unknown> & { readiness: () => Record<string, boolean> }
  runtime.ffmpeg = {
    run: async (args: string[]) => {
      ffmpegCalls.push(args)
      return { ok: true, code: 0 }
    }
  }
  // 假 LLM：挑本块弹幕最多的 id 回一条
  runtime.callLlm = async ({ user, chunkIndex }: { user: string; chunkIndex: number }) => {
    const pairs = [...user.matchAll(/"id":"([^"]+)","start":[^,]+,"end":[^,]+,"danmaku":(\d+)/g)]
    let best: string | null = null
    let bestN = -1
    for (const m of pairs) {
      if (Number(m[2]) > bestN) {
        bestN = Number(m[2])
        best = m[1]
      }
    }
    return { text: JSON.stringify({ clips: best ? [{ id: best, score: 88, reason: `块${chunkIndex}最优` }] : [] }), usage: { prompt_tokens: 100, completion_tokens: 20 }, model: 'mimo-v2.6-flash' }
  }
  runtime.callAsr = async ({ startSec }: { startSec: number }) => ({
    language: 'zh',
    duration: 200,
    segments: [{ start: 1, end: 3, text: `片${startSec}甲` }]
  })
  runtime.readBinary = async () => new Uint8Array([1, 2, 3])

  const api = {
    prices: { builtin: { currency: 'CNY', models: [{ match: 'mimo*', input: 1, output: 2 }] }, last: () => null, refresh: async () => ({ ok: true, source: 'builtin' }) }
  }
  registerRunRoutes(ctx, api, runtime)

  const call = async (m: string, p: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
    const h = handlers.get(`${m} ${p}`)
    if (!h) throw new Error(`未注册路由 ${m} ${p}`)
    const res = await h({ method: m, path: p, query: new URLSearchParams(), body })
    return { status: res.status, body: (res.body ?? {}) as Record<string, unknown> }
  }
  return { root, recDir, outDir, cfg, handlers, ffmpegCalls, call }
}

describe('控制页"处理"链：会话列表与就绪状态', () => {
  it('① 会话列表列出录像并能找到同名弹幕；未配置目录时给出人话说明', async () => {
    const r = await rig()
    const res = await r.call('GET', '/vupcut/sessions')
    const sessions = res.body.sessions as Array<{ name: string; danmakuPath: string | null }>
    expect(sessions.length, '应找到假录像').toBe(1)
    expect(sessions[0].name).toBe('s01.mp4')
    expect(sessions[0].danmakuPath, '同名弹幕应被关联').toMatch(/s01\.jsonl$/)

    r.cfg.paths = { ...(r.cfg.paths as object), recordings: '' }
    const empty = await r.call('GET', '/vupcut/sessions')
    expect(empty.body.note, '要说明原因').toMatch(/未配置录像目录/)
  })

  it('② 就绪状态逐项如实（缺哪个说哪个）', async () => {
    const r = await rig()
    const res = await r.call('GET', '/vupcut/readiness')
    expect(res.body.llmKey).toBe(true)
    expect(res.body.model).toBe(true)
    expect(res.body.outputDir).toBe(true)
    expect(res.body.asrModel, '未配 ASR 模型 ⇒ 显示 false（界面据此提示"可跳过转写"）').toBe(false)

    const r2 = await rig({ ready: false })
    expect((await r2.call('GET', '/vupcut/readiness')).body.llmKey).toBe(false)
  })
})

describe('控制页"处理"链：跑一场并拿到结果', () => {
  it('③ 启动立刻返回 202（异步）；轮询最终拿到 done + 结果列表（含分数与理由）', async () => {
    const r = await rig()
    const started = await r.call('POST', '/vupcut/run', { session: 's01.mp4' })
    expect(started.status, '异步任务应立刻返回').toBe(202)
    expect(started.body.ok).toBe(true)

    let phase = 'starting'
    for (let i = 0; i < 60 && phase !== 'done' && phase !== 'failed' && phase !== 'cancelled'; i += 1) {
      await sleep(30)
      const job = await r.call('GET', '/vupcut/job')
      phase = String(job.body.phase)
      if (phase === 'done') {
        const clips = job.body.clips as Array<{ id: string; start: number; end: number; score: number | null; reason: string }>
        expect(clips.length, '应有选段').toBeGreaterThan(0)
        expect(clips[0].score, '分数要回给界面').toBe(88)
        expect(clips[0].reason).toMatch(/最优/)
        expect(job.body.error, '成功时不应有 error').toBe(null)
      }
    }
    expect(phase, `任务未完成（phase=${phase}）`).toBe('done')
  })

  it('④ 进度事件覆盖各阶段；未校准时间轴的 warning 必须回报给界面', async () => {
    const r = await rig()
    r.cfg.offsetSec = null // 未校准
    await r.call('POST', '/vupcut/run', { session: 's01.mp4' })
    let job: { body: Record<string, unknown> } = { body: {} }
    for (let i = 0; i < 60; i += 1) {
      await sleep(30)
      job = await r.call('GET', '/vupcut/job')
      if (job.body.running === false) break
    }
    const steps = new Set((job.body.progress as Array<{ step: string }>).map((p) => p.step))
    for (const s of ['danmaku', 'offset', 'windows', 'score', 'export']) {
      expect(steps.has(s), `进度里应有 ${s}`).toBe(true)
    }
    expect(job.body.warning, '未校准必须显眼提示').toMatch(/尚未校准/)
  })

  it('⑤ 未配置输出目录 ⇒ 启动即被拒并说明（不让用户白等）', async () => {
    const r = await rig()
    r.cfg.paths = { ...(r.cfg.paths as object), output: '' }
    const res = await r.call('POST', '/vupcut/run', { session: 's01.mp4' })
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toMatch(/输出目录/)
  })

  it('⑥ 已有任务在跑 ⇒ 409 并说明（本版本一次只跑一场）', async () => {
    const r = await rig()
    await r.call('POST', '/vupcut/run', { session: 's01.mp4' })
    const again = await r.call('POST', '/vupcut/run', { session: 's01.mp4' })
    expect(again.status).toBe(409)
    expect(String(again.body.error)).toMatch(/一次只跑一场/)
  })
})

describe('控制页"处理"链：取消与手动标记', () => {
  it('⑦ 取消 ⇒ 保留已完成部分并给出续跑起点；再取消说"没有在跑的任务"', async () => {
    const r = await rig()
    await r.call('POST', '/vupcut/run', { session: 's01.mp4' })
    const cancelled = await r.call('POST', '/vupcut/job/cancel')
    expect(cancelled.status).toBe(200)
    expect(String(cancelled.body.note)).toMatch(/保留|续跑/)

    let job: { body: Record<string, unknown> } = { body: {} }
    for (let i = 0; i < 80; i += 1) {
      await sleep(30)
      job = await r.call('GET', '/vupcut/job')
      if (job.body.running === false) break
    }
    expect(job.body.cancelled ?? job.body.phase === 'cancelled', '应报告已取消').toBeTruthy()

    const again = await r.call('POST', '/vupcut/job/cancel')
    expect(String(again.body.note)).toMatch(/没有在跑/)
  })

  it('⑧ 手动标记：合法则写入配置，非法则 400 并说明', async () => {
    const r = await rig()
    const bad = await r.call('POST', '/vupcut/mark', { start: 10, end: 5 })
    expect(bad.status).toBe(400)
    expect(String(bad.body.error)).toMatch(/结束必须晚于开始/)

    const ok = await r.call('POST', '/vupcut/mark', { start: 100, end: 110, label: '开场' })
    expect(ok.status).toBe(200)
    expect(ok.body.marks).toBe(1)
  })

  it('⑨ 导出：没有片段时 400；有片段时走 FFmpeg 端口并回报每条结果', async () => {
    const r = await rig()
    const none = await r.call('POST', '/vupcut/export')
    expect(none.status).toBe(400)

    await r.call('POST', '/vupcut/run', { session: 's01.mp4' })
    let job: { body: Record<string, unknown> } = { body: {} }
    for (let i = 0; i < 60; i += 1) {
      await sleep(30)
      job = await r.call('GET', '/vupcut/job')
      if (job.body.running === false) break
    }
    const clips = job.body.clips as Array<{ id: string }>
    expect(clips.length).toBeGreaterThan(0)
    const exp = await r.call('POST', '/vupcut/export', { clips: [clips[0].id] })
    expect(exp.status).toBe(200)
    expect(exp.body.exported, '应导出 1 条').toBe(1)
    expect(r.ffmpegCalls.length, '导出应调用 FFmpeg 端口').toBeGreaterThan(0)
  })
})
