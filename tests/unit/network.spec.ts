import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import { createNetworkClient } from '../../src/main/core/network'

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

describe('统一网络客户端（本地空实现）', () => {
  it('GET/POST 一律 reject，红线信息明确', async () => {
    const net = createNetworkClient({ logger: testLogger() })
    await expect(net.request('https://example.com')).rejects.toThrow('local-first')
    await expect(
      net.request('https://example.com/api', { method: 'POST', body: { a: 1 } })
    ).rejects.toThrow('local-first')
  })

  it('拒绝计数递增 + diagnostics 形状', async () => {
    const net = createNetworkClient({ logger: testLogger() })
    await expect(net.request('https://x.example')).rejects.toThrow()
    await expect(net.request('https://y.example')).rejects.toThrow()
    expect(net.diagnostics()).toEqual({
      mode: 'local-empty',
      rejected: 2,
      lastRejection: expect.stringContaining('local-first')
    })
  })

  it('并发请求全部拒绝、计数准确、互不干扰', async () => {
    const net = createNetworkClient({ logger: testLogger() })
    const results = await Promise.allSettled(
      ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', 'https://e.example'].map(
        (url) => net.request(url)
      )
    )
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(net.diagnostics().rejected).toBe(5)
  })
})
