import type { ILogger } from '@contracts/logger'
import type { IConfig } from '@contracts/config'
import type { IEventBus } from '@contracts/event'
import type { IPermission } from '@contracts/permission'
import type { IGateway } from '@contracts/gateway'
import type { IModuleManager } from '@contracts/module'
import type {
  IWebTools,
  WebToolDenial,
  WebToolsDiagnostics,
  WebToolHost,
  WebToolOpenResult,
  WebToolStatus,
  WebToolUiTokens,
  WebToolView
} from '@contracts/webtools'
import { isNavigationAllowed } from '@contracts/webtools'

/**
 * T29 module pages: a web declaration whose url starts with '/' is the
 * module's own gateway page. The container resolves it at open time via
 * `gateway.getRouteUrl` (token + dynamic port) and injects the gateway
 * origin into the navigation closed set. The resolved URL carries the
 * token — it NEVER leaves this file (status returns the DECLARED url for
 * third-party tools and null for module pages).
 */

/** Declared web url flavor: '/'-prefixed module route vs absolute tool URL. */
function isModulePageUrl(url: string): boolean {
  return url.startsWith('/')
}

/**
 * Core web tool container manager (T11).
 *
 * The service itself is Electron-free: the view host is injected (tests
 * use a fake; the assembly root passes the WebContentsView host from
 * ./electron-host). Every tool gets its own persistent `persist:`
 * session partition (login state survives close/reopen and is isolated
 * from the app and other tools). The default-deny posture lives here:
 * navigation is gated by the tool's allowedDomains origin set (denials
 * counted), and new-window / permission / download denials arrive from
 * the host through the spec's onDenied hook.
 */

const DENIAL_RING_SIZE = 20

/**
 * T33 token-payload guard (defense in depth): only flat objects with
 * `--`-prefixed custom-property keys and string values free of `;{}` are
 * accepted — CSS-injection-proof, so a buggy renderer payload can never
 * smuggle declarations out of the token block.
 */
export function sanitizeUiTokens(tokens: unknown): WebToolUiTokens | null {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null
  const out: WebToolUiTokens = {}
  for (const [key, value] of Object.entries(tokens)) {
    if (!/^--[0-9a-zA-Z-]+$/.test(key)) return null
    if (typeof value !== 'string' || /[;{}]/.test(value)) return null
    out[key] = value
  }
  return out
}

export interface WebToolsOptions {
  logger: ILogger
  modules: IModuleManager
  /** T29: resolves module-page route paths to gateway URLs (token + port). */
  gateway: IGateway
  host: WebToolHost
}

/** Convenience bundle used by tests and the assembly root. */
export interface WebToolsRig {
  webtools: IWebTools
  modules: IModuleManager
  host: WebToolHost
  logger: ILogger
  config: IConfig
  bus: IEventBus
  permissions: IPermission
  gateway: IGateway
  root: string
}

