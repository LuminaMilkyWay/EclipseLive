/**
 * asr：**通用 ASR 客户端**（用户决定：与评分类似 —— **手动输入 API**，不做厂商定制集成）。
 *
 * 三件事分开，谁都不越界：
 *   ① `detectAsrFormat(modelId)`：由模型 ID 猜接口形态（猜不出就按最通用的 OpenAI 兼容处理，并标注是推测）；
 *   ② `buildTranscribeRequest(...)`：产出**纯数据**的请求描述（url / headers / **multipart 表单**）
 *      —— 本文件**不发起任何请求**；生产传输层是核心门面（`ctx.network`，默认拒绝）；
 *   ③ `parseTranscribe(...)`：把各家响应统一成 `{ segments, text, language, durationSec }`。
 *
 * ⚠️ 关键工程事实（本轮踩到并修在核心侧）：上传音频用 **multipart**，绝不能走 JSON 序列化
 *    （会把二进制毁掉）⇒ 核心门面已支持 FormData/Blob/Uint8Array **原样透传**，并把体积上限提到 32MB。
 *
 * ⚠️ 隐私：音频比文本敏感得多 ⇒ 调用方必须先做**单独的一次确认**（不能复用"联网"总开关），
 *    并且**绝不把音频内容写进任何日志**。
 */

/** 最常见的转录路径（OpenAI 兼容，含 MiMo / 硅基流动 / 自建网关等）。 */
export const DEFAULT_TRANSCRIBE_PATH = '/v1/audio/transcriptions'
/** 允许的响应格式（verbose_json 才带时间戳 ⇒ 默认用它）。 */
export const RESPONSE_FORMATS = ['verbose_json', 'json', 'text', 'srt', 'vtt']

const trimSlash = (s) => String(s ?? '').replace(/\/+$/, '')

/**
 * 由模型 ID 猜接口形态。**猜不出也照样能用**（按 OpenAI 兼容 + 标注为推测）。
 * `custom` = 用户自己填路径（自建网关 / 特殊厂商）。
 */
export function detectAsrFormat(modelId, { path = null } = {}) {
  if (typeof path === 'string' && path.trim() !== '') return { format: 'custom', guessed: false, reason: '用户指定了路径' }
  const id = String(modelId ?? '').trim().toLowerCase()
  if (id === '') return { format: 'openai', guessed: true, reason: '未填模型 ID ⇒ 按 OpenAI 兼容处理' }
  if (/^whisper|^gpt-4o-transcribe|^gpt-4o-mini-transcribe|asr|transcribe|sensevoice|paraformer|funasr/.test(id)) {
    return { format: 'openai', guessed: false, reason: '已知的转录类模型命名' }
  }
  if (/^chirp|^google|speech-to-text/.test(id)) return { format: 'google', guessed: false, reason: 'Google 系命名' }
  return { format: 'openai', guessed: true, reason: '未识别 ⇒ 默认按 OpenAI 兼容处理' }
}

/** 默认 base（用户可覆盖；自建网关就填自己的）。 */
export function defaultAsrBase() {
  return 'https://api.openai.com'
}

/**
 * 产出请求描述（**纯数据，不发请求**）。
 *
 * @param {object} a
 * @param {string} a.model 模型 ID（如 `whisper-1` / `mimo-v2.5-asr` / `whisper-large-v3-turbo`）
 * @param {string} a.apiKey 用户自填密钥（只进请求头，**永不写日志**）
 * @param {string} [a.baseUrl] 自定义 base（自建网关/中转）
 * @param {string} [a.path] 自定义路径（覆盖默认）
 * @param {Uint8Array|ArrayBuffer} a.audio 音频字节（**由 FFmpeg 抽取的 16kHz 单声道**，体积小、上传快）
 * @param {string} [a.filename] multipart 里的文件名（各家按扩展名判格式 ⇒ 要带正确后缀）
 * @param {string} [a.mime]
 * @param {string} [a.language] 语言提示（中文场景显著提升准确率与标点）
 * @param {string} [a.prompt] 领域提示词（如主播名、专有名词）
 * @param {string} [a.responseFormat] 默认 verbose_json（**要时间戳就必须用它**）
 */
