import { safeStorage } from 'electron'
import type { CredentialCipher } from './index'

/**
 * Electron safeStorage cipher (assembly-root use only; unit tests inject
 * their own cipher so the core service stays Electron-free).
 *
 * - Windows: DPAPI; macOS: Keychain; Linux: libsecret/kwallet.
 * - When OS encryption is unavailable the fallback stores plaintext
 *   flagged 'weak' — honestly surfaced through the store metadata, never
 *   silently. On Windows DPAPI is always available, so the fallback mainly
 *   guards unusual environments.
 */
export function createElectronCipher(): CredentialCipher {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      protection: 'strong',
      encrypt: (plaintext) => safeStorage.encryptString(plaintext),
      decrypt: (data) => safeStorage.decryptString(data)
    }
  }
  return {
    protection: 'weak',
    encrypt: (plaintext) => Buffer.from(plaintext, 'utf8'),
    decrypt: (data) => data.toString('utf8')
  }
}
