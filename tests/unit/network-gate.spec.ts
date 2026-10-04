import { describe, expect, it, vi } from 'vitest'
import type { ILogger } from '../../src/contracts/logger'
import { createNetworkClient, hostAllowed, hostOf } from '../../src/main/core/network'

/**
 * C2 守卫：受管网络门面的**三道闸门**与**两条工程约束**。
 *
 * ⚠️ 本测试**不联网**：`fetchImpl` 是注入的假实现。真发请求需要用户明确同意，
 * 且**我不会用任何真实密钥发请求** —— 这条界限也由测试固定下来。
 *
 * 三道闸门（全部默认拒绝）：
 *   ① 用户同意（默认关 ⇒ 与 T9 的 local-first 行为完全一致）；
 *   ② 只允许 https + 主机白名单（默认放行三家主流 API 主机，用户可加自建网关）；
 *   ③ 不跟随重定向（`redirect:'error'`）⇒ 白名单不能被 302 绕过。
 * 两条约束：**密钥绝不进日志**、体积上限（请求 256KB / 响应 2MB）。
 */

function testLogger(): { logger: ILogger; lines: string[] } {
  const lines: string[] = []
  const record = (...a: unknown[]): void => {
    lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  }
  const make = (): ILogger => ({
    debug: record,
    info: record,
    warn: record,
    error: record,
    child: () => make(),
    setLevel: () => {}
  })
  return { logger: make(), lines }
}

const okFetch = (payload = '{"ok":true}'): typeof fetch =>
  vi.fn(async () => new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

describe('C2 网络门面：默认拒绝（与 T9 行为一致）', () => {
  it('① 未获同意时一律拒绝，且理由仍是 local-first', async () => {
    const { logger } = testLogger()
    const net = createNetworkClient({ logger, fetchImpl: okFetch() })
    await expect(net.request('https://api.openai.com/v1/chat/completions')).rejects.toThrow(/local-first/)
    expect(net.diagnostics().mode, '未开启 ⇒ 仍报告 local-empty').toBe('local-empty')
    expect(net.diagnostics().rejected).toBe(1)
  })
})

describe('C2 网络门面：获准后的三道闸门', () => {
  it('② 只允许 https（明文 http 一律拒绝）', async () => {
    const { logger } = testLogger()
    const net = createNetworkClient({ logger, fetchImpl: okFetch(), isEnabled: () => true })
    await expect(net.request('http://api.openai.com/x')).rejects.toThrow(/只允许 https/)
    expect(hostOf('http://api.openai.com/x')).toBe(null)
  })

  it('③ 主机白名单：默认放行三家主流 API，其它主机拒绝并**说明是哪个主机**', async () => {
    const { logger, lines } = testLogger()
    const net = createNetworkClient({ logger, fetchImpl: okFetch(), isEnabled: () => true })
    await expect(net.request('https://api.openai.com/v1/x')).resolves.toBeTruthy()
    await expect(net.request('https://api.anthropic.com/v1/messages')).resolves.toBeTruthy()
    await expect(net.request('https://generativelanguage.googleapis.com/v1beta/x')).resolves.toBeTruthy()
    await expect(net.request('https://evil.example.com/steal')).rejects.toThrow(/主机不在白名单：evil\.example\.com/)
    expect(lines.join('\n'), '拒绝原因要进日志（便于审计）').toMatch(/主机不在白名单/)
  })

  it('④ 用户可加自建网关（extraHosts），且子域匹配生效', async () => {
    const { logger } = testLogger()
    const net = createNetworkClient({
      logger,
      fetchImpl: okFetch(),
      isEnabled: () => true,
      extraHosts: () => ['my-gateway.example', 'openai.com']
    })
    await expect(net.request('https://my-gateway.example/v1/chat/completions')).resolves.toBeTruthy()
    expect(hostAllowed('api.openai.com', ['openai.com']), '子域应被放行').toBe(true)
    expect(net.diagnostics().allowedHosts, '设置界面需要展示当前放行主机').toContain('my-gateway.example')
  })

  it('⑤ 不跟随重定向（防止白名单被 302 绕过）', async () => {
    const { logger } = testLogger()
    const spy = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(init?.redirect, '必须显式设为 error').toBe('error')
      return new Response('{}', { status: 200 })
    })
    const net = createNetworkClient({ logger, fetchImpl: spy as unknown as typeof fetch, isEnabled: () => true })
    await net.request('https://api.openai.com/v1/x')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('C2 网络门面：两条工程约束', () => {
  it('⑥ **密钥绝不进日志**（只记主机/方法/状态码/字节/耗时）', async () => {
    const { logger, lines } = testLogger()
    const net = createNetworkClient({ logger, fetchImpl: okFetch(), isEnabled: () => true })
    await net.request('https://api.openai.com/v1/chat/completions', {
      headers: { authorization: 'Bearer sk-SECRET-123', 'x-api-key': 'sk-ALSO-SECRET' },
      body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: '直播片段' }] }
    })
    const joined = lines.join('\n')
    expect(joined, '日志里不得出现密钥').not.toMatch(/sk-SECRET-123|sk-ALSO-SECRET/)
    expect(joined, '日志里不得出现请求体内容').not.toMatch(/直播片段/)
    expect(joined, '但应当有可用于审计的元数据').toMatch(/api\.openai\.com/)
  })

  it('⑦ 体积上限：请求体超 32MB 拒绝；响应超 2MB 拒绝；**ASR 用的大表单必须放行**', async () => {
    const { logger } = testLogger()
    // ASR 上传音频用 multipart（10 分钟 16kHz 单声道 mp3 ≈ 1~2MB）⇒ 旧上限 256KB 会把它全挡掉，
    // 因此上限提到 32MB；这里先确认"几百 KB 的表单/二进制"能正常通过。
    const net0 = createNetworkClient({ logger, fetchImpl: okFetch(), isEnabled: () => true })
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(300 * 1024)], { type: 'audio/mpeg' }), 'a.mp3')
    form.append('model', 'whisper-1')
    await expect(net0.request('https://api.openai.com/v1/audio/transcriptions', { body: form as unknown as string })).resolves.toBeTruthy()

    const tooBig = 'x'.repeat(33 * 1024 * 1024)
    const net1 = createNetworkClient({ logger, fetchImpl: okFetch(), isEnabled: () => true })
    await expect(net1.request('https://api.openai.com/v1/x', { body: tooBig })).rejects.toThrow(/请求体过大/)

    const huge = 'y'.repeat(2 * 1024 * 1024 + 10)
    const net2 = createNetworkClient({ logger, fetchImpl: okFetch(huge), isEnabled: () => true })
    await expect(net2.request('https://api.openai.com/v1/x')).rejects.toThrow(/响应过大/)
  })

  it('⑧ 超时要给可读原因，且计入 rejected', async () => {
    const { logger } = testLogger()
    const hanging = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            rej(e)
          })
        })
    )
    const net = createNetworkClient({ logger, fetchImpl: hanging as unknown as typeof fetch, isEnabled: () => true })
    await expect(net.request('https://api.openai.com/v1/x', { timeoutMs: 1000 })).rejects.toThrow(/请求超时/)
    expect(net.diagnostics().rejected).toBe(1)
  })

  it('⑨ 非 2xx 视为失败，但**状态码要如实报告**（便于区分 401 密钥错与 429 限流）', async () => {
    const { logger } = testLogger()
    const f = vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 })) as unknown as typeof fetch
    const net = createNetworkClient({ logger, fetchImpl: f, isEnabled: () => true })
    await expect(net.request('https://api.openai.com/v1/x')).rejects.toThrow(/HTTP 401/)
    expect(net.diagnostics().lastRejection).toBe('HTTP 401')
  })
})

