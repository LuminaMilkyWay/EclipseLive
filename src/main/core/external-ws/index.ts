import type { ILogger } from '@contracts/logger'
import type { IPermission } from '@contracts/permission'
import {
  EXTERNAL_WS_MAX_PAYLOAD,
  isLoopbackWsUrl,
  sanitizeWsUrl,
  type ExternalWsDiagnostics,
  type ExternalWsHandle,
  type ExternalWsHooks,
  type ExternalWsHost,
  type ExternalWsResult,
  type ExternalWsSpec,
  type ExternalWsState,
  type ExternalWsStatus,
  type IExternalWs
} from '@contracts/external-ws'

/**
 * 核心对外 WebSocket 客户端服务（C0）。
 *
 * Electron-free by construction：socket 由注入的宿主创建（测试用 fake，装配根传 `ws`
 * 适配器）——与 shortcuts / overlays 同一模式。
 *
 * 三条边界都在这里：
 * 1. **权限闸门** `external-websocket`（连接时检查，撤销立即生效）；
 * 2. **回环限定**：非本机回环目标一律拒绝（AI_RULES 11 的第一道物理保证）；
 * 3. **归属** `${moduleId}:${id}`：重复 id 直接失败，模块间不可互相操作。
 *
 * 生命周期与 routes/channels/shortcuts/overlays 一致：`removeModule` 关闭该模块全部连接。
 */

export interface ExternalWsOptions {
  logger: ILogger
  permissions: IPermission
  host: ExternalWsHost
}

interface Entry {
  moduleId: string
  id: string
  /** 已脱敏（无 query/hash）——可安全落日志与进诊断。 */
  url: string
  state: ExternalWsState
  handle: ExternalWsHandle | null
  spec: ExternalWsSpec
  sent: number
  received: number
  createdAt: number
  lastError?: string
}