export function buildTranscribeRequest({
  model,
  apiKey,
  baseUrl = null,
  path = null,
  audio,
  filename = 'audio.mp3',
  mime = 'audio/mpeg',
  language = null,
  prompt = null,
  responseFormat = 'verbose_json',
  format = null
}) {
  const det = format ? { format, guessed: false, reason: '调用方指定' } : detectAsrFormat(model, { path })
  const base = trimSlash(baseUrl && String(baseUrl).trim() !== '' ? baseUrl : defaultAsrBase())
  const p = path && String(path).trim() !== '' ? String(path) : DEFAULT_TRANSCRIBE_PATH
  const url = det.format === 'google'
    ? `${base}/v1/speech:recognize?key=${encodeURIComponent(String(apiKey ?? ''))}`
    : `${base}${p.startsWith('/') ? p : `/${p}`}`

  const form = new FormData()
  const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio) : audio
  form.append('file', new Blob([bytes], { type: mime }), filename)
  form.append('model', String(model ?? ''))
  form.append('response_format', RESPONSE_FORMATS.includes(responseFormat) ? responseFormat : 'verbose_json')
  if (language) form.append('language', String(language))
  if (prompt) form.append('prompt', String(prompt))

  const headers =
    det.format === 'google'
      ? { 'content-type': 'application/json' }
      : { authorization: `Bearer ${String(apiKey ?? '')}` }
  // ⚠️ 不要手写 content-type：multipart 的 boundary 由 fetch 生成。
  return { format: det.format, guessed: det.guessed, reason: det.reason, method: 'POST', url, headers, form, multipart: det.format !== 'google' }
}

/** 把 `verbose_json.segments`（或纯文本）统一成片段时间轴（秒）。 */
export function normalizeSegments(json) {
  if (json === null || json === undefined) return { segments: [], text: '' }
  if (typeof json === 'string') return { segments: [], text: json }
  const rawSegs = Array.isArray(json.segments) ? json.segments : Array.isArray(json.results) ? json.results : null
  if (rawSegs) {
    const segments = rawSegs
      .map((s) => ({
        start: Number(s?.start ?? s?.startTime ?? s?.start_time ?? 0) || 0,
        end: Number(s?.end ?? s?.endTime ?? s?.end_time ?? 0) || 0,
        text: String(s?.text ?? s?.transcript ?? '').trim()
      }))
      .filter((s) => s.text !== '' && s.end > s.start)
      .sort((a, b) => a.start - b.start)
    return { segments, text: segments.map((s) => s.text).join(' ') }
  }
  const text = String(json.text ?? json.transcript ?? '').trim()
  return { segments: [], text }
}

/** 统一响应（含时长与 usage，便于成本核算）。 */
export function parseTranscribe(json) {
  const { segments, text } = normalizeSegments(json)
  const durationSec =
    typeof json?.duration === 'number'
      ? json.duration
      : segments.length > 0
        ? segments[segments.length - 1].end
        : null
  return {
    segments,
    text,
    language: typeof json?.language === 'string' ? json.language : null,
    durationSec,
    usage: json?.usage ?? null,
    raw: json
  }
}

/** 把错误翻译成**给人看的话**（并标明可否重试，供 ④ 的 isRetryable 逻辑使用）。 */
export function describeAsrError(err) {
  const status = Number(err?.status ?? err?.statusCode ?? NaN)
  const msg = String(err?.message ?? err ?? '')
  if (status === 401 || status === 403 || /unauthorized|invalid.*key|密钥/i.test(msg)) {
    return { message: 'ASR 密钥无效或无权限：请检查密钥与接口地址', retryable: false }
  }
  if (status === 429) return { message: 'ASR 服务限流（429）：稍后重试或降低并发', retryable: true }
  if (status === 413 || /too large|payload/i.test(msg)) return { message: '音频片段过大：请减小分片时长', retryable: false }
  if (status >= 500) return { message: `ASR 服务端错误（${status}）：可重试`, retryable: true }
  if (/timeout|超时|ECONNRESET|EAI_AGAIN|network/i.test(msg)) return { message: '网络问题：可重试', retryable: true }
  if (/audio|codec|format|decode/i.test(msg)) return { message: '音频格式不被接受：请确认已抽取为 mp3/wav 单声道', retryable: false }
  return { message: msg.slice(0, 200) || '未知错误', retryable: false }
}

/** 音频时长 → 小时（成本模型用 `perHourAudio` 计价 ⇒ 必须按小时给）。 */
export function estimateAudioHours(durationSec) {
  const n = Number(durationSec)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round((n / 3600) * 1000) / 1000
}
