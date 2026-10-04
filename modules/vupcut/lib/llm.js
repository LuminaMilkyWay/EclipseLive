/**
 * llm：**多provider 适配器**（只认模型 ID，不认厂商 UI）。
 *
 * 三件事分开，谁都不越界：
 *   ① `detectProvider(modelId)`：由**模型 ID** 推断接口形态（用户只需填一个模型名）；
 *   ② `buildRequest(...)`：产出**纯数据**的请求描述（url / headers / body）——
 *      **本文件不发起网络请求**（红线：模块不得自行 fetch；生产传输层由 C2 的网络门面提供，
 *      测试用注入的假传输层 ⇒ 这正是"实例注入测试"能覆盖 LLM 段的原因）；
 *   ③ `parseResponse(...)`：把各家不同的响应统一成 `{ text, usage }`。
 *
 * 支持形态：
 *   · `openai`：POST {base}/chat/completions（Authorization: Bearer）—— 也是所有"兼容 OpenAI"的默认；
 *   · `anthropic`：POST {base}/v1/messages（x-api-key + anthropic-version，system 在顶层）；
 *   · `google`：POST {base}/v1beta/models/{model}:generateContent（?key=）。
 */

/** 模型 ID ⇒ provider（大小写不敏感；未知则按 OpenAI 兼容处理，并如实标注为推测）。 */
export function detectProvider(modelId) {
  const id = String(modelId ?? '').trim().toLowerCase()
  if (id === '') return { provider: 'openai', guessed: true, reason: '模型 ID 为空，按 OpenAI 兼容处理' }
  if (/^claude(-|$)|^anthropic\./.test(id)) return { provider: 'anthropic', guessed: false, reason: 'claude-*' }
  if (/^gemini(-|$)|^models\/gemini/.test(id)) return { provider: 'google', guessed: false, reason: 'gemini-*' }
  if (/^(gpt-|o[1-9](-|$)|chatgpt-|text-davinci)/.test(id)) return { provider: 'openai', guessed: false, reason: 'gpt-* / o*' }
  // 明确"兼容 OpenAI"的常见家族：deepseek / qwen(dashscope compatible) / glm / moonshot(kimi) / llama 等
  if (/^(deepseek|qwen|glm|moonshot|kimi|llama|mistral|yi|doubao|hunyuan|ernie|step|minimax)/.test(id)) {
    return { provider: 'openai', guessed: false, reason: '已知的 OpenAI 兼容家族' }
  }
  return { provider: 'openai', guessed: true, reason: '未识别 ⇒ 默认按 OpenAI 兼容处理' }
}

/** 各家默认 base（用户可覆盖；不写死带斜杠结尾的形态，统一在拼接时处理）。 */
export function defaultBase(provider) {
  if (provider === 'anthropic') return 'https://api.anthropic.com'
  if (provider === 'google') return 'https://generativelanguage.googleapis.com'
  return 'https://api.openai.com'
}

/** 去掉结尾斜杠，避免出现 `//`。 */
const trimSlash = (s) => String(s ?? '').replace(/\/+$/, '')

/**
 * 产出请求描述（**纯数据，不发请求**）。
 *
 * @param {object} a
 * @param {string} a.model 模型 ID（如 `gpt-4o-mini` / `claude-3-5-sonnet-latest` / `deepseek-chat`）
 * @param {string} a.apiKey 用户自填密钥（**只进请求头，绝不写日志**）
 * @param {string} [a.baseUrl] 自定义 base（自建网关/中转）
 * @param {string} a.system 系统提示词
 * @param {string} a.user 用户消息（结构化语料）
 * @param {number} [a.maxTokens]
 * @param {number} [a.temperature]
 * @param {boolean} [a.jsonMode] 是否要求返回 JSON（能支持的 provider 会开启）
 */
export function buildRequest({ model, apiKey, baseUrl, system, user, maxTokens = 2048, temperature = 0.2, jsonMode = true }) {
  const { provider } = detectProvider(model)
  const base = trimSlash(baseUrl && String(baseUrl).trim() !== '' ? baseUrl : defaultBase(provider))

  if (provider === 'anthropic') {
    return {
      provider,
      method: 'POST',
      url: `${base}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: {
        model,
        max_tokens: maxTokens,
        temperature,
        // Anthropic：system 是**顶层字段**，不在 messages 里（与 OpenAI 的关键差异）
        system,
        messages: [{ role: 'user', content: user }]
      }
    }
  }

  if (provider === 'google') {
    return {
      provider,
      method: 'POST',
      url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(String(apiKey ?? ''))}`,
      headers: { 'content-type': 'application/json' },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          ...(jsonMode ? { responseMimeType: 'application/json' } : {})
        }
      }
    }
  }

  return {
    provider: 'openai',
    method: 'POST',
    url: `${base}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${String(apiKey ?? '')}` },
    body: {
      model,
      temperature,
      max_tokens: maxTokens,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }
  }
}

/**
 * 解析响应（统一成 `{ text, usage, raw }`）。
 * 容忍缺字段：拿不到文本时返回空串，由调用方决定降级（**不得抛异常打断整场任务**）。
 */
export function parseResponse(provider, json) {
  const j = json ?? {}
  let text = ''
  if (provider === 'anthropic') {
    const parts = Array.isArray(j.content) ? j.content : []
    text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('')
  } else if (provider === 'google') {
    const cands = Array.isArray(j.candidates) ? j.candidates : []
    const parts = cands[0]?.content?.parts ?? []
    text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('')
  } else {
    text = j.choices?.[0]?.message?.content ?? j.choices?.[0]?.text ?? ''
  }
  return {
    text: typeof text === 'string' ? text : '',
    usage: j.usage ?? j.usageMetadata ?? null,
    model: j.model ?? j.modelVersion ?? null,
    raw: j
  }
}

/**
 * 从模型输出里**严格**取出一个 JSON 对象。
 * 模型常加 ```json 围栏或前后寒暄 ⇒ 这里只做"取第一段平衡括号"，然后交给调用方做 schema 校验。
 * 取不到 ⇒ 返回 null（**由调用方降级**，不抛错）。
 */
export function extractJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const s = text.replace(/```(?:json)?/gi, '')
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}
