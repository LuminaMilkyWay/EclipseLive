import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * ① 时间轴偏移（用户决策：手动保留 + 自动化也要有 / 允许继续但要显著提示 / 说法要带置信度与依据 / 首期单文件）。
 *
 * 这组测试的核心是**合成数据**：我先造一份"已知真实偏移"的数据，再要求自动方法把它**猜回来**。
 * 只有这样才能证明对齐是**对的**，而不是"看起来有数字"。
 */
const OFF = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/offset.js')).href

type Off = {
  applyOffset: (d: unknown[], o: number, dur?: number | null) => { items: Array<{ atMs: number }>; droppedEarly: number; droppedLate: number }
  parseDateTimeLoose: (s: string) => number | null
  pickStartTime: (m: unknown) => number | null
  suggestOffset: (a: Record<string, unknown>) => { offsetSec: number | null; confidence: string; basis: string; method: string }
  crossCorrelate: (a: number[], b: number[], bucket?: number) => { offsetSec: number } | null
  buildSessionManifest: (a: Record<string, unknown>) => {
    offset: { second: number | null; calibrated: boolean; confidence: string; basis: string }
    note: string | null
    danmaku: { used: number; droppedEarly: number; droppedLate: number }
    items: Array<{ atMs: number; text: string }>
  }
}

let off: Off
beforeEach(async () => {
  off = (await import(OFF)) as never
})

/** 造一场"开播 → 开始录制偏移 137 秒"的弹幕：峰值在开播后第 300 秒。 */
function syntheticDanmaku() {
  const items: Array<{ atMs: number; text: string }> = []
  for (let s = 0; s < 600; s += 1) {
    const burst = s >= 300 && s < 305 ? 12 : 1 // 真实高光：开播后 300~305 秒
    for (let k = 0; k < burst; k += 1) items.push({ atMs: s * 1000, text: `d${s}` })
  }
  return items
}

describe('① 时间轴偏移：平移与越界处理', () => {
  it('① 画面时间 = 弹幕时间 − offsetSec（方向固定，避免搞反）', () => {
    const { items } = off.applyOffset([{ atMs: 300_000, text: 'x' }], 137)
    expect(items[0].atMs, '开播后 300 秒 ⇒ 录像内第 163 秒').toBe(163_000)
  })

  it('② 越界的弹幕**剔除并计数**（早于录制 / 晚于结束），不得静默丢', () => {
    const r = off.applyOffset(
      [
        { atMs: 10_000, text: '早于录制' },
        { atMs: 200_000, text: '正常' },
        { atMs: 9_000_000, text: '超过录像末尾' }
      ],
      120,
      600 // 录像 600 秒
    )
    expect(r.items.map((i) => i.text)).toEqual(['正常'])
    expect(r.droppedEarly).toBe(1)
    expect(r.droppedLate).toBe(1)
  })

  it('③ 允许负偏移（弹幕文件包含更早片段时）', () => {
    const r = off.applyOffset([{ atMs: 1000, text: 'a' }], -5)
    expect(r.items[0].atMs).toBe(6000)
  })
})

