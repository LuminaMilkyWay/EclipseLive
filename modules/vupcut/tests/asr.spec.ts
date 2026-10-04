import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * ⑥ 通用 ASR 客户端（用户决定：**手动输入 API**，与评分类似 ⇒ 不做厂商定制集成）。
 *
 * 三条要守的事：
 *   ① **multipart 而不是 JSON**（音频是二进制，JSON 序列化会毁掉它）—— 这是本轮在核心侧修的真缺口；
 *   ② **要时间戳就必须 verbose_json**（否则拿不到 segments ⇒ 字幕没时间轴）；
 *   ③ **音频绝不进日志**（比文本敏感得多）⇒ 客户端本身不打日志，由测试确认源码里没有音频落日志路径。
 */
const ASR = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/asr.js')).href

type Asr = {
  DEFAULT_TRANSCRIBE_PATH: string
  detectAsrFormat: (m: string, o?: Record<string, unknown>) => { format: string; guessed: boolean; reason: string }
  buildTranscribeRequest: (a: Record<string, unknown>) => {
    format: string
    guessed: boolean
    url: string
    method: string
    headers: Record<string, string>
    form: FormData
    multipart: boolean
  }
  normalizeSegments: (j: unknown) => { segments: Array<{ start: number; end: number; text: string }>; text: string }
  parseTranscribe: (j: unknown) => { segments: unknown[]; text: string; language: string | null; durationSec: number | null }
  describeAsrError: (e: unknown) => { message: string; retryable: boolean }
  estimateAudioHours: (s: number) => number
}

let asr: Asr
beforeEach(async () => {
  asr = (await import(ASR)) as never
})

const audio = new Uint8Array([1, 2, 3, 4, 5])

describe('⑥ ASR：接口形态识别（猜不出也能用）', () => {
  it('① 常见转录模型 ⇒ OpenAI 兼容；Google 系 ⇒ google；用户指定路径 ⇒ custom', () => {
    expect(asr.detectAsrFormat('whisper-1').format).toBe('openai')
    expect(asr.detectAsrFormat('mimo-v2.5-asr').format).toBe('openai')
    expect(asr.detectAsrFormat('whisper-large-v3-turbo').format).toBe('openai')
    expect(asr.detectAsrFormat('SenseVoice-Small').format).toBe('openai')
    expect(asr.detectAsrFormat('chirp_3').format).toBe('google')
    expect(asr.detectAsrFormat('whatever', { path: '/my/asr' }).format).toBe('custom')
    // 认不出 ⇒ 仍可用，但**如实标注是推测**
    expect(asr.detectAsrFormat('something-new').guessed).toBe(true)
    expect(asr.detectAsrFormat('').guessed).toBe(true)
  })
})

describe('⑥ ASR：请求是 multipart（不是 JSON）', () => {
  it('② 表单里有 file/model/response_format；文件名带正确后缀；**不手写 content-type**', () => {
    const r = asr.buildTranscribeRequest({
      model: 'whisper-1',
      apiKey: 'k-123',
      baseUrl: 'https://api.example.com/',
      audio,
      filename: 'clip01.mp3',
      language: 'zh',
      prompt: '主播名：某某'
    })
    expect(r.method).toBe('POST')
    expect(r.multipart).toBe(true)
    expect(r.url, 'base 结尾斜杠要被规整').toBe('https://api.example.com/v1/audio/transcriptions')
    expect(r.headers.authorization).toBe('Bearer k-123')
    expect(r.headers['content-type'], 'multipart 的 boundary 必须交给 fetch 生成').toBe(undefined)
    expect(r.form.get('model')).toBe('whisper-1')
    expect(r.form.get('language')).toBe('zh')
    expect(r.form.get('prompt')).toMatch(/主播名/)
    expect(r.form.get('response_format'), '要时间戳就必须 verbose_json').toBe('verbose_json')
    const file = r.form.get('file') as File
    expect(file, 'file 字段必须是 Blob/File').toBeTruthy()
    expect(file.name, '文件名要带后缀（各家按后缀判格式）').toBe('clip01.mp3')
  })

  it('③ 自建网关：用户填的路径与 base 都要生效（可指向任何服务）', () => {
    const r = asr.buildTranscribeRequest({
      model: 'custom-asr',
      apiKey: 'x',
      baseUrl: 'https://my-gw.local',
      path: '/audio/transcribe',
      audio
    })
    expect(r.url).toBe('https://my-gw.local/audio/transcribe')
    expect(r.format).toBe('custom')
  })

  it('④ 非法 response_format 被挡回 verbose_json（避免用户填错导致拿不到时间戳）', () => {
    const r = asr.buildTranscribeRequest({ model: 'whisper-1', apiKey: 'k', audio, responseFormat: 'xml' })
    expect(r.form.get('response_format')).toBe('verbose_json')
  })

  it('⑤ 不传 language/prompt 时就不带这两个字段（不发送空值）', () => {
    const r = asr.buildTranscribeRequest({ model: 'whisper-1', apiKey: 'k', audio })
    expect(r.form.get('language')).toBe(null)
    expect(r.form.get('prompt')).toBe(null)
  })
})

