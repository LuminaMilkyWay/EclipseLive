import type { ILogger } from '@contracts/logger'
import type { IPermission } from '@contracts/permission'
import type {
  IGlobalShortcuts,
  ShortcutConflict,
  ShortcutHandler,
  ShortcutHost,
  ShortcutRecord,
  ShortcutResult,
  ShortcutsDiagnostics
} from '@contracts/shortcuts'

/**
 * Core global shortcut service (T23).
 *
 * Electron-free by construction: the shortcut host is injected (tests use
 * a fake; the assembly root passes the globalShortcut adapter). The
 * registry keeps a `${moduleId}:${id}` map plus an accelerator→key index
 * so cross-module conflicts are rejected BEFORE the host is touched —
 * Electron silently overwrites the callback of a duplicate accelerator,
 * so the service cannot rely on the host to report conflicts.
 */

const CONFLICT_RING_SIZE = 20

export interface ShortcutsOptions {
  logger: ILogger
  permissions: IPermission
  host: ShortcutHost
}

interface Entry {
  moduleId: string
  id: string
  accelerator: string
  handler: ShortcutHandler
  registeredAt: number
}

export function createShortcuts(options: ShortcutsOptions): IGlobalShortcuts {
  const log = options.logger.child('shortcuts')
  const byKey = new Map<string, Entry>() // `${moduleId}:${id}` -> entry
  const byAccelerator = new Map<string, string>() // accelerator -> key
  const conflicts: ShortcutConflict[] = []

  const fail = (msg: string): ShortcutResult => ({ ok: false, errors: [msg] })

  function recordConflict(
    moduleId: string,
    id: string,
    accelerator: string,
    heldBy: string
  ): void {
    conflicts.push({ moduleId, id, accelerator, heldBy, time: Date.now() })
    if (conflicts.length > CONFLICT_RING_SIZE) conflicts.shift()
    log.warn('shortcut registration lost', { moduleId, id, accelerator, heldBy })
  }

  function dropEntry(key: string): void {
    const entry = byKey.get(key)
    if (!entry) return
    byKey.delete(key)
    if (byAccelerator.get(entry.accelerator) === key) byAccelerator.delete(entry.accelerator)
    try {
      options.host.unregister(entry.accelerator)
    } catch (e) {
      log.warn('host unregister threw', { accelerator: entry.accelerator, error: String(e) })
    }
  }

  /** Trigger-time dispatch: permission re-checked, handler isolated. */
  function dispatch(entry: Entry): void {
    if (!options.permissions.check(entry.moduleId, 'global-shortcut')) {
      // Revocation takes effect immediately: drop the entry, never fire.
      log.warn('shortcut fired with permission revoked — unregistering', {
        moduleId: entry.moduleId,
        id: entry.id
      })
      dropEntry(`${entry.moduleId}:${entry.id}`)
      return
    }
    try {
      entry.handler()
    } catch (e) {
      log.warn('shortcut handler threw', {
        moduleId: entry.moduleId,
        id: entry.id,
        error: String(e)
      })
    }
  }

  const service: IGlobalShortcuts = {
    register(moduleId, id, accelerator, handler) {
      if (typeof moduleId !== 'string' || moduleId.length === 0) {
        return fail('moduleId must be a non-empty string')
      }
      if (typeof id !== 'string' || id.length === 0) {
        return fail('id must be a non-empty string')
      }
      if (typeof accelerator !== 'string' || accelerator.length === 0) {
        return fail('accelerator must be a non-empty string')
      }
      if (typeof handler !== 'function') {
        return fail('handler must be a function')
      }
      if (!options.permissions.check(moduleId, 'global-shortcut')) {
        return fail(`permission global-shortcut not granted: ${moduleId}`)
      }

      const key = `${moduleId}:${id}`
      const existing = byKey.get(key)

      // Cross-module conflict check BEFORE touching the host.
      const holder = byAccelerator.get(accelerator)
      if (holder !== undefined && holder !== key) {
        const heldBy = byKey.get(holder)?.moduleId ?? holder
        recordConflict(moduleId, id, accelerator, heldBy)
        return fail(`conflict: ${accelerator} held by ${heldBy}`)
      }

      // Take the new accelerator first; release the old one only on
      // success so a failed upsert never leaves "neither" registered.
      const next: Entry = { moduleId, id, accelerator, handler, registeredAt: Date.now() }
      let taken: boolean
      try {
        taken = options.host.register(accelerator, () => dispatch(next))
      } catch (e) {
        taken = false
        log.warn('host register threw', { accelerator, error: String(e) })
      }
      if (!taken) {
        recordConflict(moduleId, id, accelerator, 'system')
        return fail(`unavailable: ${accelerator} held by system or another application`)
      }

      if (existing && existing.accelerator !== accelerator) {
        try {
          options.host.unregister(existing.accelerator)
        } catch (e) {
          log.warn('host unregister threw during upsert', {
            accelerator: existing.accelerator,
            error: String(e)
          })
        }
        byAccelerator.delete(existing.accelerator)
      }
      byKey.set(key, next)
      byAccelerator.set(accelerator, key)
      log.info('shortcut registered', { moduleId, id, accelerator })
      return { ok: true, errors: [] }
    },

    unregister(moduleId, id) {
      const key = `${moduleId}:${id}`
      if (!byKey.has(key)) return false
      dropEntry(key)
      log.info('shortcut unregistered', { moduleId, id })
      return true
    },

    removeModule(moduleId) {
      const keys = [...byKey.keys()].filter((k) => k.startsWith(`${moduleId}:`))
      for (const key of keys) dropEntry(key)
      if (keys.length > 0) {
        log.info('module shortcuts removed', { moduleId, count: keys.length })
      }
    },

    list() {
      return [...byKey.values()]
        .map(
          ({ moduleId, id, accelerator, registeredAt }): ShortcutRecord => ({
            moduleId,
            id,
            accelerator,
            registeredAt
          })
        )
        .sort((a, b) =>
          a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : a.id < b.id ? -1 : 1
        )
    },

    diagnostics(): ShortcutsDiagnostics {
      const ids = new Map<string, string[]>()
      for (const entry of byKey.values()) {
        const arr = ids.get(entry.moduleId) ?? []
        arr.push(entry.id)
        ids.set(entry.moduleId, arr)
      }
      return {
        registered: byKey.size,
        byModule: [...ids.entries()]
          .map(([moduleId, list]) => ({ moduleId, ids: [...list].sort() }))
          .sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1)),
        conflicts: [...conflicts]
      }
    }
  }

  return service
}
