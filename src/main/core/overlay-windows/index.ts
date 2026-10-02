import type { ILogger } from '@contracts/logger'
import type { IPermission } from '@contracts/permission'
import type {
  IOverlayWindows,
  OverlayBounds,
  OverlayHostHooks,
  OverlayResult,
  OverlayScreen,
  OverlayWindowHandle,
  OverlayWindowHost,
  OverlayWindowSpec,
  OverlayWindowStatus,
  OverlaysDiagnostics
} from '@contracts/overlays'

/**
 * Core overlay window service (T25).
 *
 * Electron-free by construction: the window host is injected (tests use a
 * fake; the assembly root passes the T26 BrowserWindow adapter). The
 * registry keys windows by `${moduleId}:${id}` — ownership is enforced by
 * key lookup, so a module can never touch another module's window.
 *
 * Bounds clamping (create + setBounds): width/height floored at minSize,
 * then the rectangle is pulled into the display it intersects most — a
 * rectangle with no intersection at all recalls to the primary display.
 * A window must never be lost off-screen.
 *
 * Host events are dispatched by key with a spec-identity staleness guard:
 * callbacks for a destroyed-and-recreated window id never fire into the
 * new registration. All module callbacks run through throw isolation.
 */

export interface OverlayWindowsOptions {
  logger: ILogger
  permissions: IPermission
  host: OverlayWindowHost
}

interface Entry {
  moduleId: string
  id: string
  spec: OverlayWindowSpec
  handle: OverlayWindowHandle
  bounds: OverlayBounds | null
  clickThrough: boolean
  alwaysOnTop: boolean
  createdAt: number
}

const DEFAULT_MIN_SIZE = { width: 200, height: 120 }

/** Clamp one rectangle into the display list (minSize floor, recall on lost). */
function clampBounds(
  bounds: OverlayBounds,
  screens: OverlayScreen[],
  minSize: { width: number; height: number }
): OverlayBounds {
  const width = Math.max(bounds.width, minSize.width)
  const height = Math.max(bounds.height, minSize.height)
  if (screens.length === 0) return { x: bounds.x, y: bounds.y, width, height }

  // Display with the largest intersection; none at all → primary (or first).
  let best: OverlayScreen | undefined
  let bestArea = 0
  for (const s of screens) {
    const ix = Math.min(bounds.x + width, s.bounds.x + s.bounds.width) - Math.max(bounds.x, s.bounds.x)
    const iy = Math.min(bounds.y + height, s.bounds.y + s.bounds.height) - Math.max(bounds.y, s.bounds.y)
    const area = Math.max(0, ix) * Math.max(0, iy)
    if (area > bestArea) {
      bestArea = area
      best = s
    }
  }
  const target = (best ?? screens.find((s) => s.primary) ?? screens[0])!.bounds
  const x = Math.min(Math.max(bounds.x, target.x), target.x + target.width - width)
  const y = Math.min(Math.max(bounds.y, target.y), target.y + target.height - height)
  return { x, y, width, height }
}

function normalizeSpec(spec: OverlayWindowSpec): OverlayWindowSpec {
  return {
    ...spec,
    minSize: spec.minSize ?? DEFAULT_MIN_SIZE,
    transparent: spec.transparent ?? true,
    alwaysOnTop: spec.alwaysOnTop ?? true,
    skipTaskbar: spec.skipTaskbar ?? true,
    focusable: spec.focusable ?? true,
    resizable: spec.resizable ?? true,
    clickThrough: spec.clickThrough ?? false
  }
}

