/**
 * Global shortcut contract (T23).
 *
 * Modules register Electron-format accelerator hotkeys through the scoped
 * `ctx.shortcuts` facade; the core service owns the permission gate
 * (checked at registration AND at trigger time — a revocation disables the
 * shortcut on the very next press), cross-module accelerator conflict
 * detection (the registry is consulted BEFORE the host because Electron
 * silently overwrites the callback of a duplicate accelerator), and
 * lifecycle cleanup (module unload drops every registration).
 *
 * Design note — no manifest declaration set: shortcut ids are
 * module-private labels that occupy no shared namespace (unlike
 * events/routes/channels, which guard a shared registry). The genuinely
 * shared resource is the global accelerator space, protected by the
 * `global-shortcut` permission plus conflict detection.
 */

/** Handler invoked when the registered accelerator is pressed. */
export type ShortcutHandler = () => void

/** One live registration. */
export interface ShortcutRecord {
  moduleId: string
  /** Module-private shortcut id (e.g. "send"). */
  id: string
  /** Electron accelerator (e.g. "CommandOrControl+Shift+P"). */
  accelerator: string
  registeredAt: number
}

/** A registration attempt that lost the accelerator. */
export interface ShortcutConflict {
  moduleId: string
  id: string
  accelerator: string
  /** Module already holding it, or "system" when the OS holds it. */
  heldBy: string
  time: number
}

/** Result shape of registration calls. */
export interface ShortcutResult {
  ok: boolean
  errors: string[]
}

/**
 * Injected host — the only Electron-aware piece (the assembly root wires
 * the globalShortcut adapter; tests inject a fake). `register` returns
 * false when the accelerator cannot be taken (held by the OS or another
 * application).
 */
export interface ShortcutHost {
  register(accelerator: string, onPress: () => void): boolean
  unregister(accelerator: string): void
}

/** Diagnostics snapshot. */
export interface ShortcutsDiagnostics {
  registered: number
  byModule: Array<{ moduleId: string; ids: string[] }>
  /** Most recent lost registrations (ring, max 20). */
  conflicts: ShortcutConflict[]
}

/**
 * Core global shortcut service.
 *
 * - `register` upserts `${moduleId}:${id}`: re-registering an existing id
 *   swaps the accelerator. The new accelerator is taken on the host FIRST
 *   and the old one released only on success — a failed upsert never
 *   leaves "neither registered" (no intermediate state).
 * - Cross-module accelerator conflicts fail explicitly (the second
 *   registrant loses, the holder is named); the loser's handler is never
 *   wired.
 * - Permission is checked at registration AND at trigger time: a
 *   revocation takes effect immediately (next press is dropped and the
 *   entry unregistered).
 * - `removeModule` drops every registration of one module (unload path —
 *   same lifecycle as routes/channels: stop keeps them, unload clears).
 */
export interface IGlobalShortcuts {
  register(
    moduleId: string,
    id: string,
    accelerator: string,
    handler: ShortcutHandler
  ): ShortcutResult
  unregister(moduleId: string, id: string): boolean
  removeModule(moduleId: string): void
  list(): ShortcutRecord[]
  diagnostics(): ShortcutsDiagnostics
}

/** Module-scoped facade handed to entries via ModuleContext. */
export interface ModuleShortcuts {
  register(id: string, accelerator: string, handler: ShortcutHandler): ShortcutResult
  unregister(id: string): boolean
  /** This module's records only. */
  list(): ShortcutRecord[]
}
