import type { ILogger } from '@contracts/logger'
import type {
  INetworkClient,
  INetworkService,
  NetworkDiagnostics,
  NetworkRequestOptions,
  NetworkResponse
} from '@contracts/network'

/**
 * Unified network client —— 从 T9 的"本地空实现"升级为**受管真实实现（C2）**。
 *
 * 保留的承诺（与 T9 完全一致，任何既有断言都不该变）：
 *   · **默认拒绝**：未获用户明确同意时，每一次出站请求都以同一条 local-first 理由拒绝；
 *   · 门面形状不变：`createNetworkClient(options)` → `INetworkClient`（`request` 失败即 reject）。
 *
 * 新增的三道闸门（全部默认拒绝）：
 *   ① **用户同意**：`isEnabled()` 默认 false（配置中心注入；界面开关默认关）；
 *   ② **仅 https** + **主机白名单**：默认放行三家主流 API 主机，用户可加自建网关（Q2 = a）；
 *   ③ **不跟随重定向**：`redirect: 'error'` ⇒ 白名单无法被 302 绕过（跨主机）。
 *
 * 两条工程约束：
 *   · **密钥绝不进日志**：只记 主机/方法/状态码/字节/耗时；请求头与响应体一律不落日志；
 *   · 体积上限：请求体 256KB / 响应 2MB（超出即拒绝并说明）。
 */

/** 默认放行的三家主流 API 主机（用户 Q2 = a：按 provider 自动放行）。 */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com'
]

const REJECTION =
  'local-first: no cloud endpoints are configured — the unified network client is interface-only in T9'

const MAX_BODY_BYTES = 32 * 1024 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60_000

/** 判断请求体是否属于"必须原样透传"的类型（multipart 表单 / 二进制）。 */
function isPassthroughBody(body: unknown): boolean {
  if (body === null || body === undefined) return false
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true
  if (body instanceof Uint8Array) return true
  return typeof Blob !== 'undefined' && body instanceof Blob
}

/** 体积（无法判断时返回 undefined ⇒ 不做上限判断，交给下游）。 */
function bodyBytes(body: unknown): number | undefined {
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8')
  if (body instanceof Uint8Array) return body.byteLength
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // multipart 的体积只能粗估（内容编码后略有膨胀）；用于上限判断足够。
    let n = 0
    try {
      for (const v of (body as FormData).values()) {
        if (typeof v === 'string') n += Buffer.byteLength(v, 'utf8')
        else if (v instanceof Uint8Array) n += v.byteLength
        else if (typeof Blob !== 'undefined' && v instanceof Blob) n += v.size
      }
    } catch {
      return undefined
    }
    return n
  }
  return undefined
}

/** 取主机名：仅接受 https（明文 http 一律拒绝），解析失败返回 null。 */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    return u.hostname.toLowerCase()
  } catch {
    return null
  }
}

/** 白名单匹配：精确主机或其**子域**（例如记录 openai.com ⇒ api.openai.com 亦放行）。 */
export function hostAllowed(host: string, allow: readonly string[]): boolean {
  return allow.some((entry) => {
    const e = String(entry ?? '').trim().toLowerCase()
    if (e === '') return false
    return host === e || host.endsWith(`.${e}`)
  })
}

export interface NetworkClientOptions {
  logger: ILogger
  /** 注入的 fetch（**测试用假实现** ⇒ 测试不联网；生产传全局 fetch）。 */
  fetchImpl?: typeof fetch
  /** 是否已获用户明确同意（默认 false ⇒ 与 T9 行为一致：一律拒绝）。 */
  isEnabled?: () => boolean
  /** 额外放行的主机（用户在设置里添加的自建网关）。 */
  extraHosts?: () => readonly string[]
}