describe('C2 网络门面：forModule（绑定模块身份）', () => {
  it('⑩ 模块门面与核心共用同一套闸门：未同意照样拒绝、白名单外照样拒绝', async () => {
    const { logger } = testLogger()
    const net = createNetworkClient({ logger, fetchImpl: okFetch(), isEnabled: () => false })
    const scoped = net.forModule('vupcut')
    await expect(scoped.request('https://api.openai.com/v1/x'), '未同意 ⇒ 模块也发不出去').rejects.toThrow(/local-first/)

    const on = createNetworkClient({ logger, fetchImpl: okFetch(), isEnabled: () => true })
    const s2 = on.forModule('vupcut')
    await expect(s2.request('https://evil.example.com/x')).rejects.toThrow(/主机不在白名单/)
    await expect(s2.request('https://api.anthropic.com/v1/messages')).resolves.toBeTruthy()
  })

  it('⑪ 模块门面的日志必须带模块身份，且**依然不含密钥与请求体**', async () => {
    const { logger, lines } = testLogger()
    const net = createNetworkClient({ logger, fetchImpl: okFetch(), isEnabled: () => true })
    await net.forModule('vupcut').request('https://api.openai.com/v1/chat/completions', {
      headers: { authorization: 'Bearer sk-MODULE-SECRET' },
      body: { messages: [{ role: 'user', content: '这场直播的台词' }] }
    })
    const joined = lines.join('\n')
    expect(joined, '要能看出是哪个模块在联网（可审计）').toMatch(/vupcut/)
    expect(joined, '模块门面也不得泄漏密钥').not.toMatch(/sk-MODULE-SECRET/)
    expect(joined, '也不得泄漏请求体内容').not.toMatch(/这场直播的台词/)
  })

  it('⑫ 模块身份为空/乱填 ⇒ 记为 (unknown)，不得崩', async () => {
    const { logger, lines } = testLogger()
    const net = createNetworkClient({ logger, fetchImpl: okFetch(), isEnabled: () => true })
    await net.forModule('').request('https://api.openai.com/v1/x')
    expect(lines.join('\n')).toMatch(/\(unknown\)/)
  })
})
