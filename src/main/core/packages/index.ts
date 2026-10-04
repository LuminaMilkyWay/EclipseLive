import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { watch as fsWatch, type Dirent, type FSWatcher } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { basename, dirname, join, resolve, sep } from 'node:path'
import AdmZip from 'adm-zip'
import type { ILogger } from '@contracts/logger'
import type { IConfig } from '@contracts/config'
import type { IEventBus } from '@contracts/event'
import type { IPermission } from '@contracts/permission'
import type { IGateway } from '@contracts/gateway'
import type { IModuleManager, ModuleManifest } from '@contracts/module'
import type {
  ElmPackageInfo,
  IModulePackages,
  InstallOptions,
  InstallResult,
  InspectResult,
  PackOptions,
  PackResult
} from '@contracts/packages'
import { CORE_RANGE_PATTERN, ELM_DESCRIPTOR, ELM_FORMAT_VERSION, MODULE_DESCRIPTOR } from '@contracts/packages'
import { LICENSE_SPDX_PATTERN } from '@contracts/module'
import { validateManifest } from '../modules'

/**
 * Core .elm module package service (T7).
 *
 * A `.elm` is a ZIP whose descriptor is `module.json` (requirement naming).
 * Installing maps it onto the module directory's `manifest.json` (the T6
 * invariant) and enforces every check before anything is written: id /
 * version guard (downgrades refused) / coreVersion range / closed
 * permission set (the exact T6 manifest contract) / SHA-256 of the entry
 * payload / zip-slip-safe entries. Extraction goes through a staging
 * directory that is swapped in atomically.
 *
 * The watcher covers the "drag a .elm into the modules folder" flow: new
 * or changed .elm files auto-install and load; a vanished module directory
 * auto-unloads. Being able to write the modules directory already implies
 * local code execution, so this path needs no extra confirmation — the
 * file-picker flow confirms in the T12 UI.
 */

const STAGING_PREFIX = '.staging-'
const TRASH_PREFIX = '.trash-'
const WATCH_DEBOUNCE_MS = 400

export interface PackagesOptions {
  logger: ILogger
  modules: IModuleManager
  /** Root directory containing one sub-directory per module (watched). */
  modulesDir: string
  /** App version for coreVersion compatibility checks. */
  appVersion: string
}

