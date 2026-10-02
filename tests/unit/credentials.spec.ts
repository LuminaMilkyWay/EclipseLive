import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import {
  createCredentialStore,
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

/** 真实 AES-256-GCM 密码器（seed 决定密钥，用于构造解密失败路径）。 */
function aesCipher(seed: string, protection: 'strong' | 'weak' = 'strong'): CredentialCipher {
  const key = createHash('sha256').update(seed).digest()
  return {
    protection,
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

async function makeStore(
  dir: string,
  cipher: CredentialCipher = aesCipher('el-t9-test-key')
): Promise<CredentialStoreHandle> {
  return createCredentialStore({ logger: testLogger(), dir, cipher })
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'el-cred-'))
}

const STORE_FILE = 'credentials.json'

/* ---------- 用例 ---------- */

describe('加密键值对', () => {
  it('set/get 往返；未知键 null；has', async () => {
    const root = await tempRoot()
    const store = await makeStore(join(root, 'a'))
    store.set('openai:key', 'sk-secret-value')
    expect(store.get('openai:key')).toBe('sk-secret-value')
    expect(store.get('unknown')).toBeNull()
    expect(store.has('openai:key')).toBe(true)
    expect(store.has('unknown')).toBe(false)
    await store.flush()
  })

  it('落盘文件不含明文；list 仅元数据', async () => {
    const root = await tempRoot()
    const dir = join(root, 'a')
    const store = await makeStore(dir)
    const canary = 'plaintext-canary-9f8e7d6c'
    store.set('service:token', canary)
    await store.flush()

    const fileContent = await readFile(join(dir, STORE_FILE), 'utf8')
    expect(fileContent).not.toContain(canary)

    expect(store.list()).toEqual([
      { key: 'service:token', weak: false, updatedAt: expect.any(Number) }
    ])
  })

  it('delete：移除并持久化；未知键 false', async () => {
    const root = await tempRoot()
    const dir = join(root, 'a')
    const store = await makeStore(dir)
    store.set('a', '1')
    store.set('b', '2')
    expect(store.delete('a')).toBe(true)
    expect(store.get('a')).toBeNull()
    expect(store.delete('a')).toBe(false)
    expect(store.get('b')).toBe('2')
    await store.flush()

    const reopened = await makeStore(dir)
    expect(reopened.get('a')).toBeNull()
    expect(reopened.get('b')).toBe('2')
  })

  it('跨工厂实例持久化（重载即得）', async () => {
    const root = await tempRoot()
    const dir = join(root, 'a')
    const a = await makeStore(dir)
    a.set('persisted:key', 'v1-secret')
    await a.flush()

    const b = await makeStore(dir)
    expect(b.get('persisted:key')).toBe('v1-secret')
  })

  it('损坏文件 → .bak 备份 + 空库重建', async () => {
    const root = await tempRoot()
    const dir = join(root, 'a')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, STORE_FILE), 'not-json{', 'utf8')

    const store = await makeStore(dir)
    expect(store.get('x')).toBeNull()
    expect(existsSync(join(dir, `${STORE_FILE}.bak`))).toBe(true)

    store.set('rebuilt', 'ok')
    await store.flush()
    expect(store.get('rebuilt')).toBe('ok')
  })

  it('weak 密码器 → 元数据如实标记，往返仍通', async () => {
    const root = await tempRoot()
    const store = await makeStore(join(root, 'a'), aesCipher('el-t9-test-key', 'weak'))
    store.set('k', 'plain-secret')
    expect(store.get('k')).toBe('plain-secret')
    expect(store.list()[0].weak).toBe(true)
  })

  it('密钥不符（解密失败）→ get 返回 null 不抛出；元数据仍在', async () => {
    const root = await tempRoot()
    const dir = join(root, 'a')
    const a = await makeStore(dir, aesCipher('key-one'))
    a.set('k', 'locked-value')
    await a.flush()

    const b = await makeStore(dir, aesCipher('key-two'))
    expect(b.get('k')).toBeNull()
    expect(b.list().map((r) => r.key)).toEqual(['k'])
  })

  it('键/值校验：空键与超长值被拒收', async () => {
    const root = await tempRoot()
    const store = await makeStore(join(root, 'a'))
    store.set('', 'x')
    expect(store.has('')).toBe(false)
    const longKey = 'k'.repeat(300)
    store.set(longKey, 'x')
    expect(store.has(longKey)).toBe(false)
    store.set('ok-key', 'x'.repeat(64 * 1024 + 1))
    expect(store.has('ok-key')).toBe(false)
    store.set('ok-key', 'reasonable')
    expect(store.has('ok-key')).toBe(true)
  })
})
