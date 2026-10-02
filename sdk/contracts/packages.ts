/**
 * Module package contract — the .elm distribution format.
 *
 * A `.elm` file is a ZIP containing `module.json` (package descriptor with
 * id/name/version/author/description/coreVersion/entry/format/permissions/
 * events/routes/sha256/license), the entry file, resources, README and
 * LICENSE. Installing maps the descriptor onto the module directory's
 * `manifest.json` (the T6 discovery invariant) and enforces every check
 * before anything is written.
 */

/** .elm package format version this core understands. */
export const ELM_FORMAT_VERSION = 1

/** Descriptor file inside a .elm package. */
export const ELM_DESCRIPTOR = 'module.json'

/** Descriptor file inside an installed module directory (T6 invariant). */
export const MODULE_DESCRIPTOR = 'manifest.json'

/** Valid `coreVersion` syntax: '*' or '>=x.y.z'. */
export const CORE_RANGE_PATTERN = /^\*|>=\d+\.\d+\.\d+$/

/** Package metadata returned by inspect (no side effects). */
export interface ElmPackageInfo {
  moduleId: string
  name: string
  version: string
  /** Package format version (must equal ELM_FORMAT_VERSION). */
  format: number
  /** Core compatibility range: '*' or '>=x.y.z'. */
  coreVersion: string
  /** Entry file path, relative to the package root. */
  entry: string
  license: string
  /** SHA-256 (hex) of the entry file bytes. */
  sha256: string
  /**
   * Always false in this core — a signature scheme is deliberately not
   * implemented (local-first, no key infrastructure). The T12 install UI
   * surfaces this to the user as the unsigned-module risk confirmation.
   */
  signed: boolean
  /** Payload file count (module.json excluded). */
  fileCount: number
}

/** Options for packing a module directory into a .elm. */
export interface PackOptions {
  /** Module source directory containing a valid manifest.json. */
  dir: string
  /** Output .elm file path. */
  out: string
  /** Core compatibility recorded in module.json. Default '*'. */
  coreVersion?: string
  /** License identifier recorded in module.json. Default 'UNLICENSED'. */
  license?: string
}

export interface PackResult {
  ok: boolean
  errors: string[]
  moduleId?: string
}

export interface InspectResult {
  ok: boolean
  errors: string[]
  info?: ElmPackageInfo
}

export interface InstallOptions {
  /**
   * Bypass the version guard (downgrade / reinstall over a newer version).
   * Default false — downgrades are refused.
   */
  force?: boolean
}

export interface InstallResult {
  ok: boolean
  errors: string[]
  moduleId?: string
}

/**
 * The .elm module package service.
 *
 * - `pack()`     validates the module directory's manifest.json (T6 rules),
 *   maps it onto module.json (adding format/coreVersion/license and the
 *   SHA-256 of the entry file) and zips the whole directory.
 * - `inspect()`  runs the full install validation without touching disk.
 * - `install()`  validates (id + version guard + coreVersion + closed
 *   permission set + SHA-256 + zip-slip-safe entries), extracts to a staging
 *   directory and swaps it in atomically; the installed directory is named
 *   by the manifest id (T6 invariant).
 * - `uninstall()` unloads the module, removes its directory and keeps the
 *   config section, permission revocations and disabled state (reinstall
 *   does not silently regain anything the user revoked or disabled).
 * - `watch()`    watches the modules directory: new/changed .elm files are
 *   auto-installed and loaded; a vanished module directory auto-unloads.
 *   The watch path is the "drag .elm into the modules folder" flow — being
 *   able to write there already implies local code execution, so no extra
 *   confirmation is required on this path (the file-picker flow confirms
 *   in the T12 UI).
 */
export interface IModulePackages {
  pack(options: PackOptions): Promise<PackResult>
  inspect(elmPath: string): Promise<InspectResult>
  install(elmPath: string, options?: InstallOptions): Promise<InstallResult>
  /** Unload + remove the module directory; config is kept. */
  uninstall(moduleId: string): Promise<void>
  /** Start watching the modules dir (idempotent). Resolves after the first reconcile. */
  watch(): Promise<void>
  unwatch(): void
}
