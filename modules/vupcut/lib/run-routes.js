/**
 * run-routes：控制页上的"**处理**"这一条链（用户 Q1=a 先接一条；Q2=a 结果列表；Q3=a 进度 + 取消）。
 *
 * 设计要点（都是为了让界面**诚实**）：
 *   · 任务**异步**跑（页面轮询 `/vupcut/job`）⇒ 长任务不会把 HTTP 请求挂死；
 *   · 进度事件**逐条**记录并给页面（含"未校准时间轴"这类 warning ⇒ 界面必须显眼提示）；
 *   · **取消**只置信号 ⇒ `job.js` 会保留已完成的部分并给出续跑起点（不丢工作、不重复花钱）；
 *   · 结果列表给出：起止时间、分数、理由、以及**导出/手动标记**所需的 id；
 *   · 花费（¥ 或套餐额度）**如实回报**（含"未知"的情况，不编数字）。
 */
import { runJob } from './job.js'
import { exportClips } from './editor.js'
import { listRecordings, parseDanmaku } from './store.js'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** 进程内单任务状态（MVP：一次只跑一场；重复启动会被拒绝并说明）。 */
function createJobState() {
  return {
    id: null,
    running: false,
    phase: 'idle',
    progress: [],
    startedAt: null,
    finishedAt: null,
    signal: { aborted: false },
    result: null,
    error: null,
    spentCny: 0,
    creditsUsed: 0,
    warning: null
  }
}

/** 找同名弹幕文件（录制目录里 `.jsonl` / `.xml` 与录像同名，或同名前缀）。 */
async function findDanmakuFor(recordingPath) {
  const dir = recordingPath.replace(/[\\/][^\\/]+$/, '')
  const base = recordingPath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  let entries = []
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  for (const ext of ['.jsonl', '.xml', '.json']) {
    const hit = entries.find((e) => e.toLowerCase() === `${base}${ext}`.toLowerCase())
    if (hit) return join(dir, hit)
  }
  for (const ext of ['.jsonl', '.xml']) {
    const hit = entries.find((e) => e.toLowerCase().startsWith(base.toLowerCase()) && e.toLowerCase().endsWith(ext))
    if (hit) return join(dir, hit)
  }
  return null
}

/**
 * 注册"处理"相关路由。
 * @param {object} ctx 模块上下文
 * @param {object} api activate() 返回值（含 prices 等）
 * @param {ReturnType<import('./runtime.js').createRuntime>} runtime 运行时依赖
 */
