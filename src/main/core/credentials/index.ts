import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { ILogger } from '@contracts/logger'
import type {
  CredentialRecord,
  ICredentialStore,
  ModuleCredentials
} from '@contracts/credentials'
import { isModuleCredentialKey, moduleCredentialKey } from '@contracts/credentials'

/**
 * Secure credential store (T9) — generic encrypted key-value storage.
 *
 * - The core service is Electron-free: the cipher is an injected dependency
 *   (tests use AES-256-GCM; the assembly root passes the Electron
 *   safeStorage adapter from ./electron-cipher — DPAPI / Keychain /
 *   libsecret under the hood).
 * - Secrets are encrypted BEFORE they touch disk; plaintext and ciphertext
 *   never reach logs (key names and metadata only).
 * - Decrypt failures yield null, never a throw: one unreadable entry must
 *   not take the store (or the app) down.
 * - Persistence is a serialized queue with atomic tmp+rename writes; a
 *   corrupt store file is backed up (.bak) and rebuilt fresh.
 */

const STORE_FILE = 'credentials.json'
const MAX_KEY_LENGTH = 256
const MAX_SECRET_BYTES = 64 * 1024

/** Platform cipher injected into the store (see ./electron-cipher). */
export interface CredentialCipher {
  /** 'strong' = OS-managed encryption; 'weak' = honest fallback. */
  readonly protection: 'strong' | 'weak'
  encrypt(plaintext: string): Buffer
  decrypt(data: Buffer): string
}

export interface CredentialStoreOptions {
  logger: ILogger
  /** Directory for credentials.json. */
  dir: string
  cipher: CredentialCipher
}

/** Handle with the test-only flush() (mirrors the config center). */
export type CredentialStoreHandle = ICredentialStore & { flush(): Promise<void> }

interface StoredEntry {
  /** Base64 of the cipher output — never plaintext. */
  ciphertext: string
  weak: boolean
  updatedAt: number
}

interface PersistedShape {
  version: number
  entries: Record<string, StoredEntry>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseEntry(v: unknown): StoredEntry | null {
  if (!isPlainObject(v)) return null
  const { ciphertext, weak, updatedAt } = v
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) return null
  if (typeof weak !== 'boolean') return null
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  return { ciphertext, weak, updatedAt }
}

export async function createCredentialStore(
  options: CredentialStoreOptions
): Promise<CredentialStoreHandle> {
  const log = options.logger.child('credentials')
  const file = join(options.dir, STORE_FILE)
  const entries = new Map<string, StoredEntry>()
  let writeQueue: Promise<unknown> = Promise.resolve()

  await mkdir(options.dir, { recursive: true })

  // Load persisted entries; a corrupt file is backed up and rebuilt fresh.
  let rawText: string | undefined
  try {
    rawText = await readFile(file, 'utf8')
  } catch {
    rawText = undefined // no store yet — start empty
  }
  if (rawText !== undefined) {
    try {
      const raw = JSON.parse(rawText) as PersistedShape
      if (isPlainObject(raw?.entries)) {
        for (const [key, value] of Object.entries(raw.entries)) {
          const entry = parseEntry(value)
          if (entry && key.length > 0 && key.length <= MAX_KEY_LENGTH) {
            entries.set(key, entry)
          }
        }
      }
    } catch {
      await rename(file, `${file}.bak`).catch((e) => {
        log.warn('backing up corrupt store failed', { error: String(e) })
      })
      log.warn('corrupt credential store backed up, rebuilding empty')
    }
  }

  function persist(): void {
    writeQueue = writeQueue.then(async () => {
      const shape: PersistedShape = { version: 1, entries: Object.fromEntries(entries) }
      const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`
      try {
        await writeFile(tmp, JSON.stringify(shape, null, 2), 'utf8')
        await rename(tmp, file)
      } catch (e) {
        log.error('persisting credentials failed', { error: String(e) })
      }
    })
  }

  const service: CredentialStoreHandle = {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return null
      try {
        return options.cipher.decrypt(Buffer.from(entry.ciphertext, 'base64'))
      } catch (e) {
        // Neither plaintext nor ciphertext is ever logged — key name only.
        log.error('decrypt failed', { key, error: String(e) })
        return null
      }
    },

    set(key, secret) {
      if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
        log.warn('credential key rejected', { keyLength: key.length })
        return
      }
      if (Buffer.byteLength(secret, 'utf8') > MAX_SECRET_BYTES) {
        log.warn('credential secret rejected (too large)', { key })
        return
      }
      try {
        const data = options.cipher.encrypt(secret)
        entries.set(key, {
          ciphertext: data.toString('base64'),
          weak: options.cipher.protection === 'weak',
          updatedAt: Date.now()
        })
        persist()
      } catch (e) {
        log.error('encrypt failed', { key, error: String(e) })
      }
    },

    delete(key) {
      const had = entries.delete(key)
      if (had) persist()
      return had
    },

    has(key) {
      return entries.has(key)
    },

    list(): CredentialRecord[] {
      return [...entries.keys()].sort().map((key) => {
        const entry = entries.get(key)
        return {
          key,
          weak: entry?.weak ?? false,
          updatedAt: entry?.updatedAt ?? 0
        }
      })
    },

    async flush() {
      await writeQueue
    }
  }

  return service
}

export interface ModuleCredentialsOptions {
  store: ICredentialStore
  moduleId: string
  /** 仅用于记录被拒的非法键；不记录任何密钥材料。 */
  logger?: ILogger
}

/**
 * 模块侧命名空间门面（C0）。
 *
 * store 是**扁平键空间**，核心自己也在用（`obs:password` 等）。门面**强制**
 * `module:<moduleId>:` 前缀，于是：
 * - 模块读不到核心密钥，也读不到其他模块的密钥；
 * - 两个模块用同名短名互不覆盖；
 * - 模块无需（也不能）自己拼前缀。
 *
 * 键的合法性由 `isModuleCredentialKey` 判定：**含 `:` 即非法**——否则模块可借
 * `other:token` 逃出本子空间。非法键一律安全失败（get→null / has→false /
 * delete→false / set 静默无效），不抛异常。
 *
 * 不抛异常的另一个来源是 store 本身：加密失败与解密失败都已在 store 内部吞掉
 * （分别记日志与返回 null），门面无需重复包裹。
 */
export function createModuleCredentials(options: ModuleCredentialsOptions): ModuleCredentials {
  const { store, moduleId } = options
  const log = options.logger?.child('module-credentials')

  /** 短名 → 完整键；非法返回 null（并记一次 warn，便于发现模块 bug）。 */
  function resolve(key: string): string | null {
    if (!isModuleCredentialKey(key)) {
      log?.warn('module credential key rejected', {
        moduleId,
        keyLength: typeof key === 'string' ? key.length : -1
      })
      return null
    }
    return moduleCredentialKey(moduleId, key)
  }

  /** 本模块子空间的前缀（`module:<id>:`），用于 list 过滤。 */
  const namespace = moduleCredentialKey(moduleId, '')

  return {
    get(key) {
      const full = resolve(key)
      return full === null ? null : store.get(full)
    },
    set(key, secret) {
      const full = resolve(key)
      if (full === null) return
      store.set(full, secret)
    },
    delete(key) {
      const full = resolve(key)
      return full === null ? false : store.delete(full)
    },
    has(key) {
      const full = resolve(key)
      return full === null ? false : store.has(full)
    },
    list(): CredentialRecord[] {
      return store
        .list()
        .filter((r) => r.key.startsWith(namespace))
        .map((r) => ({ ...r, key: r.key.slice(namespace.length) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    }
  }
}
