import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * ② 手动标记（本地兜底）—— 用户决策：Q1=c 先做"输入起止秒"／Q2=b 吸附弹幕峰值或整秒／Q3=a 手动优先。
 *
 * 这一层的**硬承诺**：没有网络也必须能产片 ⇒ 手动标记在合并时**永远不会被自动结果挤掉**。
 */
const MARKS = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/marks.js')).href

type Mark = { id: string; start: number; end: number; source: string; label: string; note: string }
type Marks = {
  parseSeconds: (t: unknown) => number | null
  formatSeconds: (n: number) => string
  normalizeMark: (i: unknown, o?: Record<string, unknown>) => { ok: boolean; mark?: Mark; reason?: string }
  findDensityPeaks: (w: unknown[], o?: Record<string, unknown>) => Array<{ at: number }>
  snapMark: (m: Record<string, unknown>, o?: Record<string, unknown>) => { mark: { start: number; end: number }; snapped: { start: string; end: string } }
  mergeMarks: (man: unknown[], auto: unknown[], o?: Record<string, unknown>) => {
    clips: Mark[]
    dropped: Array<{ id: string; why: string }>
    manualCount: number
  }
  serializeMarks: (m: unknown[]) => string
  parseMarks: (t: string) => { marks: Mark[]; skipped: number }
}

let mk: Marks
beforeEach(async () => {
  mk = (await import(MARKS)) as never
})

describe('② 最小输入：起止时间解析（Q1=c）', () => {
  it('① 支持 秒 / 分:秒 / 时:分:秒 / 中文混排；非法输入返回 null 而不是猜', () => {
    expect(mk.parseSeconds('83')).toBe(83)
    expect(mk.parseSeconds('83.5')).toBe(83.5)
    expect(mk.parseSeconds('1:23')).toBe(83)
    expect(mk.parseSeconds('01:23.5')).toBe(83.5)
    expect(mk.parseSeconds('1:02:03')).toBe(3723)
    expect(mk.parseSeconds('1小时2分3秒')).toBe(3723)
    expect(mk.parseSeconds('2分'), '中文分钟').toBe(120)
    expect(mk.parseSeconds('abc'), '非法必须返回 null（不猜）').toBe(null)
    expect(mk.parseSeconds('1:2:3:4'), '超过三段视为非法').toBe(null)
    expect(mk.parseSeconds(''), '空串返回 null').toBe(null)
  })

  it('② 展示格式便于核对', () => {
    expect(mk.formatSeconds(83)).toBe('1:23.0')
    expect(mk.formatSeconds(3723)).toBe('1:02:03.0')
  })
})