export function registerRunRoutes(ctx, api, runtime) {
  const { gateway, config, logger } = ctx
  const state = createJobState()

  /** 会话列表：录像目录里的媒体文件 + 能否找到同名弹幕。 */
  gateway.registerHttpRoute('GET', '/vupcut/sessions', async () => {
    const cfg = (await config.get()) ?? {}
    const dir = cfg.paths?.recordings ?? ''
    if (dir === '') return { status: 200, body: { dir: '', sessions: [], note: '未配置录像目录' } }
    const list = await listRecordings(dir)
    const sessions = []
    for (const r of list.slice(0, 50)) {
      const danmakuPath = await findDanmakuFor(r.path)
      sessions.push({
        path: r.path,
        name: r.name,
        sizeBytes: r.sizeBytes,
        mtimeMs: r.mtimeMs,
        danmakuPath,
        sessionKey: r.name.replace(/\.[^.]+$/, '')
      })
    }
    return { status: 200, body: { dir, sessions, note: sessions.length === 0 ? '该目录下没有媒体文件' : null } }
  })

  /** 任务状态（页面轮询）。 */
  gateway.registerHttpRoute('GET', '/vupcut/job', () => ({
    status: 200,
    body: {
      id: state.id,
      running: state.running,
      phase: state.phase,
      progress: state.progress.slice(-80),
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      spentCny: state.spentCny,
      creditsUsed: state.creditsUsed,
      warning: state.warning,
      error: state.error,
      resumeFrom: state.result?.resumeFrom ?? null,
      cancelled: state.result?.cancelled === true,
      clips: (state.result?.clips ?? []).map((c) => ({ id: c.id, start: c.start, end: c.end, score: c.score ?? null, reason: c.reason ?? '', source: c.source ?? 'llm' })),
      steps: state.result?.steps ?? [],
      exported: state.result?.exported ?? null,
      readiness: runtime.readiness()
    }
  }))

  /** 启动一场处理。 */
  gateway.registerHttpRoute('POST', '/vupcut/run', async (req) => {
    if (state.running) {
      return { status: 409, body: { ok: false, error: '已有一场任务在跑（本版本一次只跑一场）' } }
    }
    const cfg = (await config.get()) ?? {}
    const pick = req.body?.session ?? null
    const recordingsDir = cfg.paths?.recordings ?? ''
    if (!recordingsDir) return { status: 400, body: { ok: false, error: '未配置录像目录' } }
    if (!cfg.paths?.output) return { status: 400, body: { ok: false, error: '未配置输出目录' } }

    const list = await listRecordings(recordingsDir)
    const chosen = pick ? list.find((r) => r.path === pick || r.name === pick) : list[0]
    if (!chosen) return { status: 404, body: { ok: false, error: '找不到指定的录像文件' } }
    const danmakuPath = await findDanmakuFor(chosen.path)

    // 重置状态
    const fresh = createJobState()
    Object.assign(state, fresh, {
      id: `job-${Date.now()}`,
      running: true,
      phase: 'starting',
      startedAt: Date.now()
    })

    const rec = {
      path: chosen.path,
      name: chosen.name,
      sessionKey: chosen.name.replace(/\.[^.]+$/, ''),
      danmakuPath,
      durationSec: null
    }

    // 异步跑（不阻塞 HTTP）；失败与取消都记进 state
    void (async () => {
      try {
        const res = await runJob({
          ctx,
          cfg,
          recording: rec,
          readText: runtime.readText,
          readBinary: runtime.readBinary,
          ffmpeg: runtime.ffmpeg,
          callLlm: runtime.callLlm,
          callAsr: runtime.readiness().asrModel ? runtime.callAsr : null,
          priceTable: api.prices?.last()?.table ?? api.prices?.builtin ?? null,
          budget: {
            table: api.prices?.last()?.table ?? api.prices?.builtin ?? null,
            model: cfg.model,
            limitCny: cfg.limits?.paygCny ?? 2,
            spentCny: state.spentCny
          },
          onProgress: (p) => {
            state.phase = p.step ?? state.phase
            state.progress.push({ at: Date.now(), ...p })
            if (typeof p.spentCny === 'number') state.spentCny = p.spentCny
            if (typeof p.creditsUsed === 'number') state.creditsUsed = p.creditsUsed
            if (p.warning) state.warning = p.warning
          },
          signal: state.signal
        })
        state.result = res
        state.spentCny = res.spentCny ?? state.spentCny
        state.creditsUsed = res.creditsUsed ?? state.creditsUsed
        state.warning = res.warning ?? state.warning
        state.error = res.ok ? null : (res.error ?? null)
        state.phase = res.cancelled ? 'cancelled' : res.ok ? 'done' : 'failed'
      } catch (e) {
        state.error = String(e?.message ?? e).slice(0, 300)
        state.phase = 'failed'
      } finally {
        state.running = false
        state.finishedAt = Date.now()
        logger.info('vupcut job finished', {
          id: state.id,
          phase: state.phase,
          clips: state.result?.clips?.length ?? 0,
          spentCny: state.spentCny,
          creditsUsed: state.creditsUsed
        })
      }
    })()

    return { status: 202, body: { ok: true, id: state.id, session: chosen.name, danmaku: danmakuPath !== null } }
  })

  /** 取消（保留已完成部分；job.js 会给出续跑起点）。 */
  gateway.registerHttpRoute('POST', '/vupcut/job/cancel', () => {
    if (!state.running) return { status: 200, body: { ok: true, running: false, note: '当前没有在跑的任务' } }
    state.signal.aborted = true
    state.phase = 'cancelling'
    return { status: 200, body: { ok: true, running: true, note: '已请求取消：已完成的部分会保留，可稍后续跑' } }
  })

  /** 导出指定片段（不传则导出全部已选片段）。 */
  gateway.registerHttpRoute('POST', '/vupcut/export', async (req) => {
    const cfg = (await config.get()) ?? {}
    const clipsWanted = Array.isArray(req.body?.clips) ? req.body.clips : null
    const all = state.result?.clips ?? []
    const clips = clipsWanted
      ? all.filter((c) => clipsWanted.includes(c.id))
      : all
    if (clips.length === 0) return { status: 400, body: { ok: false, error: '没有可导出的片段' } }
    const sessionPath = state.result?.steps?.length ? (await listRecordings(cfg.paths?.recordings ?? ''))[0]?.path : null
    if (!sessionPath) return { status: 400, body: { ok: false, error: '找不到源录像（请确认录像目录）' } }
    const res = await exportClips({
      clips,
      recording: sessionPath,
      outputDir: cfg.paths?.output ?? '',
      ffmpeg: runtime.ffmpeg,
      transcript: [],
      sessionKey: state.id ?? 'session',
      mode: cfg.export?.mode ?? 'copy',
      vertical: cfg.export?.vertical === true,
      makeSrt: cfg.export?.burnSubtitle !== true
    })
    return { status: 200, body: { ok: res.ok, exported: res.exported, failed: res.failed, results: res.results.map((r) => ({ id: r.id, ok: r.ok, output: r.output ?? null, error: r.error ?? null })) } }
  })

  /** 手动标记：并入结果列表（**手动恒优先**由 job.js/marks.js 保证）。 */
  gateway.registerHttpRoute('POST', '/vupcut/mark', async (req) => {
    const start = Number(req.body?.start)
    const end = Number(req.body?.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { status: 400, body: { ok: false, error: '起止时间不合法（结束必须晚于开始）' } }
    }
    const cfg = (await config.get()) ?? {}
    const marks = Array.isArray(cfg.marks) ? [...cfg.marks] : []
    marks.push({ id: `m-${Math.round(start * 10)}-${Math.round(end * 10)}`, start, end, source: 'manual', label: String(req.body?.label ?? '').slice(0, 40) })
    const cur = (await config.get()) ?? {}
    const res = config.set({ ...cur, marks })
    return { status: res?.ok === false ? 400 : 200, body: { ok: res?.ok !== false, marks: marks.length } }
  })

  /** 顺带把"依赖是否齐备"给页面（缺什么就显示什么，不笼统报错）。 */
  gateway.registerHttpRoute('GET', '/vupcut/readiness', () => ({ status: 200, body: runtime.readiness() }))

  logger.info('vupcut run routes registered', {
    routes: ['GET /vupcut/sessions', 'GET /vupcut/job', 'POST /vupcut/run', 'POST /vupcut/job/cancel', 'POST /vupcut/export', 'POST /vupcut/mark', 'GET /vupcut/readiness']
  })
}