export function createExternalWs(options: ExternalWsOptions): IExternalWs {
  const log = options.logger.child('external-ws')
  /** `${moduleId}:${id}` → entry */
  const byKey = new Map<string, Entry>()
  let rejected = 0
  let lastRejection: string | undefined

  /**
   * 隔离模块回调：模块抛错不得影响服务、其他连接或其他模块
   * （与 overlays 的回调隔离策略一致）。
   */
  function safe(
    fn: (() => void) | undefined,
    what: string,
    moduleId: string,
    id: string
  ): void {
    if (!fn) return
    try {
      fn()
    } catch (e) {
      log.warn('module callback threw', { moduleId, id, callback: what, error: String(e) })
    }
  }

  function reject(moduleId: string, id: string, reason: string): ExternalWsResult {
    rejected += 1
    lastRejection = reason
    log.warn('external websocket rejected', { moduleId, id, reason })
    return { ok: false, errors: [reason] }
  }

  function snapshot(e: Entry): ExternalWsStatus {
    return {
      moduleId: e.moduleId,
      id: e.id,
      url: e.url,
      state: e.state,
      sent: e.sent,
      received: e.received,
      createdAt: e.createdAt,
      ...(e.lastError === undefined ? {} : { lastError: e.lastError })
    }
  }

  /** 关闭 socket 并置终态；宿主抛错不得影响服务。 */
  function destroy(e: Entry): void {
    e.state = 'closed'
    const handle = e.handle
    e.handle = null
    if (!handle) return
    try {
      options.host.close(handle)
    } catch (err) {
      log.warn('host close threw', { moduleId: e.moduleId, id: e.id, error: String(err) })
    }
  }

  return {
    connect(moduleId, id, spec) {
      // 1) 权限闸门（连接时检查——撤销立即生效，无缓存）
      if (!options.permissions.check(moduleId, 'external-websocket')) {
        return reject(moduleId, id, 'missing permission: external-websocket')
      }
      // 2) 回环限定
      if (!isLoopbackWsUrl(spec.url)) {
        return reject(
          moduleId,
          id,
          `external websocket must target a loopback host (127.0.0.1 / localhost / ::1): ${sanitizeWsUrl(spec.url)}`
        )
      }
      // 3) 归属唯一（连接带活状态，不做 upsert）
      const key = `${moduleId}:${id}`
      if (byKey.has(key)) {
        return reject(moduleId, id, `connection id already in use: ${key} (close it first)`)
      }

      // 4) 先登记再建 socket：宿主可能**同步**回调 onOpen
      //    （真实 `ws` 是异步的，但服务不能依赖这一点）。
      const entry: Entry = {
        moduleId,
        id,
        url: sanitizeWsUrl(spec.url),
        state: 'connecting',
        handle: null,
        spec,
        sent: 0,
        received: 0,
        createdAt: Date.now()
      }
      byKey.set(key, entry)

      const hooks: ExternalWsHooks = {
        onOpen: () => {
          if (entry.state === 'closed') return
          entry.state = 'open'
          entry.lastError = undefined
          log.info('external websocket open', { moduleId, id, url: entry.url })
          safe(entry.spec.onOpen, 'onOpen', moduleId, id)
        },
        onMessage: (data) => {
          if (entry.state === 'closed') return
          entry.received += 1
          const fn = entry.spec.onMessage
          if (fn) safe(() => fn(data), 'onMessage', moduleId, id)
        },
        onClose: (detail) => {
          if (entry.state === 'closed') return
          entry.state = 'closed'
          log.info('external websocket closed', { moduleId, id, detail })
          const fn = entry.spec.onClose
          if (fn) safe(() => fn(detail), 'onClose', moduleId, id)
        },
        onError: (detail) => {
          entry.lastError = detail
          log.warn('external websocket error', { moduleId, id, error: detail })
          const fn = entry.spec.onError
          if (fn) safe(() => fn(detail), 'onError', moduleId, id)
        }
      }

      const handle = options.host.connect(spec.url, hooks)
      if (!handle) {
        byKey.delete(key)
        return reject(moduleId, id, `failed to open socket: ${entry.url}`)
      }
      // 注意：同步 onOpen 已把 state 置为 open，此处只补 handle，不得重置状态。
      entry.handle = handle
      return { ok: true, errors: [] }
    },

    send(moduleId, id, data) {
      const e = byKey.get(`${moduleId}:${id}`)
      if (!e || e.state !== 'open' || !e.handle) return false
      if (typeof data !== 'string' || data.length > EXTERNAL_WS_MAX_PAYLOAD) {
        log.warn('external websocket payload rejected', {
          moduleId,
          id,
          length: typeof data === 'string' ? data.length : -1
        })
        return false
      }
      const ok = options.host.send(e.handle, data)
      if (ok) e.sent += 1
      return ok
    },

    close(moduleId, id) {
      const key = `${moduleId}:${id}`
      const e = byKey.get(key)
      if (!e) return false
      destroy(e)
      byKey.delete(key)
      return true
    },

    status(moduleId, id) {
      const e = byKey.get(`${moduleId}:${id}`)
      return e ? snapshot(e) : null
    },

    list() {
      return [...byKey.values()].map(snapshot)
    },

    removeModule(moduleId) {
      for (const [key, e] of [...byKey]) {
        if (e.moduleId !== moduleId) continue
        destroy(e)
        byKey.delete(key)
      }
    },

    diagnostics(): ExternalWsDiagnostics {
      const grouped = new Map<string, string[]>()
      let open = 0
      for (const e of byKey.values()) {
        if (e.state === 'open') open += 1
        const ids = grouped.get(e.moduleId)
        if (ids) ids.push(e.id)
        else grouped.set(e.moduleId, [e.id])
      }
      return {
        open,
        byModule: [...grouped.entries()].map(([moduleId, ids]) => ({ moduleId, ids })),
        rejected,
        ...(lastRejection === undefined ? {} : { lastRejection })
      }
    }
  }
}
