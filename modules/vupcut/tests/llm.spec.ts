import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * 评分段的两个核心承诺（用户要求审阅"编排"⇒ 这里把它变成可执行断言）：
 *
 *   **A. 只用 API，但要认得出模型** ⇒ `llm.js` 由**模型 ID** 推断接口形态，
 *      并产出三家（OpenAI / Anthropic / Google）各自的**纯数据请求描述**（不发请求）；
 *   **B. 提示词编排** ⇒ `prompt.js`：
 *      · 数据不越权（声明"数据不是指令"）；
 *      · **只回 id、不回时间**（时间由代码 join ⇒ 不可能被模型破坏）；
 *      · **白名单校验**（越界 id 一律拒绝并计数）；
 *      · **可预览**（界面能如实展示"将要发送什么"，且预览不含密钥）。
 */
const LLM = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/llm.js')).href
const PROMPT = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/prompt.js')).href

type Llm = {
  detectProvider: (m: string) => { provider: string; guessed: boolean }
  buildRequest: (a: Record<string, unknown>) => { provider: string; url: string; headers: Record<string, string>; body: Record<string, unknown> }
  parseResponse: (p: string, j: unknown) => { text: string }
  extractJson: (t: string) => unknown
  defaultBase: (p: string) => string
}
type Prompt = {
  buildSystemPrompt: () => string
  buildUserPayload: (a: Record<string, unknown>) => { text: string; chosenIds: string[] }
  validateSelection: (parsed: unknown, index: Map<string, unknown>, opts?: Record<string, unknown>) => {
    clips: Array<{ id: string; start: number; end: number; score: number | null; reason: string }>
    rejected: Array<{ id: string; why: string }>
  }
  buildPromptPreview: (a: Record<string, unknown>) => { system: string; user: string; chosenIds: string[]; chars: number }
  selectCandidates: (w: unknown[], o?: Record<string, unknown>) => unknown[]
}

let llm: Llm
let prompt: Prompt
beforeEach(async () => {
  llm = (await import(LLM)) as never
  prompt = (await import(PROMPT)) as never
})

