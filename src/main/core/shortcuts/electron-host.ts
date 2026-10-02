import { globalShortcut } from 'electron'
import type { ShortcutHost } from '@contracts/shortcuts'

/**
 * Electron globalShortcut adapter (T24).
 *
 * Thin glue only — every business rule (conflict detection, permission
 * gates, lifecycle cleanup) lives in the Electron-free service, mirroring
 * the credentials/electron-cipher and webtools/electron-host precedent.
 * `globalShortcut.register` returns false when the accelerator cannot be
 * taken (held by the OS or another application); unregistering a key that
 * is not registered is tolerated by Electron, and the extra try/catch
 * keeps the host unconditionally non-throwing.
 *
 * Registered shortcuts are released by the OS automatically when the app
 * quits (Electron contract) — no exit-time sweep is added.
 */
export function createElectronShortcutHost(): ShortcutHost {
  return {
    register(accelerator: string, onPress: () => void): boolean {
      try {
        return globalShortcut.register(accelerator, onPress)
      } catch {
        return false
      }
    },
    unregister(accelerator: string): void {
      try {
        globalShortcut.unregister(accelerator)
      } catch {
        /* not registered — defensive only */
      }
    }
  }
}
