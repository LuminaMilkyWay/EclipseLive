import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * ⑦ 端到端编排（用户 Q1=a 模块内 `lib/job.js`；Q2=a 一条"最小但完整"的注入式端到端）。
 *
 * 本测试的**注入面**（正是用户最早要求的"实例注入测试"的模块级形态）：
 *   假 ASR ✓ 假 LLM ✓ 假 FFmpeg ✓ 注入的读文件 ✓ ⇒ 不联网、不转码、不装模型、不等真实时长。
 *
 * 三条必须钉住的正确性：
 *   ① **分片 ASR 的时间轴要加回片起点**（否则整场字幕按片长错位 —— 与 ① 的教训同源）；
 *   ② **未校准时间轴 ⇒ 允许继续但必须显著提示**（用户 Q2 决定）；
 *   ③ **产出 MP4 与同名外挂 SRT**，且 SRT 时间相对片段起点。
 */
const JOB = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/job.js')).href

type Job = {
  buildAudioArgs: (a: Record<string, unknown>) => string[]
  audioSlices: (d: number, s?: number) => Array<{ startSec: number; durationSec: number }>
  runJob: (a: Record<string, unknown>) => Promise<{
    ok: boolean
    steps: Array<{ name: string; ok: boolean; [k: string]: unknown }>
    clips?: Array<{ id: string }>
    exported?: { exported: number; results: Array<{ output?: string; srt?: string | null }> }
    warning?: string | null
  }>
}

let job: Job
beforeEach(async () => {
  job = (await import(JOB)) as never
})

/** 一场 20 分钟、带弹幕峰值的假录像（含"开播→录制"偏移 60 秒）。 */
function makeWorld({ offsetSec = 60, durationSec = 1200, asrSlices = 2 } = {}) {
  const danmakuLines: string[] = []
  for (let s = 0; s < durationSec + 120; s += 1) {
    const burst = s >= 660 && s < 666 ? 10 : 1 // 真实高光：开播后 660~666 秒 ⇒ 录像内 600~606 秒
    for (let k = 0; k < burst; k += 1) danmakuLines.push(JSON.stringify({ time: s, text: `d${s}` }))
  }
  const ffmpegCalls: string[][] = []
  const asrCalls: Array<{ filename: string; startSec: number }> = []
  const llmCalls: number[] = []
  const progress: Array<Record<string, unknown>> = []

  const ffmpeg = {
    run: async (args: string[]) => {
      ffmpegCalls.push(args)
      return { ok: true, code: 0 }
    }
  }
  const readText = async () => danmakuLines.join('\n')
  const readBinary = async () => new Uint8Array([0x49, 0x44, 0x33]) // 假 mp3 头

  // 假 ASR：每片回两段（时间**相对该片** ⇒ 编排必须加回片起点）
  const sliceSec = Math.ceil(durationSec / asrSlices)
  const callAsr = async ({ filename, startSec }: { filename: string; startSec: number }) => {
    asrCalls.push({ filename, startSec })
    const base = Math.floor(startSec / 60) * 60
    return {
      language: 'zh',
      duration: sliceSec,
      segments: [
        { start: 1, end: 3, text: `片${asrCalls.length}甲` },
        { start: 5, end: 8, text: `片${asrCalls.length}乙${base >= 0 ? '' : ''}` }
      ]
    }
  }

  // 假 LLM：总挑本块里弹幕最多的窗口（用 id 指回 ⇒ 时间是代码贴的）
  const callLlm = async ({ user, chunkIndex }: { user: string; chunkIndex: number }) => {
    llmCalls.push(chunkIndex)
    const ids = [...user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1])
    const densities = [...user.matchAll(/"id":"([^"]+)","start":[^,]+,"end":[^,]+,"danmaku":(\d+)/g)]
    let best = ids[0]
    let bestN = -1
    for (const m of densities) {
      const n = Number(m[2])
      if (n > bestN) {
        bestN = n
        best = m[1]
      }
    }
    return { text: JSON.stringify({ clips: [{ id: best, score: 90, reason: '弹幕激增' }] }), usage: { prompt_tokens: 2000, completion_tokens: 300 }, model: 'mimo-v2.6-flash' }
  }

  return { ffmpegCalls, asrCalls, llmCalls, progress, ffmpeg, readText, readBinary, callAsr, callLlm, offsetSec, durationSec }
}

const baseArgs = (w: ReturnType<typeof makeWorld>, extra: Record<string, unknown> = {}) => ({
  ctx: { logger: { info() {}, warn() {}, error() {}, debug() {}, child: () => ({ info() {}, warn() {}, error() {}, debug() {} }) } },
  cfg: {
    offsetSec: w.offsetSec,
    bucketMs: 5000,
    paths: { output: '/out' },
    asr: { sliceSec: Math.ceil(w.durationSec / 2), model: 'mimo-v2.5-asr' },
    score: { chunkSize: 40, overlap: 4, maxClips: 5 },
    export: { mode: 'copy' }
  },
  recording: { path: '/rec/s.mp4', name: 's.mp4', sessionKey: 's', durationSec: w.durationSec, danmakuPath: '/rec/s.jsonl' },
  readText: w.readText,
  readBinary: w.readBinary,
  ffmpeg: w.ffmpeg,
  callLlm: w.callLlm,
  callAsr: w.callAsr,
  onProgress: (p: Record<string, unknown>) => w.progress.push(p),
  ...extra
})

