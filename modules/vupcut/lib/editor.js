/**
 * editor：**导出**（粗剪 copy / 帧精确重编码 / 竖屏裁切 / 外挂 SRT）。
 *
 * 用户决策：Q1=a **默认 copy 粗剪**（快、无损）+ 提供"帧精确"开关；
 *          Q2=a 关键帧**往前回退**（起点可能略早，但保证有画面、不黑屏）；
 *          Q3=a 保持原比例 + 可选竖屏裁切；**字幕默认外挂 SRT，不烧进画面**。
 *
 * 关键实现说明（值得写下来）：
 *   · **输入侧定位**：`-ss` 放在 `-i` **之前** ⇒ ffmpeg 从最近的关键帧开始解码
 *     ⇒ 这正是"往前回退到关键帧"的正确做法，而且**比输出侧定位快得多**。
 *     copy 模式下切点必须落在关键帧上 ⇒ 实际起点可能比所选**早至多一个关键帧间隔**
 *     （如实写进结果说明；要精确就切"帧精确"模式）。
 *   · **字幕时间轴必须减去片段起点**（这是 ① 那轮的教训在导出侧的落点）：
 *     转写时间是"录像时间"，字幕要挂在"片段内时间"上 ⇒ 不减就会整体偏移。
 *   · 一切外部动作都走**注入的 ffmpeg 端口**（生产 = C1 受管子进程 ⇒ 模块停用/卸载即结束，无孤儿）。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

/** 默认参数。 */
export const DEFAULTS = {
  mode: 'copy',
  crf: 20,
  preset: 'veryfast',
  vertical: false,
  audioBitrate: '192k',
  faststart: true
}

