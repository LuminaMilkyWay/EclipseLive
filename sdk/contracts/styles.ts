/**
 * Style pack contract — the .elstyle format and the module registration API.
 *
 * A style pack ("样式与预设包") is an exportable bundle of a module's
 * presentation state: a business config value (written into the module's
 * config section on apply → hot update → re-render) plus CSS custom
 * properties (overlay styling). Two file shapes share one envelope:
 * plain JSON (payload inline) or ZIP (style.json envelope + CSS/image/font
 * resources under the module's style directory).
 *
 * The core owns file parsing, top-level validation, version checks,
 * backup/rollback, config writes and change events. Modules only register
 * handlers (validator / migrator / applier / exporter) — they never touch
 * file selection, extraction, config persistence or rollback themselves.
 */

/** Envelope type discriminator for every .elstyle pack. */
export const STYLE_PACK_TYPE = 'eclipse-style'

/** CSS custom properties carried by a style pack. */
export type StyleCssVars = Record<string, string>

/**
 * Pack payload. `config` is written into the module's own config section by
 * the default apply (hot update); `cssVars` is persisted with the applied
 * record for the renderer/overlays.
 */
export interface StylePayload {
  config?: unknown
  cssVars?: StyleCssVars
}

/**
 * The unified top-level envelope of every style pack.
 *
 * - `type` must be `STYLE_PACK_TYPE`.
 * - `moduleId` names the owning module (kebab-case; its handler must be
 *   registered, i.e. the module is loaded).
 * - `styleType` is the module-scoped style kind (no ':').
 * - `version` is the PAYLOAD format version; the module's handler migrates
 *   older payloads, newer ones are rejected (no downgrade migration).
 * - `coreVersion` is `'*'` or `'>=x.y.z'` compared against the app version.
 */
export interface StylePackEnvelope {
  type: typeof STYLE_PACK_TYPE
  moduleId: string
  styleType: string
  version: number
  createdAt: number
  coreVersion: string
  payload: StylePayload
}

/**
 * Handlers a module registers for one of its style types. All optional —
 * the core provides sane defaults (see IStylePacks.importPack/exportPack).
 */
export interface StyleHandler {
  /** Current payload version this handler understands. Default 1. */
  version?: number
  /** Validate the business payload; returns error strings (empty = ok). */
  validate?(payload: StylePayload): string[]
  /** Migrate an older payload (fromVersion) up to the handler's version. */
  migrate?(payload: unknown, fromVersion: number): StylePayload
  /**
   * Custom apply. Default: write payload.config into the module's config
   * section (full replacement → hot update) and persist cssVars.
   */
  apply?(payload: StylePayload): void | Promise<void>
  /** Custom export source. Default: read the module's config section. */
  export?(): StylePayload | Promise<StylePayload>
}

/** Module-scoped registration facade (handed to entries via ModuleContext). */
export interface ModuleStyles {
  /** Register a style type owned by this module. */
  register(styleType: string, handler: StyleHandler): void
}

/** Persisted record of one applied style (diagnostics / renderer). */
export interface AppliedStyle {
  moduleId: string
  styleType: string
  version: number
  appliedAt: number
  cssVars: StyleCssVars
}

/** Result of import/export calls. */
export interface StyleResult {
  ok: boolean
  errors: string[]
}

/**
 * The style pack service (config-center extension).
 *
 * importPack: content-sniffs JSON vs ZIP → top-level validation (type /
 * ids / version / coreVersion / sensitive-key scan / cssVars safety) →
 * handler lookup → payload migration → handler validation → apply with
 * snapshot rollback (config section + applied record + staging resources)
 * → `styles:applied` bus event. Any failure leaves the previous state.
 *
 * exportPack: handler export (default: config section) → envelope; writes
 * a ZIP when the module's style resources exist, plain JSON otherwise.
 *
 * Security red lines (enforced at import): no script execution (JSON data
 * only), CSS may not reference remote/imported sources, entry paths may
 * not escape, image/font types are whitelisted with size caps, sensitive
 * keys are never imported.
 */
export interface IStylePacks {
  /** Register a handler for `<moduleId>:<styleType>` (modules only). */
  register(moduleId: string, styleType: string, handler: StyleHandler): void
  /** Drop every handler of one module (called on module unload). */
  unregisterModule(moduleId: string): void
  /** Import a .elstyle file (JSON or ZIP). */
  importPack(filePath: string): Promise<StyleResult>
  /** Export `<moduleId>:<styleType>` to a .elstyle file. */
  exportPack(moduleId: string, styleType: string, outPath: string): Promise<StyleResult>
  /** The currently applied record, or undefined. */
  getApplied(moduleId: string, styleType: string): AppliedStyle | undefined
}
