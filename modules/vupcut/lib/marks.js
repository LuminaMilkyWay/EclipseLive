/**
 * marks：**手动标记**（本地兜底）＋ 与自动结果的合并规则。
 *
 * 为什么这一层必须有（去掉本地模型后更明显）：没有 Key / 断网 / 关掉云端时，
 * 用户**一条片子都出不来** ⇒ 手动标记是唯一不依赖网络的产片路径。
 *
 * 用户决策
 *   · Q1 = c：**先做"输入起止秒"的最小交互**（好用的时间轴随 console 页面一起做）；
 *   · Q2 = b：**吸附到"弹幕峰值 / 整秒"**；
 *   · Q3 = a：**手动优先，自动结果整体降位**（手动标记绝不被自动结果挤掉）。
 *
 * 约定：所有时间以**秒**（小数）表示，且都在**录像时间轴**上
 * （即调用前应先经 offset 层对齐 —— 见 lib/offset.js）。
 */

/** 片段最短时长（秒）：太短的片段在短视频里没有意义，直接拒绝并说明原因。 */
const MIN_CLIP_SEC = 1

/** 时间精度：统一到 0.1 秒（避免出现 12.34567 这种噪声）。 */
const round1 = (n) => Math.round(n * 10) / 10

/**
 * 解析用户输入的时长文本 → 秒。
 * 支持：`83` ／ `83.5` ／ `1:23` ／ `1:23.5` ／ `01:02:03` ／ `1小时2分3秒`（宽松）。
 * 解析不了 ⇒ null（**由界面提示**，不猜）。
 */
export function parseSeconds(text) {
  if (typeof text === 'number' && Number.isFinite(text)) return Math.max(0, round1(text))
  if (typeof text !== 'string') return null
  const s = text.trim()
  if (s === '') return null

  // 「1小时2分3秒」这类中英混排
  const cn = /^(?:(\d+(?:\.\d+)?)\s*(?:小时|h|hr))?\s*(?:(\d+(?:\.\d+)?)\s*(?:分|m|min))?\s*(?:(\d+(?:\.\d+)?)\s*(?:秒|s|sec))?$/i.exec(s)
  if (cn && (cn[1] || cn[2] || cn[3])) {
    const h = Number(cn[1] ?? 0)
    const m = Number(cn[2] ?? 0)
    const sec = Number(cn[3] ?? 0)
    return round1(h * 3600 + m * 60 + sec)
  }

  // 「1:02:03」/「1:23.5」/「83」
  const parts = s.split(':')
  if (parts.length === 1) {
    const n = Number(parts[0])
    return Number.isFinite(n) && n >= 0 ? round1(n) : null
  }
  if (parts.length > 3) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null
  const sec = nums.reduce((acc, n) => acc * 60 + n, 0)
  return round1(sec)
}

