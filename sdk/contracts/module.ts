/**
 * Module contract.
 *
 * A module is one directory under the modules root containing a
 * `manifest.json` (the shape below) and an entry script. The manager
 * validates the manifest, wires permissions / config / routes / channels /
 * events through the core services, and hands the entry a scoped
 * ModuleContext. Everything a module does goes through that context —
 * reaching into core internals is a contract violation by design.
 */

import type { CoreEvent, EventHandler, PublishOptions, Unsubscribe } from './event'
import type { ILogger } from './logger'
import type { PermissionType } from './permission'
import type { HttpMethod, RouteHandler, WebSocketChannelHandler } from './gateway'
import type { ValidationResult } from './config'
import type { ModuleStyles } from './styles'
import type { ModuleShortcuts } from './shortcuts'
import type { ModuleOverlays } from './overlays'
import type { ModuleExternalWs } from './external-ws'
import type { ModuleCredentials } from './credentials'
import type { WebToolDeclaration } from './webtools'

/** Module id format: lowercase kebab-case (also the directory name). */
export const MODULE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Module version format: plain semver x.y.z (no prerelease/build tags yet). */
export const MODULE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/

/**
 * 模块清单里的 SPDX 许可标识符（P3）。允许字母/数字/`.`/`+`/`-`
 * （例如 `MIT`、`Apache-2.0`、`AGPL-3.0-or-later`、`UNLICENSED`）。
 *
 * 语义（与 `NOTICE` 一致）：**缺失** ⇒ 界面标注为"未声明"，
 * 核心**不会**替作者推断或授权（不得默认按 MIT 处理）。
 */
export const LICENSE_SPDX_PATTERN = /^[A-Za-z0-9.+-]+$/

/** One dependency edge: module id + optional minimum version. */
export interface ModuleDependency {
  id: string
  /** Minimum acceptable version, compared numerically per segment. */
  version?: string
}

/** An HTTP route a module declares (and may then register). */
export interface ModuleRouteDeclaration {
  method: HttpMethod
  path: string
}

/**
 * `manifest.json` of one module.
 *
 * - `id` must be kebab-case and equal the directory name.
 * - `permissions` go through `permissions.declare` at load time.
 * - `config` is registered as a config section keyed by the module id.
 * - `events` / `routes` / `channels` are closed ownership sets: publishing
 *   an undeclared event or registering an undeclared route/channel throws.
 */
export interface ModuleManifest {
  id: string
  name: string
  version: string
  author?: string
  /** SPDX 许可标识符（P3）。缺失 ⇒ 视为"未声明"，界面需给出警示。 */
  license?: string
  /** 包内许可证文件名（默认 `LICENSE`）。 */
  licenseFile?: string
  description?: string
  permissions: PermissionType[]
  dependencies: ModuleDependency[]
  /** Entry file, relative to the module directory. */
  entry: string
  /** Config section declaration (registered as section id = module id). */
  config?: { defaults: Record<string, unknown>; version: number }
  /** Event types this module may publish. */
  events?: string[]
  /** HTTP routes this module may register on the gateway. */
  routes?: ModuleRouteDeclaration[]
  /** WebSocket channels this module may register on the gateway. */
  channels?: string[]
  /**
   * T11 web tool declaration. When present the module is a DECLARATIVE
   * web tool: no entry/routes/events/channels (no business code) — the
   * core loads it without importing anything and the web tool container
   * renders it.
   */
  web?: WebToolDeclaration
}

/** Config access scoped to the module's own section. */
export interface ModuleConfig {
  get(): Record<string, unknown> | undefined
  set(value: Record<string, unknown>): ValidationResult
  onChange(listener: (value: unknown) => void): () => void
}

/**
 * Event access scoped to the module.
 *
 * Publishing is restricted to manifest-declared event types and the `source`
 * is always forced to the module id; subscriptions are tracked so unload
 * removes them.
 */
export interface ModuleBus {
  publish<T>(type: string, payload?: T, options?: PublishOptions): CoreEvent<T>
  publishAsync<T>(type: string, payload?: T, options?: PublishOptions): Promise<CoreEvent<T>>
  subscribe<T>(type: string, handler: EventHandler<T>): Unsubscribe
  once<T>(type: string, handler: EventHandler<T>): Unsubscribe
}

/**
 * Gateway access scoped to the module: only manifest-declared routes and
 * channels may be registered (anything else throws); registrations are
 * tracked and unregistered on unload.
 */
export interface ModuleGateway {
  registerHttpRoute(method: HttpMethod, path: string, handler: RouteHandler): void
  unregisterHttpRoute(method: HttpMethod, path: string): void
  registerWebSocketChannel(channel: string, handler: WebSocketChannelHandler): void
  unregisterWebSocketChannel(channel: string): void
  broadcast(channel: string, payload: unknown): void
  getRouteUrl(path: string): string | null
  getBrowserSourceUrl(path?: string): string | null
  getWebSocketUrl(): string | null
}

