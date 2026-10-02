/**
 * Gateway contract.
 *
 * The gateway is the ONLY sanctioned network surface of the whole app:
 * one 127.0.0.1 port, HTTP + a single multiplexed WebSocket, all requests
 * token-checked. Modules register routes and channels here instead of ever
 * listening on their own — anything else is a contract violation.
 */

/** HTTP methods the gateway routes. */
export type HttpMethod = 'GET' | 'POST'

/** Parsed request handed to a route handler. */
export interface GatewayRequest {
  method: HttpMethod
  path: string
  query: URLSearchParams
  /** Parsed JSON body; undefined for GET, absent bodies, or invalid JSON. */
  json<T>(): T | undefined
}

/** Route handler response. Body is serialized as JSON when present;
 *  a non-JSON contentType (e.g. text/html for module pages, T31) writes the
 *  body string verbatim. */
export interface GatewayResponse {
  status: number
  body?: unknown
  /** Optional content type; default application/json (JSON.stringify body). */
  contentType?: string
}

/** A registered HTTP route handler (sync or async). */
export type RouteHandler = (req: GatewayRequest) => GatewayResponse | Promise<GatewayResponse>

/** A connected WebSocket client, as seen by channel handlers. */
export interface GatewayClient {
  id: number
  close(): void
}

/** Handler bound to one channel; messages arrive from clients. */
export interface WebSocketChannelHandler {
  onMessage?(payload: unknown, client: GatewayClient): void
}

/** One recent gateway error (diagnostics ring). */
export interface GatewayErrorRecord {
  time: number
  message: string
}

/** Gateway state snapshot for the diagnostics route/page. */
export interface GatewayDiagnostics {
  started: boolean
  port: number | null
  tokenPresent: boolean
  /** Registered routes, e.g. "GET /diagnostics". */
  routes: string[]
  channels: string[]
  wsClients: number
  recentErrors: GatewayErrorRecord[]
}

/**
 * The local service gateway.
 *
 * - `start()` resolves only after the port is listening; port preference is
 *   read from config, falls back to an OS-assigned port on conflict, and
 *   the final port is persisted + announced via `gateway:port-changed`.
 * - Token is generated per launch (never persisted, never logged); URLs
 *   produced by the getters embed it.
 * - Broadcasts are channel-scoped to all connected clients; only channels
 *   with a registered handler may carry traffic.
 * - Throwing handlers are isolated: logged, recorded in diagnostics, and
 *   never affect other routes, channels, or connections.
 */
export interface IGateway {
  registerHttpRoute(method: HttpMethod, path: string, handler: RouteHandler): void
  unregisterHttpRoute(method: HttpMethod, path: string): void
  registerWebSocketChannel(channel: string, handler: WebSocketChannelHandler): void
  unregisterWebSocketChannel(channel: string): void
  /** Send a payload to every connected client on a registered channel. */
  broadcast(channel: string, payload: unknown): void
  start(): Promise<void>
  stop(): Promise<void>
  getPort(): number | null
  /** `http://127.0.0.1:<port><path>?token=…` or null before start. */
  getRouteUrl(path: string): string | null
  /** Browser-source URL (defaults to "/"). */
  getBrowserSourceUrl(path?: string): string | null
  /** `ws://127.0.0.1:<port>/ws?token=…` or null before start. */
  getWebSocketUrl(): string | null
  diagnostics(): GatewayDiagnostics
}
