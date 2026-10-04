/**
 * job：**端到端编排**（把前面各层串成一条真流程）。
 *
 * 流程（每一步都可注入、可取消、可观察）：
 *   ① 录像索引（listRecordings）
 *   ② 弹幕解析（parseDanmaku）
 *   ③ 时间轴对齐（suggestOffset + applyOffset + buildSessionManifest ⇒ **未校准必须显式提示**）
 *   ④ 切窗（buildWindows ⇒ 带稳定 id 的窗口清单）
 *   ⑤ 抽音频（FFmpeg 受管端口 ⇒ 16kHz 单声道；**按时间切片**，每片单独抽，便于续跑与重传）
 *   ⑥ ASR（通用客户端 ⇒ 分片转写 ⇒ **每片的 segment 时间必须加上该片起点**）
 *   ⑦ 评分（runScoring ⇒ 分块 + 重试 + 预算 + 取消续跑 + 手动标记优先）
 *   ⑧ 导出（exportClips ⇒ MP4 + 外挂 SRT）
 *
 * ⚠️ 关键正确性点（都踩过才写下来）：
 *   · **每片 ASR 的时间轴要加回片起点**，否则整场字幕会按片长错位（① 的教训同源）；
 *   · 未校准时**照常跑但显式提示**（用户 Q2 决定：允许继续 + 显著提示）；
 *   · 任何一步失败都**不吞**：返回 `steps` 让界面如实展示是哪一步失败、还能不能续跑。
 */
import { parseDanmaku, buildWindows } from './store.js'
import { buildSessionManifest, applyOffset, suggestOffset } from './offset.js'
import { runScoring } from './pipeline.js'
import { buildCutArgs, srtFromTranscript } from './editor.js'
import { buildSystemPrompt, buildUserPayload, validateSelection } from './prompt.js'
import { buildTranscribeRequest, parseTranscribe, detectAsrFormat } from './asr.js'
import { buildRequest, detectProvider, parseResponse, extractJson } from './llm.js'

/** 抽音频参数（纯函数）：16kHz 单声道 ⇒ 体积小、上传快、识别够用。 */
export function buildAudioArgs({ input, output, startSec = null, durationSec = null, bitrate = '64k' }) {
  const args = ['-hide_banner', '-nostdin', '-y']
  // 与剪辑一致：`-ss` 放 `-i` **之前**（输入侧定位，快）
  if (Number.isFinite(startSec)) args.push('-ss', Number(startSec).toFixed(3))
  args.push('-i', input)
  if (Number.isFinite(durationSec)) args.push('-t', Number(durationSec).toFixed(3))
  args.push('-vn', '-ac', '1', '-ar', '16000', '-b:a', bitrate, output)
  return args
}

/** 按时间切片（ASR 用）：返回 [{startSec, durationSec}]。 */
export function audioSlices(durationSec, sliceSec = 600) {
  const total = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  if (total === 0) return []
  const out = []
  for (let s = 0; s < total; s += sliceSec) {
    out.push({ startSec: s, durationSec: Math.min(sliceSec, total - s) })
  }
  return out
}

/** 从 window 清单推时长（末尾 end）。 */
function windowsDuration(windows) {
  return windows.length > 0 ? windows[windows.length - 1].end : 0
}

/**
 * 跑一整条流程。
 * @param {object} a
 * @param {{logger:object, network?:object, credentials?:object, proc?:object}} a.ctx
 * @param {object} a.cfg 模块配置
 * @param {Function} a.readText 读文本（注入 ⇒ 测试不用真文件）
 * @param {Function} a.readBinary 读二进制（抽音频后的产物；注入）
 * @param {{run:(args:string[])=>Promise<{ok:boolean,code:number|null}>}} a.ffmpeg FFmpeg 端口（C1 受管）
 * @param {Function} a.callLlm 发 LLM 请求（注入；生产走 ctx.network + llm.buildRequest）
 * @param {Function} a.callAsr 发 ASR 请求（注入；生产走 ctx.network + asr.buildTranscribeRequest）
 * @param {Function} [a.confirm] 预算超限/上传音频的确认（返回 'continue' | 'abort'）
 * @param {Function} [a.onProgress]
 */
