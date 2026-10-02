import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, extname, join, resolve, sep } from 'node:path'
import AdmZip from 'adm-zip'
import type { ILogger } from '@contracts/logger'
import type { IConfig, ValidationResult } from '@contracts/config'
import type { IEventBus } from '@contracts/event'
import type {
  AppliedStyle,
  IStylePacks,
  StyleHandler,
  StylePackEnvelope,
  StylePayload,
  StyleResult
} from '@contracts/styles'
import { CORE_RANGE_PATTERN } from '@contracts/packages'
import { MODULE_ID_PATTERN } from '@contracts/module'
import { STYLE_PACK_TYPE } from '@contracts/styles'

/**
 * Core style pack service (T10) — the config-center extension for style and
 * preset packs (.elstyle).
 *
 * The core owns parsing (JSON or ZIP by content sniffing), top-level
 * validation, version checks, snapshot rollback, config writes and change
 * events. Modules only register handlers (validate / migrate / apply /
 * export) via the module-scoped facade; they never touch file selection,
 * extraction, config persistence or rollback themselves.
 *
 * Security red lines (enforced at import): JSON data only (nothing is ever
 * executed), sensitive keys are never imported, cssVars values cannot
 * contain < or > (style-tag escape), zip entries cannot escape, image/font
 * types are whitelisted with size caps, CSS may not use @import or
 * scheme-bearing url() references.
 */

const CONFIG_SECTION = 'core.styles'
const DESCRIPTOR = 'style.json'
const MAX_RESOURCE_BYTES_DEFAULT = 5 * 1024 * 1024
const MAX_TOTAL_RESOURCE_BYTES_DEFAULT = 50 * 1024 * 1024

const ALLOWED_RESOURCE_EXTENSIONS = new Set([
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf'
])

/** 敏感信息不导入（键名归一化后闭集匹配）。 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'credential',
  'credentials',
  'authorization',
  'authkey',
  'apikey',
  'session'
])

interface AppliedRecord {
  version: number
  appliedAt: number
  cssVars: Record<string, string>
}

interface PersistedShape {
  applied: Record<string, AppliedRecord>
}

interface StoredHandler {
  moduleId: string
  styleType: string
  handler: StyleHandler
  version: number
}

export interface StylePacksOptions {
  logger: ILogger
  config: IConfig
  bus: IEventBus
  /** Root directory for imported style resources (<moduleId>/<styleType>/…). */
  resourcesDir: string
  appVersion: string
  /** Test injectables for resource caps. */
  maxResourceBytes?: number
  maxTotalResourceBytes?: number
}

/** Convenience bundle used by tests and the assembly root. */
export interface StylePacksRig {
  styles: IStylePacks
  config: IConfig
  bus: IEventBus
  logger: ILogger
  root: string
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validatePersisted(v: unknown): ValidationResult {
  const o = v as { applied?: unknown }
  if (!isPlainObject(o)) return { ok: false, errors: ['must be an object'] }
  if (!isPlainObject(o.applied)) return { ok: false, errors: ['applied must be an object'] }
  for (const [key, rec] of Object.entries(o.applied)) {
    const r = rec as { version?: unknown; appliedAt?: unknown; cssVars?: unknown }
    if (
      !isPlainObject(rec) ||
      typeof r.version !== 'number' ||
      typeof r.appliedAt !== 'number' ||
      !isPlainObject(r.cssVars)
    ) {
      return { ok: false, errors: [`applied.${key} must be { version, appliedAt, cssVars }`] }
    }
  }
  return { ok: true, errors: [] }
}

/** Segment-numeric semver compare. */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Normalize + validate a zip entry name (zip-slip protection). */
function safeEntryPath(
  entryName: string
): { ok: true; segments: string[] } | { ok: false; error: string } {
  const normalized = entryName.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return { ok: false, error: `absolute entry path: ${entryName}` }
  }
  const segments = normalized.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return { ok: false, error: `empty entry path: ${entryName}` }
  if (segments.some((s) => s === '..')) {
    return { ok: false, error: `path traversal in entry: ${entryName}` }
  }
  return { ok: true, segments }
}

