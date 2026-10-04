import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ILogger } from '@contracts/logger'
import type {
  ConfigDefinition,
  IConfig,
  ImportResult,
  ValidationResult
} from '@contracts/config'

/**
 * Central configuration store.
 *
 * - One JSON file per module id: { format, version, updatedAt, data } —
 *   written atomically (tmp + rename).
 * - get() deep-merges defaults with persisted data (plain objects merge,
 *   arrays/primitives replace) and returns a fresh copy.
 * - Migration: on load, an older persisted version is passed to the module
 *   migrator; the original file is backed up to `.bak` first. Without a
 *   migrator the raw data is kept (never lose user config).
 * - Imports are two-phase: validate/migrate everything first, then apply —
 *   a single failing section rejects the whole import.
 */

const SECTION_FORMAT = 'eclipselive-config-section'
const EXPORT_FORMAT = 'eclipselive-config'

interface StoredSection {
  format: string
  version: number
  updatedAt: number
  data: unknown
}

interface PresetEntry {
  version: number
  savedAt: number
  data: unknown
}

type PresetMap = Record<string, Record<string, PresetEntry>>

export interface ConfigOptions {
  /** Directory for section files and presets.json. */
  dir: string
  /** Core logger (warnings/errors about files, migrations, listeners). */
  logger: ILogger
  /** App version recorded in export envelopes. */
  appVersion?: string
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override !== undefined ? override : base
  }
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out
}

