import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type {
  OverlayBounds,
  OverlayHostHooks,
  OverlayScreen,
  OverlayWindowHandle,
  OverlayWindowHost,
  OverlayWindowSpec
} from '@contracts/overlays'

/**
 * Electron overlay window host (T26).
 *
 * Thin glue over BrowserWindow — every business rule (permission, ownership,
 * bounds clamping, staleness guards, lifecycle) lives in the Electron-free
 * service, mirroring the credentials/webtools/shortcuts host precedents.
 *
 * Window shape: frameless, transparent (default), always-on-top at the
 * 'screen-saver' level, hidden from the taskbar, focusable (click-to-type)
 * but SHOWN with showInactive so appearing never steals focus from a game.
 *
 * Crash isolation: render-process-gone → onCrashed + win.destroy() — only
 * this window dies, the main window and siblings are untouched.
 *
 * Registered shortcuts/windows are released by the OS when the app quits;
 * no exit-time sweep is added.
 */

/** Host-side handle carrying the live BrowserWindow. */
interface ElectronOverlayHandle extends OverlayWindowHandle {
  win: BrowserWindow | null
}

/** Marker property identifying overlay windows for the resize IPC guard. */
const OVERLAY_MARKER = '__eclipseliveOverlay__'

export function isOverlayWindow(win: BrowserWindow): boolean {
  return (win as unknown as Record<string, unknown>)[OVERLAY_MARKER] === true
}

function toBounds(b: Electron.Rectangle): OverlayBounds {
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

/**
 * Apply a user-driven resize delta to one overlay window (the
 * 'overlay:resize' IPC path — transparent windows have no system resize on
 * Windows). Only minSize is enforced here; screen edges are the OS's
 * business for user-driven drags (the service clamps programmatic bounds).
 */
export function applyOverlayResize(
  win: BrowserWindow,
  delta: { dx?: unknown; dy?: unknown; dw?: unknown; dh?: unknown }
): void {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const b = win.getBounds()
  const [minW, minH] = win.getMinimumSize()
  win.setBounds({
    x: b.x + num(delta.dx),
    y: b.y + num(delta.dy),
    width: Math.max(b.width + num(delta.dw), minW || 1),
    height: Math.max(b.height + num(delta.dh), minH || 1)
  })
}

export function createElectronOverlayHost(): OverlayWindowHost {
  return {
    screens(): OverlayScreen[] {
      const primaryId = screen.getPrimaryDisplay().id
      return screen.getAllDisplays().map((d) => ({
        id: String(d.id),
        primary: d.id === primaryId,
        bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }
      }))
    },

    create(spec: OverlayWindowSpec, hooks: OverlayHostHooks): OverlayWindowHandle | null {
      let win: BrowserWindow
      try {
        win = new BrowserWindow({
          frame: false,
          transparent: spec.transparent ?? true,
          skipTaskbar: spec.skipTaskbar ?? true,
          focusable: spec.focusable ?? true,
          resizable: spec.resizable ?? true,
          show: false,
          webPreferences: {
            preload: join(__dirname, '../preload/overlay.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
          }
        })
      } catch {
        return null
      }

      const handle: ElectronOverlayHandle = { win }
      ;(win as unknown as Record<string, unknown>)[OVERLAY_MARKER] = true

      if (spec.alwaysOnTop ?? true) win.setAlwaysOnTop(true, 'screen-saver')
      const min = spec.minSize ?? { width: 200, height: 120 }
      win.setMinimumSize(min.width, min.height)
      if (spec.bounds) win.setBounds(spec.bounds)

      // User-driven close (frameless has no system button; Alt+F4 etc.).
      // Service-side destroy() never emits 'closed' — and even if it did,
      // the service's spec-identity staleness guard would swallow it.
      win.on('closed', () => {
        handle.win = null
        hooks.onClosed()
      })
      win.on('moved', () => {
        if (handle.win === win) hooks.onMoved(toBounds(win.getBounds()))
      })
      win.on('resized', () => {
        if (handle.win === win) hooks.onResized(toBounds(win.getBounds()))
      })
      win.webContents.on('render-process-gone', (_e, details) => {
        hooks.onCrashed(String(details.reason))
        // Kill the half-dead window; the service already dropped the entry.
        try {
          win.destroy()
        } catch {
          /* already dead */
        }
      })

      void win.loadURL(spec.url).catch(() => {
        /* load failure leaves an empty page; not fatal for the host */
      })
      // Transparent windows must wait for readiness before showing, and
      // showInactive keeps focus where it was (no game minimize-out).
      win.once('ready-to-show', () => win.showInactive())
      return handle
    },

    destroy(handle: OverlayWindowHandle): void {
      const h = handle as ElectronOverlayHandle
      const win = h.win
      h.win = null
      if (!win || win.isDestroyed()) return
      try {
        win.destroy()
      } catch {
        /* already dead */
      }
    },

    setClickThrough(handle: OverlayWindowHandle, on: boolean): void {
      const win = (handle as ElectronOverlayHandle).win
      if (!win || win.isDestroyed()) return
      // forward:true keeps mousemove flowing to the page while clicks pass
      // through — the module page can still react to hover.
      win.setIgnoreMouseEvents(on, { forward: true })
    },

    setAlwaysOnTop(handle: OverlayWindowHandle, on: boolean): void {
      const win = (handle as ElectronOverlayHandle).win
      if (!win || win.isDestroyed()) return
      win.setAlwaysOnTop(on, 'screen-saver')
    },

    setBounds(handle: OverlayWindowHandle, bounds: OverlayBounds): void {
      const win = (handle as ElectronOverlayHandle).win
      if (!win || win.isDestroyed()) return
      win.setBounds(bounds)
    },

    getBounds(handle: OverlayWindowHandle): OverlayBounds {
      const win = (handle as ElectronOverlayHandle).win
      if (!win || win.isDestroyed()) throw new Error('window already destroyed')
      return toBounds(win.getBounds())
    }
  }
}
