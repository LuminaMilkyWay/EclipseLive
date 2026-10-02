import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import type { IPermission, PermissionType } from '@contracts/permission'
import {
  isLoopbackWsUrl,
  sanitizeWsUrl,
  EXTERNAL_WS_MAX_PAYLOAD,
  type ExternalWsHandle,
  type ExternalWsHooks,
  type ExternalWsHost
} from '@contracts/external-ws'
import { createExternalWs } from '../../src/main/core/external-ws'

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

/** 受控权限服务：granted 决定 check 结果。 */
function fakePermissions(granted: PermissionType[] = []): IPermission {
  const set = new Set<PermissionType>(granted)
  return {
    declare: () => ({ ok: true, errors: [] }),
    removeModule: () => {},
    revoke: (_m, p) => set.delete(p),
    grant: (_m, p) => (set.add(p), true),
    check: (_m, p) => set.has(p),
    status: () => ({ declared: [...set], revoked: [], granted: [...set] }),
    listAll: () => []
  }
}

interface FakeConn {
  url: string
  hooks: ExternalWsHooks
  sent: string[]
}

/** 受控宿主：记录连接与发送；可模拟创建失败、同步 onOpen、发送失败。 */
class FakeHost implements ExternalWsHost {
  byHandle = new Map<ExternalWsHandle, FakeConn>()
  connectCalls = 0
  failConnect = false
  failSend = false
  /** true 时在 connect 内部**同步**回调 onOpen（真实 ws 是异步的，这里锁住顺序健壮性）。 */
  syncOpen = false

  connect(url: string, hooks: ExternalWsHooks): ExternalWsHandle | null {
    this.connectCalls += 1
    if (this.failConnect) return null
    const conn: FakeConn = { url, hooks, sent: [] }
    const handle: ExternalWsHandle = { n: this.byHandle.size }
    this.byHandle.set(handle, conn)
    if (this.syncOpen) hooks.onOpen()
    return handle
  }
  send(handle: ExternalWsHandle, data: string): boolean {
    const c = this.byHandle.get(handle)
    if (!c || this.failSend) return false
    c.sent.push(data)
    return true
  }
  close(handle: ExternalWsHandle): void {
    this.byHandle.delete(handle)
  }

  /* 测试驱动 */
  openByUrl(url: string): void {
    for (const c of this.byHandle.values()) if (c.url === url) c.hooks.onOpen()
  }
  messageByUrl(url: string, data: string): void {
    for (const c of this.byHandle.values()) if (c.url === url) c.hooks.onMessage(data)
  }
  closeByUrl(url: string): void {
    for (const c of this.byHandle.values()) if (c.url === url) c.hooks.onClose('closed')
  }
  sentByUrl(url: string): string[] {
    for (const c of this.byHandle.values()) if (c.url === url) return c.sent
    return []
  }
  liveCount(): number {
    return this.byHandle.size
  }
}

const VTS = 'ws://127.0.0.1:8001'

function rig(granted: PermissionType[] = ['external-websocket']) {
  const host = new FakeHost()
  const permissions = fakePermissions(granted)
  const service = createExternalWs({ logger: testLogger(), permissions, host })
  return { host, permissions, service }
}

/* ---------- 1. 回环限定（纯函数） ---------- */