describe('② 规范化：越界与过短都要**说明原因**', () => {
  it('③ 起点超出时长 ⇒ 拒绝并说明', () => {
    const r = mk.normalizeMark({ start: 700, end: 710 }, { durationSec: 600 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/超出录像时长/)
  })

  it('④ 结束早于开始 / 过短 ⇒ 拒绝', () => {
    expect(mk.normalizeMark({ start: 10, end: 9 }, { durationSec: 600 }).reason).toMatch(/必须晚于/)
    expect(mk.normalizeMark({ start: 10, end: 10.5 }, { durationSec: 600 }).reason).toMatch(/过短/)
  })

  it('⑤ 正常片段被钳制到录像时长并统一到 0.1 秒', () => {
    const r = mk.normalizeMark({ start: -3, end: 599.94 }, { durationSec: 600 })
    expect(r.ok).toBe(true)
    expect(r.mark?.start, '负数钳到 0').toBe(0)
    expect(r.mark?.end, '不超过时长且精确到 0.1 秒').toBe(600)
  })
})

describe('② 吸附（Q2=b）：优先弹幕峰值，否则整秒，并**报告实际做了什么**', () => {
  const windows = [
    { start: 0, end: 5, density: 1 },
    { start: 5, end: 10, density: 1.2 },
    { start: 10, end: 15, density: 9 }, // 峰值
    { start: 15, end: 20, density: 1.1 },
    { start: 20, end: 25, density: 1 },
    { start: 25, end: 30, density: 12 }, // 峰值
    { start: 30, end: 35, density: 1 }
  ]

  it('⑥ 容差内吸附到弹幕峰值，并标明 how=peak', () => {
    const peaks = mk.findDensityPeaks(windows)
    expect(peaks.map((p) => p.at), '应识别出两个明显峰值').toEqual([10, 25])
    const r = mk.snapMark({ start: 11.2, end: 24.6 }, { peaks })
    expect(r.mark.start, '吸到 10').toBe(10)
    expect(r.mark.end, '吸到 25').toBe(25)
    expect(r.snapped).toEqual({ start: 'peak', end: 'peak' })
  })

  it('⑦ 附近没有峰值 ⇒ 吸到整秒，并标明 how=second', () => {
    const r = mk.snapMark({ start: 41.4, end: 47.6 }, { peaks: [] })
    expect(r.mark.start).toBe(41)
    expect(r.mark.end).toBe(48)
    expect(r.snapped).toEqual({ start: 'second', end: 'second' })
  })
})

describe('② 合并（Q3=a 手动优先）：手动永远不被自动挤掉', () => {
  const auto = [
    { id: 'a1', start: 100, end: 110, score: 95, reason: '弹幕激增' },
    { id: 'a2', start: 200, end: 210, score: 90, reason: '名场面' },
    { id: 'a3', start: 300, end: 310, score: 80, reason: '普通' }
  ]

  it('⑧ 名额已满时，手动标记仍然全部保留，自动的才被丢弃', () => {
    const manual = [{ id: 'm1', start: 0, end: 10 }]
    const { clips, dropped, manualCount } = mk.mergeMarks(manual, auto, { maxClips: 2, minGapSec: 2, durationSec: 1000 })
    expect(manualCount, '手动占位 1 条').toBe(1)
    expect(clips.some((c) => c.id === 'm1'), '手动标记必须保留（哪怕名额很小）').toBe(true)
    expect(clips.length).toBe(2)
    expect(dropped.some((d) => /名额已满/.test(d.why)), '被丢弃的自动片段要说明原因').toBe(true)
  })

  it('⑨ 自动片段与手动标记重叠 ⇒ 丢弃并注明"手动优先"', () => {
    const manual = [{ id: 'm2', start: 105, end: 115 }]
    const { clips, dropped } = mk.mergeMarks(manual, auto, { maxClips: 10, minGapSec: 2, durationSec: 1000 })
    expect(clips.some((c) => c.id === 'a1'), '与手动重叠的自动片段应被丢弃').toBe(false)
    expect(dropped.find((d) => d.id === 'a1')?.why, '必须注明是"手动优先"').toMatch(/手动优先/)
    expect(clips.some((c) => c.id === 'm2')).toBe(true)
  })

  it('⑩ 自动片段按 score 降序竞争剩余名额（高分的先进）', () => {
    const { clips } = mk.mergeMarks([], auto, { maxClips: 2, minGapSec: 2, durationSec: 1000 })
    expect(clips.map((c) => c.id).sort(), '应选走 a1 与 a2').toEqual(['a1', 'a2'])
    expect(clips.map((c) => c.source), '来源要标明（下游导出不必区分，但要可追溯）').toEqual(['llm', 'llm'])
  })

  it('⑪ 输出按时间排序（界面与导出都更好用）', () => {
    const { clips } = mk.mergeMarks([{ id: 'm9', start: 500, end: 510 }], auto, { maxClips: 10, minGapSec: 2, durationSec: 1000 })
    const starts = clips.map((c) => c.start)
    expect([...starts].sort((a, b) => a - b)).toEqual(starts)
  })
})

describe('② 落盘与复用：marks.json 往返 + 坏数据计数', () => {
  it('⑫ 序列化/反序列化往返一致，坏条目要计数', () => {
    const text = mk.serializeMarks([{ id: 'm1', start: 1, end: 5, label: '开场', note: '留' }])
    const back = mk.parseMarks(text)
    expect(back.skipped).toBe(0)
    expect(back.marks[0]).toMatchObject({ id: 'm1', start: 1, end: 5, label: '开场' })

    const dirty = JSON.stringify({ version: 1, marks: [{ id: 'ok', start: 1, end: 5 }, { id: 'bad', start: 5, end: 5 }, { id: 'bad2' }] })
    const r = mk.parseMarks(dirty)
    expect(r.marks.map((m) => m.id)).toEqual(['ok'])
    expect(r.skipped, '坏条目必须计数').toBe(2)
    expect(mk.parseMarks('不是 JSON').marks).toEqual([])
  })

  it('⑬ 幂等：同输入 ⇒ 同输出（① 的教训：结果必须可复现）', () => {
    const manual = [{ id: 'm1', start: 3, end: 9 }]
    const a = mk.mergeMarks(manual, [{ id: 'a1', start: 20, end: 30, score: 50 }], { maxClips: 5, durationSec: 60 })
    const b = mk.mergeMarks(manual, [{ id: 'a1', start: 20, end: 30, score: 50 }], { maxClips: 5, durationSec: 60 })
    expect(a.clips).toEqual(b.clips)
    expect(a.dropped).toEqual(b.dropped)
  })
})