/** 秒 → `mm:ss.s`（界面展示用）。 */
export function formatSeconds(sec) {
  const n = Number.isFinite(sec) ? Math.max(0, sec) : 0
  const h = Math.floor(n / 3600)
  const m = Math.floor((n % 3600) / 60)
  const s = n % 60
  const ss = s < 10 ? `0${s.toFixed(1)}` : s.toFixed(1)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * 规范化一个片段：钳制到 [0, duration]、时长过短/反向 ⇒ 拒绝并说明原因。
 * @returns {{ok:true, mark:object} | {ok:false, reason:string}}
 */
export function normalizeMark(input, { durationSec = null, source = 'manual', id = null, label = '', note = '' } = {}) {
  const start = Number(input?.start)
  const end = Number(input?.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, reason: '起止时间必须是数字' }
  let s = Math.max(0, round1(start))
  let e = round1(end)
  if (durationSec !== null && Number.isFinite(durationSec)) {
    if (s >= durationSec) return { ok: false, reason: `起点 ${formatSeconds(s)} 超出录像时长` }
    e = Math.min(e, durationSec)
    // 贴到录像末尾：用户把结束时间填到接近片尾（例如 599.94 / 600）时，
    // 不该因为"先四舍五入到 0.1 秒"而丢掉最后那一点点（599.94 → 599.9 会切掉结尾）。
    // ⚠️ 必须拿**原始值**比较：`600 - 599.9 = 0.10000000000002274` 会大于 0.1（浮点），
    // 用 `duration - e < 0.1` 判定会漏掉这个边界（实测）。
    if (end >= durationSec - 0.1) e = durationSec
  }
  if (e <= s) return { ok: false, reason: '结束时间必须晚于开始时间' }
  if (e - s < MIN_CLIP_SEC) return { ok: false, reason: `片段过短（不足 ${MIN_CLIP_SEC} 秒）` }
  return {
    ok: true,
    mark: {
      id: id ?? `m-${Math.round(s * 10)}-${Math.round(e * 10)}`,
      start: s,
      end: e,
      source,
      label: String(label ?? '').slice(0, 40),
      note: String(note ?? '').slice(0, 200)
    }
  }
}

/**
 * 找到弹幕密度曲线的**峰值时刻**（秒）。用于吸附（用户 Q2 = b）。
 *
 * 阈值用**中位数 + MAD**（稳健统计）而不是 mean + σ：
 * 一个特别大的峰值会把 σ 抬高，从而把**另一个真实的峰值**漏掉（实测：密度 [1,1.2,9,1.1,1,12,1]
 * 用 mean+1.5σ 只能找出 12，9 被漏掉）。中位数与 MAD 不受单个尖峰影响。
 * MAD = 0（数据过于平坦）时改用**相对阈值**（> 1.5×中位数），避免把整段都标成峰值。
 */
export function findDensityPeaks(windows, { k = 2 } = {}) {
  const list = Array.isArray(windows) ? windows.filter((w) => Number.isFinite(w?.density)) : []
  if (list.length === 0) return []
  const vals = list.map((w) => w.density).sort((a, b) => a - b)
  const med = vals[Math.floor(vals.length / 2)]
  const devs = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
  const mad = devs[Math.floor(devs.length / 2)]
  const threshold = mad > 0 ? med + k * 1.4826 * mad : med * 1.5
  const peaks = []
  for (let i = 0; i < list.length; i += 1) {
    const v = list[i].density
    if (v <= threshold) continue
    const prev = list[i - 1]?.density ?? -1
    const next = list[i + 1]?.density ?? -1
    if (v >= prev && v > next) peaks.push({ at: round1(list[i].start), density: v })
  }
  return peaks
}

/**
 * 吸附（用户 Q2 = b）：优先吸附到**弹幕峰值**（容差内），否则吸到**整秒**。
 * 每次都会报告"实际做了什么"（peak / second / none）—— 与项目"不假装"的原则一致。
 */
export function snapMark(mark, { peaks = [], toleranceSec = 1.5, snapSecond = true } = {}) {
  const near = (t) => {
    let best = null
    for (const p of peaks) {
      const d = Math.abs(p.at - t)
      if (d <= toleranceSec && (best === null || d < best.d)) best = { at: p.at, d }
    }
    return best === null ? null : best.at
  }
  const doSnap = (t) => {
    const p = near(t)
    if (p !== null) return { value: round1(p), how: 'peak' }
    if (snapSecond) return { value: Math.round(t), how: 'second' }
    return { value: round1(t), how: 'none' }
  }
  const s = doSnap(Number(mark.start))
  const e = doSnap(Number(mark.end))
  return {
    mark: { ...mark, start: s.value, end: e.value },
    snapped: { start: s.how, end: e.how }
  }
}

/**
 * 合并（用户 Q3 = a：**手动优先，自动整体降位**）。
 *
 * 规则顺序（顺序本身就是优先级）：
 *   ① 手动标记**全部先占位**（并做互相去重/间隔）；
 *   ② 自动片段按 score 降序填充**剩余名额**；
 *   ③ 与已占位区间重叠（或近于 minGapSec）的自动片段 ⇒ 丢弃并**记明原因**；
 *   ④ 总数不超过 maxClips。
 * ⇒ 手动标记永远不会因为没有名额而被挤掉（这是 Q3a 的硬承诺）。
 */
export function mergeMarks(manualMarks, autoClips, { maxClips = 20, minGapSec = 2, durationSec = null } = {}) {
  const dropped = []
  const kept = []

  const tryPush = (mark, strict) => {
    if (durationSec !== null && mark.start >= durationSec) {
      dropped.push({ id: mark.id, why: '起点超出录像时长' })
      return false
    }
    if (kept.some((k) => k.id === mark.id)) {
      dropped.push({ id: mark.id, why: '重复（同 id）' })
      return false
    }
    if (kept.some((k) => Math.abs(k.start - mark.start) < minGapSec)) {
      dropped.push({ id: mark.id, why: strict ? `手动标记之间过近（< ${minGapSec}s）` : `与已选片段过近（< ${minGapSec}s）` })
      return false
    }
    kept.push(mark)
    return true
  }

  for (const m of manualMarks ?? []) {
    const n = normalizeMark(m, { source: 'manual', id: m.id, label: m.label, note: m.note, durationSec })
    if (!n.ok) {
      dropped.push({ id: m?.id ?? '(手动)', why: n.reason })
      continue
    }
    tryPush(n.mark, true)
  }

  const manualCount = kept.length
  const auto = [...(autoClips ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  for (const c of auto) {
    if (kept.length >= maxClips) {
      dropped.push({ id: c.id, why: `名额已满（上限 ${maxClips}）` })
      continue
    }
    const n = normalizeMark({ start: c.start, end: c.end }, { source: c.source ?? 'llm', id: c.id, note: c.reason, label: c.label, durationSec })
    if (!n.ok) {
      dropped.push({ id: c.id, why: n.reason })
      continue
    }
    // ⚠️ 归一化只保证 start/end 安全，**不能顺手丢掉评分与理由**：
    //    界面要用它们排序与展示（曾因这里没透传而让 score 变成 null）。
    n.mark.score = Number.isFinite(c.score) ? c.score : null
    n.mark.reason = typeof c.reason === 'string' ? c.reason : ''
    const overlappingManual = kept.slice(0, manualCount).some((m) => n.mark.start < m.end && n.mark.end > m.start)
    if (overlappingManual) {
      dropped.push({ id: c.id, why: '与手动标记重叠（手动优先）' })
      continue
    }
    tryPush(n.mark, false)
  }

  kept.sort((a, b) => a.start - b.start)
  return { clips: kept, dropped, manualCount }
}

/** 序列化（`marks.json`）：便于复用上一场的标记。 */
export function serializeMarks(marks) {
  return JSON.stringify({ version: 1, marks: (marks ?? []).map((m) => ({ id: m.id, start: m.start, end: m.end, label: m.label ?? '', note: m.note ?? '' })) }, null, 2)
}

/** 反序列化：容忍坏数据并**回报跳过条数**（与弹幕解析同一原则）。 */
export function parseMarks(text) {
  try {
    const j = JSON.parse(text)
    const list = Array.isArray(j) ? j : j?.marks
    if (!Array.isArray(list)) return { marks: [], skipped: 0 }
    const marks = []
    let skipped = 0
    for (const m of list) {
      const n = normalizeMark(m, { source: 'manual', id: m?.id, label: m?.label, note: m?.note })
      if (n.ok) marks.push(n.mark)
      else skipped += 1
    }
    return { marks, skipped }
  } catch {
    return { marks: [], skipped: 0 }
  }
}
