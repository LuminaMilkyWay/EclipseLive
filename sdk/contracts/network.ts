/**
 * Unified network client contract.
 *
 * EVERY future outbound HTTP request must go through this interface —
 * modules may never use fetch or third-party HTTP clients directly (a
 * module-contract rule, enforced by review; the module-facing facade will
 * gate on the `network-access` permission when real endpoints ever land).
 *
 * In T9 the local implementation is deliberately EMPTY: no cloud
 * endpoints exist (local-first red line) and every request rejects with an
 * explicit message. Wiring real endpoints requires a core change behind
 * explicit user consent — it cannot happen by accident through a module.
 */

export interface NetworkRequestOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  /** JSON-serialized when present. */
  body?: unknown
  timeoutMs?: number
}

export interface NetworkResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

/** Diagnostics snapshot (the T12 diagnostics page "网络状态" source). */
export interface NetworkDiagnostics {
  /**
   * `local-empty` = T9 的本地空实现（**默认**：未获用户同意时一律拒绝）；
   * `enabled` = C2 受管实现已获用户明确同意，会真实出站（仅 https + 主机白名单）。
   */
  mode: 'local-empty' | 'enabled'
  /** Rejected requests so far. */
  rejected: number
  lastRejection?: string
  /** 仅在 `enabled` 时提供：成功出站次数。 */
  sent?: number
  /** 仅在 `enabled` 时提供：累计响应字节数。 */
  bytesIn?: number
  /** 仅在 `enabled` 时提供：当前放行的主机（供设置界面展示）。 */
  allowedHosts?: readonly string[]
}

export interface INetworkClient {
  /**
   * 未获用户同意时**一律 reject**（与 T9 行为一致）；获准后仅允许
   * **https + 白名单主机**，且**不跟随重定向**（防止白名单被 302 绕过）。
   */
  request(url: string, options?: NetworkRequestOptions): Promise<NetworkResponse>
  diagnostics(): NetworkDiagnostics
}

/**
 * C2：核心侧的网络服务。相对模块可见的 `INetworkClient` 多一个 `forModule`：
 * 核心用 `forModule(moduleId)` 生成**带模块身份**的门面（用于记账、审计与限权），
 * 模块只能拿到 `INetworkClient` ⇒ 模块无法伪造成别人、也无法触达核心自身的调用。
 */
export interface INetworkService extends INetworkClient {
  /** 生成某模块专用的门面（同一个服务、同一套闸门，只是绑定了模块身份）。 */
  forModule(moduleId: string): INetworkClient
  /** 当前放行的主机（供设置界面展示；同样适用于模块门面）。 */
  allowedHosts?: () => readonly string[]
}