/** Convenience bundle used by tests and the assembly root. */
export interface PackagesRig {
  packages: IModulePackages
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

/** Segment-numeric semver compare (versions are plain x.y.z). */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Normalize + validate one zip entry name; returns safe relative segments. */
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

interface ParsedPackage {
  zip: AdmZip
  moduleJson: Record<string, unknown>
  entries: AdmZip.IZipEntry[]
}

function parsePackage(buffer: Buffer): { ok: true; pkg: ParsedPackage } | { ok: false; errors: string[] } {
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch (e) {
    return { ok: false, errors: [`invalid zip: ${String(e)}`] }
  }
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  const desc = entries.find((e) => e.entryName === ELM_DESCRIPTOR)
  if (!desc) return { ok: false, errors: [`${ELM_DESCRIPTOR} missing`] }
  let moduleJson: unknown
  try {
    moduleJson = JSON.parse(desc.getData().toString('utf8'))
  } catch (e) {
    return { ok: false, errors: [`${ELM_DESCRIPTOR} is not valid json: ${String(e)}`] }
  }
  if (!isPlainObject(moduleJson)) {
    return { ok: false, errors: [`${ELM_DESCRIPTOR} must be an object`] }
  }
  return { ok: true, pkg: { zip, moduleJson, entries } }
}

/**
 * Full install validation: format, coreVersion range vs app version, the
 * exact T6 manifest contract (id/kebab/x.y.z/closed permissions/entry
 * containment), entry presence + SHA-256, no stray manifest.json.
 */
function validatePackage(pkg: ParsedPackage, appVersion: string, modulesDir: string): {
  ok: boolean
  errors: string[]
  manifest?: ModuleManifest
  info?: ElmPackageInfo
} {
  const { moduleJson, entries } = pkg
  const errors: string[] = []

  const format = moduleJson.format
  if (format !== ELM_FORMAT_VERSION) {
    errors.push(`unsupported package format: ${String(format)} (expected ${ELM_FORMAT_VERSION})`)
  }

  const coreVersion = typeof moduleJson.coreVersion === 'string' ? moduleJson.coreVersion : '*'
  if (!CORE_RANGE_PATTERN.test(coreVersion)) {
    errors.push(`coreVersion must be '*' or '>=x.y.z': ${coreVersion}`)
  } else if (coreVersion !== '*') {
    const min = coreVersion.slice(2)
    if (compareVersion(appVersion, min) < 0) {
      errors.push(`core version ${appVersion} < required ${min}`)
    }
  }

  // Module-runtime subset must pass the exact T6 manifest contract. The
  // install target is <modulesDir>/<id>, so entry containment is checked
  // against the real destination.
  const id = typeof moduleJson.id === 'string' ? moduleJson.id : ''
  const targetDir = join(modulesDir, id.length > 0 ? id : '_')
  const manifestCheck = validateManifest(id, targetDir, moduleJson)
  if (manifestCheck.ok) {
    const manifest = manifestCheck.manifest
    const sha256 =
      typeof moduleJson.sha256 === 'string' ? moduleJson.sha256.toLowerCase() : ''
    // Entry presence + SHA-256 integrity of the executable payload.
    // Declarative web tools carry no entry payload: both checks are skipped.
    if (manifest.entry) {
      const entryName = manifest.entry.replace(/\\/g, '/')
      const entryZip = entries.find((e) => e.entryName === entryName)
      if (!entryZip) {
        errors.push(`entry not found in package: ${manifest.entry}`)
      } else if (!/^[0-9a-f]{64}$/.test(sha256)) {
        errors.push('sha256 missing or malformed')
      } else {
        const actual = createHash('sha256').update(entryZip.getData()).digest('hex')
        if (actual !== sha256) errors.push(`sha256 mismatch for entry ${manifest.entry}`)
      }
    }
    // A stray manifest.json would collide with the mapped descriptor.
    if (entries.some((e) => e.entryName === MODULE_DESCRIPTOR)) {
      errors.push(`unexpected ${MODULE_DESCRIPTOR} in package (${ELM_DESCRIPTOR} is the descriptor)`)
    }
    if (errors.length > 0) return { ok: false, errors }
    return {
      ok: true,
      errors: [],
      manifest: manifestCheck.manifest,
      info: {
        moduleId: manifestCheck.manifest.id,
        name: manifestCheck.manifest.name,
        version: manifestCheck.manifest.version,
        format: ELM_FORMAT_VERSION,
        coreVersion,
        entry: manifest.entry ?? '',
        license: typeof moduleJson.license === 'string' ? moduleJson.license : 'UNLICENSED',
        sha256: manifest.entry ? sha256 : '',
        signed: false,
        fileCount: entries.filter((e) => e.entryName !== ELM_DESCRIPTOR).length
      }
    }
  }
  return { ok: false, errors: [...errors, ...manifestCheck.errors] }
}

export function createPackages(options: PackagesOptions): IModulePackages {
  const log = options.logger.child('packages')

  let watcher: FSWatcher | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let reconciling = false
  let rerunPending = false
  const processedElm = new Map<string, number>()

  type ReadResult =
    | { ok: true; pkg: ParsedPackage; manifest: ModuleManifest; info: ElmPackageInfo }
    | { ok: false; errors: string[] }

  async function readPackage(elmPath: string): Promise<ReadResult> {
    let buffer: Buffer
    try {
      buffer = await readFile(elmPath)
    } catch (e) {
      return { ok: false, errors: [`cannot read package: ${String(e)}`] }
    }
    const parsed = parsePackage(buffer)
    if (!parsed.ok) return { ok: false, errors: parsed.errors }
    const check = validatePackage(parsed.pkg, options.appVersion, options.modulesDir)
    if (!check.ok || !check.manifest || !check.info) return { ok: false, errors: check.errors }
    return { ok: true, pkg: parsed.pkg, manifest: check.manifest, info: check.info }
  }

  /** Collect every payload file of a module directory (manifest.json excluded). */
  async function collectFiles(
    base: string,
    rel: string,
    out: Array<{ name: string; data: Buffer }>
  ): Promise<void> {
    const entries = await readdir(join(base, rel), { withFileTypes: true })
    for (const entry of entries) {
      const relName = rel.length === 0 ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) await collectFiles(base, relName, out)
      else if (entry.isFile() && relName !== MODULE_DESCRIPTOR) {
        out.push({ name: relName, data: await readFile(join(base, relName)) })
      }
    }
  }

