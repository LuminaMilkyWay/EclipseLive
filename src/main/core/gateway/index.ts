import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ILogger } from '@contracts/logger'
import type { IConfig } from '@contracts/config'
import type { IEventBus } from '@contracts/event'
import type {
  GatewayClient,
  GatewayDiagnostics,
  GatewayErrorRecord,
  GatewayRequest,
  HttpMethod,
  IGateway,
  RouteHandler,
  WebSocketChannelHandler
} from '@contracts/gateway'

/**
 * The local service gateway — the ONLY network surface of the app.
 *
 * - Binds 127.0.0.1 only. Preferred port comes from the config section
 *   `core.gateway` (default 27900); on conflict it falls back to an
 *   OS-assigned port, persists the actual port and announces
 *   `gateway:port-changed` on the bus (T8 updates OBS sources with it).
 * - Token: 48 hex chars from crypto.randomBytes per launch; never
 *   persisted, never logged. Every HTTP request and WS upgrade is checked
 *   (query `?token=` or `Authorization: Bearer`); no token → reject.
 * - Single WS endpoint `/ws` multiplexed by `{ channel, payload }`
 *   envelopes; only registered channels carry traffic.
 * - Fault isolation: throwing route/channel handlers are logged, pushed
 *   into the diagnostics error ring, and never affect anything else.
 */

const BIND_HOST = '127.0.0.1'
const DEFAULT_PORT = 27900
const MAX_BODY_BYTES = 64 * 1024
const ERROR_RING_SIZE = 20
const WS_PATH = '/ws'

export interface GatewayOptions {
  logger: ILogger
  config: IConfig
  bus: IEventBus
  /** Test/first-run override; 0 = OS-assigned random port. */
  preferredPort?: number
}

/** Convenience bundle used by tests and the assembly root. */
export interface GatewayRig {
  gateway: IGateway
  bus: IEventBus
  config: IConfig
  logger: ILogger
}

