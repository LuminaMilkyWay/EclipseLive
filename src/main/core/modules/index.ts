import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ILogger } from '@contracts/logger'
import type { IConfig, ValidationResult } from '@contracts/config'
import type {
  CoreEvent,
  EventHandler,
  IEventBus,
  PublishOptions,
  Unsubscribe
} from '@contracts/event'
import type { IPermission, PermissionType } from '@contracts/permission'
import { isPermissionType } from '@contracts/permission'
import type { IGateway, HttpMethod } from '@contracts/gateway'
import type {
  IModule,
  IModuleManager,
  LoadResult,
  ModuleBus,
  ModuleConfig,
  ModuleContext,
  ModuleDependency,
  ModuleGateway,
  ModuleInfo,
  ModuleManifest,
  ModuleRouteDeclaration,
  ModuleScanSummary,
  ModuleStatus
} from '@contracts/module'
import { MODULE_ID_PATTERN, MODULE_VERSION_PATTERN } from '@contracts/module'
import type { IStylePacks, ModuleStyles, StyleHandler } from '@contracts/styles'
import type { IGlobalShortcuts, ModuleShortcuts } from '@contracts/shortcuts'
import type { IOverlayWindows, ModuleOverlays } from '@contracts/overlays'
import type { IExternalWs, ModuleExternalWs } from '@contracts/external-ws'
import type { ICredentialStore, ModuleCredentials } from '@contracts/credentials'
import { createModuleCredentials } from '../credentials'
import type { WebToolDeclaration } from '@contracts/webtools'

/**
 * Core module manager (T6).
 *
 * - Discovery: one sub-directory per module under `modulesDir`; the
 *   directory name MUST equal the manifest id; dot/underscore-prefixed
 *   directories are skipped. Manifests are validated up front (id/version/
 *   closed permission set/entry containment/route-channel-event shapes).
 * - Load: dependency check → permission declaration → config section
 *   registration → entry import → `init(ctx)`. Any throw marks the module
 *   `failed`, rolls back partial registrations and never touches the core
 *   or sibling modules (crash isolation).
 * - Ownership: the context handed to entries is fully scoped — only
 *   manifest-declared routes/channels/events are accepted (anything else
 *   throws into the module's own error handling), event sources are forced
 *   to the module id, config/permission access is bound to the module id.
 * - Logical unload: stops, unregisters routes/channels/subscriptions and
 *   drops permission declarations. The config section registration and the
 *   ESM import cache survive until app restart (memory-level reclaim is
 *   not attempted — see the README).
 */

const CONFIG_SECTION = 'core.modules'

/** Persisted shape: user-disabled module ids. */
interface PersistedShape {
  disabled: string[]
}

interface ModuleRecord {
  id: string
  dir: string
  status: ModuleStatus
  error?: string
  manifest?: ModuleManifest
  validationErrors: string[]
  impl?: IModule
  /** T11: declarative web tool (no entry, no business code). */
  webTool?: boolean
  routes: Set<string>
  channels: Set<string>
  unsubscribes: Unsubscribe[]
}

/** Statuses that satisfy a dependency check. */
const LOADED_STATUSES: ReadonlySet<ModuleStatus> = new Set(['loaded', 'started', 'stopped'])

export interface ModulesOptions {
  logger: ILogger
  config: IConfig
  bus: IEventBus
  permissions: IPermission
  gateway: IGateway
  /** Root directory containing one sub-directory per module. */
  modulesDir: string
  /** T10 style pack service: entries get a scoped ctx.styles facade. */
  styles?: IStylePacks
  /** T23 global shortcut service: entries get a scoped ctx.shortcuts facade. */
  shortcuts?: IGlobalShortcuts
  /** T25 overlay window service: entries get a scoped ctx.overlays facade. */
  overlays?: IOverlayWindows
  /** C0 outbound WebSocket service: entries get a scoped ctx.externalWs facade. */
  externalWs?: IExternalWs
  /** C0 credential store: entries get a namespaced ctx.credentials facade. */
  credentials?: ICredentialStore
}