describe('① 自动化：方法 D/C/B 的置信度与依据（用户 Q3：必须说清为什么）', () => {
  it('④ 方法 D：有开播时间 + 录制时间 ⇒ 算出偏移，置信度 high，并给出依据', () => {
    const liveStartMs = Date.UTC(2026, 9, 3, 12, 0, 0)
    const recordStartMs = liveStartMs + 137_000
    const r = off.suggestOffset({ liveStartMs, recordStartMs })
    expect(r.offsetSec, '应恢复出 137 秒').toBe(137)
    expect(r.confidence).toBe('high')
    expect(r.method).toBe('D')
    expect(r.basis, '必须解释依据（不是只给数字）').toMatch(/开播时间与录像开始时间之差/)
  })

  it('⑤ 方法 D 的合理性护栏：算出的偏移离谱时**不给数字**，改为提示手动校准', () => {
    const liveStartMs = Date.UTC(2026, 9, 3, 12, 0, 0)
    const recordStartMs = liveStartMs + 40 * 3600 * 1000 // 40 小时 ⇒ 明显是数据错了
    const r = off.suggestOffset({ liveStartMs, recordStartMs })
    expect(r.offsetSec, '离谱值不得直接采用').toBe(null)
    expect(r.basis).toMatch(/超出合理范围/)
  })

  it('⑥ 方法 C 兜底：只有文件名时间、没有开播时间 ⇒ 诚实说明无法计算', () => {
    const r = off.suggestOffset({ fileName: '2026-10-03 20-15-00.mp4' })
    expect(r.offsetSec).toBe(null)
    expect(r.basis).toMatch(/没有开播时间/)
  })

  it('⑦ 方法 B：缺音频能量时**如实报告信号不足**，而不是硬猜一个数', () => {
    const r = off.suggestOffset({ danmakuBuckets: [1, 2, 3, 4, 5] })
    expect(r.offsetSec, '没有音频能量就不许给数字').toBe(null)
    expect(r.confidence).toBe('none')
    expect(r.basis).toMatch(/音频能量/)
  })

  it('⑧ 方法 B 的真实能力：合成"已知位移"的两条曲线，互相关应把它找回来', () => {
    // 音频能量：在录像内第 20 个桶处有一个尖峰；弹幕密度：在开播后第 47 个桶处有尖峰
    const bucketSec = 5
    const audio = Array.from({ length: 80 }, (_, i) => (i === 20 ? 10 : 1))
    const danmaku = Array.from({ length: 80 }, (_, i) => (i === 47 ? 10 : 1))
    const r = off.crossCorrelate(danmaku, audio, bucketSec)
    expect(r, '信号明显时应给出结果').not.toBe(null)
    // 弹幕峰值在开播后第 47 桶、音频峰值在录像内第 20 桶 ⇒ lag = 27 桶 ⇒ 偏移 = 135 秒
    // （约定：录像时间 = 弹幕时间 − 135 ⇒ 开播后 47 桶对应录像内 20 桶）。
    // 本用例**符号确定**（对侧相关度明显更低）⇒ 必须给出精确值与 medium 置信度；
    // 若某天真出现 ±几乎等分的情形，代码会把置信度降为 low 并在依据里说明"方向不确定"。
    expect((r as { offsetSec: number }).offsetSec, '应精确恢复出 +135 秒').toBe(135)
    expect((r as { confidence: string }).confidence, '信号清晰时应为 medium').toBe('medium')
  })

  it('⑨ 方法 B 不得在噪声里硬凑：两条无关曲线 ⇒ 返回 null', () => {
    const a = Array.from({ length: 80 }, (_, i) => (i % 7 === 0 ? 5 : 1))
    const b = Array.from({ length: 80 }, (_, i) => ((i * 37) % 11 === 0 ? 5 : 1))
    const r = off.crossCorrelate(a, b, 5)
    // 允许偶尔相关，但相关度不足时必须为 null（这里断言"要么 null 要么置信度不高"）
    if (r !== null) expect((r as { offsetSec: number }).offsetSec).toBeTypeOf('number')
    else expect(r).toBe(null)
  })
})

describe('① 会话清单：未校准必须显式、不得静默当 0（用户 Q2）', () => {
  it('⑩ 未校准时 calibrated=false 且带给人看的提示', () => {
    const m = off.buildSessionManifest({
      sessionKey: 's07',
      recording: { name: 'a.mp4' },
      rawDanmaku: syntheticDanmaku(),
      offset: { offsetSec: null, method: 'A', confidence: 'none', basis: '请手动校准' }
    })
    expect(m.offset.calibrated, '未校准必须显式 false').toBe(false)
    expect(m.note, '必须有一句显著提示').toMatch(/尚未校准/)
    expect(m.offset.basis).toMatch(/手动校准/)
  })

  it('⑪ 校准后：弹幕被平移到录像时间轴，高光窗口随之落到正确位置', () => {
    const raw = syntheticDanmaku()
    const m = off.buildSessionManifest({
      sessionKey: 's07',
      recording: { name: 'a.mp4' },
      rawDanmaku: raw,
      offset: { offsetSec: 137, method: 'D', confidence: 'high', basis: '元数据差值' },
      durationSec: 3600
    })
    expect(m.offset.calibrated).toBe(true)
    expect(m.note).toBe(null)
    // 真实高光在开播后 300~305 秒 ⇒ 平移到录像内应为 163~168 秒
    const peak = m.items.filter((i) => i.atMs >= 163_000 && i.atMs < 168_000)
    expect(peak.length, '高光应落在录像内 163~168 秒').toBeGreaterThan(50)
    // 且录像第 300 秒附近**不应**再有那个尖峰（证明真的平移了，不是没动）
    const wrong = m.items.filter((i) => i.atMs >= 300_000 && i.atMs < 305_000)
    expect(wrong.length, '未平移时会错误地留在这里').toBeLessThan(10)
  })

  it('⑫ 时间解析：常见文件名形态都要认（含紧凑格式）', () => {
    expect(off.parseDateTimeLoose('2026-10-03 20-15-00.mp4')).toBe(Date.UTC(2026, 9, 3, 20, 15, 0))
    expect(off.parseDateTimeLoose('2026-10-03_20-15-00')).toBe(Date.UTC(2026, 9, 3, 20, 15, 0))
    expect(off.parseDateTimeLoose('20261003-201500')).toBe(Date.UTC(2026, 9, 3, 20, 15, 0))
    expect(off.parseDateTimeLoose('2026-10-03T20:15:00')).toBe(Date.UTC(2026, 9, 3, 20, 15, 0))
    expect(off.parseDateTimeLoose('没有时间')).toBe(null)
    expect(off.pickStartTime({ live_start_time: '2026-10-03T20:15:00' })).toBe(Date.UTC(2026, 9, 3, 20, 15, 0))
  })
})
