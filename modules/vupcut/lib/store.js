/**
 * store：把"录像 + 弹幕"变成**带时间戳与稳定 id 的窗口清单**。
 *
 * 这一层是整个 VupCutCode 的地基，也是"时间戳永不经过模型"这条设计的落点：
 *   · 窗口由**确定性代码**切分，id 由**取整后的起点**推导（同输入 ⇒ 同 id ⇒ 幂等）；
 *   · 后续无论接规则、LLM 还是别的评分方式，都只在这个清单上做选择，
 *     **模型只回 id，不回时间** —— 因此时间戳不可能被模型破坏。
 *
 * 依赖注入：文件系统与"当前时间"由调用方传入（便于测试与实例注入测试）。
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

/** 视为录像的扩展名（只按扩展名索引，不探测文件内容 —— 探测交给后续的 FFprobe）。 */
const MEDIA_EXTS = new Set(['.mp4', '.mkv', '.flv', '.ts', '.mov', '.webm', '.m4v'])

/**
 * 列出目录下的录像文件（按修改时间倒序 ⇒ 最近一场在最前）。
 * 不递归、不读文件内容 ⇒ 大目录也很快。
 */
export async function listRecordings(dir) {
  if (!dir) return []
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (!e.isFile()) continue
    if (!MEDIA_EXTS.has(extname(e.name).toLowerCase())) continue
    const full = join(dir, e.name)
    try {
      const s = await stat(full)
      out.push({ path: full, name: e.name, sizeBytes: s.size, mtimeMs: s.mtimeMs })
    } catch {
      /* 单个文件读不到不影响整体索引 */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** 从一条弹幕记录里取出时间与文本 —— 兼容常见的几种字段命名（各导出工具不一致）。 */
function pickDanmaku(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const t = raw.time ?? raw.t ?? raw.ts ?? raw.progress ?? raw.at ?? raw.offset
  const text = raw.text ?? raw.content ?? raw.msg ?? raw.message ?? raw.danmaku
  if (typeof text !== 'string') return null
  let atMs = null
  if (typeof t === 'number' && Number.isFinite(t)) {
    // 约定：<1000 视为秒，否则视为毫秒（导出工具两种都有）
    atMs = t < 1000 ? Math.round(t * 1000) : Math.round(t)
  } else if (typeof t === 'string' && t.trim() !== '' && Number.isFinite(Number(t))) {
    const n = Number(t)
    atMs = n < 1000 ? Math.round(n * 1000) : Math.round(n)
  }
  if (atMs === null || atMs < 0) return null
  return { atMs, text }
}

/**
 * 解析弹幕文本。支持：
 *   · **JSONL**：每行一个 JSON 对象（字段命名兼容多种导出工具）；
 *   · **XML**（B 站弹幕格式）：`<d p="12.34,1,25,…">文本</d>`，p 的第一段是秒。
 * 返回 `{ items, skipped }` —— **跳过多少条必须回报**（否则用户会以为弹幕全用上了）。
 */
export function parseDanmaku(text, format = 'auto') {
  const items = []
  let skipped = 0
  const kind = format === 'auto' ? (/^\s*</.test(text) ? 'xml' : 'jsonl') : format

  if (kind === 'xml') {
    const re = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g
    let m
    while ((m = re.exec(text)) !== null) {
      const first = (m[1] ?? '').split(',')[0]
      const sec = Number(first)
      const body = m[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
      if (!Number.isFinite(sec) || sec < 0 || body === '') {
        skipped += 1
        continue
      }
      items.push({ atMs: Math.round(sec * 1000), text: body })
    }
    return { items: items.sort((a, b) => a.atMs - b.atMs), skipped }
  }

  for (const line of text.split('\n')) {
    const s = line.trim()
    if (s === '') continue
    let raw = null
    try {
      raw = JSON.parse(s)
    } catch {
      skipped += 1
      continue
    }
    const picked = pickDanmaku(raw)
    if (picked === null) {
      skipped += 1
      continue
    }
    items.push(picked)
  }
  return { items: items.sort((a, b) => a.atMs - b.atMs), skipped }
}

/** 窗口 id：由**取整后的起点**推导 ⇒ 同输入同 id（幂等，且重跑不产生新 id）。 */
export function windowId(sessionKey, startMs, bucketMs) {
  const idx = Math.floor(startMs / bucketMs)
  return `${sessionKey}-w${String(idx).padStart(5, '0')}`
}

/**
 * 把弹幕（与可选的转写）切成窗口。
 *
 * @param {object} args
 * @param {string} args.sessionKey 会话键（一般取录像文件名去扩展名）
 * @param {Array<{atMs:number,text:string}>} args.danmaku 弹幕（须已按时间排序）
 * @param {Array<{start:number,end:number,text:string}>} [args.transcript] 转写片段（秒），骨架阶段可为空
 * @param {number} [args.bucketMs] 窗口粒度（默认 5000ms）
 * @param {number} [args.durationMs] 已知时长；未提供则由弹幕末尾推断（并在 needDuration 里标注）
 * @param {number} [args.maxExcerptChars] 每窗口转写摘录上限（控制喂给 LLM 的体积）
 */
export function buildWindows({
  sessionKey,
  danmaku = [],
  transcript = [],
  bucketMs = 5000,
  durationMs = null,
  maxExcerptChars = 120
}) {
  if (!(bucketMs > 0)) throw new Error('bucketMs 必须为正数')
  const lastDanmaku = danmaku.length > 0 ? danmaku[danmaku.length - 1].atMs : 0
  const lastTranscript = transcript.length > 0 ? transcript[transcript.length - 1].end * 1000 : 0
  const inferred = Math.max(lastDanmaku, lastTranscript)
  const needDuration = durationMs === null
  const total = Math.max(durationMs ?? inferred, 0)

  const windows = []
  // 只用 start < total 的窗口：否则会在结尾多切一个**零长度空窗口**（会让"全场无高光"的
  // 判断与候选数都偏一位），也可能让界面显示一段并不存在的时间。
  for (let startMs = 0; startMs < total; startMs += bucketMs) {
    const endMs = Math.min(startMs + bucketMs, total)
    const msgs = danmaku.filter((d) => d.atMs >= startMs && d.atMs < endMs)
    const segs = transcript.filter((s) => s.end * 1000 > startMs && s.start * 1000 < endMs)
    let excerpt = segs.map((s) => s.text).join(' ').trim()
    if (excerpt.length > maxExcerptChars) excerpt = excerpt.slice(0, maxExcerptChars) + '…'
    windows.push({
      id: windowId(sessionKey, startMs, bucketMs),
      start: startMs / 1000,
      end: endMs / 1000,
      danmaku: msgs.length,
      density: Math.round((msgs.length / Math.max((endMs - startMs) / 1000, 0.001)) * 100) / 100,
      chars: excerpt.length,
      excerpt
    })
  }
  return { windows, needDuration, durationMs: total }
}

/** 便于界面提示：统计窗口里有多少是"完全空白"的（无弹幕且无转写）⇒ 提示用户检查数据源。 */
export function emptyWindowCount(windows) {
  return windows.filter((w) => w.danmaku === 0 && w.chars === 0).length
}

/** 读文件（注入点；测试可替换）。 */
export async function readText(path) {
  return readFile(path, 'utf8')
}