/** Convenience bundle used by tests and the assembly root. */
export interface ModulesRig {
  modules: IModuleManager
  logger: ILogger
  config: IConfig
  bus: IEventBus
  permissions: IPermission
  gateway: IGateway
  modulesDir: string
  root: string
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** URL origin or null for invalid/empty strings (T25 overlay origin closed-set). */
function originOf(url: string | null): string | null {
  if (typeof url !== 'string' || url.length === 0) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function validatePersisted(v: unknown): ValidationResult {
  const o = v as { disabled?: unknown }
  if (!isPlainObject(o)) return { ok: false, errors: ['must be an object'] }
  if (!Array.isArray(o.disabled) || o.disabled.some((x) => typeof x !== 'string')) {
    return { ok: false, errors: ['disabled must be an array of strings'] }
  }
  return { ok: true, errors: [] }
}

/** Segment-numeric semver compare (manifest versions are plain x.y.z). */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

const routeKey = (method: HttpMethod, path: string): string => `${method} ${path}`

/** Validation outcome for one manifest (exported for core/packages, T7). */
export type ManifestResult =
  | { ok: true; manifest: ModuleManifest }
  | { ok: false; errors: string[] }

/**
 * Validate a raw manifest.json value against the T6 rules (id=dirName,
 * kebab ids, x.y.z versions, closed permission set, entry containment,
 * declaration shapes). Exported for the package service (T7) so .elm
 * installs and module directories enforce the exact same contract.
 */
export function validateManifest(dirName: string, dir: string, raw: unknown): ManifestResult {
  const errors: string[] = []
  if (!isPlainObject(raw)) return { ok: false, errors: ['manifest must be a JSON object'] }
  const m = raw

  if (typeof m.id !== 'string' || !MODULE_ID_PATTERN.test(m.id)) {
    errors.push('id must be kebab-case (a-z0-9 with single dashes)')
  } else if (m.id !== dirName) {
    errors.push(`id "${m.id}" must match directory name "${dirName}"`)
  }
  if (typeof m.name !== 'string' || m.name.length === 0) {
    errors.push('name must be a non-empty string')
  }
  if (typeof m.version !== 'string' || !MODULE_VERSION_PATTERN.test(m.version)) {
    errors.push('version must be x.y.z (e.g. 0.1.0)')
  }
  if (m.author !== undefined && typeof m.author !== 'string') {
    errors.push('author must be a string')
  }
  if (m.description !== undefined && typeof m.description !== 'string') {
    errors.push('description must be a string')
  }

  const permissions: PermissionType[] = []
  if (!Array.isArray(m.permissions)) {
    errors.push('permissions must be an array')
  } else {
    for (const p of m.permissions) {
      if (!isPermissionType(p)) errors.push(`unknown permission: ${String(p)}`)
      else permissions.push(p)
    }
  }

  const dependencies: ModuleDependency[] = []
  if (m.dependencies !== undefined) {
    if (!Array.isArray(m.dependencies)) {
      errors.push('dependencies must be an array')
    } else {
      for (const d of m.dependencies) {
        if (
          !isPlainObject(d) ||
          typeof d.id !== 'string' ||
          !MODULE_ID_PATTERN.test(d.id) ||
          (d.version !== undefined &&
            (typeof d.version !== 'string' || !MODULE_VERSION_PATTERN.test(d.version)))
        ) {
          errors.push('each dependency must be { id: kebab-case, version?: x.y.z }')
        } else {
          dependencies.push({ id: d.id, version: d.version })
        }
      }
    }
  }

  if (m.web === undefined) {
    if (typeof m.entry !== 'string' || m.entry.length === 0) {
      errors.push('entry must be a non-empty string')
    } else if (!resolve(dir, m.entry).startsWith(dir + sep)) {
      errors.push('entry must stay inside the module directory')
    }
  } else if (typeof m.entry === 'string' && m.entry.length > 0) {
    // T29 页面模块：entry 可选但若提供必须留在模块目录内（containment 不因 web 缺省）。
    if (!resolve(dir, m.entry).startsWith(dir + sep)) {
      errors.push('entry must stay inside the module directory')
    }
  }

  let config: ModuleManifest['config']
  if (m.config !== undefined) {
    const c = m.config as { defaults?: unknown; version?: unknown }
    if (
      !isPlainObject(m.config) ||
      !isPlainObject(c.defaults) ||
      typeof c.version !== 'number' ||
      !Number.isInteger(c.version) ||
      c.version < 1
    ) {
      errors.push('config must be { defaults: object, version: integer >= 1 }')
    } else {
      config = { defaults: c.defaults as Record<string, unknown>, version: c.version }
    }
  }

  let events: string[] | undefined
  if (m.events !== undefined) {
    if (!Array.isArray(m.events) || m.events.some((e) => typeof e !== 'string' || e.length === 0)) {
      errors.push('events must be an array of non-empty strings')
    } else {
      events = [...(m.events as string[])]
    }
  }

  let routes: ModuleRouteDeclaration[] | undefined
  if (m.routes !== undefined) {
    if (!Array.isArray(m.routes)) {
      errors.push('routes must be an array')
    } else {
      routes = []
      for (const r of m.routes) {
        if (
          !isPlainObject(r) ||
          (r.method !== 'GET' && r.method !== 'POST') ||
          typeof r.path !== 'string' ||
          !/^\/\S*$/.test(r.path)
        ) {
          errors.push('each route must be { method: GET|POST, path: "/…" without spaces }')
        } else {
          routes.push({ method: r.method, path: r.path })
        }
      }
    }
  }

  let channels: string[] | undefined
  if (m.channels !== undefined) {
    if (
      !Array.isArray(m.channels) ||
      m.channels.some((c) => typeof c !== 'string' || c.length === 0)
    ) {
      errors.push('channels must be an array of non-empty strings')
    } else {
      channels = [...(m.channels as string[])]
    }
  }

  // T11 declarative web tool / T29 module page declaration.
  // 相对 url（'/x' 形）= 业务模块页面：entry/routes/events/channels 合法共存；
  // 绝对 http(s) URL = 第三方工具：仍禁业务代码（防第三方页伪装业务）。
  let web: WebToolDeclaration | undefined
  if (m.web !== undefined && !isPlainObject(m.web)) {
    errors.push('web must be an object')
  } else if (m.web !== undefined) {
    const w = m.web
    let parsed: URL | null = null
    try {
      parsed = new URL(typeof w.url === 'string' ? w.url : '')
    } catch {
      parsed = null
    }
    const absolute = parsed !== null && (parsed.protocol === 'https:' || parsed.protocol === 'http:')
    const relative =
      typeof w.url === 'string' &&
      w.url.startsWith('/') &&
      !w.url.includes('://') &&
      !/\s/.test(w.url)
    if (!absolute && !relative) {
      errors.push('web.url must be an http(s) URL or a /-prefixed module route path')
    }
    const domains = w.allowedDomains
    if (absolute) {
      if (!Array.isArray(domains) || domains.length === 0 || domains.some((d) => typeof d !== 'string')) {
        errors.push('web.allowedDomains must be a non-empty array of origin strings')
      } else {
        for (const d of domains) {
          let p: URL | null = null
          try {
            p = new URL(d)
          } catch {
            p = null
          }
          if (!p || (p.protocol !== 'https:' && p.protocol !== 'http:')) {
            errors.push(`web.allowedDomains entry must be an origin: ${d}`)
          }
        }
        if (parsed && !(domains as string[]).includes(parsed.origin)) {
          errors.push('web.url origin must be listed in web.allowedDomains')
        }
      }
    } else if (relative) {
      // 页面模块：allowedDomains 可省略（核心运行时注入网关 origin）；给了则须为 origin 数组。
      if (domains !== undefined) {
        if (!Array.isArray(domains) || domains.some((d) => typeof d !== 'string')) {
          errors.push('web.allowedDomains must be an array of origin strings')
        } else {
          for (const d of domains) {
            let p: URL | null = null
            try {
              p = new URL(d)
            } catch {
              p = null
            }
            if (!p || (p.protocol !== 'https:' && p.protocol !== 'http:')) {
              errors.push(`web.allowedDomains entry must be an origin: ${d}`)
            }
          }
        }
      }
    }
    if (
      w.partition !== undefined &&
      (typeof w.partition !== 'string' || !/^[a-z0-9-]+$/.test(w.partition))
    ) {
      errors.push('web.partition must be kebab-case')
    }
    const mode = w.windowMode ?? 'embedded'
    if (mode !== 'embedded' && mode !== 'window') {
      errors.push('web.windowMode must be "embedded" or "window"')
    }
    if (w.pinned !== undefined && typeof w.pinned !== 'boolean') {
      errors.push('web.pinned must be a boolean')
    }
    if (w.icon !== undefined && (typeof w.icon !== 'string' || w.icon.length === 0)) {
      errors.push('web.icon must be a non-empty string')
    }
    if (absolute) {
      // 第三方工具零业务（T11 不变；相对 url 页面模块不受此限）
      if (typeof m.entry === 'string' && m.entry.length > 0) {
        errors.push('web tool modules must not declare an entry (no business code)')
      }
      if (routes !== undefined && routes.length > 0) {
        errors.push('web tool modules must not declare routes')
      }
      if (events !== undefined && events.length > 0) {
        errors.push('web tool modules must not declare events')
      }
      if (channels !== undefined && channels.length > 0) {
        errors.push('web tool modules must not declare channels')
      }
    }
    web = {
      url: typeof w.url === 'string' ? w.url : '',
      allowedDomains: Array.isArray(domains) ? [...(domains as string[])] : [],
      partition: typeof w.partition === 'string' ? w.partition : undefined,
      windowMode: mode === 'window' ? 'window' : 'embedded',
      pinned: w.pinned === true,
      icon: typeof w.icon === 'string' ? w.icon : undefined
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    manifest: {
      id: m.id as string,
      name: m.name as string,
      version: m.version as string,
      author: m.author as string | undefined,
      description: m.description as string | undefined,
      permissions,
      dependencies,
      entry: m.entry as string,
      config,
      events,
      routes,
      channels,
      web
    }
  }
}

export function createModules(options: ModulesOptions): IModuleManager {
  const log = options.logger.child('modules')
  const records = new Map<string, ModuleRecord>()

  options.config.register<PersistedShape>(CONFIG_SECTION, {
    defaults: { disabled: [] },
    version: 1,
    validate: validatePersisted
  })

  const fail = (msg: string): LoadResult => ({ ok: false, errors: [msg] })

  function readDisabled(): Set<string> {
    const shape = options.config.get<PersistedShape>(CONFIG_SECTION)
    const list = shape?.disabled
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [])
  }

  function writeDisabled(next: Set<string>): void {
    const result = options.config.set<PersistedShape>(CONFIG_SECTION, { disabled: [...next] })
    if (!result.ok) log.error('persisting disabled list failed', { errors: result.errors })
  }

  function toInfo(rec: ModuleRecord): ModuleInfo {
    return {
      id: rec.id,
      status: rec.status,
      error:
        rec.error ??
        (rec.validationErrors.length > 0 ? rec.validationErrors.join('; ') : undefined),
      manifest: rec.manifest ? { ...rec.manifest } : undefined
    }
  }

  /** Unregister everything this module registered (idempotent). */
  function cleanupRegistrations(rec: ModuleRecord): void {
    for (const key of rec.routes) {
      const idx = key.indexOf(' ')
      options.gateway.unregisterHttpRoute(key.slice(0, idx) as HttpMethod, key.slice(idx + 1))
    }
    for (const channel of rec.channels) {
      options.gateway.unregisterWebSocketChannel(channel)
    }
    const offs = rec.unsubscribes.splice(0)
    for (const off of offs) {
      try {
        off()
      } catch {
        /* contract says unsubscribes are safe to re-call; defensive only */
      }
    }
    rec.routes.clear()
    rec.channels.clear()
    // T10: the module's style handlers go with it (stale code must not apply).
    options.styles?.unregisterModule(rec.id)
    // T23: the module's global shortcuts go with it (unload clears them,
    // same lifecycle as routes/channels — stop keeps them).
    options.shortcuts?.removeModule(rec.id)
    // T25: the module's overlay windows go with it (same lifecycle).
    options.overlays?.removeModule(rec.id)
    // C0: the module's outbound WebSocket connections go with it (same
    // lifecycle) — a stale socket would keep firing callbacks into dead code.
    options.externalWs?.removeModule(rec.id)
  }

  async function importEntry(entryPath: string): Promise<IModule> {
    // CJS `module.exports = {...}` and ESM `export default {...}` both land
    // on `.default` through Node's interop.
    const ns = (await import(pathToFileURL(entryPath).href)) as { default?: unknown }
    const impl = (ns.default ?? ns) as IModule
    if (typeof impl !== 'object' || impl === null) {
      throw new Error(`entry must export a module object: ${entryPath}`)
    }
    return impl
  }

  /** Build the scoped context handed to one module entry. */
  function buildContext(rec: ModuleRecord): ModuleContext {
    const manifest = rec.manifest as ModuleManifest
    const declaredRoutes = new Set((manifest.routes ?? []).map((r) => routeKey(r.method, r.path)))
    const declaredChannels = new Set(manifest.channels ?? [])
    const declaredEvents = new Set(manifest.events ?? [])

    const gatewayFacade: ModuleGateway = {
      registerHttpRoute(method, path, handler) {
        if (!declaredRoutes.has(routeKey(method, path))) {
          throw new Error(`route not declared in manifest: ${method} ${path}`)
        }
        options.gateway.registerHttpRoute(method, path, handler)
        rec.routes.add(routeKey(method, path))
      },
      unregisterHttpRoute(method, path) {
        options.gateway.unregisterHttpRoute(method, path)
        rec.routes.delete(routeKey(method, path))
      },
      registerWebSocketChannel(channel, handler) {
        if (!declaredChannels.has(channel)) {
          throw new Error(`channel not declared in manifest: ${channel}`)
        }
        options.gateway.registerWebSocketChannel(channel, handler)
        rec.channels.add(channel)
      },
      unregisterWebSocketChannel(channel) {
        options.gateway.unregisterWebSocketChannel(channel)
        rec.channels.delete(channel)
      },
      broadcast(channel, payload) {
        options.gateway.broadcast(channel, payload)
      },
      getRouteUrl(path) {
        return options.gateway.getRouteUrl(path)
      },
      getBrowserSourceUrl(path) {
        return options.gateway.getBrowserSourceUrl(path)
      },
      getWebSocketUrl() {
        return options.gateway.getWebSocketUrl()
      }
    }

    const busFacade: ModuleBus = {
      publish<T>(type: string, payload?: T, publishOptions?: PublishOptions): CoreEvent<T> {
        if (!declaredEvents.has(type)) throw new Error(`event not declared in manifest: ${type}`)
        return options.bus.publish<T>(type, payload, { ...publishOptions, source: rec.id })
      },
      publishAsync<T>(
        type: string,
        payload?: T,
        publishOptions?: PublishOptions
      ): Promise<CoreEvent<T>> {
        if (!declaredEvents.has(type)) throw new Error(`event not declared in manifest: ${type}`)
        return options.bus.publishAsync<T>(type, payload, { ...publishOptions, source: rec.id })
      },
      subscribe<T>(type: string, handler: EventHandler<T>): Unsubscribe {
        const off = options.bus.subscribe<T>(type, handler)
        rec.unsubscribes.push(off)
        return off
      },
      once<T>(type: string, handler: EventHandler<T>): Unsubscribe {
        const off = options.bus.once<T>(type, handler)
        rec.unsubscribes.push(off)
        return off
      }
    }

    const configFacade: ModuleConfig = {
      get: () => options.config.get<Record<string, unknown>>(rec.id),
      set: (value) => options.config.set<Record<string, unknown>>(rec.id, value),
      onChange: (listener) => options.config.onChange(rec.id, listener)
    }

    // T10: scoped style registration — moduleId is forced, so a module can
    // only ever register handlers under its own identity.
    const stylesFacade: ModuleStyles = {
      register: (styleType: string, handler: StyleHandler) => {
        options.styles?.register(rec.id, styleType, handler)
      }
    }

    // T23: scoped shortcut registration — moduleId is forced on every call;
    // the permission gate (register-time + trigger-time) lives in the
    // shortcuts service itself.
    const shortcuts = options.shortcuts
    const shortcutsFacade: ModuleShortcuts | undefined = shortcuts
      ? {
          register: (id, accelerator, handler) =>
            shortcuts.register(rec.id, id, accelerator, handler),
          unregister: (id) => shortcuts.unregister(rec.id, id),
          list: () => shortcuts.list().filter((r) => r.moduleId === rec.id)
        }
      : undefined

    // T25: scoped overlay windows — moduleId forced on every call; the URL
    // origin closed-set (own gateway pages only) is enforced HERE because
    // only the manager knows the gateway origin. The permission gate and
    // bounds clamping live in the overlay service.
    const overlays = options.overlays
    let overlaysFacade: ModuleOverlays | undefined
    if (overlays) {
      const gatewayOrigin = originOf(options.gateway.getRouteUrl('/'))
      overlaysFacade = {
        create: (id, spec) => {
          if (gatewayOrigin === null || originOf(spec.url) !== gatewayOrigin) {
            return {
              ok: false,
              errors: [`overlay url must match the gateway origin: ${spec.url}`]
            }
          }
          return overlays.create(rec.id, id, spec)
        },
        destroy: (id) => overlays.destroy(rec.id, id),
        setClickThrough: (id, on) => overlays.setClickThrough(rec.id, id, on),
        setAlwaysOnTop: (id, on) => overlays.setAlwaysOnTop(rec.id, id, on),
        setBounds: (id, bounds) => overlays.setBounds(rec.id, id, bounds),
        getBounds: (id) => overlays.getBounds(rec.id, id),
        screens: () => overlays.screens(),
        list: () => overlays.list().filter((w) => w.moduleId === rec.id)
      }
    }

    // C0: scoped outbound WebSocket — moduleId forced on every call. The two
    // boundaries (loopback-only + `external-websocket` permission) live in the
    // service; the facade only owns the module scoping.
    const externalWs = options.externalWs
    const externalWsFacade: ModuleExternalWs | undefined = externalWs
      ? {
          connect: (id, spec) => externalWs.connect(rec.id, id, spec),
          send: (id, data) => externalWs.send(rec.id, id, data),
          close: (id) => externalWs.close(rec.id, id),
          status: (id) => externalWs.status(rec.id, id),
          list: () => externalWs.list().filter((c) => c.moduleId === rec.id)
        }
      : undefined

    // C0: namespace-isolated credentials — the facade forces the
    // `module:<moduleId>:` prefix so a module can never read the core's own
    // secrets (e.g. `obs:password`) or another module's keys.
    const credentialsFacade: ModuleCredentials | undefined = options.credentials
      ? createModuleCredentials({ store: options.credentials, moduleId: rec.id, logger: log })
      : undefined

    return {
      moduleId: rec.id,
      logger: log.child(rec.id),
      config: configFacade,
      bus: busFacade,
      gateway: gatewayFacade,
      permissions: {
        check: (permission: PermissionType) => options.permissions.check(rec.id, permission)
      },
      ...(options.styles ? { styles: stylesFacade } : {}),
      ...(shortcutsFacade ? { shortcuts: shortcutsFacade } : {}),
      ...(overlaysFacade ? { overlays: overlaysFacade } : {}),
      ...(externalWsFacade ? { externalWs: externalWsFacade } : {}),
      ...(credentialsFacade ? { credentials: credentialsFacade } : {})
    }
  }

  /** DFS topological order with cycle detection. */
  function orderModules(candidates: ModuleRecord[]): {
    order: ModuleRecord[]
    cycles: ModuleRecord[]
  } {
    const byId = new Map(candidates.map((r) => [r.id, r]))
    const color = new Map<string, 'visiting' | 'done'>()
    const order: ModuleRecord[] = []
    const cycles: ModuleRecord[] = []
    const visit = (rec: ModuleRecord, stack: string[]): void => {
      const c = color.get(rec.id)
      if (c === 'done') return
      if (c === 'visiting') {
        const from = stack.indexOf(rec.id)
        for (const sid of stack.slice(from)) {
          const member = byId.get(sid)
          if (member && !cycles.includes(member)) cycles.push(member)
        }
        return
      }
      color.set(rec.id, 'visiting')
      stack.push(rec.id)
      for (const dep of rec.manifest?.dependencies ?? []) {
        const depRec = byId.get(dep.id)
        if (depRec) visit(depRec, stack)
      }
      stack.pop()
      color.set(rec.id, 'done')
      order.push(rec)
    }
    for (const rec of candidates) visit(rec, [])
    const cycleIds = new Set(cycles.map((r) => r.id))
    return { order: order.filter((r) => !cycleIds.has(r.id)), cycles }
  }

  const manager: IModuleManager = {
    async discover(): Promise<ModuleInfo[]> {
      const disabled = readDisabled()
      let entries: Dirent[] = []
      try {
        entries = await readdir(options.modulesDir, { withFileTypes: true })
      } catch {
        log.warn('modules directory unreadable', { dir: options.modulesDir })
      }

      const fresh = new Map<string, ModuleRecord>()
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
          continue
        }
        const dir = join(options.modulesDir, entry.name)
        const rec: ModuleRecord = {
          id: entry.name,
          dir,
          status: 'invalid',
          validationErrors: [],
          routes: new Set(),
          channels: new Set(),
          unsubscribes: []
        }
        try {
          const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as unknown
          const v = validateManifest(entry.name, dir, raw)
          if (v.ok) {
            rec.manifest = v.manifest
            rec.status = 'discovered'
          } else {
            rec.validationErrors = v.errors
          }
        } catch (e) {
          rec.validationErrors = [`cannot read manifest: ${String(e)}`]
        }
        fresh.set(entry.name, rec)
      }

      // Merge: on-disk records with a live runtime state keep it.
      for (const [id, rec] of fresh) {
        const existing = records.get(id)
        if (
          existing &&
          (existing.impl !== undefined || existing.webTool || existing.status === 'disabled')
        ) {
          existing.dir = rec.dir
        } else {
          records.set(id, rec)
        }
      }
      // Records whose directory vanished and that are not loaded are dropped.
      for (const id of [...records.keys()]) {
        const rec = records.get(id)
        if (
          rec &&
          !fresh.has(id) &&
          rec.impl === undefined &&
          !rec.webTool &&
          rec.status !== 'disabled'
        ) {
          records.delete(id)
        }
      }
      // Apply the persisted disabled list.
      for (const rec of records.values()) {
        if (disabled.has(rec.id)) {
          if (rec.impl === undefined && rec.status !== 'invalid') rec.status = 'disabled'
        } else if (rec.status === 'disabled' && rec.manifest !== undefined) {
          rec.status = 'discovered'
        }
      }
      return [...records.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(toInfo)
    },

    async load(moduleId: string): Promise<LoadResult> {
      const rec = records.get(moduleId)
      if (!rec) return fail(`unknown module: ${moduleId}`)
      if (rec.status === 'disabled') return fail('module is disabled (enable it first)')
      if (rec.impl !== undefined || rec.webTool) return fail('module already loaded (unload first)')
      if (!rec.manifest) return fail(`invalid manifest: ${rec.validationErrors.join('; ')}`)
      const manifest = rec.manifest

      for (const dep of manifest.dependencies) {
        const depRec = records.get(dep.id)
        if (!depRec?.manifest || !LOADED_STATUSES.has(depRec.status)) {
          return fail(`dependency not loaded: ${dep.id}`)
        }
        if (dep.version !== undefined && compareVersion(depRec.manifest.version, dep.version) < 0) {
          return fail(
            `dependency ${dep.id} version ${depRec.manifest.version} < required ${dep.version}`
          )
        }
      }

      const declared = options.permissions.declare(moduleId, manifest.permissions)
      if (!declared.ok) {
        rec.status = 'failed'
        rec.error = declared.errors.join('; ')
        log.error('permission declaration rejected', { moduleId, errors: declared.errors })
        return fail(declared.errors[0])
      }
      if (manifest.config) {
        options.config.register(moduleId, {
          defaults: manifest.config.defaults,
          version: manifest.config.version
        })
      }

      // T11: declarative web tool — no entry, no business code to import.
      // Loading merely marks it available for the web tool container.
      // T31: a web declaration WITH an entry is a module PAGE (business
      // module) — it must go through the normal import/init path so its
      // routes/channels actually register; only entry-less web modules
      // take the declarative shortcut.
      if (manifest.web && !manifest.entry) {
        rec.webTool = true
        rec.error = undefined
        rec.status = 'loaded'
        log.info('web tool module loaded', { moduleId })
        return { ok: true, errors: [] }
      }

      try {
        const impl = await importEntry(resolve(rec.dir, manifest.entry))
        const ctx = buildContext(rec)
        await impl.init?.(ctx)
        rec.impl = impl
        rec.error = undefined
        rec.status = 'loaded'
        log.info('module loaded', { moduleId })
        return { ok: true, errors: [] }
      } catch (e) {
        // Crash isolation: roll back partial registrations; core and
        // sibling modules are never affected.
        cleanupRegistrations(rec)
        options.permissions.removeModule(moduleId)
        rec.status = 'failed'
        rec.error = String(e)
        log.error('module load failed', { moduleId, error: String(e) })
        return fail(String(e))
      }
    },

    async unload(moduleId: string): Promise<void> {
      const rec = records.get(moduleId)
      if (!rec || (rec.impl === undefined && !rec.webTool)) return
      if (rec.impl) {
        try {
          await rec.impl.stop?.()
        } catch (e) {
          log.warn('module stop threw during unload', { moduleId, error: String(e) })
        }
      }
      cleanupRegistrations(rec)
      options.permissions.removeModule(moduleId)
      rec.impl = undefined
      rec.webTool = false
      rec.error = undefined
      rec.status = 'discovered'
      log.info('module unloaded', { moduleId })
    },

    async start(moduleId: string): Promise<LoadResult> {
      const rec = records.get(moduleId)
      if (!rec || (rec.impl === undefined && !rec.webTool)) {
        return fail(`module not loaded: ${moduleId}`)
      }
      try {
        if (rec.impl) await rec.impl.start?.()
        rec.status = 'started'
        rec.error = undefined
        log.info('module started', { moduleId })
        return { ok: true, errors: [] }
      } catch (e) {
        rec.status = 'failed'
        rec.error = String(e)
        log.error('module start failed', { moduleId, error: String(e) })
        return fail(String(e))
      }
    },

    async stop(moduleId: string): Promise<void> {
      const rec = records.get(moduleId)
      if (!rec || (rec.impl === undefined && !rec.webTool)) return
      if (rec.impl) {
        try {
          await rec.impl.stop?.()
        } catch (e) {
          log.warn('module stop threw', { moduleId, error: String(e) })
        }
      }
      rec.status = 'stopped'
    },

    async restart(moduleId: string): Promise<LoadResult> {
      const rec = records.get(moduleId)
      if (!rec) return fail(`unknown module: ${moduleId}`)
      if (rec.impl !== undefined) await manager.unload(moduleId)
      const loaded = await manager.load(moduleId)
      if (!loaded.ok) return loaded
      return manager.start(moduleId)
    },

    async disable(moduleId: string): Promise<void> {
      const rec = records.get(moduleId)
      if (!rec) return
      if (rec.impl !== undefined) await manager.unload(moduleId)
      const next = readDisabled()
      next.add(moduleId)
      writeDisabled(next)
      rec.status = 'disabled'
      log.info('module disabled', { moduleId })
    },

    async enable(moduleId: string): Promise<void> {
      const rec = records.get(moduleId)
      if (!rec) return
      const next = readDisabled()
      next.delete(moduleId)
      writeDisabled(next)
      if (rec.status === 'disabled') rec.status = rec.manifest ? 'discovered' : 'invalid'
      log.info('module enabled', { moduleId })
    },

    get(moduleId: string): ModuleInfo | undefined {
      const rec = records.get(moduleId)
      return rec ? toInfo(rec) : undefined
    },

    list(): ModuleInfo[] {
      return [...records.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(toInfo)
    },

    async startAll(): Promise<ModuleScanSummary> {
      const infos = await manager.discover()
      const candidates = [...records.values()].filter(
        (r) => r.status === 'discovered' && r.manifest !== undefined
      )
      const { order, cycles } = orderModules(candidates)
      const failed: string[] = []
      for (const rec of cycles) {
        rec.status = 'failed'
        rec.error = 'dependency cycle detected'
        log.error('module in dependency cycle', { moduleId: rec.id })
        failed.push(rec.id)
      }
      let started = 0
      for (const rec of order) {
        const loaded = await manager.load(rec.id)
        if (!loaded.ok) {
          failed.push(rec.id)
          continue
        }
        const startResult = await manager.start(rec.id)
        if (!startResult.ok) failed.push(rec.id)
        else started++
      }
      log.info('module scan complete', {
        discovered: infos.length,
        started,
        failed: failed.length
      })
      return { discovered: infos.length, started, failed }
    }
  }

  return manager
}