/** Deep scan for sensitive key names (敏感信息不导入). Returns the first hit. */
function findSensitiveKey(value: unknown, path: string, depth: number): string | null {
  if (depth > 8) return null
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSensitiveKey(value[i], `${path}[${i}]`, depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const normalized = k.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (SENSITIVE_KEYS.has(normalized)) return `${path}.${k}`
      const hit = findSensitiveKey(v, `${path}.${k}`, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

/** Top-level envelope validation; returns collected errors. */
function validateEnvelope(raw: unknown, appVersion: string): { errors: string[]; envelope: StylePackEnvelope | null } {
  const errors: string[] = []
  if (!isPlainObject(raw)) return { errors: ['pack must be a JSON object'], envelope: null }
  if (raw.type !== STYLE_PACK_TYPE) errors.push(`type must be "${STYLE_PACK_TYPE}"`)
  if (typeof raw.moduleId !== 'string' || !MODULE_ID_PATTERN.test(raw.moduleId)) {
    errors.push('moduleId must be kebab-case')
  }
  if (typeof raw.styleType !== 'string' || raw.styleType.length === 0 || raw.styleType.includes(':')) {
    errors.push('styleType must be a non-empty string without ":"')
  }
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    errors.push('version must be an integer >= 1')
  }
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) {
    errors.push('createdAt must be a number')
  }
  const coreVersion = typeof raw.coreVersion === 'string' ? raw.coreVersion : ''
  if (!CORE_RANGE_PATTERN.test(coreVersion)) {
    errors.push(`coreVersion must be '*' or '>=x.y.z': ${coreVersion}`)
  } else if (coreVersion !== '*') {
    const min = coreVersion.slice(2)
    if (compareVersion(appVersion, min) < 0) {
      errors.push(`core version ${appVersion} < required ${min}`)
    }
  }
  if (!isPlainObject(raw.payload)) {
    errors.push('payload must be an object')
  } else {
    const cssVars = (raw.payload as { cssVars?: unknown }).cssVars
    if (cssVars !== undefined) {
      if (!isPlainObject(cssVars)) {
        errors.push('payload.cssVars must be an object')
      } else {
        for (const [name, value] of Object.entries(cssVars)) {
          if (typeof value !== 'string') {
            errors.push('payload.cssVars values must be strings')
            break
          }
          if (value.includes('<') || value.includes('>')) {
            errors.push(`cssVars value must not contain < or >: ${name}`)
            break
          }
        }
      }
    }
    const sensitive = findSensitiveKey((raw.payload as { config?: unknown }).config, 'config', 0)
    if (sensitive) errors.push(`sensitive key rejected (敏感信息不导入): ${sensitive}`)
  }
  if (errors.length > 0) return { errors, envelope: null }
  return {
    errors: [],
    envelope: raw as unknown as StylePackEnvelope
  }
}

export async function createStylePacks(options: StylePacksOptions): Promise<IStylePacks> {
  const log = options.logger.child('styles')
  const maxResourceBytes = options.maxResourceBytes ?? MAX_RESOURCE_BYTES_DEFAULT
  const maxTotalResourceBytes = options.maxTotalResourceBytes ?? MAX_TOTAL_RESOURCE_BYTES_DEFAULT
  const registry = new Map<string, StoredHandler>()

  options.config.register<PersistedShape>(CONFIG_SECTION, {
    defaults: { applied: {} },
    version: 1,
    validate: validatePersisted
  })
  await options.config.ready()

  const registryKey = (moduleId: string, styleType: string): string => `${moduleId}:${styleType}`

  function readShape(): PersistedShape {
    return options.config.get<PersistedShape>(CONFIG_SECTION) ?? { applied: {} }
  }

  /** Collect resource files of a directory recursively (export). */
  async function collectFiles(
    base: string,
    rel: string,
    out: Array<{ name: string; data: Buffer }>
  ): Promise<void> {
    const entries = await readdir(join(base, rel), { withFileTypes: true })
    for (const entry of entries) {
      const relName = rel.length === 0 ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) await collectFiles(base, relName, out)
      else if (entry.isFile()) out.push({ name: relName, data: await readFile(join(base, relName)) })
    }
  }

  const service: IStylePacks = {
    register(moduleId: string, styleType: string, handler: StyleHandler): void {
      if (!MODULE_ID_PATTERN.test(moduleId) || styleType.length === 0 || styleType.includes(':')) {
        log.warn('style handler registration rejected', { moduleId, styleType })
        return
      }
      registry.set(registryKey(moduleId, styleType), {
        moduleId,
        styleType,
        handler,
        version: handler.version ?? 1
      })
      log.info('style handler registered', { moduleId, styleType })
    },

    unregisterModule(moduleId: string): void {
      for (const key of [...registry.keys()]) {
        if (key.startsWith(`${moduleId}:`)) registry.delete(key)
      }
    },

    async importPack(filePath: string): Promise<StyleResult> {
      let buffer: Buffer
      try {
        buffer = await readFile(filePath)
      } catch (e) {
        return { ok: false, errors: [`cannot read pack: ${String(e)}`] }
      }

      // Content sniff: ZIP (PK magic) or plain JSON.
      const isZip = buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b
      let envelope: StylePackEnvelope | null = null
      const resources: Array<{ name: string; data: Buffer }> = []
      const errors: string[] = []

      if (isZip) {
        let zip: AdmZip
        try {
          zip = new AdmZip(buffer)
        } catch (e) {
          return { ok: false, errors: [`invalid zip: ${String(e)}`] }
        }
        const entries = zip.getEntries().filter((e) => !e.isDirectory)
        const desc = entries.find((e) => e.entryName === DESCRIPTOR)
        if (!desc) return { ok: false, errors: [`${DESCRIPTOR} missing`] }
        try {
          envelope = JSON.parse(desc.getData().toString('utf8')) as StylePackEnvelope
        } catch (e) {
          return { ok: false, errors: [`${DESCRIPTOR} is not valid json: ${String(e)}`] }
        }
        // Validate every resource entry BEFORE anything is written.
        let total = 0
        for (const entry of entries) {
          if (entry.entryName === DESCRIPTOR) continue
          const name = entry.entryName
          const safe = safeEntryPath(name)
          if (!safe.ok) {
            errors.push(safe.error)
            continue
          }
          const ext = extname(name).toLowerCase()
          if (!ALLOWED_RESOURCE_EXTENSIONS.has(ext)) {
            errors.push(`resource type not allowed: ${name}`)
            continue
          }
          const data = entry.getData()
          if (data.length > maxResourceBytes) {
            errors.push(`resource too large: ${name}`)
            continue
          }
          total += data.length
          if (total > maxTotalResourceBytes) {
            errors.push('total resources too large')
            continue
          }
          if (ext === '.css') {
            const text = data.toString('utf8')
            if (/@import\b/i.test(text)) {
              errors.push(`@import is not allowed in css: ${name}`)
              continue
            }
            if (/url\(\s*['"]?[a-z][a-z0-9+.-]*:/i.test(text)) {
              errors.push(`remote url() reference is not allowed in css: ${name}`)
              continue
            }
          }
          resources.push({ name, data })
        }
      } else {
        try {
          envelope = JSON.parse(buffer.toString('utf8')) as StylePackEnvelope
        } catch (e) {
          return { ok: false, errors: [`invalid json: ${String(e)}`] }
        }
      }

      const check = validateEnvelope(envelope, options.appVersion)
      errors.push(...check.errors)
      envelope = check.envelope
      if (errors.length > 0 || !envelope) return { ok: false, errors }
      const { moduleId, styleType } = envelope

      const stored = registry.get(registryKey(moduleId, styleType))
      if (!stored) {
        return {
          ok: false,
          errors: [`no style handler registered for ${moduleId}:${styleType} (module must be loaded)`]
        }
      }

      // Payload version check: older payloads migrate, newer are rejected.
      let payload: StylePayload = envelope.payload
      if (envelope.version > stored.version) {
        return {
          ok: false,
          errors: [`payload version ${envelope.version} not supported (handler understands ${stored.version})`]
        }
      }
      if (envelope.version < stored.version) {
        if (!stored.handler.migrate) {
          return {
            ok: false,
            errors: [
              `payload version ${envelope.version} < current ${stored.version} and module has no migrator`
            ]
          }
        }
        const migrated = stored.handler.migrate(envelope.payload, envelope.version)
        if (!isPlainObject(migrated)) {
          return { ok: false, errors: ['migrator must return a payload object'] }
        }
        payload = migrated as StylePayload
      }

      const handlerErrors = stored.handler.validate?.(payload) ?? []
      if (handlerErrors.length > 0) return { ok: false, errors: handlerErrors }

      // Apply with snapshot rollback: config section + applied record are
      // restored and staged resources deleted on any failure.
      const key = registryKey(moduleId, styleType)
      const beforeConfig = options.config.get(moduleId)
      const beforeApplied = readShape()
      let staged: string | null = null
      try {
        if (resources.length > 0) {
          staged = join(options.resourcesDir, `.staging-${randomBytes(4).toString('hex')}`)
          await rm(staged, { recursive: true, force: true })
          await mkdir(staged, { recursive: true })
          for (const r of resources) {
            const outPath = resolve(staged, r.name.replace(/\\/g, '/'))
            if (!outPath.startsWith(staged + sep)) throw new Error(`unsafe resource path: ${r.name}`)
            await mkdir(dirname(outPath), { recursive: true })
            await writeFile(outPath, r.data)
          }
        }

        if (stored.handler.apply) {
          await stored.handler.apply(payload)
        } else if (payload.config !== undefined) {
          const written = options.config.set(moduleId, payload.config)
          if (!written.ok) {
            throw new Error(`config write rejected: ${written.errors.join('; ')}`)
          }
        }

        const shape = readShape()
        shape.applied[key] = {
          version: envelope.version,
          appliedAt: Date.now(),
          cssVars: payload.cssVars ?? {}
        }
        const persisted = options.config.set(CONFIG_SECTION, shape)
        if (!persisted.ok) {
          throw new Error(`persisting applied record failed: ${persisted.errors.join('; ')}`)
        }

        if (staged) {
          const target = join(options.resourcesDir, moduleId, styleType)
          await rm(target, { recursive: true, force: true })
          await mkdir(dirname(target), { recursive: true })
          await rename(staged, target)
          staged = null
        }

        options.bus.publish(
          'styles:applied',
          { moduleId, styleType, version: envelope.version },
          { source: 'styles' }
        )
        log.info('style pack applied', { moduleId, styleType, version: envelope.version })
        return { ok: true, errors: [] }
      } catch (e) {
        if (beforeConfig !== undefined) {
          options.config.set(moduleId, beforeConfig)
        }
        options.config.set(CONFIG_SECTION, beforeApplied)
        if (staged) await rm(staged, { recursive: true, force: true })
        log.error('style pack import failed', { moduleId, styleType, error: String(e) })
        return { ok: false, errors: [String(e)] }
      }
    },

    async exportPack(
      moduleId: string,
      styleType: string,
      outPath: string
    ): Promise<StyleResult> {
      const stored = registry.get(registryKey(moduleId, styleType))
      if (!stored) {
        return {
          ok: false,
          errors: [`no style handler registered for ${moduleId}:${styleType}`]
        }
      }

      let payload: StylePayload
      if (stored.handler.export) {
        payload = await stored.handler.export()
      } else {
        payload = { config: options.config.get(moduleId) }
      }
      if (payload.cssVars !== undefined) {
        for (const value of Object.values(payload.cssVars)) {
          if (value.includes('<') || value.includes('>')) {
            return { ok: false, errors: ['exported cssVars values must not contain < or >'] }
          }
        }
      }

      const envelope: StylePackEnvelope = {
        type: STYLE_PACK_TYPE,
        moduleId,
        styleType,
        version: stored.version,
        createdAt: Date.now(),
        coreVersion: '*',
        payload
      }

      const resourceRoot = join(options.resourcesDir, moduleId, styleType)
      const files: Array<{ name: string; data: Buffer }> = []
      if (existsSync(resourceRoot)) {
        try {
          await collectFiles(resourceRoot, '', files)
        } catch {
          files.length = 0
        }
      }

      const out = resolve(outPath)
      await mkdir(dirname(out), { recursive: true })
      if (files.length > 0) {
        const zip = new AdmZip()
        zip.addFile(DESCRIPTOR, Buffer.from(JSON.stringify(envelope, null, 2), 'utf8'))
        for (const f of files) zip.addFile(f.name, f.data)
        await writeFile(out, zip.toBuffer())
      } else {
        await writeFile(out, JSON.stringify(envelope, null, 2), 'utf8')
      }
      log.info('style pack exported', { moduleId, styleType, withResources: files.length > 0 })
      return { ok: true, errors: [] }
    },

    getApplied(moduleId: string, styleType: string): AppliedStyle | undefined {
      const record = readShape().applied[registryKey(moduleId, styleType)]
      if (!record) return undefined
      return { moduleId, styleType, ...record }
    }
  }

  return service
}
