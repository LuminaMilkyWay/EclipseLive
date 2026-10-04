/**
 * runtime：把模块上下文 `ctx` 组装成 `job.js` 需要的那组**生产依赖**。
 *
 * 为什么单独一层：`job.js` 只认注入的依赖（这样才能不联网、不转码地测试）；
 * 而"生产依赖到底是什么"是**装配问题**，集中在这里，便于审计与替换：
 *   · ASR / LLM 都经 **`ctx.network`**（核心门面 ⇒ 默认拒绝 + 白名单 + 密钥不进日志）；
 *   · FFmpeg 走 **`ctx.proc`**（C1 受管子进程 ⇒ 模块停用即结束，无孤儿）；
 *   · 密钥只从 **`ctx.credentials`** 读，**绝不出现在返回值或日志里**；
 *   · 所有出站请求都带**超时**，且**失败原样抛出**交给 ④ 的重试/续跑逻辑判断可重试性。
 */
import { readFile } from 'node:fs/promises'
import { detectProvider, buildRequest, parseResponse } from './llm.js'
import { buildTranscribeRequest, parseTranscribe } from './asr.js'
import { createPorts } from './ports.js'

/** 读密钥（缺凭据服务 / 缺密钥 ⇒ 返回 null，由调用方给出人话提示）。 */
export function readApiKey(ctx, key = 'llm:apiKey') {
  try {
    const v = ctx?.credentials?.get?.(key)
    return typeof v === 'string' && v.trim() !== '' ? v : null
  } catch {
    return null
  }
}

/** ASR 用单独的密钥（用户可以在页面里给 ASR 配另一家的 key）。 */
export function readAsrKey(ctx) {
  return readApiKey(ctx, 'asr:apiKey')
}

/**
 * 组装生产依赖。
 * @param {object} ctx 模块上下文
 * @param {object} cfg 模块配置
 */
export function createRuntime(ctx, cfg) {
  const ports = createPorts({ ctx, testCfg: cfg?.test ?? null })
  const ffmpeg = ports.ports.ffmpeg

  /** 统一的出站调用（走核心门面；未授权时会抛错，由上层决定降级）。 */
  const post = async (url, { headers, body, timeoutMs }) => {
    if (!ctx?.network || typeof ctx.network.request !== 'function') {
      throw new Error('未获核心授权：模块拿不到网络门面（需要 network-access 权限且核心已注入）')
    }
    const res = await ctx.network.request(url, { method: 'POST', headers, body, timeoutMs })
    return res?.body ?? null
  }

  const callLlm = async ({ system, user, timeoutMs }) => {
    const model = String(cfg?.model ?? '')
    if (model === '') throw new Error('未配置模型 ID：请在页面里填写（例如 mimo-v2.6-flash / gpt-4o-mini）')
    const key = readApiKey(ctx)
    if (!key) throw new Error('未配置 API 密钥：请在页面里保存（只存进凭据库，不会回显）')
    const req = buildRequest({
      model,
      apiKey: key,
      baseUrl: cfg?.baseUrl ?? null,
      system,
      user,
      maxTokens: cfg?.score?.maxTokens ?? 2048,
      temperature: cfg?.score?.temperature ?? 0.2
    })
    const body = await post(req.url, { headers: req.headers, body: req.body, timeoutMs })
    const { text, usage, model: used } = parseResponse(detectProvider(model).provider, body)
    return { text, usage, model: used ?? model }
  }

  const callAsr = async ({ bytes, filename, startSec, durationSec }) => {
    const asrCfg = cfg?.asr ?? {}
    const model = String(asrCfg.model ?? '')
    if (model === '') throw new Error('未配置 ASR 模型 ID：请在页面里填写（或留空跳过转写）')
    const key = readAsrKey(ctx) ?? readApiKey(ctx)
    if (!key) throw new Error('未配置 ASR 密钥：请在页面里保存')
    const req = buildTranscribeRequest({
      model,
      apiKey: key,
      baseUrl: asrCfg.baseUrl ?? null,
      path: asrCfg.path ?? null,
      audio: bytes,
      filename,
      mime: 'audio/mpeg',
      language: asrCfg.language ?? 'zh'
    })
    // ⚠️ 这里**必须是 multipart 表单**（核心门面已支持二进制原样透传）；
    //    也要给足够超时（音频上传 + 转写比纯文本慢得多）。
    const body = await post(req.url, { headers: req.headers, body: req.form, timeoutMs: asrCfg.timeoutMs ?? 300_000 })
    return parseTranscribe(body)
  }

  return {
    ports,
    ffmpeg,
    callLlm,
    callAsr,
    readText: (p) => readFile(p, 'utf8'),
    readBinary: async (p) => new Uint8Array(await readFile(p)),
    /** 给界面看的"依赖是否齐备"（缺哪个就说哪个，不笼统报错）。 */
    readiness: () => {
      const has = (v) => typeof v === 'string' && v.trim() !== ''
      return {
        network: Boolean(ctx?.network),
        proc: Boolean(ctx?.proc),
        llmKey: Boolean(readApiKey(ctx)),
        asrKey: Boolean(readAsrKey(ctx) ?? readApiKey(ctx)),
        model: has(cfg?.model),
        asrModel: has(cfg?.asr?.model),
        outputDir: has(cfg?.paths?.output),
        recordingsDir: has(cfg?.paths?.recordings)
      }
    }
  }
}
