/**
 * offset：**弹幕时间轴 ⇄ 录像时间轴的对齐**（用户决定：手动能力保留，同时要有自动化 ✓）。
 *
 * 问题：弹幕时间是"**开播以来**"的秒数，而录像文件是"**开始录制以来**"的秒数
 * ⇒ 两者相差 `offsetSec`（先开播后开录、掉线重连、手动分段都会造成偏移）。
 * 不校准 ⇒ 所有片段**整体平移** ⇒ 画面与弹幕/台词完全错位（最坏整场作废）。
 *
 * 本文件的分工：
 *   · `applyOffset()`：把弹幕平移到**录像时间轴**（越界的剔除并计数）；
 *   · `suggestOffset()`：**自动给出建议值 + 置信度 + 依据**（用户决定 Q3 = 必须说清"为什么"）；
 *   · `buildSessionManifest()`：会话清单 —— 把 `calibrated` 变成**显式字段**，
 *     未校准绝不静默当 0（与"不假装知道时长"同一原则）。
 *
 * 约定（写死，避免方向搞反）：**画面时间 = 弹幕时间 − offsetSec**，
 * 其中 `offsetSec` = "开播 → 开始录制"之间经过的秒数。
 *
 * 自动化的能力链（用户 Q1：手动保留、自动也要有）：
 *   D 元数据（弹幕导出里的开播时间）→ C 文件名/文件时间推断 → B 音频能量互相关 → A 手动。
 *   B 需要**音频能量曲线**（由编辑器/FFmpeg 提供）⇒ 现在把接口留好并**如实报告"信号不足"**，
 *   而不是假装猜一个数（后者会让用户以为已经对齐）。
 */

/** 无偏移时的空结果（避免调用方到处判空）。 */
const EMPTY = { items: [], droppedEarly: 0, droppedLate: 0 }

/**
 * 把弹幕从"开播时间轴"平移到"录像时间轴"。
 *
 * @param {Array<{atMs:number,text:string}>} danmaku 已在开播时间轴上、按时间升序
 * @param {number} offsetSec 开播 → 开始录制的秒数（可为负：弹幕文件包含更早片段时）
 * @param {number|null} durationSec 录像时长；提供时超出末尾的弹幕会被剔除并计数
 */
export function applyOffset(danmaku, offsetSec, durationSec = null) {
  if (!Array.isArray(danmaku) || danmaku.length === 0) return { ...EMPTY }
  const shift = Number.isFinite(offsetSec) ? offsetSec : 0
  const items = []
  let droppedEarly = 0
  let droppedLate = 0
  for (const d of danmaku) {
    const atMs = d.atMs - Math.round(shift * 1000)
    if (atMs < 0) {
      droppedEarly += 1
      continue
    }
    if (durationSec !== null && Number.isFinite(durationSec) && atMs > durationSec * 1000) {
      droppedLate += 1
      continue
    }
    items.push({ atMs: Math.round(atMs), text: d.text })
  }
  items.sort((a, b) => a.atMs - b.atMs)
  return { items, droppedEarly, droppedLate }
}

/** 解析一个"看起来像日期时间"的字符串（文件名或元数据里都可能出现）。 */
export function parseDateTimeLoose(s) {
  if (typeof s !== 'string' || s.trim() === '') return null
  const t = s.trim()
  // 常见形态：2026-10-03 20-15-00 / 2026-10-03_20-15-00 / 2026-10-03T20:15:00 / 20261003-201500
  const norm = t
    .replace(/[_T]/g, ' ')
    .replace(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2})[-:](\d{2})[-:](\d{2})/, '$1-$2-$3 $4:$5:$6')
    .replace(/(\d{4})(\d{2})(\d{2})[- ](\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6')
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(norm)
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se))
  return Number.isFinite(ms) ? ms : null
}

/** 元数据里可能出现的"开播时间"字段名（各导出工具不一致，全部尝试）。 */
const START_KEYS = ['live_start_time', 'liveStartTime', 'start_time', 'startTime', 'live_start', 'started_at']

