/**
 * pipeline：评分任务的**编排**（分块 / 重试 / 取消 / 续跑 / 预算 / 合并）。
 *
 * 为什么需要它（用户决策 Q1=a / Q2=a / Q3=a）：
 *   · 一场 4 小时录像有几千个窗口 ⇒ 一次调用塞不完（超上下文、费用暴涨）⇒ **按时间分块**；
 *     ⚠️ 块间**留重叠**，否则"高光正好落在切缝上"会被两边各切一半、谁也选不出完整片段；
 *   · 接口会 429 / 5xx / 超时 ⇒ **指数退避 + 抖动**重试（可重试错误）；而 **401/403 立即失败**
 *     （密钥错重试多少次都没用，只会白等 ⇒ 直接提示去查密钥）；
 *   · 用户可能中途点取消 ⇒ **保留已完成块的结果**、如实显示已花费用，并给出**续跑起点**；
 *   · 续跑时**只跑剩下的块** ⇒ 不重复花钱（这是本模块对用户最实在的承诺之一）。
 *
 * 依赖全部注入（`call` / `sleep` / `random` / `now` / `confirm`）⇒ 测试不需要网络与真实计时器，
 * 且结果**确定性**（① 那轮的教训：同输入必须同输出）。
 */
import { accumulateUsage, budgetVerdict, estimateCost, estimatePlanCredits, planVerdict, estimateTokens } from './cost.js'
import { extractJson } from './llm.js'
import { mergeMarks } from './marks.js'
import { buildSystemPrompt, buildUserPayload, validateSelection } from './prompt.js'

/** 默认参数（都可在调用处覆盖）。 */
export const DEFAULTS = {
  chunkSize: 40,
  overlap: 4,
  maxRetries: 3,
  baseDelayMs: 800,
  maxDelayMs: 20_000,
  timeoutMs: 60_000
}

/**
 * 把窗口按时间切成若干块，**块间带重叠**。
 * 重叠窗口在合并阶段按 id 去重 ⇒ 不会产生重复片段，但能避免"高光被切缝切断"。
 */
export function chunkWindows(windows, { chunkSize = DEFAULTS.chunkSize, overlap = DEFAULTS.overlap } = {}) {
  const list = Array.isArray(windows) ? windows : []
  if (list.length === 0) return []
  const step = Math.max(1, chunkSize - Math.max(0, overlap))
  const chunks = []
  for (let start = 0; start < list.length; start += step) {
    const slice = list.slice(start, start + chunkSize)
    if (slice.length === 0) break
    chunks.push({ index: chunks.length, start, end: start + slice.length, ids: slice.map((w) => w.id), windows: slice })
    if (start + chunkSize >= list.length) break
  }
  return chunks
}

/**
 * 判断错误是否值得重试（Q3=a）：**429 / 5xx / 超时 / 网络类** 重试；**401/403/400** 立即失败。
 * 也接受 `{status}` 或字符串。
 */
export function isRetryable(err) {
  const status = typeof err === 'object' && err !== null ? Number(err.status ?? err.statusCode ?? NaN) : NaN
  if (Number.isFinite(status)) {
    if (status === 401 || status === 403 || status === 400 || status === 404 || status === 422) return false
    if (status === 429 || status >= 500) return true
    return false
  }
  const msg = String(typeof err === 'string' ? err : (err && err.message) || '')
  if (/401|403|未授权|unauthorized|forbidden|invalid.*key|密钥/i.test(msg)) return false
  if (/timeout|超时|429|限流|rate ?limit|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|网络|5\d\d/i.test(msg)) return true
  return false
}

/** 退避延迟（指数 + 抖动；抖动可注入以便测试确定性）。 */
export function backoffDelay(attempt, { baseDelayMs = DEFAULTS.baseDelayMs, maxDelayMs = DEFAULTS.maxDelayMs, random = Math.random } = {}) {
  const raw = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1))
  const jitter = 0.5 + random() * 0.5 // 50%~100% ⇒ 避免同一时刻的重试风暴
  return Math.round(raw * jitter)
}