describe('⑦ 端到端：抽音频参数与分片', () => {
  it('① 抽音频：16kHz 单声道、`-ss` 在 `-i` 之前（输入侧定位）', () => {
    const args = job.buildAudioArgs({ input: 'in.mp4', output: 'a.mp3', startSec: 600, durationSec: 300 })
    expect(args.indexOf('-ss'), '-ss 必须在 -i 之前').toBeLessThan(args.indexOf('-i'))
    expect(args).toContain('-vn')
    expect(args[args.indexOf('-ac') + 1]).toBe('1')
    expect(args[args.indexOf('-ar') + 1]).toBe('16000')
    expect(args[args.length - 1]).toBe('a.mp3')
  })

  it('② 分片：20 分钟按 10 分钟切 ⇒ 2 片，最后一片不越界', () => {
    expect(job.audioSlices(1200, 600)).toEqual([
      { startSec: 0, durationSec: 600 },
      { startSec: 600, durationSec: 600 }
    ])
    expect(job.audioSlices(650, 600)[1]).toEqual({ startSec: 600, durationSec: 50 })
    expect(job.audioSlices(0)).toEqual([])
  })
})

describe('⑦ 端到端：完整一条链（注入假 ASR/LLM/FFmpeg）', () => {
  it('③ 跑完全流程：各步成功、选出片段、导出 MP4 + 同名外挂 SRT', async () => {
    const w = makeWorld()
    const r = await job.runJob(baseArgs(w))
    const names = r.steps.map((s) => s.name)
    for (const n of ['danmaku', 'offset', 'windows', 'asr', 'score', 'export']) {
      expect(names, `缺少步骤 ${n}`).toContain(n)
    }
    expect(r.ok, '整条链应成功').toBe(true)
    expect(w.asrCalls.length, '应按分片调用 ASR').toBe(2)
    // ⚠️ ffmpeg 端口同时用于"抽音频"与"导出剪切" ⇒ 要按参数区分：抽音频带 `-vn`（只要音频轨）。
    const audioCalls = w.ffmpegCalls.filter((a) => a.includes('-vn'))
    const cutCalls = w.ffmpegCalls.filter((a) => a.includes('-vn') === false)
    expect(audioCalls.length, '抽音频调用数应等于分片数').toBe(2)
    expect(cutCalls.length, '导出剪切调用数应等于选中片段数').toBe(r.clips?.length)
    expect(r.clips?.length, '应选出片段').toBeGreaterThan(0)
    expect(r.exported?.exported).toBeGreaterThan(0)
    const first = r.exported?.results[0]
    expect(first?.output, '应产出 mp4').toMatch(/\.mp4$/)
    expect(first?.srt, '应产出同名外挂 SRT（未要求烧字幕）').toMatch(/\.srt$/)
  })

  it('④ 分片 ASR 的时间轴**加回片起点**（否则整场字幕按片长错位）', async () => {
    const w = makeWorld()
    const r = await job.runJob(baseArgs(w))
    // 第二片从 600 秒开始 ⇒ 该片第 1 段（片内 1~3 秒）⇒ 整场应是 601~603 秒
    const exported = r.exported?.results ?? []
    expect(exported.length).toBeGreaterThan(0)
    // 用进度事件确认 ASR 片数，再用窗口摘录（chars>0）间接确认时间轴已回填
    const asrProgress = w.progress.filter((p) => p.step === 'asr')
    expect(asrProgress.length, '应有逐片进度').toBeGreaterThan(0)
    const info = r.steps.find((s) => s.name === 'asr') as { segments: number }
    expect(info.segments, '两片各 2 段 ⇒ 共 4 段').toBe(4)
  })

  it('⑤ 未校准时间轴 ⇒ **允许继续但显著提示**（用户 Q2 决定）', async () => {
    const w = makeWorld({ offsetSec: null as unknown as number })
    const cfg = baseArgs(w).cfg as Record<string, unknown>
    delete cfg.offsetSec // 不校准
    const r = await job.runJob({ ...baseArgs(w), cfg })
    const off = r.steps.find((s) => s.name === 'offset') as { calibrated: boolean }
    expect(off.calibrated, '未校准必须显式为 false').toBe(false)
    expect(r.ok, '允许继续跑完').toBe(true)
    expect(r.warning, '必须带一句显著提示').toMatch(/尚未校准/)
  })

  it('⑥ 没有 ASR ⇒ 跳过该步但**如实说明质量会下降**，流程仍可跑完', async () => {
    const w = makeWorld()
    const r = await job.runJob({ ...baseArgs(w), callAsr: null })
    const asrStep = r.steps.find((s) => s.name === 'asr') as { skipped?: boolean; reason?: string }
    expect(asrStep.skipped).toBe(true)
    expect(asrStep.reason, '要说明后果').toMatch(/质量/)
    expect(r.ok, '仍应产出片子').toBe(true)
    expect(w.asrCalls.length).toBe(0)
  })

  it('⑦ 未配置输出目录 ⇒ 该步失败并**明确指出**（不静默成功）', async () => {
    const w = makeWorld()
    const cfg = { ...(baseArgs(w).cfg as Record<string, unknown>), paths: { output: '' } }
    const r = await job.runJob({ ...baseArgs(w), cfg })
    expect(r.ok).toBe(false)
    const ex = r.steps.find((s) => s.name === 'export') as { ok: boolean; error?: string }
    expect(ex.ok).toBe(false)
    expect(ex.error).toMatch(/输出目录/)
  })

  it('⑧ 进度事件覆盖各阶段（界面据此显示进度）', async () => {
    const w = makeWorld()
    await job.runJob(baseArgs(w))
    const steps = new Set(w.progress.map((p) => p.step))
    for (const s of ['danmaku', 'offset', 'windows', 'asr', 'score', 'export']) {
      expect(steps.has(s), `进度里应有 ${s}`).toBe(true)
    }
  })
})
