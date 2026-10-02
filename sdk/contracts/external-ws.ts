/**
 * Outbound WebSocket client contract (C0).
 *
 * AI_RULES 第 3 条明令「模块禁止自行开 WebSocket」，`network/README.md` 同旨
 * 「所有对外网络请求必须走核心门面」——本契约是 `INetworkClient` 的 WebSocket 对应物。
 *
 * **回环限定（关键红线）**：只接受 `ws://` / `wss://` + **本机回环主机**
 * （127.0.0.1 / localhost / ::1）。被连接的对端是**同机伙伴应用**（如 VTube Studio
 * 的 `ws://127.0.0.1:8001`），而非云端端点——这条限定是 AI_RULES 第 11 条
 * 「不引入联网依赖/云服务/遥测」得以保持完整的原因：门面在物理上不具备出网能力。
 *
 * 其余语义与 overlays / shortcuts 一致：
 * - 权限闸门 `external-websocket` 在**连接时**检查（撤销立即生效）；
 * - 归属 `${moduleId}:${id}`，重复 id 直接失败（不 upsert，连接带活状态）；
 * - 生命周期与 routes/channels/shortcuts/overlays 相同：`removeModule` 关闭该模块全部连接；
 * - 模块侧只能看到自己的连接（facade 过滤），且**不能**操作其他模块的连接。
 */

/** Connection state as reported to the module and to diagnostics. */
export type ExternalWsState = 'connecting' | 'open' | 'closed'

/**
 * 被接受的回环主机名白名单。**不是**"额外允许"的清单，而是**唯一**允许的清单：
 * 任何不在此列的 host 一律拒绝（含公网域名、局域网 IP、`0.0.0.0`）。
 *
 * 有意**不覆盖整段 `127.0.0.0/8`**：OS 层整个 /8 都是回环，但伙伴应用一律绑定
 * `127.0.0.1`/`localhost`（VTS 即 `ws://localhost:8001`）。收窄到三种规范写法更简单、
 * 更好审计，且不可能放宽"出不了本机"这一性质。若将来确有应用绑在 `127.0.0.2`，
 * 再按需扩展并补测试——现在不预留（AI_RULES 第 12 条）。
 */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1']

/** 允许的协议。回环上 `wss://` 少见但合法（本地自签），故一并接受。 */
export const EXTERNAL_WS_PROTOCOLS: readonly string[] = ['ws:', 'wss:']

/** 单条 payload 上限（字节，按 UTF-16 码元近似计）。防止模块把主进程内存打爆。 */
export const EXTERNAL_WS_MAX_PAYLOAD = 1024 * 1024

/**
 * URL 是否为"回环 WebSocket"。
 *
 * 纯函数：解析失败、协议不在白名单、host 不在回环白名单，三者任一即 false。
 *
 * 注意 IPv6：WHATWG URL 的 `hostname` **保留方括号**（`ws://[::1]:8001` → `[::1]`），
 * 故比较前统一去括号；`LOOPBACK_HOSTS` 只登记裸地址。
 * IPv4-mapped 形式（`[::ffff:127.0.0.1]`）不在白名单内 → **fail-closed 拒绝**，
 * 宁可拒绝一种异体写法，也不放宽回环边界。
 */
export function isLoopbackWsUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!EXTERNAL_WS_PROTOCOLS.includes(parsed.protocol)) return false
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  return LOOPBACK_HOSTS.includes(host)
}

/**
 * 供落盘/日志/诊断使用的脱敏 URL：**去掉 query 与 hash**。
 *
 * 模块可能把一次性凭据放在 query 里（如 `?token=…`），而状态快照会被写进日志与
 * 诊断页——AI_RULES 第 15 条要求敏感数据脱敏。回环连接不需要 query 参与鉴权
 * （鉴权走消息层），故剥离无副作用。
 */
export function sanitizeWsUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return '<invalid-url>'
  }
}

/**
 * 连接声明。回调全部可选但必须是函数；回调抛错**不会**影响服务与其他连接
 * （与 overlays 的回调隔离策略一致）。
 *
 * 刻意**不提供**握手超时/重连/心跳：那些属于模块自己的协议语义（VTS 的两步认证、
 * OBS 的 op 握手各不相同），核心只做通用传输。模块可用自己的定时器实现。
 */
export interface ExternalWsSpec {
  url: string
  /** Socket opened (transport level — protocol handshake is the module's job). */
  onOpen?(): void
  /** Text frame received. */
  onMessage?(data: string): void
  /** Socket closed (by either side, or after an error). */
  onClose?(detail: string): void
  /** Transport error. */
  onError?(detail: string): void
}

/** Result shape of connect (facade + service). */
export interface ExternalWsResult {
  ok: boolean
  errors: string[]
}

/** Live connection snapshot (diagnostics / facade list). */
export interface ExternalWsStatus {
  moduleId: string
  id: string
  /** Sanitized (query/hash stripped) — safe to log. */
  url: string
  state: ExternalWsState
  sent: number
  received: number
  createdAt: number
  lastError?: string
}

/** Diagnostics snapshot. */
export interface ExternalWsDiagnostics {
  /** Connections currently open. */
  open: number
  /** Every module holding at least one connection. */
  byModule: Array<{ moduleId: string; ids: string[] }>
  /** Refused attempts (non-loopback URL or missing permission). */
  rejected: number
  lastRejection?: string
}

/** Events the host reports back to the service (service adds ownership). */
export interface ExternalWsHooks {
  onOpen(): void
  onMessage(data: string): void
  onClose(detail: string): void
  onError(detail: string): void
}

/** Opaque socket handle produced by the host; pass it back for operations. */
export type ExternalWsHandle = object

/**
 * Injected host — the only socket-aware piece (assembly root wires the `ws`
 * adapter; tests inject a fake). `connect` returns null when the socket could not
 * be created at all; `send` returns false when the socket is not open.
 */
export interface ExternalWsHost {
  connect(url: string, hooks: ExternalWsHooks): ExternalWsHandle | null
  send(handle: ExternalWsHandle, data: string): boolean
  close(handle: ExternalWsHandle): void
}

/**
 * Core outbound WebSocket service.
 *
 * - `connect` 校验回环 + 权限后交给宿主；`${moduleId}:${id}` 重复即失败。
 * - `send`    仅对 open 连接成功；超长 payload 拒绝；未 open 返回 false 并计数。
 * - `removeModule` 关闭并清理该模块全部连接（unload 路径）。
 * - 回调抛错被隔离，绝不影响服务或其他连接。
 */
export interface IExternalWs {
  connect(moduleId: string, id: string, spec: ExternalWsSpec): ExternalWsResult
  send(moduleId: string, id: string, data: string): boolean
  close(moduleId: string, id: string): boolean
  status(moduleId: string, id: string): ExternalWsStatus | null
  list(): ExternalWsStatus[]
  removeModule(moduleId: string): void
  diagnostics(): ExternalWsDiagnostics
}

/** Module-scoped facade handed to entries via ModuleContext. */
export interface ModuleExternalWs {
  connect(id: string, spec: ExternalWsSpec): ExternalWsResult
  send(id: string, data: string): boolean
  close(id: string): boolean
  status(id: string): ExternalWsStatus | null
  /** This module's connections only. */
  list(): ExternalWsStatus[]
}