describe('⑥ ASR：响应解析（拿得到时间轴）', () => {
  it('⑥ verbose_json 的 segments ⇒ 片段时间轴（排序、过滤空段）', () => {
    const j = {
      language: 'zh',
      duration: 12.5,
      segments: [
        { start: 5, end: 7, text: '后半句' },
        { start: 0, end: 4.9, text: ' 前半句 ' },
        { start: 7, end: 7, text: '零长度要丢掉' },
        { start: 8, end: 9, text: '   ' }
      ]
    }
    const r = asr.parseTranscribe(j)
    expect(r.segments.length).toBe(2)
    expect((r.segments[0] as { text: string }).text, '要去空白').toBe('前半句')
    expect((r.segments[0] as { start: number }).start, '要按时间排序').toBe(0)
    expect(r.language).toBe('zh')
    expect(r.durationSec).toBe(12.5)
  })

  it('⑦ 纯文本响应 ⇒ 没有 segments 但文本要有（不能整条丢）', () => {
    const r = asr.parseTranscribe({ text: '只有纯文本' })
    expect(r.text).toBe('只有纯文本')
    expect(r.segments).toEqual([])
    expect(r.durationSec, '没有时长就如实给 null').toBe(null)
  })

  it('⑧ 无 segments 时用最后一段的 end 兜底当总时长', () => {
    const r = asr.parseTranscribe({ segments: [{ start: 0, end: 3, text: 'a' }, { start: 3, end: 9.5, text: 'b' }] })
    expect(r.durationSec).toBe(9.5)
  })

  it('⑨ 空/异常响应不得抛错（转成空结果即可）', () => {
    expect(asr.parseTranscribe(null).text).toBe('')
    expect(asr.normalizeSegments(undefined).segments).toEqual([])
    expect(asr.normalizeSegments('纯字符串').text).toBe('纯字符串')
  })
})

describe('⑥ ASR：错误翻译与成本单位', () => {
  it('⑩ 401/429/413 分别给可操作的话，并标明是否可重试', () => {
    expect(asr.describeAsrError({ status: 401 }).retryable).toBe(false)
    expect(asr.describeAsrError({ status: 401 }).message).toMatch(/密钥/)
    expect(asr.describeAsrError({ status: 429 }).retryable).toBe(true)
    expect(asr.describeAsrError({ status: 503 }).retryable).toBe(true)
    expect(asr.describeAsrError({ status: 413 }).message).toMatch(/分片时长/)
    expect(asr.describeAsrError('audio decode failed').message).toMatch(/mp3\/wav|格式/)
    expect(asr.describeAsrError('请求超时').retryable).toBe(true)
  })

  it('⑪ 时长 → 小时（成本模型按 perHourAudio 计价，必须给小时）', () => {
    expect(asr.estimateAudioHours(3600)).toBe(1)
    expect(asr.estimateAudioHours(1800)).toBe(0.5)
    expect(asr.estimateAudioHours(0)).toBe(0)
    expect(asr.estimateAudioHours(-5)).toBe(0)
    // 一场 4 小时直播：MiMo ASR 按 ¥0.5/小时 ⇒ ¥2；与成本模型的单位对齐
    expect(asr.estimateAudioHours(4 * 3600) * 0.5).toBe(2)
  })

  it('⑫ 客户端自身**不打日志**（音频内容绝不落日志）', () => {
    const src = readFileSync(resolve(process.cwd(), 'modules/vupcut/lib/asr.js'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code, 'ASR 客户端不应有任何日志调用').not.toMatch(/logger\.|console\./)
    expect(code, '不得把音频字节写进任何字符串拼接').not.toMatch(/JSON\.stringify\([^)]*audio/)
  })
})