/** 秒 → SRT 时间戳 `HH:MM:SS,mmm`（越界钳制到 0）。 */
export function srtTime(sec) {
  const n = Number.isFinite(sec) ? Math.max(0, sec) : 0
  const h = Math.floor(n / 3600)
  const m = Math.floor((n % 3600) / 60)
  const s = Math.floor(n % 60)
  const ms = Math.round((n - Math.floor(n)) * 1000)
  const p2 = (x) => String(x).padStart(2, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(ms).padStart(3, '0')}`
}

/**
 * 由转写生成**片段内时间轴**的 SRT（Q3=a：外挂字幕，不烧画面）。
 * @param {Array<{start:number,end:number,text:string}>} segments 录像时间轴上的转写（秒）
 * @param {number} clipStartSec 片段在录像里的起点
 * @param {number} clipEndSec 片段在录像里的终点
 */
export function srtFromTranscript(segments, clipStartSec, clipEndSec) {
  const from = Number(clipStartSec) || 0
  const to = Number.isFinite(clipEndSec) ? clipEndSec : Infinity
  const lines = []
  let n = 0
  for (const s of Array.isArray(segments) ? segments : []) {
    const start = Math.max(Number(s?.start) || 0, from)
    const end = Math.min(Number(s?.end) || 0, to)
    if (!(end > start)) continue // 与片段不相交 ⇒ 跳过（不产生空字幕）
    const text = String(s?.text ?? '').trim()
    if (text === '') continue
    n += 1
    // 相对片段起点（**不减去就会整体偏移** —— ① 的教训）
    lines.push(`${n}\n${srtTime(start - from)} --> ${srtTime(end - from)}\n${text}\n`)
  }
  return lines.join('\n')
}

/** 输出文件名：场次_序号_起止时间.mp4（去掉不安全字符）。 */
export function outputName({ sessionKey = 'session', index = 1, start = 0, end = 0, ext = '.mp4' }) {
  const safe = String(sessionKey).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)
  const t = (x) => String(Math.round(x)).padStart(5, '0')
  return `${safe}_${String(index).padStart(3, '0')}_${t(start)}-${t(end)}${ext}`
}

/** 竖屏裁切滤镜（9:16，先放大到覆盖再裁，避免变形）。 */
export const VERTICAL_FILTER = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'

/**
 * 构造 FFmpeg 参数（**纯函数** ⇒ 可精确断言）。
 * @param {object} a
 * @param {number} a.startSec 所选起点（copy 模式下会由 ffmpeg 回退到最近关键帧）
 * @param {number} a.endSec 终点
 * @param {'copy'|'precise'} [a.mode]
 */
export function buildCutArgs({
  input,
  output,
  startSec,
  endSec,
  mode = DEFAULTS.mode,
  crf = DEFAULTS.crf,
  preset = DEFAULTS.preset,
  vertical = DEFAULTS.vertical,
  audioBitrate = DEFAULTS.audioBitrate,
  faststart = DEFAULTS.faststart
}) {
  const dur = Math.max(0.05, Number(endSec) - Number(startSec))
  // ⚠️ `-ss` 必须在 `-i` 之前（输入侧定位）：快，且**自动回退到最近关键帧**（Q2=a）。
  const args = ['-hide_banner', '-nostdin', '-y', '-ss', Number(startSec).toFixed(3), '-i', input, '-t', dur.toFixed(3)]

  if (mode === 'precise') {
    args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p')
    if (vertical) args.push('-vf', VERTICAL_FILTER)
    args.push('-c:a', 'aac', '-b:a', audioBitrate)
    if (faststart) args.push('-movflags', '+faststart')
  } else {
    // copy：无损且秒级 ⇒ 切点必须落在关键帧上（ffmpeg 自动处理）
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero')
    if (vertical) {
      // copy 无法裁切 ⇒ 明确拒绝比"悄悄忽略用户要求"好
      throw new Error('copy 模式无法裁切画面：请切换到"帧精确"模式再启用竖屏')
    }
  }
  args.push(output)
  return args
}

/** 从错误信息里判断是否"copy 切点不在关键帧"这类可自动降级的失败。 */
export function looksLikeKeyframeProblem(message) {
  const m = String(message ?? '')
  return /non-monotonous|keyframe|Invalid data found|Could not find codec parameters|timestamps are unset/i.test(m)
}

/**
 * 批量导出。
 *
 * @param {object} a
 * @param {Array<{id:string,start:number,end:number}>} a.clips 要导出的片段（录像时间轴，秒）
 * @param {string} a.recording 录像路径
 * @param {string} a.outputDir 输出目录
 * @param {{ run: (args: string[], opts?: object) => Promise<{ ok: boolean; code: number|null; stderr?: string }> }} a.ffmpeg 受管子进程端口
 * @param {Array<{start:number,end:number,text:string}>} [a.transcript] 转写（用于生成 SRT）
 * @param {(p:{index:number,total:number,clipId:string,phase:'start'|'done'|'failed'}) => void} [a.onProgress]
 * @param {{aborted:boolean}} [a.signal]
 * @param {(name:string,text:string)=>Promise<void>} [a.writeFileImpl] 注入写文件（测试用）
 */
export async function exportClips({
  clips = [],
  recording,
  outputDir,
  ffmpeg,
  transcript = [],
  sessionKey = basename(String(recording ?? 'session'), extname(String(recording ?? ''))),
  mode = DEFAULTS.mode,
  vertical = DEFAULTS.vertical,
  crf = DEFAULTS.crf,
  preset = DEFAULTS.preset,
  makeSrt = true,
  onProgress = null,
  signal = null,
  writeFileImpl = null
}) {
  if (!ffmpeg || typeof ffmpeg.run !== 'function') throw new Error('缺少 ffmpeg 端口（应经 C1 受管子进程注入）')
  const write = writeFileImpl ?? ((p, t) => writeFile(p, t, 'utf8'))
  await mkdir(outputDir, { recursive: true }).catch(() => {})

  const results = []
  let index = 0
  for (const clip of clips) {
    index += 1
    if (signal?.aborted) {
      results.push({ id: clip.id, ok: false, skipped: true, error: '用户取消' })
      continue
    }
    const name = outputName({ sessionKey, index, start: clip.start, end: clip.end })
    const out = join(outputDir, name)
    onProgress?.({ index, total: clips.length, clipId: clip.id, phase: 'start' })

    let args
    try {
      args = buildCutArgs({ input: recording, output: out, startSec: clip.start, endSec: clip.end, mode, crf, preset, vertical })
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 200)
      results.push({ id: clip.id, ok: false, output: out, error: msg })
      onProgress?.({ index, total: clips.length, clipId: clip.id, phase: 'failed' })
      continue
    }

    const r = await ffmpeg.run(args, { timeoutMs: 30 * 60_000 })
    if (!r || r.ok !== true) {
      // 如实回报：单条失败**不影响**其它片段（批量导出不该被一条卡死）
      const msg = `ffmpeg 退出码 ${r?.code ?? '未知'}${r?.stderr ? `：${String(r.stderr).slice(-200)}` : ''}`
      results.push({ id: clip.id, ok: false, output: out, error: msg, hint: looksLikeKeyframeProblem(msg) ? '可尝试切换到"帧精确"模式' : null })
      onProgress?.({ index, total: clips.length, clipId: clip.id, phase: 'failed' })
      continue
    }

    let srtPath = null
    if (makeSrt && transcript.length > 0) {
      const srt = srtFromTranscript(transcript, clip.start, clip.end)
      if (srt.trim() !== '') {
        srtPath = out.replace(/\.mp4$/i, '.srt')
        await write(srtPath, srt).catch(() => {
          srtPath = null
        })
      }
    }
    results.push({
      id: clip.id,
      ok: true,
      output: out,
      srt: srtPath,
      start: clip.start,
      end: clip.end,
      // 如实说明 copy 模式的固有误差（用户 Q2=a 的代价）
      note: mode === 'copy' ? 'copy 模式起点可能比所选略早（回退到最近关键帧）；要精确请用"帧精确"' : null
    })
    onProgress?.({ index, total: clips.length, clipId: clip.id, phase: 'done' })
  }

  const okCount = results.filter((r) => r.ok).length
  return {
    ok: okCount > 0,
    total: clips.length,
    exported: okCount,
    failed: results.length - okCount,
    cancelled: signal?.aborted === true,
    results
  }
}
