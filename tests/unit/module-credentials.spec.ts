import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import {
  isModuleCredentialKey,
  moduleCredentialKey,
  MODULE_CREDENTIAL_KEY_MAX,
  type CredentialRecord,
  type ICredentialStore
} from '@contracts/credentials'
import {
  createCredentialStore,
  createModuleCredentials,
  type CredentialCipher,
  type CredentialStoreHandle
} from '../../src/main/core/credentials'

/* ---------- 测试辅助 ---------- */

function testLogger(): ILogger {
  const make = (): ILogger => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => make(),
    setLevel: () => {}
  })
  return make()
}

/** 内存 store：可直接检视**原始键空间**，用于证明命名空间隔离。 */
class MemoryStore implements ICredentialStore {
  raw = new Map<string, string>()
  get(key: string): string | null {
    return this.raw.get(key) ?? null
  }
  set(key: string, secret: string): void {
    this.raw.set(key, secret)
  }
  delete(key: string): boolean {
    return this.raw.delete(key)
  }
  has(key: string): boolean {
    return this.raw.has(key)
  }
  list(): CredentialRecord[] {
    return [...this.raw.keys()].sort().map((key) => ({ key, weak: false, updatedAt: 0 }))
  }
}

const STORE = 'module:vts-controlpad:auth-token'

function rig(moduleId = 'vts-controlpad') {
  const store = new MemoryStore()
  const creds = createModuleCredentials({ store, moduleId })
  return { store, creds }
}

/* ---------- 1. 往返 ---------- */

describe('模块凭据门面：基本往返', () => {
  it('set → get → has → delete', () => {
    const { creds } = rig()
    expect(creds.has('auth-token')).toBe(false)
    expect(creds.get('auth-token')).toBeNull()

    creds.set('auth-token', 'tok-123')
    expect(creds.get('auth-token')).toBe('tok-123')
    expect(creds.has('auth-token')).toBe(true)

    expect(creds.delete('auth-token')).toBe(true)
    expect(creds.delete('auth-token')).toBe(false)
    expect(creds.get('auth-token')).toBeNull()
  })

  it('写入落在 module:<id>: 命名空间下（不污染核心键空间）', () => {
    const { store, creds } = rig()
    creds.set('auth-token', 'tok-123')
    expect([...store.raw.keys()]).toEqual([STORE])
    expect(store.raw.get(STORE)).toBe('tok-123')
  })
})

/* ---------- 2. 隔离（本次 C0 的安全要点） ---------- */

describe('命名空间隔离：读不到本模块以外的任何密钥', () => {
  it('读不到核心自己的密钥（OBS 密码）', () => {
    const { store, creds } = rig()
    store.set('obs:password', 'OBS-SECRET')

    expect(creds.get('password'), '不得跨到核心命名空间').toBeNull()
    expect(creds.get('obs:password'), '含冒号的键直接被判非法').toBeNull()
    expect(creds.has('password')).toBe(false)
  })

  it('读不到其他模块的密钥（同名短名也不互相覆盖）', () => {
    const { store, creds } = rig('mod-a')
    const other = createModuleCredentials({ store, moduleId: 'mod-b' })
    other.set('auth-token', 'B-TOKEN')

    expect(creds.get('auth-token'), 'A 读同名短名不得拿到 B 的值').toBeNull()
    creds.set('auth-token', 'A-TOKEN')
    expect(creds.get('auth-token')).toBe('A-TOKEN')
    expect(other.get('auth-token'), 'B 的值不被 A 覆盖').toBe('B-TOKEN')
    expect(store.raw.get(moduleCredentialKey('mod-b', 'auth-token'))).toBe('B-TOKEN')
  })

  it('list() 只含本模块条目且前缀已剥离', () => {
    const { store, creds } = rig('mod-a')
    const other = createModuleCredentials({ store, moduleId: 'mod-b' })
    creds.set('token', 'a')
    creds.set('pin', 'b')
    other.set('token', 'c')
    store.set('obs:password', 'core')

    expect(creds.list().map((r) => r.key)).toEqual(['pin', 'token'])
    expect(JSON.stringify(creds.list()), '不得泄漏核心键名').not.toContain('obs:password')
  })
})

/* ---------- 3. 非法短名一律拒绝（防越权） ---------- */

describe('非法短名被拒（`:` 是越权入口）', () => {
  it('含冒号 / 空串 / 超长：get→null、has→false、delete→false、set 静默无效', () => {
    const { store, creds } = rig('mod-a')
    const bad = ['mod-b:token', 'a:b', '', 'x'.repeat(MODULE_CREDENTIAL_KEY_MAX + 1)]

    for (const k of bad) {
      expect(isModuleCredentialKey(k), `${JSON.stringify(k)} 应判非法`).toBe(false)
      expect(creds.get(k)).toBeNull()
      expect(creds.has(k)).toBe(false)
      expect(creds.delete(k)).toBe(false)
      creds.set(k, 'should-be-ignored')
    }
    expect([...store.raw.keys()], '非法键不得写入任何位置').toEqual([])
  })

  it('边界：最大长度短名合法，恰好超一字符非法', () => {
    expect(isModuleCredentialKey('x'.repeat(MODULE_CREDENTIAL_KEY_MAX))).toBe(true)
    expect(isModuleCredentialKey('x'.repeat(MODULE_CREDENTIAL_KEY_MAX + 1))).toBe(false)
  })
})

/* ---------- 4. 真实加密 store 往返（锁住键长不变量） ---------- */

describe('接真实加密 store', () => {
  function aesCipher(seed: string): CredentialCipher {
    const key = createHash('sha256').update(seed).digest()
    return {
      protection: 'strong',
      encrypt(plaintext) {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
        return Buffer.concat([iv, cipher.getAuthTag(), enc])
      },
      decrypt(data) {
        const iv = data.subarray(0, 12)
        const tag = data.subarray(12, 28)
        const enc = data.subarray(28)
        const decipher = createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
      }
    }
  }

  it('最大长度短名也能落盘并读回（前缀 + id 不得撞 store 的键长上限）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'el-modcred-'))
    const store: CredentialStoreHandle = await createCredentialStore({
      logger: testLogger(),
      dir,
      cipher: aesCipher('el-c0-test-key')
    })
    const creds = createModuleCredentials({ store, moduleId: 'vts-controlpad' })
    const maxKey = 'k'.repeat(MODULE_CREDENTIAL_KEY_MAX)

    creds.set(maxKey, 'boundary-secret')
    expect(creds.get(maxKey), '超长键被 store 静默丢弃会导致这里为 null').toBe('boundary-secret')
    expect(creds.list().map((r) => r.key)).toEqual([maxKey])

    // 落盘的是密文：磁盘上不得出现明文
    creds.set('auth-token', 'PLAINTEXT-MUST-NOT-LEAK')
    const { readFile, readdir } = await import('node:fs/promises')
    const files = await readdir(dir)
    const dump = (await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8').catch(() => '')))).join('')
    expect(dump, '凭据不得明文落盘').not.toContain('PLAINTEXT-MUST-NOT-LEAK')
  })
})