describe('回环限定：isLoopbackWsUrl', () => {
  it('接受本机回环的各种写法', () => {
    expect(isLoopbackWsUrl('ws://127.0.0.1:8001')).toBe(true)
    expect(isLoopbackWsUrl('ws://127.0.0.1')).toBe(true)
    expect(isLoopbackWsUrl('ws://localhost:8001')).toBe(true)
    expect(isLoopbackWsUrl('ws://[::1]:8001')).toBe(true)
    expect(isLoopbackWsUrl('wss://127.0.0.1:8443')).toBe(true)
    expect(isLoopbackWsUrl('ws://127.0.0.1:8001/some/path')).toBe(true)
  })

  it('拒绝一切非回环目标（含前缀伪装与局域网/公网）', () => {
    expect(isLoopbackWsUrl('ws://evil.example.com:8001')).toBe(false)
    // 前缀伪装：以 127.0.0.1 开头但实际是别的域
    expect(isLoopbackWsUrl('ws://127.0.0.1.evil.com:8001')).toBe(false)
    expect(isLoopbackWsUrl('ws://192.168.1.9:8001')).toBe(false)
    expect(isLoopbackWsUrl('ws://10.0.0.5:8001')).toBe(false)
    expect(isLoopbackWsUrl('ws://0.0.0.0:8001')).toBe(false)
    // 回环但非 ws 协议
    expect(isLoopbackWsUrl('http://127.0.0.1:8001')).toBe(false)
    expect(isLoopbackWsUrl('file:///c:/x')).toBe(false)
    // 畸形
    expect(isLoopbackWsUrl('')).toBe(false)
    expect(isLoopbackWsUrl('not a url')).toBe(false)
    expect(isLoopbackWsUrl('ws://')).toBe(false)
  })

  it('IPv4-mapped IPv6 等异体形式一律 fail-closed（拒绝而非放行）', () => {
    expect(isLoopbackWsUrl('ws://[::ffff:127.0.0.1]:8001')).toBe(false)
  })
})

describe('脱敏：sanitizeWsUrl', () => {
  it('剥离 query 与 hash（模块可能把一次性凭据放在 query 里）', () => {
    const out = sanitizeWsUrl('ws://127.0.0.1:8001/ws?token=SUPERSECRET#frag')
    expect(out).not.toContain('SUPERSECRET')
    expect(out).not.toContain('token')
    expect(out).not.toContain('#')
    expect(out).toContain('127.0.0.1:8001')
  })

  it('畸形 URL 不抛、返回占位符', () => {
    expect(sanitizeWsUrl('not a url')).toBe('<invalid-url>')
  })
})

/* ---------- 2. 权限闸门 ---------- */

describe('权限闸门：external-websocket', () => {
  it('未授权时拒绝且不触碰宿主', () => {
    const { host, service } = rig([])
    const res = service.connect('mod-a', 'vts', { url: VTS })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toContain('external-websocket')
    expect(host.connectCalls, '权限不足时不得建立任何 socket').toBe(0)
    expect(service.diagnostics().rejected).toBe(1)
  })

  it('授权后建立连接并交给宿主', () => {
    const { host, service } = rig()
    const res = service.connect('mod-a', 'vts', { url: VTS })
    expect(res.ok).toBe(true)
    expect(host.connectCalls).toBe(1)
    expect(service.status('mod-a', 'vts')?.state).toBe('connecting')
  })

  it('撤销后再次连接立即被拒（连接时检查，无缓存）', () => {
    const { permissions, service } = rig()
    expect(service.connect('mod-a', 'vts', { url: VTS }).ok).toBe(true)
    permissions.revoke('mod-a', 'external-websocket')
    expect(service.connect('mod-a', 'vts2', { url: VTS }).ok).toBe(false)
  })
})

/* ---------- 3. 回环拒绝与计数 ---------- */

describe('非回环目标被拒', () => {
  it('拒绝并计入 rejected / lastRejection，且不触碰宿主', () => {
    const { host, service } = rig()
    const res = service.connect('mod-a', 'bad', { url: 'ws://evil.example.com:8001' })
    expect(res.ok).toBe(false)
    expect(host.connectCalls).toBe(0)
    const d = service.diagnostics()
    expect(d.rejected).toBe(1)
    expect(d.lastRejection ?? '').toContain('loopback')
  })
})

/* ---------- 4. 归属与重复 id ---------- */

