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
  /** The only mode in T9: interface defined, nothing wired. */
  mode: 'local-empty'
  /** Rejected requests so far. */
  rejected: number
  lastRejection?: string
}

export interface INetworkClient {
  /** Always rejects in T9 — no cloud endpoints are configured (red line). */
  request(url: string, options?: NetworkRequestOptions): Promise<NetworkResponse>
  diagnostics(): NetworkDiagnostics
}
