import { createHash } from 'node:crypto'
import { WebSocket } from 'ws'
import type { ILogger } from '@contracts/logger'
import type { IConfig, ValidationResult } from '@contracts/config'
import type { IEventBus } from '@contracts/event'
import type { IGateway } from '@contracts/gateway'
import type { ICredentialStore } from '@contracts/credentials'
import type {
  IObsBridge,
  ObsBrowserSourceBinding,
  ObsConnectionStatus,
  ObsDiagnostics,
  ObsRequestResult,
  ObsRequestStatus
} from '@contracts/obs'

/**
 * Core OBS bridge (T8) — an obs-websocket v5 OUTBOUND client.
 *
 * - Never listens on a port: the gateway stays the only listening surface
 *   ("只连接不占用"). The bridge dials ws://127.0.0.1:<port> (default 4455,
 *   configurable via the `core.obs` section).
 * - v5 handshake: Hello → Identify(rpcVersion 1 + eventSubscriptions) →
 *   Identified, including the challenge/salt SHA-256 password auth when OBS
 *   asks for one.
 * - Requests (op 6/7) are matched by requestId with a timeout; transport
 *   failures reject, OBS-level failures resolve with ok:false.
 * - OBS events (op 5) are republished on the internal bus as
 *   `obs:<eventType>` (source 'obs').
 * - Auto-reconnect with exponential backoff; a manual disconnect stops the
 *   loop, reconnect() resets it. connect() never throws and never blocks
 *   startup — OBS-not-running lands in diagnostics.
 * - Browser-source bindings (persisted in `core.obs.bindings`) are synced
 *   on connect and on `gateway:port-changed`: URL comes from the gateway
 *   (token auto-embedded), existing sources are updated on change, missing
 *   sources are created in the current program scene. The URL is NEVER
 *   logged (it embeds the gateway token).
 */

const CONFIG_SECTION = 'core.obs'
const DEFAULT_PORT = 4455
const DEFAULT_EVENT_SUBSCRIPTIONS = 65535

interface PersistedShape {
  port: number
  password: string
  eventSubscriptions: number
  autoReconnect: boolean
  bindings: ObsBrowserSourceBinding[]
}

const FALLBACK_CONFIG: PersistedShape = {
  port: DEFAULT_PORT,
  password: '',
  eventSubscriptions: DEFAULT_EVENT_SUBSCRIPTIONS,
  autoReconnect: true,
  bindings: []
}

export interface ObsOptions {
  logger: ILogger
  config: IConfig
  bus: IEventBus
  gateway: IGateway
  /**
   * T9 credential store: the 'obs:password' secret takes priority over the
   * plaintext `core.obs.password` config value (the documented T8→T9 upgrade).
   */
  credentials?: ICredentialStore
  /** Test injectables (retry backoff base/cap and request+handshake timeout). */
  retryBaseMs?: number
  retryCapMs?: number
  requestTimeoutMs?: number
}

/** Convenience bundle used by tests and the assembly root. */
export interface ObsRig {
  obs: IObsBridge
  bus: IEventBus
  config: IConfig
  gateway: IGateway
  credentials: ICredentialStore
  logger: ILogger
  root: string
}