describe('归属 ${moduleId}:${id}', () => {
  it('同模块重复 id 失败（不 upsert）', () => {
    const { service } = rig()
    expect(service.connect('mod-a', 'vts', { url: VTS }).ok).toBe(true)
    const again = service.connect('mod-a', 'vts', { url: VTS })
    expect(again.ok).toBe(false)
    expect(again.errors.join(' ')).toContain('already')
  })

  it('不同模块可用同一个 id（命名空间不交叉）', () => {
    const { service } = rig()
    expect(service.connect('mod-a', 'vts', { url: VTS }).ok).toBe(true)
    expect(service.connect('mod-b', 'vts', { url: VTS }).ok).toBe(true)
    expect(service.list()).toHaveLength(2)
  })
})

/* ---------- 5. 生命周期 ---------- */

describe('生命周期与卸载清理', () => {
  it('removeModule 关闭该模块全部连接，其他模块不受影响', () => {
    const { host, service } = rig()
    service.connect('mod-a', 'c1', { url: VTS })
    service.connect('mod-a', 'c2', { url: VTS })
    service.connect('mod-b', 'c3', { url: VTS })
    expect(host.liveCount()).toBe(3)

    service.removeModule('mod-a')

    expect(host.liveCount(), 'A 的两条连接应被关闭').toBe(1)
    expect(service.list().map((s) => s.moduleId)).toEqual(['mod-b'])
    expect(service.status('mod-a', 'c1')).toBeNull()
  })

  it('close 只关一条且返回是否命中', () => {
    const { host, service } = rig()
    service.connect('mod-a', 'c1', { url: VTS })
    service.connect('mod-a', 'c2', { url: VTS })
    expect(service.close('mod-a', 'c1')).toBe(true)
    expect(service.close('mod-a', 'c1')).toBe(false)
    expect(host.liveCount()).toBe(1)
  })
})

/* ---------- 6. 状态机与 send ---------- */

describe('状态机与 send', () => {
  it('open 之前 send 失败；open 之后成功并计数', () => {
    const { host, service } = rig()
    service.connect('mod-a', 'vts', { url: VTS })
    expect(service.send('mod-a', 'vts', '{}'), '未 open 不得发送').toBe(false)

    host.openByUrl(VTS)
    expect(service.status('mod-a', 'vts')?.state).toBe('open')
    expect(service.send('mod-a', 'vts', '{"k":1}')).toBe(true)
    expect(host.sentByUrl(VTS)).toEqual(['{"k":1}'])
    expect(service.status('mod-a', 'vts')?.sent).toBe(1)
  })

  it('超长 payload 拒绝且不发给宿主', () => {
    const { host, service } = rig()
    service.connect('mod-a', 'vts', { url: VTS })
    host.openByUrl(VTS)
    const huge = 'x'.repeat(EXTERNAL_WS_MAX_PAYLOAD + 1)
    expect(service.send('mod-a', 'vts', huge)).toBe(false)
    expect(host.sentByUrl(VTS)).toEqual([])
  })

  it('宿主 send 失败时不计入 sent', () => {
    const { host, service } = rig()
    service.connect('mod-a', 'vts', { url: VTS })
    host.openByUrl(VTS)
    host.failSend = true
    expect(service.send('mod-a', 'vts', 'x')).toBe(false)
    expect(service.status('mod-a', 'vts')?.sent).toBe(0)
  })

  it('收到消息递增 received 并转发给模块回调', () => {
    const got: string[] = []
    const { host, service } = rig()
    service.connect('mod-a', 'vts', { url: VTS, onMessage: (d) => got.push(d) })
    host.openByUrl(VTS)
    host.messageByUrl(VTS, 'hello')
    expect(got).toEqual(['hello'])
    expect(service.status('mod-a', 'vts')?.received).toBe(1)
  })

  it('宿主 close 后状态转为 closed 且不再可发送', () => {
    const { host, service } = rig()
    const closed: string[] = []
    service.connect('mod-a', 'vts', { url: VTS, onClose: (d) => closed.push(d) })
    host.openByUrl(VTS)
    host.closeByUrl(VTS)
    expect(service.status('mod-a', 'vts')?.state).toBe('closed')
    expect(closed).toEqual(['closed'])
    expect(service.send('mod-a', 'vts', 'x')).toBe(false)
  })

  it('宿主 connect 返回 null → 失败且不留半成品记录', () => {
    const host = new FakeHost()
    host.failConnect = true
    const service = createExternalWs({
      logger: testLogger(),
      permissions: fakePermissions(['external-websocket']),
      host
    })
    const res = service.connect('mod-a', 'vts', { url: VTS })
    expect(res.ok).toBe(false)
    expect(service.status('mod-a', 'vts')).toBeNull()
    expect(service.list()).toHaveLength(0)
  })

  it('宿主在 connect 内同步回调 onOpen 时，最终状态仍为 open（顺序健壮性）', () => {
    const host = new FakeHost()
    host.syncOpen = true
    const service = createExternalWs({
      logger: testLogger(),
      permissions: fakePermissions(['external-websocket']),
      host
    })
    expect(service.connect('mod-a', 'vts', { url: VTS }).ok).toBe(true)
    expect(service.status('mod-a', 'vts')?.state, '同步 onOpen 不得被后续赋值覆盖').toBe('open')
    expect(service.send('mod-a', 'vts', 'early')).toBe(true)
  })
})

