/**
 * Credential store contract.
 *
 * Generic encrypted key-value storage — the single home for future cloud
 * account tokens and API keys (and, today, the OBS WebSocket password).
 * Secrets are encrypted at rest with the platform-appropriate system
 * (DPAPI / Keychain / libsecret via Electron safeStorage); the core service
 * itself is Electron-free and takes the cipher as an injected dependency.
 *
 * - Plaintext NEVER reaches logs — only key names and metadata do.
 * - A decrypt failure yields null, never a throw: one unreadable entry
 *   must not take the store (or the app) down.
 * - `list()` exposes metadata only (key / weak / updatedAt).
 */

/** Metadata of one stored secret (no secret material). */
export interface CredentialRecord {
  key: string
  /**
   * True when the store fell back to non-encrypted storage because the OS
   * encryption was unavailable (flagged honestly; never silently).
   */
  weak: boolean
  updatedAt: number
}

export interface ICredentialStore {
  /** The secret, or null when the key is unknown or undecryptable. */
  get(key: string): string | null
  /** Encrypt and persist a secret (full replacement for the key). */
  set(key: string, secret: string): void
  /** Remove one secret. Returns false when the key was unknown. */
  delete(key: string): boolean
  has(key: string): boolean
  /** Metadata of every stored secret, sorted by key — never secret material. */
  list(): CredentialRecord[]
}

/* ---------- C0：模块侧命名空间门面 ---------- */

/**
 * 模块密钥的命名空间前缀。
 *
 * 背景：store 是**扁平 key 空间**，核心自己也在用（如 `obs:password`）。若把 store
 * 原样暴露给模块，任一模块即可读到 **OBS 密码**与其他模块的 token —— 这是 C0 必须
 * 先补的能力缺口。做法是门面**强制前缀**，模块只能看得见自己的子空间。
 */
export const MODULE_CREDENTIAL_PREFIX = 'module:'

/** 模块密钥最大长度（前缀之外的短名）。 */
export const MODULE_CREDENTIAL_KEY_MAX = 64

/**
 * 完整存储键：`module:<moduleId>:<key>`。
 *
 * 调用方无需自行拼接——门面负责，避免模块"忘加前缀"而写进核心空间。
 */
export function moduleCredentialKey(moduleId: string, key: string): string {
  return `${MODULE_CREDENTIAL_PREFIX}${moduleId}:${key}`
}

/**
 * 模块密钥短名是否合法。
 *
 * **拒绝 `:`** 是安全要点：含冒号即可伪造出别的前缀（如 `other:token`），
 * 从而越出本模块子空间。空串与超长同样拒绝。
 */
export function isModuleCredentialKey(key: string): boolean {
  return typeof key === 'string' && key.length > 0 && key.length <= MODULE_CREDENTIAL_KEY_MAX && !key.includes(':')
}

/**
 * 模块作用域的凭据门面（C0）。
 *
 * - 模块用**自己的短名**读写；前缀由门面补齐，模块永远看不到其他子空间。
 * - `list()` 只返回本模块的条目，且**前缀已被剥离**（模块不该看到核心的键格式）。
 * - 与 `ICredentialStore` 同样的诚实语义：解密失败返回 null，绝不抛。
 *
 * 刻意**不设权限**：门面只能访问核心托管目录下的加密存储，不是通用文件写能力；
 * 且"能否保存自己的密钥"对用户没有可否决的意义（对比 `file-write` 能写任意路径）。
 * 真正的边界是命名空间隔离本身。
 */
export interface ModuleCredentials {
  /** 本模块命名空间下的密钥；未设置或不可解密 → null。 */
  get(key: string): string | null
  /** 加密持久化；key 非法时静默忽略（门面不抛）。 */
  set(key: string, secret: string): void
  /** 删除本模块的密钥；未设置 → false。 */
  delete(key: string): boolean
  has(key: string): boolean
  /** 仅本模块条目的元数据（前缀已剥离），按 key 排序。 */
  list(): CredentialRecord[]
}
