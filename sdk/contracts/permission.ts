/**
 * Permission contract.
 *
 * Modules declare a closed set of permissions at load time; the core
 * validates them, tracks user revocations persistently, and every runtime
 * capability check goes through `check()`. A declared permission is granted
 * until the user revokes it — revocation takes effect immediately and
 * survives module removal/reinstall (security first).
 */

/**
 * Closed permission catalog. Unknown strings are rejected at declaration —
 * extending the catalog requires a core change by design.
 */
export type PermissionType =
  | 'keyboard-capture'
  | 'obs-control'
  | 'network-access'
  | 'file-read'
  | 'file-write'
  | 'clipboard'
  | 'camera'
  | 'microphone'
  // T23: global hotkey registration (Electron globalShortcut). Scoped to
  // specific accelerators — not general keyboard input capture.
  | 'global-shortcut'
  // T25: overlay window creation (always-on-top/transparent/click-through/
  // multi-display, packaged declaration to avoid permission fragmentation).
  | 'window-overlay'
  // C1：受管子进程（模块启动 ASR/FFmpeg 等外部程序的能力）。
  | 'subprocess'
  // C0: outbound WebSocket to a machine-local companion app (loopback only).
  // 命名与既有 10 项保持一致用 kebab-case；任务卡原文写的 `external.websocket`
  // 是描述性写法，闭集内统一短横线更自洽（若要改回点号是一行改动）。
  | 'external-websocket'

/** Runtime catalog (single source of truth for the union above). */
export const PERMISSION_TYPES: readonly PermissionType[] = [
  'keyboard-capture',
  'obs-control',
  'network-access',
  'file-read',
  'file-write',
  'clipboard',
  'camera',
  'microphone',
  'global-shortcut',
  'window-overlay',
  'subprocess',
  'external-websocket'
]

/** Type guard for values coming from manifests, config files, or IPC. */
export function isPermissionType(v: unknown): v is PermissionType {
  return typeof v === 'string' && (PERMISSION_TYPES as readonly string[]).includes(v)
}

/** Result of a declaration call. */
export interface DeclareResult {
  ok: boolean
  errors: string[]
}

/** Permission state of one module. */
export interface PermissionStatus {
  /** Permissions declared by the module manifest. */
  declared: PermissionType[]
  /** Revoked by the user (subset of declared that is currently denied). */
  revoked: PermissionType[]
  /** Currently usable: declared minus revoked. */
  granted: PermissionType[]
}

/** PermissionStatus tagged with the module id (diagnostics listing). */
export interface ModulePermissionStatus extends PermissionStatus {
  moduleId: string
}

/**
 * Central permission service.
 *
 * - `declare`  registers a module's manifest permissions. Re-declaring the
 *   identical set is idempotent; a DIFFERENT set is rejected (silent
 *   permission escalation) — changing permissions must go through a
 *   reinstall.
 * - `revoke`   takes a granted permission away, effective immediately and
 *   persisted. Idempotent.
 * - `grant`     restores a revoked permission (must still be declared).
 * - `check`     is the runtime gate: unknown module, undeclared or revoked
 *   permissions all yield false.
 * - Revocations persist across module removal/reinstall until the user
 *   explicitly re-grants.
 */
export interface IPermission {
  declare(moduleId: string, permissions: PermissionType[]): DeclareResult
  /** Drop a module's declarations (unload). Revocations are kept. */
  removeModule(moduleId: string): void
  revoke(moduleId: string, permission: PermissionType): boolean
  grant(moduleId: string, permission: PermissionType): boolean
  check(moduleId: string, permission: PermissionType): boolean
  /** Snapshot of one module's permission state (unknown id → empty). */
  status(moduleId: string): PermissionStatus
  /** Snapshot of every module that has declared permissions. */
  listAll(): ModulePermissionStatus[]
}