/* ---------- 7. 回调隔离 ---------- */

describe('回调隔离：模块抛错不影响服务', () => {
  it('onMessage / onOpen / onClose 抛错都被吞掉，服务与其他连接照常', () => {
    // 两条连接用**不同 URL**，才能用 URL 驱动分别命中（同 URL 会被一起关掉，测不出隔离）
    const VTS2 = 'ws://127.0.0.1:8002'
    const { host, service } = rig()
    service.connect('mod-a', 'boom', {
      url: VTS,
      onOpen: () => {
        throw new Error('module onOpen exploded')
      },
      onMessage: () => {
        throw new Error('module onMessage exploded')
      },
      onClose: () => {
        throw new Error('module onClose exploded')
      }
    })
    service.connect('mod-b', 'ok', { url: VTS2 })

    expect(() => host.openByUrl(VTS)).not.toThrow()
    expect(() => host.messageByUrl(VTS, 'x')).not.toThrow()
    expect(() => host.closeByUrl(VTS)).not.toThrow()

    expect(service.status('mod-a', 'boom')?.state).toBe('closed')

    host.openByUrl(VTS2)
    expect(service.status('mod-b', 'ok')?.state, '另一条连接必须不受影响').toBe('open')
    expect(service.send('mod-b', 'ok', 'still-alive')).toBe(true)
  })
})

/* ---------- 8. 状态快照与脱敏 ---------- */

describe('状态快照与脱敏', () => {
  it('status / list / diagnostics 中的 url 已剥离 query（token 不入日志）', () => {
    const { service } = rig()
    service.connect('mod-a', 'vts', { url: 'ws://127.0.0.1:8001/ws?token=SUPERSECRET' })
    const snap = JSON.stringify({ s: service.status('mod-a', 'vts'), l: service.list(), d: service.diagnostics() })
    expect(snap).not.toContain('SUPERSECRET')
    expect(service.status('mod-a', 'vts')?.url).toBe('ws://127.0.0.1:8001/ws')
  })

  it('diagnostics 汇总 open 数与 byModule 分组', () => {
    const { host, service } = rig()
    service.connect('mod-a', 'c1', { url: VTS })
    service.connect('mod-a', 'c2', { url: VTS })
    service.connect('mod-b', 'c3', { url: VTS })
    host.openByUrl(VTS)

    const d = service.diagnostics()
    expect(d.open).toBe(3)
    expect(d.byModule).toEqual([
      { moduleId: 'mod-a', ids: ['c1', 'c2'] },
      { moduleId: 'mod-b', ids: ['c3'] }
    ])
  })

  it('宿主报错写入 lastError 且可查询', () => {
    const { host, service } = rig()
    service.connect('mod-a', 'vts', { url: VTS })
    for (const c of host.byHandle.values()) c.hooks.onError('ECONNREFUSED')
    expect(service.status('mod-a', 'vts')?.lastError).toContain('ECONNREFUSED')
  })
})
