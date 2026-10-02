import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import {
  APP_SETTINGS_VERSION,
  appDefaults,
  validateAppSettings
} from '../../src/shared/appSettings'
import {
  GITHUB_REPO,
  createUpdateChecker,
  type ReleaseInfo
} from '../../src/main/core/updates'

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

describe('AppSettings（core.app 分区）', () => {
  it('默认关闭：checkUpdatesEnabled 初始 false；分区版本 1', () => {
    expect(appDefaults.checkUpdatesEnabled).toBe(false)
    expect(APP_SETTINGS_VERSION).toBe(1)
  })

  it('validateAppSettings 严格校验：布尔合法，缺键 / 未知键 / 类型错 / 非对象拒', () => {
    expect(validateAppSettings({ checkUpdatesEnabled: true }).ok).toBe(true)
    expect(validateAppSettings({ checkUpdatesEnabled: false }).ok).toBe(true)
    expect(validateAppSettings({}).ok).toBe(false)
    expect(validateAppSettings({ checkUpdatesEnabled: 'yes' }).ok).toBe(false)
    expect(validateAppSettings({ checkUpdatesEnabled: true, extra: 1 }).ok).toBe(false)
    expect(validateAppSettings(null).ok).toBe(false)
    expect(validateAppSettings('x').ok).toBe(false)
  })
})

describe('updates 检查器（注入 transport，不触网）', () => {
  it('请求 GitHub Releases latest 端点', async () => {
    const urls: string[] = []
    const checker = createUpdateChecker({
      logger: testLogger(),
      appVersion: '0.1.0',
      transport: async (url: string) => {
        urls.push(url)
        return { tagName: 'v0.1.0' } satisfies ReleaseInfo
      }
    })
    await checker.check()
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('api.github.com/repos/')
    expect(urls[0]).toContain(GITHUB_REPO)
    expect(urls[0]).toContain('/releases/latest')
  })

  it('更高 tag → update-available（带 latest 与发布页 url）', async () => {
    const checker = createUpdateChecker({
      logger: testLogger(),
      appVersion: '0.1.0',
      transport: async () => ({ tagName: 'v0.2.0', htmlUrl: 'https://example.com/r' })
    })
    const r = await checker.check()
    expect(r.ok).toBe(true)
    expect(r.status).toBe('update-available')
    expect(r.current).toBe('0.1.0')
    expect(r.latest).toBe('v0.2.0')
    expect(r.url).toBe('https://example.com/r')
  })

  it('相同 tag → up-to-date', async () => {
    const checker = createUpdateChecker({
      logger: testLogger(),
      appVersion: '0.1.0',
      transport: async () => ({ tagName: 'v0.1.0' })
    })
    const r = await checker.check()
    expect(r.ok).toBe(true)
    expect(r.status).toBe('up-to-date')
  })

  it('transport 失败 → error（ok false，不抛出）', async () => {
    const checker = createUpdateChecker({
      logger: testLogger(),
      appVersion: '0.1.0',
      transport: async () => Promise.reject(new Error('network down'))
    })
    const r = await checker.check()
    expect(r.ok).toBe(false)
    expect(r.status).toBe('error')
    expect(r.error).toContain('network down')
  })

  it('非法 tag → error', async () => {
    const checker = createUpdateChecker({
      logger: testLogger(),
      appVersion: '0.1.0',
      transport: async () => ({ tagName: 'novel' })
    })
    const r = await checker.check()
    expect(r.ok).toBe(false)
    expect(r.status).toBe('error')
  })
})