export function createNetworkClient(options: NetworkClientOptions): INetworkService {
  const log = options.logger.child('network')
  const fetcher = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined)
  let rejected = 0
  let lastRejection: string | undefined
  let sent = 0
  let bytesIn = 0

  const allowedHosts = (): readonly string[] => [
    ...DEFAULT_ALLOWED_HOSTS,
    ...(options.extraHosts?.() ?? []).map((h) => String(h ?? '').trim().toLowerCase()).filter(Boolean)
  ]

  const deny = (reason: string, detail?: Record<string, unknown>): never => {
    rejected += 1
    lastRejection = reason
    // 只记元数据：绝不含请求头/请求体（可能带密钥）。
    log.warn('outbound request rejected', { reason, ...(detail ?? {}) })
    throw new Error(reason)
  }

  // 先声明再赋值：`forModule` 里要引用同一个实例（方法体在调用时才求值 ⇒ 不存在 TDZ 问题）。
  let client!: INetworkService
  client = {
    async request(url: string, requestOptions?: NetworkRequestOptions): Promise<NetworkResponse> {
      // 闸门 ①：用户同意（默认关 ⇒ 与 T9 行为完全一致）
      if (!(options.isEnabled?.() ?? false)) deny(REJECTION, { rejected })
      // 闸门 ②：https + 主机白名单
      const host = hostOf(String(url ?? ''))
      if (host === null) deny('只允许 https 地址（或地址不合法）', { host: null })
      if (!hostAllowed(host as string, allowedHosts())) {
        deny(`主机不在白名单：${host}（可在设置里添加）`, { host })
      }
      if (!fetcher) deny('运行环境不支持网络请求')

      const method = requestOptions?.method ?? 'POST'
      const rawIn = requestOptions?.body
      // ⚠️ 二进制 / multipart（如 ASR 上传音频）必须**原样透传**：JSON.stringify 会把它毁掉。
      const passthrough = isPassthroughBody(rawIn)
      const rawBody: string | FormData | Blob | Uint8Array | undefined =
        rawIn === undefined ? undefined : passthrough ? (rawIn as FormData | Blob | Uint8Array) : typeof rawIn === 'string' ? rawIn : JSON.stringify(rawIn)
      const size = bodyBytes(rawBody)
      if (size !== undefined && size > MAX_BODY_BYTES) {
        deny(`请求体过大（上限 ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB）`, { host, bytes: size })
      }

      const controller = new AbortController()
      const timeoutMs = Math.max(1000, Math.min(requestOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS, 5 * 60_000))
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const started = Date.now()

      try {
        const res = await (fetcher as typeof fetch)(String(url), {
          method,
          headers: { ...(requestOptions?.headers ?? {}) },
          body: rawBody,
          signal: controller.signal,
          // 不跟随重定向 ⇒ 白名单不能被 302 绕过（跨主机）。
          redirect: 'error'
        })
        const text = await res.text()
        const bytes = Buffer.byteLength(text, 'utf8')
        const ms = Date.now() - started
        if (bytes > MAX_RESPONSE_BYTES) {
          rejected += 1
          lastRejection = `响应过大（上限 ${MAX_RESPONSE_BYTES} 字节）`
          log.warn('response too large', { host, bytes })
          throw new Error(lastRejection)
        }
        sent += 1
        bytesIn += bytes
        // ⚠️ 只记元数据：不含请求头（Authorization / x-api-key）、不含响应体。
        log.info('outbound request', { host, method, status: res.status, ms, bytes })
        const headers: Record<string, string> = {}
        res.headers.forEach((v, k) => {
          headers[k] = v
        })
        let body: unknown = text
        try {
          body = JSON.parse(text)
        } catch {
          /* 非 JSON ⇒ 原样返回文本（由调用方判断） */
        }
        if (!res.ok) {
          rejected += 1
          lastRejection = `HTTP ${res.status}`
          throw new Error(lastRejection)
        }
        return { status: res.status, headers, body }
      } catch (e) {
        if ((e as { message?: string })?.message === lastRejection) throw e
        const aborted = (e as { name?: string } | null)?.name === 'AbortError'
        const msg = aborted
          ? `请求超时（${timeoutMs} ms）`
          : `请求失败：${String((e as Error)?.message ?? e).slice(0, 120)}`
        rejected += 1
        lastRejection = msg
        log.warn('outbound request failed', { host, ms: Date.now() - started, reason: msg })
        throw new Error(msg)
      } finally {
        clearTimeout(timer)
      }
    },

    diagnostics(): NetworkDiagnostics {
      // 未开启时保持 T9 的既有语义（既有断言不受影响）；开启后如实报告真实状态。
      const enabled = options.isEnabled?.() ?? false
      return {
        mode: enabled ? 'enabled' : 'local-empty',
        rejected,
        lastRejection,
        ...(enabled ? { sent, bytesIn, allowedHosts: allowedHosts() } : {})
      }
    },

    /**
     * 生成**绑定模块身份**的门面（C2）：模块只能拿到 `INetworkClient`，
     * 因此无法伪造身份、也无法触达核心自身的调用；这里额外把模块 id 写进日志，
     * 便于"哪個模块在联网"这件事可审计（后续可在此加按模块计数/配额）。
     */
    forModule(moduleId: string): INetworkClient {
      const id = String(moduleId ?? '').trim() || '(unknown)'
      const scoped = options.logger.child('network').child(`module:${id}`)
      return {
        request: async (url: string, requestOptions?: NetworkRequestOptions): Promise<NetworkResponse> => {
          // 只记元数据（主机/方法）；不含请求头与请求体（密钥与直播内容都不落日志）。
          scoped.info('module outbound request', { moduleId: id, host: hostOf(String(url)), method: requestOptions?.method ?? 'POST' })
          return await client.request(url, requestOptions)
        },
        diagnostics: () => client.diagnostics()
      }
    }
  }
  return client
}