interface PendingRequest {
  resolve: (v: ObsRequestResult<unknown>) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validatePersisted(v: unknown): ValidationResult {
  const o = v as Record<string, unknown>
  if (!isPlainObject(o)) return { ok: false, errors: ['must be an object'] }
  if (typeof o.port !== 'number' || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535) {
    return { ok: false, errors: ['port must be an integer in [1, 65535]'] }
  }
  if (typeof o.password !== 'string') return { ok: false, errors: ['password must be a string'] }
  if (
    typeof o.eventSubscriptions !== 'number' ||
    !Number.isInteger(o.eventSubscriptions) ||
    o.eventSubscriptions < 0
  ) {
    return { ok: false, errors: ['eventSubscriptions must be a non-negative integer'] }
  }
  if (typeof o.autoReconnect !== 'boolean') {
    return { ok: false, errors: ['autoReconnect must be a boolean'] }
  }
  if (!Array.isArray(o.bindings)) return { ok: false, errors: ['bindings must be an array'] }
  for (const b of o.bindings) {
    if (
      !isPlainObject(b) ||
      typeof b.sourceName !== 'string' ||
      b.sourceName.length === 0 ||
      typeof b.path !== 'string' ||
      !b.path.startsWith('/')
    ) {
      return { ok: false, errors: ['each binding must be { sourceName: non-empty, path: "/…" }'] }
    }
  }
  return { ok: true, errors: [] }
}

/** obs-websocket v5 password auth: base64(sha256(base64(sha256(pw+salt))+challenge)). */
function computeAuth(password: string, challenge: string, salt: string): string {
  const sha256 = (data: string) => createHash('sha256').update(data, 'utf8').digest()
  return createHash('sha256')
    .update(sha256(`${password}${salt}`).toString('base64') + challenge)
    .digest('base64')
}

export function createObs(options: ObsOptions): IObsBridge {
  const log = options.logger.child('obs')
  const retryBase = options.retryBaseMs ?? 1000
  const retryCap = options.retryCapMs ?? 30_000
  const timeoutMs = options.requestTimeoutMs ?? 5000

  let ws: WebSocket | null = null
  let status: ObsConnectionStatus = 'disconnected'
  let lastError: string | undefined
  let lastConnectedAt: number | undefined
  let attempts = 0
  let requestsSent = 0
  let responsesReceived = 0
  let nextRequestId = 1
  let manuallyDisconnected = false
  let connecting = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<string, PendingRequest>()
  const bindingState = new Map<string, { synced: boolean; lastError?: string }>()

  options.config.register<PersistedShape>(CONFIG_SECTION, {
    defaults: FALLBACK_CONFIG,
    version: 1,
    validate: validatePersisted
  })

  // T5 consumer: gateway port changed → re-write bound browser-source URLs.
  options.bus.subscribe('gateway:port-changed', () => {
    if (status === 'connected') void syncAllBrowserSources()
  })

  function readConfig(): PersistedShape {
    return options.config.get<PersistedShape>(CONFIG_SECTION) ?? FALLBACK_CONFIG
  }

  function failPendingAll(reason: string): void {
    for (const [, p] of pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    pending.clear()
  }

  function destroySocket(socket: WebSocket | null): void {
    if (!socket) return
    socket.removeAllListeners()
    try {
      socket.terminate()
    } catch {
      /* already dead */
    }
  }

  function scheduleRetry(): void {
    if (manuallyDisconnected || !readConfig().autoReconnect) return
    if (retryTimer) clearTimeout(retryTimer)
    const delay = Math.min(retryBase * 2 ** Math.max(attempts - 1, 0), retryCap)
    retryTimer = setTimeout(() => {
      retryTimer = null
      void attempt()
    }, delay)
  }

  function markBinding(
    binding: ObsBrowserSourceBinding,
    synced: boolean,
    lastError?: string
  ): void {
    bindingState.set(binding.sourceName, { synced, lastError })
    // Never log the URL — it embeds the gateway token.
    if (synced) {
      log.info('browser source synced', { sourceName: binding.sourceName, path: binding.path })
    } else {
      log.warn('browser source sync failed', {
        sourceName: binding.sourceName,
        path: binding.path,
        error: lastError ?? 'unknown'
      })
    }
  }

  async function syncBinding(binding: ObsBrowserSourceBinding): Promise<void> {
    const url = options.gateway.getBrowserSourceUrl(binding.path)
    if (!url) {
      markBinding(binding, false, 'gateway not started')
      return
    }
    try {
      const current = await bridge.send<{ inputSettings?: { url?: string } }>('GetInputSettings', {
        inputName: binding.sourceName
      })
      if (current.ok && current.data?.inputSettings) {
        if (current.data.inputSettings.url === url) {
          markBinding(binding, true)
          return
        }
        const updated = await bridge.send('SetInputSettings', {
          inputName: binding.sourceName,
          inputSettings: { url },
          overlay: true
        })
        markBinding(binding, updated.ok, updated.ok ? undefined : 'SetInputSettings failed')
        return
      }
      // Source does not exist yet → create it in the current program scene.
      const scenes = await bridge.send<{ currentProgramSceneName?: string }>('GetSceneList')
      const sceneName = scenes.ok ? scenes.data?.currentProgramSceneName : undefined
      if (!sceneName) {
        markBinding(binding, false, 'cannot determine current scene')
        return
      }
      const created = await bridge.send('CreateInput', {
        sceneName,
        inputName: binding.sourceName,
        inputKind: 'browser_source',
        inputSettings: { url, width: 800, height: 600 }
      })
      markBinding(binding, created.ok, created.ok ? undefined : 'CreateInput failed')
    } catch (e) {
      markBinding(binding, false, String(e))
    }
  }

  async function syncAllBrowserSources(): Promise<void> {
    for (const binding of readConfig().bindings) {
      await syncBinding(binding)
    }
  }

  /** One connection attempt; resolves when the attempt settles either way. */
  function attempt(): Promise<void> {
    if (manuallyDisconnected || connecting || status === 'connected') {
      return Promise.resolve()
    }
    const cfg = readConfig()
    // T9: the credential store secret wins over the plaintext config value.
    const password = options.credentials?.get('obs:password') ?? cfg.password
    status = 'connecting'
    connecting = true
    return new Promise<void>((resolve) => {
      let settled = false
      let handshakeTimer: ReturnType<typeof setTimeout> | null = null
      const settle = (): void => {
        if (settled) return
        settled = true
        connecting = false
        resolve()
      }
      const finishFailure = (message: string): void => {
        if (settled) return
        lastError = message
        status = 'disconnected'
        attempts += 1
        log.warn('obs connection attempt failed', { error: message, attempts })
        failPendingAll('connection failed')
        settle()
        scheduleRetry()
      }

      let socket: WebSocket
      try {
        socket = new WebSocket(`ws://127.0.0.1:${cfg.port}`)
      } catch (e) {
        finishFailure(`cannot create connection: ${String(e)}`)
        return
      }
      ws = socket

      handshakeTimer = setTimeout(() => {
        finishFailure('handshake timeout')
        destroySocket(socket)
        if (ws === socket) ws = null
      }, timeoutMs)

      socket.on('error', (err) => {
        finishFailure(String(err))
      })

      socket.on('close', () => {
        if (handshakeTimer) {
          clearTimeout(handshakeTimer)
          handshakeTimer = null
        }
        if (ws === socket) ws = null
        if (status === 'connected') {
          // Dropped after being established.
          status = 'disconnected'
          lastError = 'connection closed'
          attempts += 1
          log.warn('obs connection closed', { attempts })
          failPendingAll('connection closed')
          scheduleRetry()
        }
        settle()
      })

      socket.on('message', (raw) => {
        let msg: { op: number; d: Record<string, unknown> }
        try {
          msg = JSON.parse(String(raw)) as { op: number; d: Record<string, unknown> }
        } catch {
          log.warn('obs message is not valid json')
          return
        }
        switch (msg.op) {
          case 0: {
            // Hello → Identify
            const identify: Record<string, unknown> = {
              rpcVersion: 1,
              eventSubscriptions: cfg.eventSubscriptions
            }
            const auth = msg.d.authentication as
              | { challenge: string; salt: string }
              | undefined
            if (auth) {
              if (password.length === 0) {
                finishFailure(
                  'OBS requires a password but none is configured'
                )
                destroySocket(socket)
                if (ws === socket) ws = null
                return
              }
              identify.authentication = computeAuth(password, auth.challenge, auth.salt)
            }
            socket.send(JSON.stringify({ op: 1, d: identify }))
            break
          }
          case 2: {
            // Identified
            if (handshakeTimer) {
              clearTimeout(handshakeTimer)
              handshakeTimer = null
            }
            status = 'connected'
            lastError = undefined
            lastConnectedAt = Date.now()
            attempts = 0
            log.info('obs connected', { port: cfg.port })
            settle()
            void syncAllBrowserSources()
            break
          }
          case 5: {
            // Event → internal bus
            const d = msg.d as { eventType?: string; eventData?: unknown }
            if (typeof d.eventType === 'string' && d.eventType.length > 0) {
              options.bus.publish(`obs:${d.eventType}`, d.eventData, { source: 'obs' })
            }
            break
          }
          case 7: {
            // RequestResponse
            responsesReceived += 1
            const d = msg.d as { requestId?: string; requestStatus?: ObsRequestStatus }
            const entry = typeof d.requestId === 'string' ? pending.get(d.requestId) : undefined
            if (!entry) return
            pending.delete(d.requestId as string)
            clearTimeout(entry.timer)
            entry.resolve({
              ok: d.requestStatus?.result === true,
              status: d.requestStatus ?? { result: false, code: 0 },
              data: (msg.d as { responseData?: unknown }).responseData
            })
            break
          }
          default:
            break
        }
      })
    })
  }

  const bridge: IObsBridge = {
    async connect(): Promise<void> {
      manuallyDisconnected = false
      await attempt()
    },

    disconnect(): void {
      manuallyDisconnected = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      destroySocket(ws)
      ws = null
      status = 'disconnected'
      failPendingAll('disconnected')
    },

    async reconnect(): Promise<void> {
      manuallyDisconnected = false
      attempts = 0
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      destroySocket(ws)
      ws = null
      status = 'disconnected'
      await attempt()
    },

    async send<T>(requestType: string, requestData?: unknown): Promise<ObsRequestResult<T>> {
      if (status !== 'connected' || !ws) throw new Error('not connected')
      const socket = ws
      const requestId = String(nextRequestId++)
      requestsSent += 1
      return new Promise<ObsRequestResult<T>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error(`request timeout: ${requestType}`))
        }, timeoutMs)
        pending.set(requestId, {
          resolve: (v) => resolve(v as ObsRequestResult<T>),
          reject,
          timer
        })
        socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }))
      })
    },

    bindBrowserSource(sourceName: string, path: string): void {
      if (sourceName.length === 0 || !path.startsWith('/')) {
        log.warn('invalid browser source binding rejected', { sourceName, path })
        return
      }
      const cfg = readConfig()
      const bindings = cfg.bindings.filter((b) => b.sourceName !== sourceName)
      bindings.push({ sourceName, path })
      const result = options.config.set<PersistedShape>(CONFIG_SECTION, { ...cfg, bindings })
      if (!result.ok) {
        log.error('persisting browser source binding failed', { errors: result.errors })
        return
      }
      bindingState.delete(sourceName)
      log.info('browser source bound', { sourceName, path })
      if (status === 'connected') void syncBinding({ sourceName, path })
    },

    unbindBrowserSource(sourceName: string): void {
      const cfg = readConfig()
      const bindings = cfg.bindings.filter((b) => b.sourceName !== sourceName)
      if (bindings.length === cfg.bindings.length) return
      const result = options.config.set<PersistedShape>(CONFIG_SECTION, { ...cfg, bindings })
      if (!result.ok) {
        log.error('persisting browser source unbind failed', { errors: result.errors })
      }
      bindingState.delete(sourceName)
    },

    listBrowserSources(): ObsBrowserSourceBinding[] {
      return readConfig().bindings.map((b) => ({ ...b }))
    },

    diagnostics(): ObsDiagnostics {
      const cfg = readConfig()
      return {
        status,
        port: cfg.port,
        attempts,
        lastError,
        lastConnectedAt,
        requestsSent,
        responsesReceived,
        browserSources: cfg.bindings.map((b) => {
          const s = bindingState.get(b.sourceName)
          return {
            sourceName: b.sourceName,
            path: b.path,
            synced: s?.synced ?? false,
            lastError: s?.lastError
          }
        })
      }
    }
  }

  return bridge
}