/** 同一片段被多个块选中 ⇒ 只留一条（记录被去重的来源，便于解释）。 */
export function dedupeClips(clips) {
  const kept = []
  const dupes = []
  for (const c of clips) {
    const first = kept.find((k) => k.id === c.id)
    if (first) {
      dupes.push({ id: c.id, why: '多个分块重复选中（已去重）' })
      // 分数取更高者，理由取更长的（信息更多）
      if ((c.score ?? 0) > (first.score ?? 0)) first.score = c.score
      if ((c.reason ?? '').length > (first.reason ?? '').length) first.reason = c.reason
      continue
    }
    kept.push({ ...c })
  }
  return { clips: kept, dupes }
}

/**
 * 跑一次评分任务。
 *
 * @param {object} a
 * @param {Array} a.windows 窗口清单（store 产出，带稳定 id）
 * @param {Array} [a.manualMarks] 手动标记（**恒优先**，不受分块/去重影响）
 * @param {(req: {system:string,user:string,timeoutMs:number,chunkIndex:number}) => Promise<{text?:string, usage?:object, model?:string}>} a.call
 *        真正发请求的函数（生产走 ctx.network + llm.buildRequest；测试注入假实现）
 * @param {(ms:number) => Promise<void>} [a.sleep] 退避等待（测试注入即时实现）
 * @param {() => number} [a.random] 抖动来源（测试注入固定值）
 * @param {{aborted:boolean}} [a.signal] 取消信号
 * @param {(p:{chunkIndex:number,chunks:number,done:number,spentCny:number,creditsUsed:number}) => void} [a.onProgress]
 * @param {(req:{message:string,overBy:number,kind:'payg'|'plan'}) => Promise<'continue'|'abort'>} [a.confirm] 超限确认（用户决定）
 * @param {object} [a.budget] `{ table, model, limitCny, quotaTotal, limitPct, creditRule, acknowledged }`
 * @param {number} [a.fromChunk] 从第几块开始（续跑；前面块的结果由 a.priorClips 传入）
 * @param {Array} [a.priorClips] 已完成的选段（续跑时传入，参与最终合并）
 * @param {object} [a.opts] 覆盖 DEFAULTS（chunkSize/overlap/maxRetries/timeoutMs/...）
 */
