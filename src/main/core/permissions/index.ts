import type { ILogger } from '@contracts/logger'
import type { IConfig, ValidationResult } from '@contracts/config'
import type {
  DeclareResult,
  IPermission,
  ModulePermissionStatus,
  PermissionStatus,
  PermissionType
} from '@contracts/permission'
import { isPermissionType } from '@contracts/permission'

/**
 * Central permission service.
 *
 * - Modules declare a closed-catalog permission set at load time; the
 *   declaration is idempotent for identical sets and rejects any change
 *   (silent escalation prevention) — changes require a reinstall.
 * - A declared permission is granted until the user revokes it. Revocation
 *   is immediate, persisted (via the config center) and kept across module
 *   removal/reinstall until explicitly re-granted.
 * - The factory is async on purpose: persisted revocations must be loaded
 *   before any declaration lands, eliminating the startup race where a
 *   revoked permission could slip through.
 */

export interface PermissionOptions {
  logger: ILogger
  config: IConfig
}

const CONFIG_SECTION = 'core.permissions'

/** Persisted shape: revocations per module id. */
interface PersistedShape {
  revoked: Record<string, string[]>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validatePersisted(v: unknown): ValidationResult {
  const o = v as { revoked?: unknown }
  if (!isPlainObject(o)) return { ok: false, errors: ['must be an object'] }
  const revoked = o.revoked
  if (!isPlainObject(revoked)) return { ok: false, errors: ['revoked must be an object'] }
  for (const [id, list] of Object.entries(revoked)) {
    if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) {
      return { ok: false, errors: [`revoked.${id} must be an array of strings`] }
    }
  }
  return { ok: true, errors: [] }
}

export async function createPermissions(options: PermissionOptions): Promise<IPermission> {
  const log = options.logger.child('permissions')
  const declared = new Map<string, Set<PermissionType>>()
  const revoked = new Map<string, Set<PermissionType>>()

  options.config.register<PersistedShape>(CONFIG_SECTION, {
    defaults: { revoked: {} },
    version: 1,
    validate: validatePersisted
  })

  // Wait for the section load before any declaration can be accepted so
  // persisted revocations are always in effect (no startup race window).
  await options.config.ready()
  applyPersisted(options.config.get<PersistedShape>(CONFIG_SECTION))

  function applyPersisted(shape: PersistedShape | undefined): void {
    const map = shape?.revoked
    if (!isPlainObject(map)) return
    for (const [id, list] of Object.entries(map)) {
      if (!Array.isArray(list)) continue
      // Runtime convergence: garbage permission names never take effect.
      const set = new Set<PermissionType>(list.filter(isPermissionType))
      if (set.size > 0) revoked.set(id, set)
    }
  }

  function persist(): void {
    const out: Record<string, string[]> = {}
    for (const [id, set] of revoked) {
      if (set.size > 0) out[id] = [...set]
    }
    const result = options.config.set<PersistedShape>(CONFIG_SECTION, { revoked: out })
    if (!result.ok) {
      log.error('persist revocations failed', { errors: result.errors })
    }
  }

  const service: IPermission = {
    declare(moduleId: string, permissions: PermissionType[]): DeclareResult {
      const existing = declared.get(moduleId)
      const incoming = new Set<PermissionType>(permissions.filter(isPermissionType))

      if (existing) {
        const same =
          existing.size === incoming.size &&
          [...existing].every((p) => incoming.has(p))
        if (!same) {
          log.warn('permission escalation attempt blocked', { moduleId })
          return {
            ok: false,
            errors: ['permission escalation: re-declaration must match the original set']
          }
        }
        return { ok: true, errors: [] }
      }

      const unknown = permissions.filter((p) => !isPermissionType(p))
      if (unknown.length > 0) {
        return { ok: false, errors: unknown.map((p) => `unknown permission: ${String(p)}`) }
      }

      declared.set(moduleId, incoming)
      return { ok: true, errors: [] }
    },

    removeModule(moduleId: string): void {
      // Revocations are intentionally kept: a reinstall must not silently
      // regain a permission the user revoked.
      declared.delete(moduleId)
    },

    revoke(moduleId: string, permission: PermissionType): boolean {
      const d = declared.get(moduleId)
      if (!d || !d.has(permission)) return false
      let set = revoked.get(moduleId)
      if (!set) {
        set = new Set()
        revoked.set(moduleId, set)
      }
      set.add(permission)
      persist()
      return true
    },

    grant(moduleId: string, permission: PermissionType): boolean {
      const d = declared.get(moduleId)
      if (!d || !d.has(permission)) return false
      revoked.get(moduleId)?.delete(permission)
      persist()
      return true
    },

    check(moduleId: string, permission: PermissionType): boolean {
      const d = declared.get(moduleId)
      if (!d || !d.has(permission)) return false
      return !(revoked.get(moduleId)?.has(permission) ?? false)
    },

    status(moduleId: string): PermissionStatus {
      const d = declared.get(moduleId) ?? new Set<PermissionType>()
      const r = revoked.get(moduleId) ?? new Set<PermissionType>()
      const revokedList = [...r].filter((p) => d.has(p))
      const grantedList = [...d].filter((p) => !r.has(p))
      return { declared: [...d], revoked: revokedList, granted: grantedList }
    },

    listAll(): ModulePermissionStatus[] {
      return [...declared.keys()].map((moduleId) => ({
        moduleId,
        ...service.status(moduleId)
      }))
    }
  }

  return service
}