export function createGateway(options: GatewayOptions): IGateway {
  const log = options.logger.child('gateway')
  const { config, bus } = options

  const token = randomBytes(24).toString('hex')
  const routes = new Map<string, RouteHandler>()
  const channels = new Map<string, WebSocketChannelHandler>()
  const clients = new Set<WebSocket>()
  const recentErrors: GatewayErrorRecord[] = []

  let server: Server | null = null
  let wss: WebSocketServer | null = null
  let started = false
  let port: number | null = null
  let nextClientId = 1

  config.register('core.gateway', {
    defaults: { port: DEFAULT_PORT },
    version: 1,
    validate: (v) => {
      const o = v as { port?: unknown }
      if (typeof o !== 'object' || o === null) return { ok: false, errors: ['must be an object'] }
      if (typeof o.port !== 'number' || !Number.isInteger(o.port) || o.port < 0 || o.port > 65535) {
        return { ok: false, errors: ['port must be an integer in [0, 65535]'] }
      }
      return { ok: true, errors: [] }
    }
  })

  function pushError(message: string): void {
    recentErrors.push({ time: Date.now(), message })
    if (recentErrors.length > ERROR_RING_SIZE) recentErrors.shift()
  }

  const routeKey = (method: HttpMethod, path: string): string => `${method} ${path}`

  function tokenFromRequest(url: URL, headers: IncomingMessage['headers']): string | null {
    const fromQuery = url.searchParams.get('token')
    if (fromQuery) return fromQuery
    const auth = headers.authorization
    if (auth && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length)
    return null
  }

  async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        return undefined
      }
      chunks.push(chunk)
    }
    return chunks.length > 0 ? Buffer.concat(chunks) : undefined
  }

  function send(
    res: ServerResponse,
    status: number,
    body?: unknown,
    contentType?: string
  ): void {
    const isJson = contentType === undefined || contentType.includes('json')
    const payload =
      body === undefined ? '' : isJson ? JSON.stringify(body) : String(body)
    res.writeHead(status, {
      'content-type': contentType ?? 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    })
    res.end(payload)
  }

  const requestHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization'
      })
      res.end()
      return
    }
    const method: HttpMethod = req.method === 'POST' ? 'POST' : 'GET'
    const url = new URL(req.url ?? '/', `http://${BIND_HOST}`)
    if (tokenFromRequest(url, req.headers) !== token) {
      send(res, 401, { error: 'unauthorized' })
      return
    }
    const handler = routes.get(routeKey(method, url.pathname))
    if (!handler) {
      send(res, 404, { error: 'not found' })
      return
    }
    const raw = method === 'POST' ? await readBody(req) : undefined
    let parsed: unknown
    let parsedTried = false
    const request: GatewayRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      json<T>(): T | undefined {
        if (!parsedTried) {
          parsedTried = true
          if (raw && raw.length > 0) {
            try {
              parsed = JSON.parse(raw.toString('utf8'))
            } catch {
              parsed = undefined
            }
          }
        }
        return parsed as T | undefined
      }
    }
    try {
      const out = await handler(request)
      send(res, out.status, out.body, out.contentType)
    } catch (e) {
      pushError(`route ${method} ${url.pathname}: ${String(e)}`)
      log.error('route handler threw', { route: `${method} ${url.pathname}`, error: String(e) })
      send(res, 500, { error: 'internal' })
    }
  }

  function attachWs(srv: Server): void {
    const wsServer = new WebSocketServer({ noServer: true })
    wss = wsServer
    wsServer.on('connection', (ws: WebSocket) => {
      clients.add(ws)
      const client: GatewayClient = { id: nextClientId++, close: () => ws.close() }
      ws.on('message', (data) => {
        let msg: { channel?: unknown; payload?: unknown }
        try {
          msg = JSON.parse(String(data)) as { channel?: unknown; payload?: unknown }
        } catch {
          log.warn('ws message is not valid json')
          return
        }
        if (typeof msg.channel !== 'string') {
          log.warn('ws message missing channel')
          return
        }
        const channel = channels.get(msg.channel)
        if (!channel) {
          log.warn('message on unregistered channel', { channel: msg.channel })
          return
        }
        try {
          channel.onMessage?.(msg.payload, client)
        } catch (e) {
          pushError(`ws channel ${msg.channel}: ${String(e)}`)
          log.error('ws handler threw', { channel: msg.channel, error: String(e) })
        }
      })
      ws.on('close', () => clients.delete(ws))
      ws.on('error', () => {
        /* handled via close */
      })
    })
    srv.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', `http://${BIND_HOST}`)
      if (url.pathname !== WS_PATH || tokenFromRequest(url, req.headers) !== token) {
        log.warn('ws upgrade rejected', { path: url.pathname })
        socket.destroy()
        return
      }
      wsServer.handleUpgrade(req, socket, head, (ws) => {
        wsServer.emit('connection', ws, req)
      })
    })
  }

  function listenOnce(portAttempt: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        void requestHandler(req, res)
      })
      const onError = (e: Error): void => {
        srv.close()
        reject(e)
      }
      srv.once('error', onError)
      srv.listen(portAttempt, BIND_HOST, () => {
        srv.off('error', onError)
        resolve(srv)
      })
    })
  }

  const gateway: IGateway = {
    registerHttpRoute(method, path, handler) {
      const key = routeKey(method, path)
      if (routes.has(key)) log.warn('route re-registered (replaced)', { route: key })
      routes.set(key, handler)
    },

    unregisterHttpRoute(method, path) {
      routes.delete(routeKey(method, path))
    },

    registerWebSocketChannel(channel, handler) {
      if (channels.has(channel)) log.warn('channel re-registered (replaced)', { channel })
      channels.set(channel, handler)
    },

    unregisterWebSocketChannel(channel) {
      channels.delete(channel)
    },

    broadcast(channel, payload) {
      if (!channels.has(channel)) {
        log.warn('broadcast on unregistered channel blocked', { channel })
        return
      }
      const message = JSON.stringify({ channel, payload })
      for (const ws of clients) {
        if (ws.readyState === ws.OPEN) {
          try {
            ws.send(message)
          } catch {
            /* dead client — the close event cleans it up */
          }
        }
      }
    },

    async start() {
      if (started) return
      // Ensure the persisted port preference is loaded before reading it.
      await config.ready()
      const preferred =
        options.preferredPort ?? config.get<{ port: number }>('core.gateway')?.port ?? DEFAULT_PORT
      try {
        server = await listenOnce(preferred)
      } catch (e) {
        log.warn('preferred port unavailable, requesting ephemeral port', {
          port: preferred,
          error: String(e)
        })
        server = await listenOnce(0)
      }
      const addr = server.address()
      port = typeof addr === 'object' && addr !== null ? addr.port : null
      started = true
      attachWs(server)

      const previous = config.get<{ port: number }>('core.gateway')?.port
      const writeResult = config.set('core.gateway', { port: port as number })
      if (!writeResult.ok) log.error('persisting gateway port failed', { errors: writeResult.errors })

      bus.publish('gateway:started', { port }, { source: 'gateway' })
      if (previous !== undefined && previous !== port) {
        bus.publish('gateway:port-changed', { port, previous }, { source: 'gateway' })
      }
      log.info('gateway listening', { port })
    },

    async stop() {
      if (!started) return
      started = false
      const srv = server
      server = null
      port = null
      for (const ws of clients) ws.close()
      clients.clear()
      const wsServer = wss
      wss = null
      await new Promise<void>((resolve) => {
        if (wsServer) wsServer.close(() => resolve())
        else resolve()
      })
      await new Promise<void>((resolve) => {
        if (srv) srv.close(() => resolve())
        else resolve()
      })
      bus.publish('gateway:stopped', {}, { source: 'gateway' })
    },

    getPort() {
      return port
    },

    getRouteUrl(path) {
      if (!started || port === null) return null
      return `http://${BIND_HOST}:${port}${path}?token=${token}`
    },

    getBrowserSourceUrl(path) {
      return gateway.getRouteUrl(path ?? '/')
    },

    getWebSocketUrl() {
      if (!started || port === null) return null
      return `ws://${BIND_HOST}:${port}${WS_PATH}?token=${token}`
    },

    diagnostics(): GatewayDiagnostics {
      return {
        started,
        port,
        tokenPresent: token.length > 0,
        routes: [...routes.keys()],
        channels: [...channels.keys()],
        wsClients: clients.size,
        recentErrors: [...recentErrors]
      }
    }
  }

  // Built-in diagnostics route — token-protected like everything else.
  gateway.registerHttpRoute('GET', '/diagnostics', () => ({
    status: 200,
    body: gateway.diagnostics()
  }))

  return gateway
}