export async function runJob({
  ctx,
  cfg = {},
  recording,
  danmakuText = '',
  danmakuFormat = 'auto',
  manualMarks = [],
  readText,
  readBinary = null,
  ffmpeg,
  callLlm,
  callAsr = null,
  confirm = null,
  onProgress = null,
  signal = null,
  budget = null,
  priceTable = null,
  asrPriceTable = null,
  opts = {}
}) {
  const log = ctx?.logger
  const steps = []
  const step = (name, ok, extra = {}) => {
    steps.push({ name, ok, ...extra })
    onProgress?.({ step: name, ok, ...extra })
  }

  // ① 录像存在性由调用方保证（模块只处理"给它什么"）；这里读弹幕
  let rawDanmaku = []
  let skipped = 0
  try {
    const text = await readText(recording?.danmakuPath ?? '')
    const parsed = parseDanmaku(text, danmakuFormat)
    rawDanmaku = parsed.items
    skipped = parsed.skipped
    step('danmaku', true, { items: rawDanmaku.length, skipped })
  } catch (e) {
    step('danmaku', false, { error: String(e?.message ?? e).slice(0, 160) })
    return { ok: false, steps, error: '弹幕读取失败' }
  }

  // ② 时间轴对齐
  const suggestion = suggestOffset({
    liveStartMs: null,
    recordStartMs: null,
    fileName: recording?.name ?? '',
    danmakuBuckets: null,
    audioBuckets: null
  })
  const offsetSec = Number.isFinite(cfg.offsetSec) ? cfg.offsetSec : suggestion.offsetSec
  const session = buildSessionManifest({
    sessionKey: recording?.sessionKey ?? 'session',
    recording: recording?.path ?? null,
    rawDanmaku,
    offset: { offsetSec, method: Number.isFinite(cfg.offsetSec) ? 'A' : suggestion.method, confidence: suggestion.confidence, basis: suggestion.basis },
    durationSec: Number.isFinite(recording?.durationSec) ? recording.durationSec : null
  })
  step('offset', true, { calibrated: session.offset.calibrated, second: session.offset.second, basis: session.offset.basis })
  if (!session.offset.calibrated) {
    // 用户 Q2：**允许继续，但必须显著提示**
    onProgress?.({ step: 'offset', ok: true, warning: session.note })
  }

  // ③ 切窗
  const { windows, needDuration, durationMs } = buildWindows({
    sessionKey: recording?.sessionKey ?? 'session',
    danmaku: session.items,
    transcript: [],
    bucketMs: cfg.bucketMs ?? 5000,
    durationMs: Number.isFinite(recording?.durationSec) ? recording.durationSec * 1000 : null
  })
  step('windows', windows.length > 0, { count: windows.length, needDuration, durationMs })
  if (windows.length === 0) return { ok: false, steps, error: '没有可用窗口（弹幕为空？）' }

  const durationSec = Number.isFinite(recording?.durationSec) ? recording.durationSec : windowsDuration(windows)

  // ④ 抽音频 + ASR（可选：没有 callAsr 就跳过，评分只看弹幕统计 ⇒ 质量差但能跑）
  let transcript = []
  let asrHours = 0
  if (typeof callAsr === 'function') {
    const sliceSec = Math.max(60, Number(cfg.asr?.sliceSec) || 600)
    const slices = audioSlices(durationSec, sliceSec)
    let done = 0
    for (const s of slices) {
      if (signal?.aborted) break
      const outMp3 = `${recording?.sessionKey ?? 'session'}_${Math.round(s.startSec)}.mp3`
      const r = await ffmpeg.run(buildAudioArgs({ input: recording.path, output: outMp3, startSec: s.startSec, durationSec: s.durationSec }))
      if (!r || r.ok !== true) {
        step('audio', false, { slice: done, error: `抽音频失败（退出码 ${r?.code ?? '未知'}）` })
        break
      }
      const bytes = readBinary ? await readBinary(outMp3) : null
      if (bytes === null) {
        step('audio', false, { slice: done, error: '读不到抽取出的音频（readBinary 未注入）' })
        break
      }
      const parsed = parseTranscribe(await callAsr({ bytes, filename: outMp3, startSec: s.startSec, durationSec: s.durationSec }))
      // ⚠️ 关键：把该片的时间轴**加回片起点**（否则整场字幕按片长错位）
      for (const seg of parsed.segments) {
        transcript.push({ start: seg.start + s.startSec, end: seg.end + s.startSec, text: seg.text })
      }
      asrHours += (parsed.durationSec ?? s.durationSec) / 3600
      done += 1
      onProgress?.({ step: 'asr', ok: true, done, total: slices.length })
    }
    step('asr', transcript.length > 0, {
      segments: transcript.length,
      hours: Math.round(asrHours * 1000) / 1000,
      format: detectAsrFormat(cfg.asr?.model ?? '').format
    })
  } else {
    step('asr', true, { skipped: true, reason: '未配置 ASR（评分将只依据弹幕统计，质量会明显下降）' })
  }

  // ⑤ 用转写补齐窗口摘录（评分语料的关键）
  if (transcript.length > 0) {
    const rebuilt = buildWindows({
      sessionKey: recording?.sessionKey ?? 'session',
      danmaku: session.items,
      transcript,
      bucketMs: cfg.bucketMs ?? 5000,
      durationMs: durationSec * 1000
    })
    windows.length = 0
    windows.push(...rebuilt.windows)
  }

  // ⑥ 评分
  const scored = await runScoring({
    windows,
    manualMarks,
    call: callLlm,
    signal,
    confirm,
    budget,
    opts: { chunkSize: cfg.score?.chunkSize ?? 40, overlap: cfg.score?.overlap ?? 4, maxClips: cfg.score?.maxClips ?? 20 },
    onProgress: (p) => onProgress?.({ step: 'score', ok: true, ...p })
  })
  step('score', scored.ok || scored.cancelled, { clips: scored.clips.length, spentCny: scored.spentCny, creditsUsed: scored.creditsUsed, cancelled: scored.cancelled, resumeFrom: scored.resumeFrom })
  if (scored.cancelled) return { ok: false, cancelled: true, resumeFrom: scored.resumeFrom, steps, clips: scored.clips, spentCny: scored.spentCny }

  // ⑦ 导出（MP4 + 外挂 SRT）
  const out = cfg.paths?.output
  if (!out) {
    step('export', false, { error: '未配置输出目录' })
    return { ok: false, steps, clips: scored.clips, error: '未配置输出目录' }
  }
  const exported = await exportViaPort({ clips: scored.clips, recording, outputDir: out, ffmpeg, transcript, cfg, signal, onProgress })
  step('export', exported.ok, { exported: exported.exported, failed: exported.failed })
  return { ok: exported.ok, steps, clips: scored.clips, exported, spentCny: scored.spentCny, creditsUsed: scored.creditsUsed, warning: session.note }
}

/** 导出（薄封装，便于测试替换；真正逻辑在 editor.js）。 */
async function exportViaPort({ clips, recording, outputDir, ffmpeg, transcript, cfg, signal, onProgress }) {
  const { exportClips } = await import('./editor.js')
  return await exportClips({
    clips,
    recording: recording.path,
    outputDir,
    ffmpeg,
    transcript,
    sessionKey: recording.sessionKey,
    mode: cfg.export?.mode ?? 'copy',
    vertical: cfg.export?.vertical === true,
    crf: cfg.export?.crf ?? 20,
    preset: cfg.export?.preset ?? 'veryfast',
    makeSrt: cfg.export?.burnSubtitle !== true,
    signal,
    onProgress: (p) => onProgress?.({ step: 'export', ok: p.phase !== 'failed', ...p })
  })
}

/** 供页面/测试复用：从响应文本取出选段（与 pipeline 内部同源）。 */
export function selectionFromText(text, index, opts = {}) {
  return validateSelection(extractJson(text), index, opts)
}

export { buildSystemPrompt, buildUserPayload, buildRequest, detectProvider, parseResponse, buildTranscribeRequest, buildCutArgs, srtFromTranscript, applyOffset }