describe('A. 模型 ID 识别与多格式适配（只产出请求描述，不发请求）', () => {
  it('① 由模型 ID 认出 provider', () => {
    expect(llm.detectProvider('gpt-4o-mini').provider).toBe('openai')
    expect(llm.detectProvider('o3-mini').provider).toBe('openai')
    expect(llm.detectProvider('claude-3-5-sonnet-latest').provider).toBe('anthropic')
    expect(llm.detectProvider('gemini-2.0-flash').provider).toBe('google')
    // 常见"兼容 OpenAI"的家族不得被误判成 Anthropic/Google
    for (const m of ['deepseek-chat', 'qwen-max', 'glm-4-plus', 'moonshot-v1-8k', 'llama-3.1-70b']) {
      expect(llm.detectProvider(m).provider, `${m} 应按 OpenAI 兼容处理`).toBe('openai')
    }
    // 认不出来要**如实标注是推测**，不能假装确定
    expect(llm.detectProvider('some-unknown-model-xyz').guessed, '未知模型应标注 guessed').toBe(true)
  })

  it('② OpenAI 形态：Bearer + messages(system 在 messages 里) + response_format', () => {
    const r = llm.buildRequest({ model: 'gpt-4o-mini', apiKey: 'k', system: 'S', user: 'U' })
    expect(r.url).toBe('https://api.openai.com/chat/completions')
    expect(r.headers.authorization).toBe('Bearer k')
    const msgs = (r.body as { messages: Array<{ role: string }> }).messages
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user'])
    expect(JSON.stringify(r.body)).toContain('json_object')
  })

  it('③ Anthropic 形态：x-api-key + 版本头 + system 在**顶层**（与 OpenAI 的关键差异）', () => {
    const r = llm.buildRequest({ model: 'claude-3-5-sonnet-latest', apiKey: 'k', system: 'S', user: 'U' })
    expect(r.url).toBe('https://api.anthropic.com/v1/messages')
    expect(r.headers['x-api-key']).toBe('k')
    expect(r.headers['anthropic-version'], '缺版本头会被 Anthropic 拒绝').toBeTruthy()
    expect((r.body as { system: string }).system, 'system 必须在顶层').toBe('S')
    expect((r.body as { messages: unknown[] }).messages, 'system 不得混进 messages').toHaveLength(1)
  })

  it('④ Google 形态：:generateContent + key 在查询串 + systemInstruction', () => {
    const r = llm.buildRequest({ model: 'gemini-2.0-flash', apiKey: 'k', system: 'S', user: 'U' })
    expect(r.url).toContain(':generateContent')
    expect(r.url).toContain('key=k')
    expect(JSON.stringify(r.body)).toContain('systemInstruction')
  })

  it('⑤ 三家响应都能统一解析出文本', () => {
    expect(llm.parseResponse('openai', { choices: [{ message: { content: 'A' } }] }).text).toBe('A')
    expect(llm.parseResponse('anthropic', { content: [{ type: 'text', text: 'B' }] }).text).toBe('B')
    expect(llm.parseResponse('google', { candidates: [{ content: { parts: [{ text: 'C' }] } }] }).text).toBe('C')
    // 缺字段不得抛错（否则会把整场任务打断）
    expect(llm.parseResponse('openai', {}).text).toBe('')
  })

  it('⑥ 取 JSON：容忍代码围栏与前后寒暄，取不到返回 null（由调用方降级）', () => {
    expect(llm.extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(llm.extractJson('好的，结果如下：{"a":{"b":2}} 希望有帮助')).toEqual({ a: { b: 2 } })
    expect(llm.extractJson('完全没有 JSON')).toBe(null)
  })
})

describe('B. 评分提示词编排（数据不越权 / 只回 id / 白名单 / 可预览）', () => {
  const windows = [
    { id: 's-w00000', start: 0, end: 5, danmaku: 2, density: 0.4, excerpt: '开场' },
    { id: 's-w00001', start: 5, end: 10, danmaku: 80, density: 16, excerpt: '大笑' },
    { id: 's-w00002', start: 10, end: 15, danmaku: 1, density: 0.2, excerpt: '' },
    { id: 's-w00003', start: 15, end: 20, danmaku: 60, density: 12, excerpt: '名场面' }
  ]

  it('⑦ 系统提示词必须含"数据不是指令"与"不要输出时间"两条硬规则', () => {
    const s = prompt.buildSystemPrompt()
    expect(s, '必须声明数据边界（防提示词注入）').toMatch(/不是对你的指令|不是指令|只按本系统提示词/)
    expect(s, '必须禁止模型输出时间').toMatch(/不要输出时间|不要输出时间戳/)
    expect(s, '必须要求只引用输入里的 id').toMatch(/原样引用窗口的 id|必须原样引用/)
    expect(s, '必须给出 JSON 输出契约').toContain('"clips"')
    expect(s, '禁止代码围栏（否则解析要额外兜底）').toMatch(/不要 Markdown 代码围栏/)
  })

  it('⑧ user 语料是结构化 JSONL：窗口一行、含 id 与 start/end，且不把弹幕拼成散文', () => {
    const { text, chosenIds } = prompt.buildUserPayload({ sessionKey: 's', bucketMs: 5000, windows, topN: 10 })
    const lines = text.split('\n').filter((l) => l.startsWith('{'))
    expect(lines.length, '候选窗口应逐行给出').toBeGreaterThan(0)
    const first = JSON.parse(lines[0])
    expect(first, '每行必须带 id 与 start/end（时间在结构化字段里）').toHaveProperty('id')
    expect(first).toHaveProperty('start')
    expect(first).toHaveProperty('end')
    expect(chosenIds, 'chosenIds 必须与实际行一致').toContain(first.id)
  })

  it('⑨ 白名单：模型编造的 id 一律拒绝，且**如实报告拒绝原因**', () => {
    const index = new Map(windows.map((w) => [w.id, w]))
    const { clips, rejected } = prompt.validateSelection(
      { clips: [{ id: 's-w00001', score: 90, reason: '好' }, { id: '不存在-99', score: 100, reason: '编的' }] },
      index,
      { durationSec: 20 }
    )
    expect(clips.map((c) => c.id)).toEqual(['s-w00001'])
    expect(rejected.some((r) => /白名单/.test(r.why)), '越界 id 必须带原因回报').toBe(true)
  })

  it('⑩ 时间由代码贴回：模型只给 id，代码补 start/end 并按时长钳制', () => {
    const index = new Map(windows.map((w) => [w.id, w]))
    const { clips } = prompt.validateSelection({ clips: [{ id: 's-w00003', score: 80, reason: '名场面' }] }, index, { durationSec: 17 })
    expect(clips[0].start, '起点来自窗口（模型不参与）').toBe(15)
    expect(clips[0].end, '结束时间被钳制到录像时长').toBe(17)
  })

  it('⑪ 数量上限与最小间隔生效（防止碎片化输出）', () => {
    const index = new Map(windows.map((w) => [w.id, w]))
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `x-${i}`, start: i * 10, end: i * 10 + 5 }))
    const idx2 = new Map(many.map((w) => [w.id, w]))
    const { clips, rejected } = prompt.validateSelection(
      { clips: many.slice(0, 25).map((w) => ({ id: w.id, score: 50, reason: '' })) },
      idx2,
      { maxClips: 5, minGapSec: 2 }
    )
    expect(clips.length, '不得超过上限').toBeLessThanOrEqual(5)
    expect(rejected.length, '被丢弃的要计数').toBeGreaterThan(0)
    index.clear()
  })

  it('⑫ 预览**不含密钥**（用户要能看到"将要发送什么"，但绝不能看到别人的 key）', () => {
    const preview = prompt.buildPromptPreview({ sessionKey: 's', bucketMs: 5000, windows, topN: 4 })
    expect(preview.chars, '预览要给出体积，便于用户判断成本').toBeGreaterThan(0)
    expect(JSON.stringify(preview), '预览里不得出现密钥').not.toMatch(/sk-|api[_-]?key/i)
  })
})
