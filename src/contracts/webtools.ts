/**
 * Web tool container contract (T11).
 *
 * A web tool is a DECLARATIVE module: no business code, just a `web`
 * declaration in its manifest (url / icon / session partition / allowed
 * domains / window mode / pinned-to-sidebar). The core provides the
 * embedded browser container — an Electron WebContentsView per tool
 * (never an iframe) with its own persistent `persist:` session partition
 * (login state kept, isolated from the app and other tools).
 *
 * Security posture (default deny): navigation is only allowed to origins
 * in the tool's allowedDomains; new windows, downloads and permission
 * requests are all denied by default (user-granted exceptions are a T12
 * UI flow that consumes the hooks here). Embedded pages get no Node.js,
 * no file access and no core access — no preload is injected in T11.
 */

/** Where the container lives. */
export type WebToolWindowMode = 'embedded' | 'window'

/**
 * The manifest `web` declaration. Two flavors share one container:
 *
 * - **Declarative third-party tool** — an absolute http(s) URL (its origin
 *   must be in allowedDomains); NO entry/routes/events/channels (no
 *   business code, unchanged since T11).
 * - **Module page (T29)** — a `/`-prefixed relative path resolved at
 *   runtime against the gateway (`getRouteUrl`, token + dynamic port);
 *   the owning module IS a business module (entry/routes/events allowed).
 *   allowedDomains may be omitted — the core injects the current gateway
 *   origin into the navigation closed set.
 */
export interface WebToolDeclaration {
  /** Absolute http(s) URL, or a `/`-prefixed module route path. */
  url: string
  /**
   * Closed set of origins navigation may ever reach (gateway origin is
   * added for module pages). Required for absolute-URL tools; omit for
   * module pages (the validator stores []).
   */
  allowedDomains?: string[]
  /** Session partition suffix (kebab); default = module id. */
  partition?: string
  windowMode: WebToolWindowMode
  pinned: boolean
  /** Icon path relative to the module directory (optional). */
  icon?: string
}

/**
 * Pure navigation policy: the URL must be http(s) and its origin must be
 * listed in allowedDomains (exact origin match including port).
 */
export function isNavigationAllowed(url: string, allowedDomains: string[]): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    return allowedDomains.includes(parsed.origin)
  } catch {
    return false
  }
}

/** Kinds of default-denied actions (diagnostics ring / T12 confirm flows). */
export type WebToolDenialKind = 'navigation' | 'new-window' | 'permission' | 'download'

/** One recorded denial. */
export interface WebToolDenial {
  moduleId: string
  kind: WebToolDenialKind
  detail: string
  time: number
}

/** The spec the service hands to the host to create one container view. */
export interface WebToolViewSpec {
  moduleId: string
  /** Resolved load URL (module pages: gateway route URL with token — NEVER logged). */
  url: string
  /** Full Electron session partition, e.g. "persist:webtool-my-tool". */
  partition: string
  windowMode: WebToolWindowMode
  /**
   * The gateway origin when this view hosts a module page (T29), null for
   * third-party tools. Permission requests from this exact origin for
   * `clipboard-sanitized-write` are granted (copy-to-clipboard buttons);
   * everything else stays default-denied.
   */
  selfOrigin: string | null
  /** Navigation gate (origin closed set); returning false blocks it. */
  allowNavigation(url: string): boolean
  /** Reports a default-denied action (new window / permission / download). */
  onDenied(kind: WebToolDenialKind, detail: string): void
}

/** Client-area rectangle for one embedded view (T30 geometry follow). */
export interface WebToolRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Module-page UI tokens (T33): the HOST's currently resolved design token
 * values (`--r-*` / `--sp-*` / `--txt-*` / `--bg-*` / `--mat-*` ...) pushed
 * one-way into a module page. Module pages run with ZERO preload and cannot
 * read host CSS variables, so the renderer computes these values and the
 * main process injects them as `:root` custom properties via
 * `webContents.executeJavaScript` (host-controlled, values only — no code
 * from the page side, no weakening of the zero-preload posture).
 */
export type WebToolUiTokens = Record<string, string>

/** One container view handle (created and owned by the host). */
export interface WebToolView {
  load(): Promise<void>
  /** T29: re-load a different URL (module page reload after a port change). */
  loadUrl(url: string): Promise<void>
  /** T30: move/resize the embedded view (window-mode views ignore this). */
  setBounds(rect: WebToolRect): void
  /** T30: show/hide without destroying (tab-driven exclusivity). */
  setVisible(visible: boolean): void
  /**
   * T33: inject host design tokens into the page as `:root` CSS custom
   * properties (immediately; also re-injected on every future load of the
   * same view). Module pages MUST consume these and define no theme of
   * their own — see MODULE_UI_CONTRACT.md.
   */
  setUiTokens(tokens: WebToolUiTokens): void
  destroy(): void
}

/** Injectable Electron glue (the assembly root passes the real host). */
export interface WebToolHost {
  createView(spec: WebToolViewSpec): WebToolView
}

/** Runtime state of one web tool. */
export interface WebToolStatus {
  moduleId: string
  /** Declared URL for third-party tools; null for module pages (token red line). */
  url: string | null
  partition: string
  windowMode: WebToolWindowMode
  pinned: boolean
  state: 'closed' | 'open'
  /** T29: true when this is a module page (web + entry business module). */
  page: boolean
  denials: number
}

/** Diagnostics snapshot (T12 diagnostics page "网页工具状态" source). */
export interface WebToolsDiagnostics {
  tools: number
  open: number
  denials: number
  recent: WebToolDenial[]
}

export interface WebToolOpenResult {
  ok: boolean
  errors: string[]
}

/**
 * The web tool container manager.
 *
 * - `open()` looks up the module's `web` declaration, assembles a spec
 *   (partition `persist:webtool-<partition ?? moduleId>`; navigation gate
 *   with denial counting) and creates + loads the view through the host.
 * - `close()` destroys the view (idempotent); the session partition
 *   persists, so login state survives close/reopen.
 * - `list()`/`status()` merge the module manager's registry with the
 *   container state; regular modules never appear.
 */
export interface IWebTools {
  open(moduleId: string): Promise<WebToolOpenResult>
  close(moduleId: string): void
  /**
   * T29: re-resolve a module page's gateway URL and reload its open view
   * (drive on `gateway:port-changed`). Third-party tools and closed pages
   * are skipped — a no-op for them.
   */
  reload(moduleId: string): void
  /**
   * T30: move/resize an open embedded view to the renderer-reported
   * content rect. Invalid rects (non-positive size, non-numbers) are
   * ignored; closed tools are a no-op.
   */
  setRect(moduleId: string, rect: WebToolRect): void
  /** T30: show one open view without re-creating it (tab activation). */
  show(moduleId: string): void
  /** T30: hide one open view without destroying it (tab switch-away). */
  hide(moduleId: string): void
  /**
   * T33: push host design tokens into one open module page (stored and
   * re-injected when the view re-loads or a fresh view opens). Invalid
   * token payloads (non-object, non `--`-prefixed keys, values with
   * `;{}`) are ignored — see MODULE_UI_CONTRACT.md.
   */
  setUiTokens(moduleId: string, tokens: WebToolUiTokens): void
  status(moduleId: string): WebToolStatus | undefined
  list(): WebToolStatus[]
  diagnostics(): WebToolsDiagnostics
}