export function createOverlayWindows(options: OverlayWindowsOptions): IOverlayWindows {
  const log = options.logger.child('overlays')
  const byKey = new Map<string, Entry>()

  const fail = (msg: string): OverlayResult => ({ ok: false, errors: [msg] })

  function dropEntry(key: string): Entry | undefined {
    const entry = byKey.get(key)
    if (!entry) return undefined
    byKey.delete(key)
    try {
      options.host.destroy(entry.handle)
    } catch (e) {
      log.warn('host destroy threw', { moduleId: entry.moduleId, id: entry.id, error: String(e) })
    }
    return entry
  }

  /** Callback dispatch with throw isolation — a module never crashes the service. */
  function safe(moduleId: string, id: string, what: string, fn: () => void): void {
    try {
      fn()
    } catch (e) {
      log.warn('overlay callback threw', { moduleId, id, what, error: String(e) })
    }
  }

  /**
   * Hook bundle bound to one registration. `live()` guards staleness by
   * spec identity: after destroy + re-create under the same id the OLD
   * host hooks must never mutate the NEW entry.
   */
  function hooksFor(moduleId: string, id: string, spec: OverlayWindowSpec): OverlayHostHooks {
    const key = `${moduleId}:${id}`
    const live = (): Entry | undefined => {
      const current = byKey.get(key)
      return current && current.spec === spec ? current : undefined
    }
    return {
      onClosed() {
        const entry = live()
        if (!entry) return
        dropEntry(key)
        log.info('overlay window closed by user', { moduleId, id })
        if (spec.onClosed) safe(moduleId, id, 'onClosed', spec.onClosed)
      },
      onCrashed(detail: string) {
        const entry = live()
        if (!entry) return
        dropEntry(key)
        log.warn('overlay window crashed — destroyed', { moduleId, id, detail })
        if (spec.onCrashed) safe(moduleId, id, 'onCrashed', () => spec.onCrashed!(detail))
      },
      onMoved(bounds: OverlayBounds) {
        const entry = live()
        if (!entry) return
        entry.bounds = bounds
        if (spec.onMoved) safe(moduleId, id, 'onMoved', () => spec.onMoved!(bounds))
      },
      onResized(bounds: OverlayBounds) {
        const entry = live()
        if (!entry) return
        entry.bounds = bounds
        if (spec.onResized) safe(moduleId, id, 'onResized', () => spec.onResized!(bounds))
      }
    }
  }

  const service: IOverlayWindows = {
    create(moduleId, id, spec) {
      if (typeof moduleId !== 'string' || moduleId.length === 0) {
        return fail('moduleId must be a non-empty string')
      }
      if (typeof id !== 'string' || id.length === 0) {
        return fail('id must be a non-empty string')
      }
      if (typeof spec.url !== 'string' || spec.url.length === 0) {
        return fail('spec.url must be a non-empty string')
      }
      for (const [name, fn] of [
        ['onClosed', spec.onClosed],
        ['onCrashed', spec.onCrashed],
        ['onMoved', spec.onMoved],
        ['onResized', spec.onResized]
      ] as const) {
        if (fn !== undefined && typeof fn !== 'function') {
          return fail(`spec.${name} must be a function`)
        }
      }
      if (!options.permissions.check(moduleId, 'window-overlay')) {
        return fail(`permission window-overlay not granted: ${moduleId}`)
      }

      const key = `${moduleId}:${id}`
      if (byKey.has(key)) {
        return fail(`overlay already exists, destroy it first: ${key}`)
      }

      const normalized = normalizeSpec(spec)
      if (normalized.bounds) {
        normalized.bounds = clampBounds(
          normalized.bounds,
          options.host.screens(),
          normalized.minSize ?? DEFAULT_MIN_SIZE
        )
      }

      const hooks = hooksFor(moduleId, id, normalized)
      let handle: OverlayWindowHandle | null
      try {
        handle = options.host.create(normalized, hooks)
      } catch (e) {
        handle = null
        log.warn('host create threw', { moduleId, id, error: String(e) })
      }
      if (!handle) return fail(`host failed to create window: ${key}`)

      const entry: Entry = {
        moduleId,
        id,
        spec: normalized,
        handle,
        bounds: normalized.bounds ?? null,
        clickThrough: normalized.clickThrough ?? false,
        alwaysOnTop: normalized.alwaysOnTop ?? true,
        createdAt: Date.now()
      }
      byKey.set(key, entry)

      // Backfill bounds from the host (it may have centered the window).
      try {
        entry.bounds = options.host.getBounds(handle)
      } catch {
        /* host may answer only after show; keep declared bounds */
      }
      log.info('overlay window created', { moduleId, id })
      return { ok: true, errors: [] }
    },

    destroy(moduleId, id) {
      const key = `${moduleId}:${id}`
      if (!byKey.has(key)) return false
      dropEntry(key)
      log.info('overlay window destroyed', { moduleId, id })
      return true
    },

    setClickThrough(moduleId, id, on) {
      const entry = byKey.get(`${moduleId}:${id}`)
      if (!entry) return false
      try {
        options.host.setClickThrough(entry.handle, on)
      } catch (e) {
        log.warn('host setClickThrough threw', { moduleId, id, error: String(e) })
        return false
      }
      entry.clickThrough = on
      log.info('overlay click-through toggled', { moduleId, id, on })
      return true
    },

    setAlwaysOnTop(moduleId, id, on) {
      const entry = byKey.get(`${moduleId}:${id}`)
      if (!entry) return false
      try {
        options.host.setAlwaysOnTop(entry.handle, on)
      } catch (e) {
        log.warn('host setAlwaysOnTop threw', { moduleId, id, error: String(e) })
        return false
      }
      entry.alwaysOnTop = on
      return true
    },

    setBounds(moduleId, id, bounds) {
      const entry = byKey.get(`${moduleId}:${id}`)
      if (!entry) return false
      const clamped = clampBounds(
        bounds,
        options.host.screens(),
        entry.spec.minSize ?? DEFAULT_MIN_SIZE
      )
      try {
        options.host.setBounds(entry.handle, clamped)
      } catch (e) {
        log.warn('host setBounds threw', { moduleId, id, error: String(e) })
        return false
      }
      entry.bounds = clamped
      return true
    },

    getBounds(moduleId, id) {
      const entry = byKey.get(`${moduleId}:${id}`)
      if (!entry) return null
      try {
        return options.host.getBounds(entry.handle)
      } catch {
        return entry.bounds
      }
    },

    screens() {
      return options.host.screens()
    },

    list() {
      return [...byKey.values()]
        .map(
          (e): OverlayWindowStatus => ({
            moduleId: e.moduleId,
            id: e.id,
            url: e.spec.url,
            bounds: e.bounds ? { ...e.bounds } : null,
            transparent: e.spec.transparent ?? true,
            alwaysOnTop: e.alwaysOnTop,
            clickThrough: e.clickThrough,
            focusable: e.spec.focusable ?? true,
            resizable: e.spec.resizable ?? true,
            createdAt: e.createdAt
          })
        )
        .sort((a, b) =>
          a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : a.id < b.id ? -1 : 1
        )
    },

    removeModule(moduleId) {
      const keys = [...byKey.keys()].filter((k) => k.startsWith(`${moduleId}:`))
      for (const key of keys) dropEntry(key)
      if (keys.length > 0) {
        log.info('module overlays removed', { moduleId, count: keys.length })
      }
    },

    diagnostics(): OverlaysDiagnostics {
      const ids = new Map<string, string[]>()
      let clickThroughCount = 0
      for (const entry of byKey.values()) {
        const arr = ids.get(entry.moduleId) ?? []
        arr.push(entry.id)
        ids.set(entry.moduleId, arr)
        if (entry.clickThrough) clickThroughCount += 1
      }
      return {
        open: byKey.size,
        byModule: [...ids.entries()]
          .map(([moduleId, list]) => ({ moduleId, ids: [...list].sort() }))
          .sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1)),
        clickThroughCount
      }
    }
  }

  return service
}