/**
 * The only object handed to a module entry. All capability is pre-scoped:
 * nothing here lets a module touch another module's sections, routes,
 * channels or permission identity.
 */
export interface ModuleContext {
  moduleId: string
  logger: ILogger
  config: ModuleConfig
  bus: ModuleBus
  gateway: ModuleGateway
  permissions: { check(permission: PermissionType): boolean }
  /** T10 style pack registration (present when the styles service is wired). */
  styles?: ModuleStyles
  /**
   * T23 global shortcut registration (present when the shortcuts service
   * is wired). Registrations live until module unload — same lifecycle as
   * routes/channels (stop keeps them).
   */
  shortcuts?: ModuleShortcuts
  /**
   * T25 overlay window management (present when the overlay service is
   * wired). Windows are destroyed on module unload; the facade only
   * accepts gateway-origin URLs (own pages only).
   */
  overlays?: ModuleOverlays
  /**
   * C0 outbound WebSocket client (present when the external-ws service is
   * wired). Gated on the `external-websocket` permission and **restricted to
   * loopback hosts** — modules never open their own socket (AI_RULES 3).
   * Connections are closed on module unload.
   */
  externalWs?: ModuleExternalWs
  /**
   * C0 namespace-isolated credential store (present when the credential store
   * is wired). Keys are forced under `module:<moduleId>:` so a module can never
   * read the core's own secrets (e.g. the OBS password) or another module's.
   */
  credentials?: ModuleCredentials
}

/**
 * Entry export shape. All hooks are optional; the manager awaits
 * async results and isolates throws (see IModuleManager).
 */
export interface IModule {
  /** Receives the scoped context; throwing here fails the load. */
  init?(ctx: ModuleContext): void | Promise<void>
  /** Throwing here marks the module failed without touching anything else. */
  start?(): void | Promise<void>
  /** Best-effort cleanup on stop/unload; throws are logged, never fatal. */
  stop?(): void | Promise<void>
}

/** Lifecycle state of one module record. */
export type ModuleStatus =
  | 'discovered' // valid manifest, not loaded yet
  | 'invalid' // manifest failed validation
  | 'disabled' // user-disabled (persisted); load refuses
  | 'loaded' // init done
  | 'started'
  | 'stopped'
  | 'failed' // import/init/start threw (or dependency cycle)

/** Snapshot of one module (diagnostics / future T12 UI). */
export interface ModuleInfo {
  id: string
  status: ModuleStatus
  /** Why the module is invalid or failed. */
  error?: string
  /** Present unless the manifest failed validation. */
  manifest?: ModuleManifest
}

/** Result shape of load/start/restart. */
export interface LoadResult {
  ok: boolean
  errors: string[]
}

/** Summary of a startAll scan (also logged by the assembly root). */
export interface ModuleScanSummary {
  discovered: number
  started: number
  failed: string[]
}

/**
 * Central module manager.
 *
 * - `discover()`  rescans the modules directory; runtime state of loaded
 *   modules is preserved, the disabled list (`core.modules.disabled`) is
 *   applied. Dotscore/underscore-prefixed directories are skipped.
 * - `load()`      validates (again), checks dependencies (must be loaded
 *   with a sufficient version), declares permissions, registers the config
 *   section, imports the entry and awaits `init`. Any throw → status
 *   `failed`, partial registrations rolled back, core untouched.
 * - `unload()`    logical unload: best-effort `stop`, unregisters the
 *   module's routes/channels/subscriptions, drops its permission
 *   declarations (user revocations are kept by contract). The config
 *   section registration and the ESM module cache survive until app
 *   restart — memory-level reclaim is not attempted.
 * - `restart()`   unload + load + start on the same entry instance
 *   (import cache) with a fresh context.
 * - `disable()`   persists the id and unloads a running module; `enable()`
 *   clears the persisted flag. Load refuses disabled modules.
 * - `startAll()`  discover + topological (dependency order) load/start of
 *   every enabled module; cycles and broken modules land in `failed`
 *   without blocking the rest.
 */
export interface IModuleManager {
  discover(): Promise<ModuleInfo[]>
  load(moduleId: string): Promise<LoadResult>
  unload(moduleId: string): Promise<void>
  start(moduleId: string): Promise<LoadResult>
  stop(moduleId: string): Promise<void>
  restart(moduleId: string): Promise<LoadResult>
  disable(moduleId: string): Promise<void>
  enable(moduleId: string): Promise<void>
  get(moduleId: string): ModuleInfo | undefined
  list(): ModuleInfo[]
  startAll(): Promise<ModuleScanSummary>
}
