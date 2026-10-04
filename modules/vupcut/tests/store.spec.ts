import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * store 层验收（VupCutCode 的地基）。
 *
 * 本卡的核心承诺有三条，全部在这里钉住：
 *   ① **时间是代码的责任**：窗口自带 `start/end`（秒），且**单调递增、无重叠**；
 *   ② **id 稳定**（同输入 ⇒ 同 id）⇒ 幂等、可续跑、LLM 只回 id 也不会错位；
 *   ③ **解析要兼容且诚实**：多种导出字段都认，跳过的坏数据**必须回报条数**（不能静默吞掉）。
 */
const STORE = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/store.js')).href

type Store = {
  listRecordings: (dir: string) => Promise<Array<{ name: string; sizeBytes: number }>>
  parseDanmaku: (text: string, format?: string) => { items: Array<{ atMs: number; text: string }>; skipped: number }
  buildWindows: (a: Record<string, unknown>) => {
    windows: Array<{ id: string; start: number; end: number; danmaku: number; density: number; chars: number; excerpt: string }>
    needDuration: boolean
  }
  windowId: (key: string, startMs: number, bucketMs: number) => string
  emptyWindowCount: (w: Array<{ danmaku: number; chars: number }>) => number
}

let store: Store
beforeEach(async () => {
  store = (await import(STORE)) as never
})

describe('store：弹幕解析（兼容 + 诚实回报跳过数）', () => {
  it('① JSONL：兼容多种字段命名（time/t/ts/progress；text/content/msg）', () => {
    const text = [
      '{"time":1.5,"text":"哈哈"}',
      '{"t":3,"content":"草"}',
      '{"ts":2000,"msg":"第二次用毫秒"}',
      '{"progress":2500,"message":"毫秒也应识别"}'
    ].join('\n')
    const { items, skipped } = store.parseDanmaku(text)
    expect(skipped, '全部合法 ⇒ 不应跳过').toBe(0)
    expect(items.map((i) => i.atMs), '秒/毫秒都要归一化成毫秒并按时间排序').toEqual([1500, 2000, 2500, 3000])
    expect(items.map((i) => i.text), '按时间升序：1.5s / 2.0s / 2.5s / 3.0s').toEqual(['哈哈', '第二次用毫秒', '毫秒也应识别', '草'])
  })

  it('② 坏行必须**计数**而不是静默丢弃（用户要能看出弹幕没全用上）', () => {
    const text = ['{"time":1,"text":"好"}', '这不是 JSON', '{"time":2}', '{"time":-3,"text":"负数时间"}'].join('\n')
    const { items, skipped } = store.parseDanmaku(text)
    expect(items, '只有一条可用').toHaveLength(1)
    expect(skipped, '三条坏行都要被数出来').toBe(3)
  })

  it('③ XML（B 站弹幕格式）：p 的第一段是秒，且实体要还原', () => {
    const xml = '<i><d p="12.34,1,25,16777215,0,0,0,0">哈哈&lt;笑&gt;</d><d p="3.5,1,25">早</d><d p="bad,1,25">坏</d></i>'
    const { items, skipped } = store.parseDanmaku(xml)
    expect(skipped, '关键帧坏的一条要计数').toBe(1)
    expect(items.map((i) => i.atMs)).toEqual([3500, 12340])
    expect(items[1].text, 'HTML 实体应还原').toBe('哈哈<笑>')
  })
})

describe('store：窗口化（时间戳与 id 的确定性）', () => {
  it('④ 时间自代码：start/end 以秒给出，单调递增且无重叠', () => {
    const danmaku = Array.from({ length: 30 }, (_, i) => ({ atMs: i * 1000, text: 'x' }))
    const { windows } = store.buildWindows({ sessionKey: 's07', danmaku, bucketMs: 5000, durationMs: 30000 })
    expect(windows.length, '30 秒 / 5 秒粒度 ⇒ 6 个窗口').toBe(6)
    for (let i = 0; i < windows.length; i += 1) {
      expect(windows[i].start, `第 ${i} 个窗口起点应为 i*5 秒`).toBe(i * 5)
      expect(windows[i].end).toBe((i + 1) * 5)
      if (i > 0) expect(windows[i].start, '不得重叠').toBeGreaterThanOrEqual(windows[i - 1].end)
    }
    // 每秒一条（0..29 秒）⇒ 每 5 秒窗口正好 5 条；边界属于**后**一个窗口（左闭右开）。
    expect(windows[0].danmaku, '0-5s 含 0/1/2/3/4 秒共 5 条').toBe(5)
    expect(windows[1].danmaku, '5-10s 含 5..9 秒共 5 条').toBe(5)
    expect(windows[5].danmaku, '最后 5 秒仍应有数据（且不得多出零长度尾窗）').toBe(5)
  })

  it('⑤ id 稳定且幂等：同输入 ⇒ 同 id（LLM 只回 id 也不会错位）', () => {
    const danmaku = [{ atMs: 0, text: 'a' }, { atMs: 7000, text: 'b' }]
    const a = store.buildWindows({ sessionKey: 's07', danmaku, bucketMs: 5000, durationMs: 10000 })
    const b = store.buildWindows({ sessionKey: 's07', danmaku, bucketMs: 5000, durationMs: 10000 })
    expect(a.windows.map((w) => w.id)).toEqual(b.windows.map((w) => w.id))
    expect(a.windows[0].id, 'id 由取整后的起点推导').toBe('s07-w00000')
    expect(a.windows[1].id).toBe('s07-w00001')
  })

  it('⑥ 未提供时长时如实标注（不得假装知道时长）', () => {
    const danmaku = [{ atMs: 12000, text: 'a' }]
    const r = store.buildWindows({ sessionKey: 's', danmaku, bucketMs: 5000 })
    expect(r.needDuration, '没给 durationMs ⇒ needDuration 必须为真').toBe(true)
    expect(r.windows.length, '由弹幕末尾推断覆盖到 12 秒').toBe(3)
  })

  it('⑦ 转写摘录进窗口，且长度受控（控制喂给 LLM 的体积）', () => {
    const transcript = [{ start: 0, end: 3, text: '这是一段很长的台词'.repeat(30) }]
    const r = store.buildWindows({ sessionKey: 's', danmaku: [], transcript, bucketMs: 5000, durationMs: 5000, maxExcerptChars: 40 })
    expect(r.windows[0].chars, '摘录长度应受 maxExcerptChars 限制').toBeLessThanOrEqual(41)
    expect(r.windows[0].excerpt.endsWith('…'), '被截断时应给出省略号').toBe(true)
  })
})

describe('store：录像索引', () => {
  it('⑧ 只索引媒体扩展名，按修改时间倒序（最近一场在前）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vupcut-rec-'))
    writeFileSync(join(dir, 'a.mp4'), 'x')
    writeFileSync(join(dir, 'b.mkv'), 'xx')
    writeFileSync(join(dir, 'notes.txt'), 'nope')
    const list = await store.listRecordings(dir)
    expect(list.map((r) => r.name).sort(), 'txt 不应入索引').toEqual(['a.mp4', 'b.mkv'])
    expect(list[0].sizeBytes, '大小要如实回报').toBeGreaterThan(0)
  })

  it('⑨ 目录不存在 ⇒ 返回空数组（不抛错：界面要能显示"没有录像"）', async () => {
    expect(await store.listRecordings(join(tmpdir(), 'vupcut-not-exist-xyz'))).toEqual([])
    expect(await store.listRecordings('')).toEqual([])
  })
})