export async function runScoring({
  windows = [],
  manualMarks = [],
  call,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  random = Math.random,
  signal = null,
  onProgress = null,
  confirm = null,
  budget = null,
  fromChunk = 0,
  priorClips = [],
  opts = {}
}) {
  if (typeof call !== 'function') throw new Error('runScoring 需要一个 call 函数')
  const o = { ...DEFAULTS, ...opts }
  const chunks = chunkWindows(windows, { chunkSize: o.chunkSize, overlap: o.overlap })
  const index = new Map(windows.map((w) => [w.id, w]))
  const system = buildSystemPrompt()

  let spentCny = budget?.spentCny ?? 0
  let creditsUsed = budget?.creditsUsed ?? 0
  let acknowledged = budget?.acknowledged === true
  const allClips = [...priorClips]
  const chunkReports = []
  const rejected = []
  let lastError = null

  for (const chunk of chunks) {
    if (chunk.index < fromChunk) continue // 续跑：跳过已完成块（**不重复花钱**）

    // ── 取消检查（Q2=a：保留已完成块的结果）
    if (signal?.aborted) {
      return finish({ cancelled: true, resumeFrom: chunk.index, allClips, chunkReports, rejected, spentCny, creditsUsed, lastError })
    }

    const { text: user } = buildUserPayload({
      sessionKey: 'session',
      bucketMs: 5000,
      windows: chunk.windows,
      topN: chunk.windows.length,
      quietSamples: Math.min(8, Math.max(1, Math.floor(chunk.windows.length / 8)))
    })

    // ── 预算预检（超限 ⇒ **问用户**，而不是硬停 —— 与成本卡的策略一致）
    if (budget && confirm) {
      const inTok = estimateTokens(system + user)
      const outTok = 1_500
      let verdict = null
      if (budget.quotaTotal) {
        const credits = estimatePlanCredits({
          creditRule: budget.creditRule ?? null,
          inputTokens: inTok,
          outputTokens: outTok
        })
        verdict = planVerdict({ creditsUsed, quotaTotal: budget.quotaTotal, creditsNext: credits.credits, limitPct: budget.limitPct ?? 20, acknowledged })
      } else {
        const est = estimateCost({ model: budget.model, table: budget.table, inputTokens: inTok, outputTokens: outTok })
        verdict = budgetVerdict({ spentCny, limitCny: budget.limitCny ?? 2, estimateCny: est.amountCny, acknowledged })
      }
      if (verdict.state === 'exceed') {
        const choice = await confirm({ message: verdict.message ?? '超出预算上限，是否继续？', overBy: verdict.overBy ?? verdict.overByPct ?? 0, kind: budget.quotaTotal ? 'plan' : 'payg' })
        if (choice !== 'continue') {
          return finish({ cancelled: true, abortedByBudget: true, resumeFrom: chunk.index, allClips, chunkReports, rejected, spentCny, creditsUsed, lastError })
        }
        acknowledged = true // 已确认 ⇒ 本场不再反复打断
      }
    }

    // ── 调用（含重试）
    let attempt = 0
    let ok = false
    let chosen = []
    let usageText = ''
    while (attempt <= o.maxRetries && !ok) {
      attempt += 1
      try {
        const res = await call({ system, user, timeoutMs: o.timeoutMs, chunkIndex: chunk.index })
        usageText = typeof res?.text === 'string' ? res.text : ''
        // 真实 usage 优先（预算以真实值为准）
        if (budget && res?.usage) {
          if (budget.quotaTotal) {
            const c = estimatePlanCredits({
              creditRule: budget.creditRule ?? null,
              inputTokens: Number(res.usage.prompt_tokens ?? res.usage.input_tokens ?? 0) || 0,
              outputTokens: Number(res.usage.completion_tokens ?? res.usage.output_tokens ?? 0) || 0
            })
            creditsUsed += c.credits ?? 0
          } else {
            const acc = accumulateUsage({ spentCny, table: budget.table, model: budget.model ?? res?.model, usage: res.usage })
            spentCny = acc.spentCny
          }
        }
        const parsed = extractJson(usageText)
        const v = validateSelection(parsed, index, {
          durationSec: null,
          maxClips: o.chunkSize,
          minGapSec: 1
        })
        chosen = v.clips
        rejected.push(...v.rejected.map((r) => ({ ...r, chunk: chunk.index })))
        ok = true
      } catch (e) {
        lastError = { message: String((e && e.message) || e).slice(0, 200), chunk: chunk.index, attempt }
        if (!isRetryable(e) || attempt > o.maxRetries) break
        await sleep(backoffDelay(attempt, { baseDelayMs: o.baseDelayMs, maxDelayMs: o.maxDelayMs, random }))
      }
    }

    if (!ok) {
      // 单块彻底失败 ⇒ 记录下来但**不放弃整场**（其余块仍有价值；用户可续跑）
      chunkReports.push({ index: chunk.index, ok: false, clips: 0, error: lastError?.message ?? '未知错误' })
      onProgress?.({ chunkIndex: chunk.index, chunks: chunks.length, done: chunkReports.length, spentCny, creditsUsed })
      continue
    }

    const { clips, dupes } = dedupeClips([...allClips.slice(priorClips.length), ...chosen])
    allClips.length = 0
    allClips.push(...priorClips, ...clips.filter((c) => !priorClips.some((p) => p.id === c.id)))
    rejected.push(...dupes.map((d) => ({ ...d, chunk: chunk.index })))
    chunkReports.push({ index: chunk.index, ok: true, clips: chosen.length, attempts: attempt })
    onProgress?.({ chunkIndex: chunk.index, chunks: chunks.length, done: chunkReports.length, spentCny, creditsUsed })
  }

  return finish({ cancelled: false, allClips, chunkReports, rejected, spentCny, creditsUsed, lastError })

  function finish({ cancelled, abortedByBudget = false, resumeFrom = null, allClips: clips, chunkReports: reports, rejected: rej, spentCny: spent, creditsUsed: credits, lastError: err }) {
    // 最终合并：**手动标记恒优先**（与 marks.js 的合并在同一处收口）。
    const merged = mergeMarks(manualMarks, clips, { maxClips: o.maxClips ?? 20, minGapSec: o.minGapSec ?? 2 })
    return {
      ok: reports.some((r) => r.ok) && !cancelled,
      cancelled,
      abortedByBudget,
      resumeFrom,
      clips: merged.clips,
      manualCount: merged.manualCount,
      dropped: [...rej, ...merged.dropped],
      chunks: reports,
      spentCny: spent,
      creditsUsed: credits,
      lastError: err,
      doneChunks: reports.filter((r) => r.ok).length
    }
  }
}