/** 从元数据对象里取开播时间（毫秒）。 */
export function pickStartTime(meta) {
  if (meta === null || typeof meta !== 'object') return null
  for (const k of START_KEYS) {
    const v = meta[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? Math.round(v * 1000) : Math.round(v)
    const parsed = parseDateTimeLoose(v)
    if (parsed !== null) return parsed
  }
  return null
}

/**
 * 自动建议偏移。
 *
 * @param {object} a
 * @param {number|null} [a.liveStartMs] 开播时刻（来自弹幕元数据 → 方法 D）
 * @param {number|null} [a.recordStartMs] 开始录制时刻（文件名推断 → 方法 C；或元数据）
 * @param {string} [a.fileName] 录像文件名（用于方法 C 的兜底解析）
 * @param {Array<number>} [a.danmakuBuckets] 弹幕密度序列（方法 B 的输入之一）
 * @param {Array<number>} [a.audioBuckets] 音频能量序列（方法 B；**未接入时为 null**）
 * @param {number} [a.bucketSec] 上述序列的桶宽（秒）
 * @returns {{offsetSec:number|null, confidence:'high'|'medium'|'low'|'none', basis:string, method:string}}
 */
export function suggestOffset(a = {}) {
  const { liveStartMs = null, recordStartMs = null, fileName = '', danmakuBuckets = null, audioBuckets = null, bucketSec = 5 } = a

  // ── 方法 D：元数据开播时间 + 已知/推断的录制开始时间（最可靠）
  const fileTime = recordStartMs ?? parseDateTimeLoose(fileName)
  if (liveStartMs !== null && fileTime !== null) {
    const offsetSec = Math.round((fileTime - liveStartMs) / 1000)
    if (offsetSec >= -60 && offsetSec <= 24 * 3600) {
      return {
        offsetSec,
        confidence: 'high',
        method: 'D',
        basis: `弹幕元数据的开播时间与录像开始时间之差为 ${offsetSec} 秒`
      }
    }
    return {
      offsetSec: null,
      confidence: 'low',
      method: 'D',
      basis: `算出的偏移为 ${offsetSec} 秒，超出合理范围（-60 ~ 86400 秒）⇒ 不采用，请手动校准`
    }
  }

  // ── 方法 C：只有文件名时间（没有开播时间可比 ⇒ 只能给提示，不给数字）
  if (fileTime !== null && liveStartMs === null) {
    return {
      offsetSec: null,
      confidence: 'low',
      method: 'C',
      basis: '只从文件名读到了录制时间，但弹幕数据里没有开播时间，无法计算偏移 ⇒ 请手动校准（或补充弹幕元数据）'
    }
  }

  // ── 方法 B：音频能量 × 弹幕密度互相关（需要编辑器提供音频能量）
  if (Array.isArray(danmakuBuckets) && danmakuBuckets.length > 0) {
    if (!Array.isArray(audioBuckets) || audioBuckets.length === 0) {
      return {
        offsetSec: null,
        confidence: 'none',
        method: 'B',
        basis: '自动对齐需要音频能量曲线（编辑器接入后可用）；当前信号不足 ⇒ 请手动校准'
      }
    }
    const found = crossCorrelate(danmakuBuckets, audioBuckets, bucketSec)
    return found ?? { offsetSec: null, confidence: 'none', method: 'B', basis: '互相关没有找到明显峰值 ⇒ 请手动校准' }
  }

  // ── 方法 A：交给手动
  return { offsetSec: null, confidence: 'none', method: 'A', basis: '没有可用于自动校准的信息 ⇒ 请手动校准（拖动滑块并看预览）' }
}

/**
 * 归一化互相关：在 ±maxLagSec 内找使"弹幕密度"与"音频能量"最吻合的位移。
 * 只在信号足够（双侧都有足够非零桶）时才返回结果 ⇒ 避免噪声里硬凑一个数。
 */
export function crossCorrelate(danmakuBuckets, audioBuckets, bucketSec = 5, maxLagSec = 1800) {
  const n = Math.min(danmakuBuckets.length, audioBuckets.length)
  const maxLag = Math.floor(maxLagSec / bucketSec)
  const norm = (arr) => {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length
    const sd = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length) || 1
    return arr.map((v) => (v - mean) / sd)
  }
  if (n < 20) return null
  const a = norm(danmakuBuckets.slice(0, n))
  const b = norm(audioBuckets.slice(0, n))
  let best = { lag: 0, score: -Infinity }
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let sum = 0
    let cnt = 0
    for (let i = 0; i < n; i += 1) {
      const j = i + lag
      if (j < 0 || j >= n) continue
      sum += a[i] * b[j]
      cnt += 1
    }
    if (cnt < n * 0.5) continue
    const score = sum / cnt
    // 平票时取**绝对值更小**的位移：单尖峰信号的相关峰天然对称（±lag 几乎等分），
    // 若只按 `>` 取第一个最大值，符号会随遍历顺序翻转 ⇒ 同输入得到 ±135 两种答案（实测）。
    if (
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) <= 1e-9 && Math.abs(lag) < Math.abs(best.lag))
    ) {
      best = { lag, score }
    }
  }
  if (!Number.isFinite(best.score) || best.score < 0.25) return null
  // 反向位移是否几乎同样好 ⇒ 方向**不确定**，置信度降为 low 并在依据里说明（不许假装确定）。
  const opposite = -best.lag
  let oppositeScore = -Infinity
  {
    let sum = 0
    let cnt = 0
    for (let i = 0; i < n; i += 1) {
      const j = i + opposite
      if (j < 0 || j >= n) continue
      sum += a[i] * b[j]
      cnt += 1
    }
    if (cnt >= n * 0.5) oppositeScore = sum / cnt
  }
  const ambiguous = oppositeScore >= best.score - 0.02
  // ⚠️ 符号推导（写在这里，防止以后被"改回去"）：
  //   同一时刻 M：弹幕时间 S = i·bucket（a 是弹幕），录像时间 R = j·bucket（b 是音频），
  //   约定 offset = S − R。
  //   相关式 a[i]·b[i+lag] 对齐的是 j = i + lag ⇒ offset = (i − j)·bucket = **−lag·bucket**。
  //   （曾经写成 +lag·bucket ⇒ 同一份数据得到 ±135 两个答案，方向整体反了。）
  const offsetSec = Math.round(-best.lag * bucketSec)
  const confidence = ambiguous ? 'low' : best.score >= 0.5 ? 'medium' : 'low'
  return {
    offsetSec,
    confidence,
    method: 'B',
    basis: ambiguous
      ? `弹幕密度与音频能量在位移 ${offsetSec} 秒处相关度最高（${best.score.toFixed(2)}），但**反向位移几乎同样吻合** ⇒ 方向不确定，请手动确认`
      : `弹幕密度与音频能量的吻合峰值出现在位移 ${offsetSec} 秒（相关度 ${best.score.toFixed(2)}）`
  }
}

/**
 * 会话清单 —— 把"是否校准"变成**显式事实**。
 * ⚠️ 未校准时 `calibrated: false`，且带一句给人看的提示；
 * 任何后续步骤（选段/导出）都应据此**显著提示**（用户 Q2 决定：允许继续，但要提示）。
 */
export function buildSessionManifest({ sessionKey, recording, rawDanmaku, offset, durationSec = null }) {
  const offsetSec = offset?.offsetSec ?? null
  const calibrated = offsetSec !== null
  const applied = applyOffset(rawDanmaku ?? [], offsetSec ?? 0, durationSec)
  return {
    sessionKey,
    recording: recording ?? null,
    durationSec,
    offset: {
      second: offsetSec,
      calibrated,
      source: offset?.method ?? 'A',
      confidence: offset?.confidence ?? 'none',
      basis: offset?.basis ?? '未校准'
    },
    note: calibrated ? null : '尚未校准时间轴：片段可能整体偏移，请在预览里确认后再导出',
    danmaku: {
      total: Array.isArray(rawDanmaku) ? rawDanmaku.length : 0,
      used: applied.items.length,
      droppedEarly: applied.droppedEarly,
      droppedLate: applied.droppedLate
    },
    items: applied.items
  }
}