export function createConfig(options: ConfigOptions): IConfig & { flush(): Promise<void> } {
  const { dir, logger } = options
  const log = logger.child('config')

  const definitions = new Map<string, ConfigDefinition<unknown>>()
  const cache = new Map<string, unknown>()
  const listeners = new Map<string, Set<(value: unknown) => void>>()
  let queue: Promise<unknown> = Promise.resolve()
  let dirReady = false
  let presets: PresetMap | null = null

  const sectionFile = (id: string): string => join(dir, `${id}.json`)
  const presetsFile = (): string => join(dir, 'presets.json')

  async function ensureDir(): Promise<void> {
    if (!dirReady) {
      await mkdir(dir, { recursive: true })
      dirReady = true
    }
  }

  async function writeAtomic(file: string, content: string): Promise<void> {
    await ensureDir()
    const tmp = `${file}.tmp`
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, file)
  }

  function mergedFor(id: string): unknown {
    const def = definitions.get(id)
    if (!def) return undefined
    return deepMerge(def.defaults, cache.get(id))
  }

  function notify(id: string): void {
    const set = listeners.get(id)
    if (!set) return
    const value = mergedFor(id)
    for (const fn of [...set]) {
      try {
        fn(value)
      } catch (e) {
        log.warn('listener threw', { moduleId: id, error: String(e) })
      }
    }
  }

  async function loadSection(id: string): Promise<void> {
    const def = definitions.get(id)
    if (!def) return
    // A set() that arrived before our queued load must not be clobbered.
    if (cache.has(id)) return
    let raw: string
    try {
      raw = await readFile(sectionFile(id), 'utf8')
    } catch {
      return // no file yet — get() falls back to defaults
    }
    let stored: StoredSection | null = null
    try {
      stored = JSON.parse(raw) as StoredSection
    } catch {
      stored = null
    }
    if (
      !isPlainObject(stored) ||
      stored.format !== SECTION_FORMAT ||
      typeof stored.version !== 'number'
    ) {
      // Preserve the broken file on disk; the user may want to repair it.
      log.warn('section file corrupted, falling back to defaults', { moduleId: id })
      return
    }
    let data = stored.data
    if (stored.version < def.version) {
      try {
        await copyFile(sectionFile(id), `${sectionFile(id)}.bak`)
      } catch {
        /* first-run or unreadable — migration continues */
      }
      if (def.migrate) {
        try {
          data = def.migrate(data, stored.version)
        } catch (e) {
          log.error('migration failed, keeping raw data', { moduleId: id, error: String(e) })
        }
      } else {
        log.warn('stored version older and no migrator, keeping raw data', { moduleId: id })
      }
      cache.set(id, data)
      // Persist the migrated form immediately (version bumped).
      try {
        await writeAtomic(
          sectionFile(id),
          JSON.stringify(
            { format: SECTION_FORMAT, version: def.version, updatedAt: Date.now(), data },
            null,
            2
          )
        )
      } catch (e) {
        log.error('persist after migration failed', { moduleId: id, error: String(e) })
      }
    } else {
      cache.set(id, data)
    }
  }

  async function persistSection(id: string): Promise<void> {
    const def = definitions.get(id)
    if (!def || !cache.has(id)) return
    const stored: StoredSection = {
      format: SECTION_FORMAT,
      version: def.version,
      updatedAt: Date.now(),
      data: cache.get(id)
    }
    try {
      await writeAtomic(sectionFile(id), JSON.stringify(stored, null, 2))
    } catch (e) {
      log.error('config persist failed', { moduleId: id, error: String(e) })
    }
  }

  async function loadPresets(): Promise<PresetMap> {
    if (presets) return presets
    try {
      const parsed = JSON.parse(await readFile(presetsFile(), 'utf8')) as unknown
      presets = isPlainObject(parsed) ? (parsed as PresetMap) : {}
    } catch {
      // Missing or corrupt presets file starts fresh; the file itself is preserved.
      presets = {}
    }
    return presets
  }

  async function persistPresets(): Promise<void> {
    try {
      await writeAtomic(presetsFile(), JSON.stringify(presets ?? {}, null, 2))
    } catch (e) {
      log.error('presets persist failed', { error: String(e) })
    }
  }

  function makeEnvelope(ids: string[]): string {
    const sections: Record<string, { version: number; data: unknown }> = {}
    for (const id of ids) {
      const def = definitions.get(id)
      if (def) sections[id] = { version: def.version, data: mergedFor(id) }
    }
    return JSON.stringify(
      {
        format: EXPORT_FORMAT,
        appVersion: options.appVersion ?? null,
        exportedAt: Date.now(),
        sections
      },
      null,
      2
    )
  }

  /** Shared validated-write path used by set(), applyPreset() and imports. */
  function setImpl(id: string, value: unknown): ValidationResult {
    const def = definitions.get(id)
    if (!def) return { ok: false, errors: [`unknown module: ${id}`] }
    const check: ValidationResult = def.validate
      ? def.validate(value)
      : { ok: true, errors: [] }
    if (!check.ok) return check
    cache.set(id, value)
    queue = queue.then(() => persistSection(id))
    notify(id)
    return { ok: true, errors: [] }
  }

  function importEnvelope(raw: string, only?: string): ImportResult {
    const result: ImportResult = { ok: true, errors: [], applied: [], skipped: [] }
    let env: { format?: unknown; sections?: unknown }
    try {
      env = JSON.parse(raw) as typeof env
    } catch {
      return { ...result, ok: false, errors: ['invalid JSON'] }
    }
    if (!isPlainObject(env) || env.format !== EXPORT_FORMAT || !isPlainObject(env.sections)) {
      return { ...result, ok: false, errors: ['bad envelope'] }
    }
    if (only !== undefined && !isPlainObject(env.sections[only])) {
      return { ...result, ok: false, errors: [`envelope has no section: ${only}`] }
    }

    // Phase 1 — validate and migrate everything; collect nothing on failure.
    const ready: Array<[string, unknown]> = []
    for (const [id, secRaw] of Object.entries(env.sections)) {
      if (only !== undefined && id !== only) continue
      const def = definitions.get(id)
      if (!def) {
        result.skipped.push(id)
        continue
      }
      const sec = secRaw as { version?: unknown; data?: unknown }
      if (!isPlainObject(sec) || typeof sec.version !== 'number') {
        result.ok = false
        result.errors.push(`bad section: ${id}`)
        continue
      }
      if (sec.version > def.version) {
        result.ok = false
        result.errors.push(`section newer than module definition: ${id}`)
        continue
      }
      let data = sec.data
      if (sec.version < def.version) {
        if (def.migrate) {
          try {
            data = def.migrate(data, sec.version)
          } catch {
            result.ok = false
            result.errors.push(`${id}: migration failed`)
            continue
          }
        } else {
          log.warn('import: older version without migrator, importing raw', { moduleId: id })
        }
      }
      const check: ValidationResult = def.validate
        ? def.validate(data)
        : { ok: true, errors: [] }
      if (!check.ok) {
        result.ok = false
        result.errors.push(...check.errors.map((e) => `${id}: ${e}`))
        continue
      }
      ready.push([id, data])
    }

    // Atomic: any failure means nothing is applied.
    if (!result.ok) return result

    for (const [id, data] of ready) {
      cache.set(id, data)
      queue = queue.then(() => persistSection(id))
      notify(id)
      result.applied.push(id)
    }
    return result
  }

  // eager presets load, chained so the first flush() covers it
  queue = queue.then(() => loadPresets())

  return {
    register(id: string, definition: ConfigDefinition<unknown>): void {
      if (definitions.has(id)) {
        log.warn('duplicate registration ignored', { moduleId: id })
        return
      }
      definitions.set(id, definition)
      queue = queue.then(() => loadSection(id))
    },

    get<T>(id: string): T | undefined {
      if (!definitions.has(id)) return undefined
      return mergedFor(id) as T
    },

    set(_id: string, value: unknown): ValidationResult {
      return setImpl(_id, value)
    },

    onChange(id: string, listener: (value: unknown) => void): () => void {
      let set = listeners.get(id)
      if (!set) {
        set = new Set()
        listeners.set(id, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },

    sections(): Array<{ id: string; version: number }> {
      return [...definitions.entries()]
        .map(([id, def]) => ({ id, version: def.version }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    },

    savePreset(id: string, name: string): boolean {
      if (!definitions.has(id)) return false
      const trimmed = name.trim()
      if (!trimmed || trimmed.length > 64) return false
      const def = definitions.get(id)
      if (!def) return false
      const snapshot: PresetEntry = { version: def.version, savedAt: Date.now(), data: mergedFor(id) }
      if (presets !== null) {
        // Already loaded — mutate memory synchronously, persist asynchronously.
        presets[id] = presets[id] ?? {}
        presets[id][trimmed] = snapshot
        queue = queue.then(() => persistPresets())
      } else {
        // Not loaded yet (immediately after creation) — chain after the load.
        queue = queue.then(async () => {
          const p = await loadPresets()
          p[id] = p[id] ?? {}
          p[id][trimmed] = snapshot
          await persistPresets()
        })
      }
      return true
    },

    listPresets(id: string): string[] {
      const section = presets?.[id]
      return section && isPlainObject(section) ? Object.keys(section) : []
    },

    applyPreset(id: string, name: string): ValidationResult {
      const def = definitions.get(id)
      if (!def) return { ok: false, errors: [`unknown module: ${id}`] }
      const entry = presets?.[id]?.[name]
      if (!entry || typeof entry.version !== 'number') {
        return { ok: false, errors: [`preset not found: ${name}`] }
      }
      let data = entry.data
      if (entry.version < def.version && def.migrate) {
        try {
          data = def.migrate(data, entry.version)
        } catch {
          return { ok: false, errors: [`${id}: preset migration failed`] }
        }
      }
      // Presets go through the normal validated set path.
      return setImpl(id, data)
    },

    deletePreset(id: string, name: string): boolean {
      const section = presets?.[id]
      if (!section || !(name in section)) return false
      delete section[name]
      queue = queue.then(() => persistPresets())
      return true
    },

    exportSection(id: string): string | null {
      if (!definitions.has(id)) return null
      return makeEnvelope([id])
    },

    exportAll(): string {
      return makeEnvelope([...definitions.keys()])
    },

    importSection(id: string, json: string): ImportResult {
      return importEnvelope(json, id)
    },

    importAll(json: string): ImportResult {
      return importEnvelope(json)
    },

    /** Contract-facing readiness: resolves when all queued loads/writes so far are done. */
    ready: async () => {
      await queue
    },

    /** Implementation helper for tests awaiting the internal write queue. */
    flush: async () => {
      await queue
    }
  }
}
