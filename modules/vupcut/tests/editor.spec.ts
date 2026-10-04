import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⑤ 导出（用户决策：Q1=a 默认 copy 粗剪 + 帧精确开关／Q2=a 关键帧**往前回退**／
 * Q3=a 保持原比例 + 可选竖屏 + **字幕外挂 SRT 不烧**）。
 *
 * 这组测试守三件容易出人命的事：
 *   ① **`-ss` 必须在 `-i` 之前**（输入侧定位 ⇒ 快 + 自动回退关键帧）；放到后面会先解整段 ⇒ 极慢；
 *   ② **字幕时间必须减去片段起点**（① 那轮的教训：不减就整体偏移）；
 *   ③ **单条失败不能卡死批量**（如实回报每条的成败与原因）。
 */
const EDIT = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/editor.js')).href

type Edit = {
  DEFAULTS: Record<string, unknown>
  srtTime: (n: number) => string
  srtFromTranscript: (s: unknown[], from: number, to: number) => string
  outputName: (a: Record<string, unknown>) => string
  VERTICAL_FILTER: string
  buildCutArgs: (a: Record<string, unknown>) => string[]
  looksLikeKeyframeProblem: (m: string) => boolean
  exportClips: (a: Record<string, unknown>) => Promise<{
    ok: boolean
    total: number
    exported: number
    failed: number
    cancelled: boolean
    results: Array<{ id: string; ok: boolean; output?: string; srt?: string | null; error?: string; note?: string | null }>
  }>
}

let ed: Edit
beforeEach(async () => {
  ed = (await import(EDIT)) as never
})

describe('⑤ FFmpeg 参数：输入侧定位 + copy/帧精确（Q1/Q2）', () => {
  it('① copy 模式：`-ss` 必须在 `-i` **之前**（否则先解整段、极慢），且用 `-c copy`', () => {
    const args = ed.buildCutArgs({ input: 'in.mp4', output: 'out.mp4', startSec: 12.5, endSec: 30, mode: 'copy' })
    const iSs = args.indexOf('-ss')
    const iIn = args.indexOf('-i')
    expect(iSs, '必须有 -ss').toBeGreaterThan(-1)
    expect(iIn).toBeGreaterThan(-1)
    expect(iSs, '-ss 必须在 -i 之前（输入侧定位 ⇒ 自动回退到最近关键帧）').toBeLessThan(iIn)
    expect(args).toContain('-c')
    expect(args[args.indexOf('-c') + 1]).toBe('copy')
    expect(args[args.length - 1], '最后一项是输出路径').toBe('out.mp4')
    expect(args[args.indexOf('-t') + 1], '时长 = 30 - 12.5').toBe('17.500')
  })

  it('② 帧精确模式：H.264 + CRF + AAC + faststart（可精确切点）', () => {
    const args = ed.buildCutArgs({ input: 'in.mp4', output: 'o.mp4', startSec: 0, endSec: 5, mode: 'precise', crf: 18, preset: 'medium' })
    expect(args).toContain('libx264')
    expect(args[args.indexOf('-crf') + 1]).toBe('18')
    expect(args[args.indexOf('-preset') + 1]).toBe('medium')
    expect(args).toContain('aac')
    expect(args).toContain('+faststart')
    expect(args, '精确模式不得用 copy').not.toContain('copy')
  })

  it('③ 竖屏：精确模式加裁切滤镜；**copy 模式明确报错**（而不是悄悄忽略用户要求）', () => {
    const v = ed.buildCutArgs({ input: 'i.mp4', output: 'o.mp4', startSec: 0, endSec: 5, mode: 'precise', vertical: true })
    expect(v).toContain('-vf')
    expect(v[v.indexOf('-vf') + 1]).toBe(ed.VERTICAL_FILTER)
    expect(ed.VERTICAL_FILTER, '9:16 竖屏').toContain('1080:1920')

    expect(() => ed.buildCutArgs({ input: 'i.mp4', output: 'o.mp4', startSec: 0, endSec: 5, mode: 'copy', vertical: true })).toThrow(/copy 模式无法裁切/)
  })

  it('④ 极短片段也给出正时长（避免 -t 0 产出空文件）', () => {
    const args = ed.buildCutArgs({ input: 'i.mp4', output: 'o.mp4', startSec: 10, endSec: 10, mode: 'copy' })
    expect(Number(args[args.indexOf('-t') + 1])).toBeGreaterThan(0)
  })
})

