/**
 * Overlay window contract (T25).
 *
 * Modules create always-on-top, frameless, optionally transparent overlay
 * windows (think floating input pads for streamers) through the scoped
 * `ctx.overlays` facade. The core service owns the permission gate
 * (`window-overlay`, checked at create time — revocation IPC linkage in the
 * assembly root destroys live windows), ownership (`${moduleId}:${id}`),
 * bounds clamping against the host's display list (a window must never be
 * lost off-screen), and lifecycle cleanup (module unload destroys every
 * window; stop keeps them — same lifecycle as routes/channels/shortcuts).
 *
 * Refraction-free zone: the service is Electron-free. The window host is
 * injected (tests pass a fake; the assembly root passes the BrowserWindow
 * adapter from T26). Window content is the module's own gateway page — the
 * facade validates the URL origin against the current gateway origin, so
 * external pages can never ride a top-most window.
 */

/** Window rectangle in logical screen coordinates. */
export interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

/** One display as reported by the host (screen enumeration). */
export interface OverlayScreen {
  id: string
  primary: boolean
  bounds: OverlayBounds
}

/**
 * Creation spec. Every window loads a URL (the module's own gateway page);
 * all geometry/appearance flags default to the floating-pad shape:
 * transparent + frameless + always-on-top + skip-taskbar + focusable
 * (click-to-type) + resizable + click-through off. Callbacks are optional
 * but must be functions when present.
 */
export interface OverlayWindowSpec {
  url: string
  /** Explicit placement; omitted → host centers on the primary screen. */
  bounds?: OverlayBounds
  /** Minimum size; clamped against by the service. Default 200×120. */
  minSize?: { width: number; height: number }
  /** Transparent window background. Default true. */
  transparent?: boolean
  /** Always on top ('screen-saver' level in the Electron host). Default true. */
  alwaysOnTop?: boolean
  /** Hide from the taskbar. Default true. */
  skipTaskbar?: boolean
  /** Keyboard focus on click (input fields need this; show stays passive).
   *  Default true — do NOT set false for input windows. */
  focusable?: boolean
  /** Allow user resize. Default true (transparent windows resize via the
   *  T26 preload bridge on Windows). */
  resizable?: boolean
  /** Start click-through. Default false. */
  clickThrough?: boolean
  /** User closed the window (native close). */
  onClosed?(): void
  /** Renderer process gone — window destroyed, module notified. */
  onCrashed?(detail: string): void
  /** User moved the window; for the module to persist the position. */
  onMoved?(bounds: OverlayBounds): void
  /** User resized the window; for the module to persist the size. */
  onResized?(bounds: OverlayBounds): void
}

/** Live registration snapshot (diagnostics / facade list). */
export interface OverlayWindowStatus {
  moduleId: string
  id: string
  url: string
  bounds: OverlayBounds | null
  transparent: boolean
  alwaysOnTop: boolean
  clickThrough: boolean
  focusable: boolean
  resizable: boolean
  createdAt: number
}

/** Result shape of create (facade + service). */
export interface OverlayResult {
  ok: boolean
  errors: string[]
}

/** Diagnostics snapshot. */
export interface OverlaysDiagnostics {
  open: number
  byModule: Array<{ moduleId: string; ids: string[] }>
  clickThroughCount: number
}

/** Opaque window handle produced by the host; pass it back for operations. */
export type OverlayWindowHandle = object

/** Events the host reports back to the service (service adds ownership). */
export interface OverlayHostHooks {
  /** Native close by the user (host must NOT re-emit after destroy). */
  onClosed(): void
  /** Renderer crashed — service destroys and forwards the detail. */
  onCrashed(detail: string): void
  onMoved(bounds: OverlayBounds): void
  onResized(bounds: OverlayBounds): void
}

/**
 * Injected host — the only Electron-aware piece (assembly root wires the
 * T26 BrowserWindow adapter; tests inject a fake). `create` returns null on
 * failure; `getBounds` may throw only for unknown handles (service guards).
 */
export interface OverlayWindowHost {
  screens(): OverlayScreen[]
  create(spec: OverlayWindowSpec, hooks: OverlayHostHooks): OverlayWindowHandle | null
  destroy(handle: OverlayWindowHandle): void
  setClickThrough(handle: OverlayWindowHandle, on: boolean): void
  setAlwaysOnTop(handle: OverlayWindowHandle, on: boolean): void
  setBounds(handle: OverlayWindowHandle, bounds: OverlayBounds): void
  getBounds(handle: OverlayWindowHandle): OverlayBounds
}

/**
 * Core overlay window service.
 *
 * - `create` applies spec defaults, clamps explicit bounds against the
 *   display list (minSize floor, off-screen recall to the primary display)
 *   and registers `${moduleId}:${id}`. A duplicate id fails — destroy
 *   first, no upsert (windows carry live state).
 * - Callbacks are isolated: a throwing onMoved/onClosed never affects the
 *   service or other windows. onClosed/onCrashed drop the entry; the host
 *   is destroyed defensively (idempotent).
 * - `removeModule` destroys every window of one module (unload path).
 */
export interface IOverlayWindows {
  create(moduleId: string, id: string, spec: OverlayWindowSpec): OverlayResult
  destroy(moduleId: string, id: string): boolean
  setClickThrough(moduleId: string, id: string, on: boolean): boolean
  setAlwaysOnTop(moduleId: string, id: string, on: boolean): boolean
  setBounds(moduleId: string, id: string, bounds: OverlayBounds): boolean
  getBounds(moduleId: string, id: string): OverlayBounds | null
  screens(): OverlayScreen[]
  list(): OverlayWindowStatus[]
  removeModule(moduleId: string): void
  diagnostics(): OverlaysDiagnostics
}

/** Module-scoped facade handed to entries via ModuleContext. */
export interface ModuleOverlays {
  create(id: string, spec: OverlayWindowSpec): OverlayResult
  destroy(id: string): boolean
  setClickThrough(id: string, on: boolean): boolean
  setAlwaysOnTop(id: string, on: boolean): boolean
  setBounds(id: string, bounds: OverlayBounds): boolean
  getBounds(id: string): OverlayBounds | null
  screens(): OverlayScreen[]
  /** This module's windows only. */
  list(): OverlayWindowStatus[]
}
