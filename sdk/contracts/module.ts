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
import type { INetworkClient } from './network'
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
/**
 * C3：**导航声明**（可选）。让模块页不再只能挂在「模块」二级菜单下。
 *
 * 未声明 ⇒ 行为与今天**完全一致**（仍在「模块」分类里）——
 * 这条不变式有守卫钉住（`tests/unit/module-nav.spec.ts`）。
 */
export interface ModuleNav {
  /** 1 = 一级菜单；2 = 「模块」分类下（默认）。 */
  level?: 1 | 2
  /**
   * 排在哪一项之后。取值见 `MODULE_UI_CONTRACT.md` 的**内置页面键**清单
   * （如 `obs-stream` = 直播中控）。指向不存在的项 ⇒ 降级为默认位置并记警告（**不得崩**）。
   */
  after?: string
  /** 同级次序（留空按发现顺序）。 */
  order?: number
  /** 该模块页是否允许**专注/沉浸**布局（侧栏收起、内容区更大）。 */
  immersive?: boolean
}

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
  /** C3：导航声明（可选；未声明则仍在「模块」分类下）。 */
  nav?: ModuleNav
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
/**
 * C1：**受管子进程**（模块用它启动 ASR / FFmpeg 等外部程序）。
 *
 * 与模块自己 `require('node:child_process')` 的差别（也是它存在的理由）：
 *   1. 模块 stop / disable / unload / 宿主退出 ⇒ 它启动的所有子进程**被强制结束**（无孤儿）；
 *   2. 权限闸门：未声明 `subprocess` 权限的模块拿不到 `ctx.proc`；
 *   3. 输出**按行**流式回调（大文件处理不会在内存里堆积）；
 *   4. 超时由核心统一处理，调用方不必自己写 race。
 */
export interface ProcSpawnSpec {
  cmd: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  /** 超时（毫秒）⇒ 到期强制结束，`wait()` 返回 `{ ok:false, timedOut:true }`。 */
  timeoutMs?: number
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
}

export interface ProcHandle {
  pid: number
  /** 主动结束：先请求退出，宽限后强制；对整棵进程树生效（Windows 亦然）。 */
  kill(): Promise<void>
  /** 等待结束。**永不 reject**（错误以返回值表达）。 */
  wait(): Promise<{ ok: boolean; code: number | null; timedOut: boolean }>
}

/** 见 `ProcSpawnSpec` / `ProcHandle`。 */
export interface ModuleProc {
  spawn(spec: ProcSpawnSpec): Promise<ProcHandle>
}

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
  /** C1：受管子进程（需声明 `subprocess` 权限）。 */
  proc?: ModuleProc
  /**
   * C2：受管网络门面（需声明 `network-access` 权限）。模块**永远不得自行 fetch**
   * （契约红线）；一切出站请求都经此，且核心侧默认拒绝：未获用户明确同意、非 https、
   * 主机不在白名单、或跟随重定向都会被拒。
   */
  network?: INetworkClient
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