  const service: IModulePackages = {
    async pack(packOptions: PackOptions): Promise<PackResult> {
      const dir = resolve(packOptions.dir)
      const dirName = basename(dir)

      let raw: unknown
      try {
        raw = JSON.parse(await readFile(join(dir, MODULE_DESCRIPTOR), 'utf8'))
      } catch (e) {
        return { ok: false, errors: [`cannot read ${MODULE_DESCRIPTOR}: ${String(e)}`] }
      }
      const manifestCheck = validateManifest(dirName, dir, raw)
      if (!manifestCheck.ok) return { ok: false, errors: manifestCheck.errors }
      const manifest = manifestCheck.manifest

      // ★ P3（用户批准的方案）：包内必须有可读的许可声明；声明真实协议时必须有许可证文件。
      // 设计依据（实测既有实现与测试，勿凭想象改动）：
      //   · `PackOptions.license` 是**打包参数**，文档写明默认 'UNLICENSED'，写进包内描述符
      //     `module.json`；**不回写**模块清单（packages.spec 有断言：安装后 manifest 不含 license）；
      //   · 因此默认值保持 'UNLICENSED'，**不**回落到 manifest.license（会改变既有语义）；
      //   · 要让真实包标注 MIT，由**调用方**（导出流程）传 `license`。
      const declaredLicense = (packOptions.license ?? 'UNLICENSED').trim()
      if (!LICENSE_SPDX_PATTERN.test(declaredLicense)) {
        return { ok: false, errors: [`invalid license identifier: "${declaredLicense}" (SPDX expected)`] }
      }
      if (declaredLicense.toUpperCase() !== 'UNLICENSED') {
        const licenseFileName = manifest.licenseFile ?? 'LICENSE'
        try {
          await stat(join(dir, licenseFileName))
        } catch {
          return {
            ok: false,
            errors: [
              `module declares "${declaredLicense}" but ships no license file at ${licenseFileName} (pack refused)`
            ]
          }
        }
      }

      const coreVersion = packOptions.coreVersion ?? '*'
      if (!CORE_RANGE_PATTERN.test(coreVersion)) {
        return { ok: false, errors: [`coreVersion must be '*' or '>=x.y.z': ${coreVersion}`] }
      }
      const license = packOptions.license ?? 'UNLICENSED'

      const files: Array<{ name: string; data: Buffer }> = []
      await collectFiles(dir, '', files)

      const moduleJson: Record<string, unknown> = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        description: manifest.description,
        coreVersion,
        format: ELM_FORMAT_VERSION,
        permissions: manifest.permissions,
        dependencies: manifest.dependencies,
        license
      }
      // Declarative web tools carry no entry payload: entry/sha256 keys are
      // omitted entirely instead of hashing a non-existent file.
      if (manifest.entry) {
        const entryFile = files.find((f) => f.name === manifest.entry.replace(/\\/g, '/'))
        if (!entryFile) return { ok: false, errors: [`entry not found: ${manifest.entry}`] }
        moduleJson.entry = manifest.entry
        moduleJson.sha256 = createHash('sha256').update(entryFile.data).digest('hex')
      }
      // ⚠️ C3 的 `nav`（一级菜单 + 沉浸）必须随包往返：此前描述符白名单漏了它，
      // 导致**安装版模块会静默丢掉一级菜单入口**（源码目录能跑、装出来不能用 —— 最坏的一类 bug）。
      if (manifest.nav) moduleJson.nav = manifest.nav
      if (manifest.config) moduleJson.config = manifest.config
      if (manifest.events) moduleJson.events = manifest.events
      if (manifest.routes) moduleJson.routes = manifest.routes
      if (manifest.channels) moduleJson.channels = manifest.channels
      if (manifest.web) moduleJson.web = manifest.web

      const zip = new AdmZip()
      zip.addFile(ELM_DESCRIPTOR, Buffer.from(JSON.stringify(moduleJson, null, 2), 'utf8'))
      for (const f of files) zip.addFile(f.name, f.data)

      const out = resolve(packOptions.out)
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, zip.toBuffer())