export function createWebTools(options: WebToolsOptions): IWebTools {
  const log = options.logger.child('webtools')
  const open = new Map<string, WebToolView>()
  const denialCounts = new Map<string, number>()
  const recent: WebToolDenial[] = []
  /** T33: last accepted host token payload per module — re-injected on fresh views. */
  const uiTokens = new Map<string, WebToolUiTokens>()
  let totalDenials = 0

  function recordDenial(moduleId: string, kind: WebToolDenial['kind'], detail: string): void {
    totalDenials += 1
    denialCounts.set(moduleId, (denialCounts.get(moduleId) ?? 0) + 1)
    recent.push({ moduleId, kind, detail, time: Date.now() })
    if (recent.length > DENIAL_RING_SIZE) recent.shift()
    log.warn('web tool action denied', { moduleId, kind })
  }

  function webToolOf(moduleId: string) {
    const info = options.modules.get(moduleId)
    const web = info?.manifest?.web
    return web ? { info, web } : null
  }

  /** T29: module page = relative web.url on a business module (entry present). */
  function isPageTool(tool: { info: { manifest?: { entry?: string } | null }; web: { url: string } }): boolean {
    return isModulePageUrl(tool.web.url) && tool.info.manifest?.entry !== undefined
  }

  /** Resolve the load URL + self origin for one declaration (token stays here). */
  function resolveLoadUrl(
    moduleId: string,
    declared: string
  ): { url: string; selfOrigin: string | null; errors: string[] } {
    if (!isModulePageUrl(declared)) return { url: declared, selfOrigin: null, errors: [] }
    const resolved = options.gateway.getRouteUrl(declared)
    if (!resolved) {
      return {
        url: declared,
        selfOrigin: null,
        errors: [`gateway not ready for module page: ${moduleId}`]
      }
    }
    let selfOrigin: string | null = null
    try {
      selfOrigin = new URL(resolved).origin
    } catch {
      selfOrigin = null
    }
    return { url: resolved, selfOrigin, errors: [] }
  }

  function statusOf(moduleId: string): WebToolStatus | undefined {
    const tool = webToolOf(moduleId)
    if (!tool) return undefined
    return {
      moduleId,
      url: isModulePageUrl(tool.web.url) ? null : tool.web.url,
      partition: `persist:webtool-${tool.web.partition ?? moduleId}`,
      windowMode: tool.web.windowMode,
      pinned: tool.web.pinned,
      state: open.has(moduleId) ? 'open' : 'closed',
      page: isPageTool(tool),
      denials: denialCounts.get(moduleId) ?? 0
    }
  }

  const service: IWebTools = {
    async open(moduleId: string): Promise<WebToolOpenResult> {
      if (open.has(moduleId)) return { ok: true, errors: [] }
      const tool = webToolOf(moduleId)
      if (!tool) {
        return { ok: false, errors: [`not a web tool module: ${moduleId}`] }
      }
      const resolved = resolveLoadUrl(moduleId, tool.web.url)
      if (resolved.errors.length > 0) {
        log.warn('module page resolve failed', { moduleId, errors: resolved.errors })
        return { ok: false, errors: resolved.errors }
      }
      // 导航闭集：自家网关 origin（页面模块）+ 声明 origin 集。
      const declared = tool.web.allowedDomains ?? []
      const allowedDomains =
        resolved.selfOrigin !== null ? [resolved.selfOrigin, ...declared] : declared
      const view = options.host.createView({
        moduleId,
        url: resolved.url,
        partition: `persist:webtool-${tool.web.partition ?? moduleId}`,
        windowMode: tool.web.windowMode,
        selfOrigin: resolved.selfOrigin,
        allowNavigation(url) {
          const allowed = isNavigationAllowed(url, allowedDomains)
          if (!allowed) recordDenial(moduleId, 'navigation', url)
          return allowed
        },
        onDenied(kind, detail) {
          recordDenial(moduleId, kind, detail)
        }
      })
      try {
        await view.load()
      } catch (e) {
        try {
          view.destroy()
        } catch {
          /* already dead */
        }
        const message = `load failed: ${String(e)}`
        log.error('web tool open failed', { moduleId, error: String(e) })
        return { ok: false, errors: [message] }
      }
      // T33: a fresh view has no injected tokens — re-push the last accepted payload.
      const tokens = uiTokens.get(moduleId)
      if (tokens) {
        try {
          view.setUiTokens(tokens)
        } catch (e) {
          log.warn('view setUiTokens threw on open', { moduleId, error: String(e) })
        }
      }
      open.set(moduleId, view)
      log.info('web tool opened', { moduleId, partition: `webtool-${tool.web.partition ?? moduleId}` })
      return { ok: true, errors: [] }
    },

    close(moduleId: string): void {
      const view = open.get(moduleId)
      if (!view) return
      open.delete(moduleId)
      try {
        view.destroy()
      } catch (e) {
        log.warn('web tool view destroy threw', { moduleId, error: String(e) })
      }
      log.info('web tool closed', { moduleId })
    },

    reload(moduleId: string): void {
      const view = open.get(moduleId)
      const tool = webToolOf(moduleId)
      if (!view || !tool) return
      if (!isModulePageUrl(tool.web.url)) return // 第三方工具：无网关可解析，跳过
      const resolved = resolveLoadUrl(moduleId, tool.web.url)
      if (resolved.errors.length > 0) {
        log.warn('module page reload resolve failed', { moduleId, errors: resolved.errors })
        return
      }
      view
        .loadUrl(resolved.url)
        .then(() => {
          log.info('module page reloaded', { moduleId })
          // T33: reload rebuilt the document — re-inject the last accepted tokens.
          const tokens = uiTokens.get(moduleId)
          if (tokens) {
            try {
              view.setUiTokens(tokens)
            } catch (e) {
              log.warn('view setUiTokens threw on reload', { moduleId, error: String(e) })
            }
          }
        })
        .catch((e) => log.warn('module page reload failed', { moduleId, error: String(e) }))
    },

    setRect(moduleId: string, rect: { x: number; y: number; width: number; height: number }): void {
      const view = open.get(moduleId)
      if (!view) return
      const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
      if (
        !num(rect.x) ||
        !num(rect.y) ||
        !num(rect.width) ||
        !num(rect.height) ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        log.warn('invalid module page rect ignored', { moduleId })
        return
      }
      try {
        view.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      } catch (e) {
        log.warn('view setBounds threw', { moduleId, error: String(e) })
      }
    },

    show(moduleId: string): void {
      const view = open.get(moduleId)
      if (!view) return
      try {
        view.setVisible(true)
      } catch (e) {
        log.warn('view setVisible(true) threw', { moduleId, error: String(e) })
      }
    },

    hide(moduleId: string): void {
      const view = open.get(moduleId)
      if (!view) return
      try {
        view.setVisible(false)
      } catch (e) {
        log.warn('view setVisible(false) threw', { moduleId, error: String(e) })
      }
    },

    setUiTokens(moduleId: string, tokens: WebToolUiTokens): void {
      const clean = sanitizeUiTokens(tokens)
      if (clean === null) {
        log.warn('invalid module page ui tokens ignored', { moduleId })
        return
      }
      uiTokens.set(moduleId, clean)
      const view = open.get(moduleId)
      if (!view) return
      try {
        view.setUiTokens(clean)
      } catch (e) {
        log.warn('view setUiTokens threw', { moduleId, error: String(e) })
      }
    },

    status(moduleId: string): WebToolStatus | undefined {
      return statusOf(moduleId)
    },

    list(): WebToolStatus[] {
      const out: WebToolStatus[] = []
      for (const info of options.modules.list()) {
        if (!info.manifest?.web) continue
        const s = statusOf(info.id)
        if (s) out.push(s)
      }
      return out
    },

    diagnostics(): WebToolsDiagnostics {
      let openCount = 0
      for (const id of open.keys()) {
        if (webToolOf(id)) openCount += 1
      }
      return {
        tools: options.modules.list().filter((i) => i.manifest?.web).length,
        open: openCount,
        denials: totalDenials,
        recent: [...recent]
      }
    }
  }

  return service
}
