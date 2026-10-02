/**
 * Configuration contract.
 *
 * Modules declare their config shape (defaults + version + optional
 * validator/migrator) and never touch files. The core persists per-module
 * sections, records version and updatedAt for future conflict-merge, and
 * notifies subscribers on every successful change (hot update).
 */

/** Result of a validation run. `errors` is empty when ok. */
export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/** Result of an import. `skipped` lists ids with no registered definition. */
export interface ImportResult {
  ok: boolean
  errors: string[]
  applied: string[]
  skipped: string[]
}

/**
 * Declaration of one module's configuration.
 *
 * - `defaults` is both the fallback value and the shape documentation.
 * - `version` must be incremented when the shape changes; persisted data
 *   with an older version is passed to `migrate` before first use.
 * - `validate` runs before every set / import / preset-apply.
 *   A missing validator accepts anything (module opts out).
 * - `migrate` receives raw persisted data and its stored version, and
 *   must return data valid for the current `version`.
 */
export interface ConfigDefinition<T> {
  defaults: T
  version: number
  validate?(value: unknown): ValidationResult
  migrate?(data: unknown, fromVersion: number): unknown
}

/**
 * Central configuration store, partitioned by module id.
 *
 * - `get` returns a deep-merged copy (defaults as base) — callers may mutate it freely.
 * - `set` validates first: on failure nothing is persisted, no listener fires.
 * - `onChange` subscribers receive the merged value; return the unsubscriber.
 */
export interface IConfig {
  /** Declare a config section. Duplicate ids are ignored with a warning. */
  register<T>(moduleId: string, definition: ConfigDefinition<T>): void
  /** Read a section as a merged copy, or undefined for unknown ids. */
  get<T>(moduleId: string): T | undefined
  /** Validate and persist a section value (full replacement, not partial). */
  set<T>(moduleId: string, value: T): ValidationResult
  /** Subscribe to merged-value changes. Returns the unsubscribe function. */
  onChange(moduleId: string, listener: (value: unknown) => void): () => void
  /** Snapshot current section data as a named preset. */
  savePreset(moduleId: string, name: string): boolean
  /** List saved preset names for a section. */
  listPresets(moduleId: string): string[]
  /** Apply a preset (validated through the normal set path). */
  applyPreset(moduleId: string, name: string): ValidationResult
  /** Remove a preset. */
  deletePreset(moduleId: string, name: string): boolean
  /** Export one section as a JSON envelope string, or null if unknown. */
  exportSection(moduleId: string): string | null
  /** Export all registered sections as one JSON envelope string. */
  exportAll(): string
  /** Import exactly `moduleId` from an envelope. Atomic on failure. */
  importSection(moduleId: string, json: string): ImportResult
  /** Import every known section from an envelope. Atomic on failure;
   *  ids without registered definitions are reported in `skipped`. */
  importAll(json: string): ImportResult
  /**
   * Metadata of every registered section (id + declared version), sorted
   * by id — the "配置摘要" source for the diagnostics page and bundle (T12).
   * No section data is included.
   */
  sections(): Array<{ id: string; version: number }>
  /**
   * Resolves when every section registered so far has been loaded from
   * disk. Services that need persisted data before accepting calls
   * (e.g. the permission service) await this in their factory.
   */
  ready(): Promise<void>
}