      log.info('module packed', { moduleId: manifest.id, files: files.length })
      return { ok: true, errors: [], moduleId: manifest.id }
    },

    async inspect(elmPath: string): Promise<InspectResult> {
      const result = await readPackage(elmPath)
      return result.ok
        ? { ok: true, errors: [], info: result.info }
        : { ok: false, errors: result.errors }
    },

    async install(elmPath: string, installOptions?: InstallOptions): Promise<InstallResult> {
      const result = await readPackage(elmPath)
      if (!result.ok) return { ok: false, errors: result.errors }
      const { pkg, manifest } = result
      const id = manifest.id
      const targetDir = join(options.modulesDir, id)

      // Version guard: downgrades are refused unless forced.
      if (!installOptions?.force) {
        let existingVersion: string | undefined
        try {
          const existing = JSON.parse(
            await readFile(join(targetDir, MODULE_DESCRIPTOR), 'utf8')
          ) as { version?: unknown }
          if (typeof existing.version === 'string') existingVersion = existing.version
        } catch {
          /* not installed yet */
        }
        if (
          existingVersion !== undefined &&
          compareVersion(manifest.version, existingVersion) < 0
        ) {
          return {
            ok: false,
            errors: [`downgrade refused: ${existingVersion} → ${manifest.version} (use force)`]
          }
        }
      }

      // Extract into staging with per-entry zip-slip protection.
      const staging = join(
        options.modulesDir,
        `${STAGING_PREFIX}${id}-${randomBytes(4).toString('hex')}`
      )
      await rm(staging, { recursive: true, force: true })
      await mkdir(staging, { recursive: true })
      const writeErrors: string[] = []
      for (const entry of pkg.entries) {
        const name = entry.entryName === ELM_DESCRIPTOR ? MODULE_DESCRIPTOR : entry.entryName
        const safe = safeEntryPath(name)
        if (!safe.ok) {
          writeErrors.push(safe.error)
          continue
        }
        const outPath = resolve(staging, ...safe.segments)
        if (!outPath.startsWith(staging + sep)) {
          writeErrors.push(`unsafe entry: ${name}`)
          continue
        }
        const data =
          entry.entryName === ELM_DESCRIPTOR
            ? Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
            : entry.getData()
        await mkdir(dirname(outPath), { recursive: true })
        await writeFile(outPath, data)
      }
      if (writeErrors.length > 0) {
        await rm(staging, { recursive: true, force: true })
        return { ok: false, errors: writeErrors }
      }

      // Atomic-ish swap: target → trash, staging → target, drop trash.
      let trash: string | null = null
      try {
        await stat(targetDir)
        trash = join(options.modulesDir, `${TRASH_PREFIX}${id}-${Date.now()}`)
        await rename(targetDir, trash)
      } catch {
        /* fresh install */
      }
      try {
        await rename(staging, targetDir)
      } catch (e) {
        if (trash) await rename(trash, targetDir).catch(() => {})
        await rm(staging, { recursive: true, force: true })
        return { ok: false, errors: [`install failed: ${String(e)}`] }
      }
      if (trash) await rm(trash, { recursive: true, force: true }).catch(() => {})

      log.info('module installed', { moduleId: id, version: manifest.version })
      return { ok: true, errors: [], moduleId: id }
    },

    async uninstall(moduleId: string): Promise<void> {
      // Unload first (stops, unregisters, drops declarations — revocations
      // are kept by contract). Config, revocation memory and the disabled
      // state survive: reinstalling does not silently regain anything.
      await options.modules.unload(moduleId)
      await rm(join(options.modulesDir, moduleId), { recursive: true, force: true })
      await options.modules.discover()
      log.info('module uninstalled (config kept)', { moduleId })
    },

    async watch(): Promise<void> {
      if (watcher) return
      await mkdir(options.modulesDir, { recursive: true })
      watcher = fsWatch(options.modulesDir, { recursive: true }, () => schedule())
      watcher.on('error', (e) => log.warn('modules dir watch error', { error: String(e) }))
      await reconcile()
      log.info('watching modules directory', { dir: options.modulesDir })
    },

    unwatch(): void {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (watcher) {
        watcher.close()
        watcher = null
      }
    }
  }

  function schedule(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void reconcile().catch((e) => log.error('reconcile failed', { error: String(e) }))
    }, WATCH_DEBOUNCE_MS)
  }

  /** One pass: auto-install new/changed .elm files, auto-unload vanished dirs. */
  async function reconcile(): Promise<void> {
    if (reconciling) {
      rerunPending = true
      return
    }
    reconciling = true
    try {
      await options.modules.discover()

      const installedIds: string[] = []
      let entries: Dirent[] = []
      try {
        entries = await readdir(options.modulesDir, { withFileTypes: true })
      } catch {
        entries = []
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.elm')) continue
        let mtime = 0
        try {
          mtime = (await stat(join(options.modulesDir, entry.name))).mtimeMs
        } catch {
          continue
        }
        if (processedElm.get(entry.name) === mtime) continue
        processedElm.set(entry.name, mtime)
        const result = await service.install(join(options.modulesDir, entry.name))
        if (!result.ok) {
          log.error('auto install failed', { file: entry.name, errors: result.errors })
          continue
        }
        if (result.moduleId) installedIds.push(result.moduleId)
      }

      if (installedIds.length > 0) {
        await options.modules.discover()
        for (const id of installedIds) {
          // Upgrade path: unload first so old registrations are cleaned;
          // the new entry instance itself only takes effect after an app
          // restart (import cache — documented T6 boundary).
          await options.modules.unload(id)
          const loaded = await options.modules.load(id)
          if (!loaded.ok) {
            log.error('auto load failed', { moduleId: id, errors: loaded.errors })
            continue
          }
          const started = await options.modules.start(id)
          log.info('auto load complete', { moduleId: id, started: started.ok })
        }
      }

      // Auto-unload modules whose directory vanished.
      let unloadedAny = false
      for (const info of options.modules.list()) {
        if (
          info.status === 'discovered' ||
          info.status === 'invalid' ||
          info.status === 'disabled'
        ) {
          continue
        }
        try {
          await stat(join(options.modulesDir, info.id))
        } catch {
          await options.modules.unload(info.id)
          unloadedAny = true
          log.info('module directory vanished, unloaded', { moduleId: info.id })
        }
      }
      if (unloadedAny) await options.modules.discover()
    } finally {
      reconciling = false
      if (rerunPending) {
        rerunPending = false
        schedule()
      }
    }
  }

  return service
}

/**
 * Seed preset modules into the (empty) user modules directory on first run
 * of a packaged build — the "恢复预置模块" data path. Skips when the target
 * has content (user data wins) or the source is missing (dev runs).
 */
export async function seedPresetModules(
  resourcesDir: string,
  modulesDir: string
): Promise<void> {
  let entries: Dirent[] = []
  try {
    entries = await readdir(resourcesDir, { withFileTypes: true })
  } catch {
    return // no preset modules shipped — nothing to seed
  }
  let hasContent = false
  try {
    hasContent = (await readdir(modulesDir)).length > 0
  } catch {
    hasContent = false
  }
  if (hasContent) return
  await mkdir(modulesDir, { recursive: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
      continue
    }
    await cp(join(resourcesDir, entry.name), join(modulesDir, entry.name), { recursive: true })
  }
}