describe('⑤ 字幕：时间轴必须减去片段起点（Q3：外挂不烧）', () => {
  it('⑤ SRT 时间戳格式正确（HH:MM:SS,mmm）', () => {
    expect(ed.srtTime(0)).toBe('00:00:00,000')
    expect(ed.srtTime(12.5)).toBe('00:00:12,500')
    expect(ed.srtTime(3723.004)).toBe('01:02:03,004')
    expect(ed.srtTime(-5), '负数钳制到 0').toBe('00:00:00,000')
  })

  it('⑥ 片段内时间轴：转写 100~110 秒、片段从 105 秒起 ⇒ 字幕从 0 开始（**减掉起点**）', () => {
    const srt = ed.srtFromTranscript(
      [
        { start: 100, end: 106, text: '前半句' }, // 与片段相交 ⇒ 起点被钳到片段起点
        { start: 106, end: 108, text: '后半句' },
        { start: 200, end: 205, text: '片段外' } // 不相交 ⇒ 跳过
      ],
      105,
      110
    )
    expect(srt, '不得包含片段外的字幕').not.toMatch(/片段外/)
    expect(srt, '第一条应从 0 开始（100 被钳到 105 ⇒ 105-105=0）').toMatch(/1\n00:00:00,000 --> 00:00:01,000\n前半句/)
    expect(srt, '第二条 106-105=1 秒').toMatch(/2\n00:00:01,000 --> 00:00:03,000\n后半句/)
  })

  it('⑦ 空文本/无交集 ⇒ 不产生空字幕条目；无转写 ⇒ 空串', () => {
    expect(ed.srtFromTranscript([{ start: 0, end: 1, text: '   ' }], 0, 5)).toBe('')
    expect(ed.srtFromTranscript([], 0, 5)).toBe('')
  })
})

describe('⑤ 批量导出：注入假 ffmpeg 端口（无真实转码）', () => {
  const clips = [
    { id: 'c1', start: 0, end: 10 },
    { id: 'c2', start: 100, end: 110 },
    { id: 'c3', start: 200, end: 210 }
  ]

  it('⑧ 逐条导出、命名含场次与起止、写外挂 SRT（**不烧字幕**）', async () => {
    const runs: string[][] = []
    const written: Array<{ p: string; t: string }> = []
    const ffmpeg = {
      run: async (args: string[]) => {
        runs.push(args)
        return { ok: true, code: 0 }
      }
    }
    const r = await ed.exportClips({
      clips,
      recording: 'D:/rec/2026-10-03 场次.mp4',
      outputDir: 'D:/out',
      ffmpeg,
      transcript: [{ start: 101, end: 103, text: '你好' }],
      writeFileImpl: async (p: string, t: string) => void written.push({ p, t })
    })
    expect(r.ok).toBe(true)
    expect(r.exported).toBe(3)
    expect(runs).toHaveLength(3)
    expect(runs[0], 'copy 模式').toContain('copy')
    expect(r.results[0].output, '文件名含场次与起止').toMatch(/2026-10-03_场次_001_00000-00010\.mp4$/)
    expect(written.length, '应写出 SRT').toBe(1)
    expect(written[0].p, 'SRT 与 MP4 同名').toMatch(/\.srt$/)
    expect(written[0].t, 'SRT 内容时间相对片段（101-100=1 秒）').toMatch(/00:00:01,000/)
    expect(r.results[0].note, 'copy 模式的固有限差要如实说明').toMatch(/关键帧/)
  })

  it('⑨ 单条失败**不卡死**批量：其余照常导出，失败条给出原因与建议', async () => {
    let n = 0
    const ffmpeg = {
      run: async () => {
        n += 1
        if (n === 2) return { ok: false, code: 1, stderr: 'Invalid data found when processing input' }
        return { ok: true, code: 0 }
      }
    }
    const r = await ed.exportClips({ clips, recording: 'in.mp4', outputDir: 'out', ffmpeg, makeSrt: false, writeFileImpl: async () => {} })
    expect(r.exported).toBe(2)
    expect(r.failed).toBe(1)
    expect(r.results[1].ok).toBe(false)
    expect(r.results[1].error).toMatch(/退出码 1/)
    expect(r.results[1].hint, '关键帧类问题要给出可操作建议').toMatch(/帧精确/)
  })

  it('⑩ 取消 ⇒ 剩余片段标记跳过并保留已完成结果（不丢工作）', async () => {
    const signal = { aborted: false }
    const ffmpeg = {
      run: async () => {
        signal.aborted = true // 第一条之后就取消
        return { ok: true, code: 0 }
      }
    }
    const r = await ed.exportClips({ clips, recording: 'in.mp4', outputDir: 'out', ffmpeg, signal, makeSrt: false, writeFileImpl: async () => {} })
    expect(r.cancelled).toBe(true)
    expect(r.exported, '已完成的第一条要保留').toBe(1)
    expect(r.results[2].error).toMatch(/取消/)
  })

  it('⑪ 缺 ffmpeg 端口 ⇒ 明确报错（不得偷偷自己起进程）', async () => {
    await expect(ed.exportClips({ clips, recording: 'in.mp4', outputDir: 'out', ffmpeg: null })).rejects.toThrow(/ffmpeg 端口/)
  })

  it('⑫ 竖屏 + copy ⇒ 该条失败但**原因明确**（不静默产出未裁切的片子）', async () => {
    const ffmpeg = { run: vi.fn(async () => ({ ok: true, code: 0 })) }
    const r = await ed.exportClips({ clips: [clips[0]], recording: 'in.mp4', outputDir: 'out', ffmpeg, vertical: true, mode: 'copy', makeSrt: false })
    expect(r.exported).toBe(0)
    expect(r.results[0].error).toMatch(/copy 模式无法裁切/)
    expect(ffmpeg.run, '不该调用 ffmpeg').not.toHaveBeenCalled()
  })
})
