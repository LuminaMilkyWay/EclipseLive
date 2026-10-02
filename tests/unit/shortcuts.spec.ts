import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import type { IPermission } from '@contracts/permission'
import type { ShortcutHost } from '@contracts/shortcuts'
import { createShortcuts } from '../../src/main/core/shortcuts'

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

/** 受控宿主：failAccelerators 中的键模拟系统/他应用占用。 */
class FakeHost implements ShortcutHost {
  registrations = new Map<string, () => void>()
  failAccelerators = new Set<string>()
  register(accelerator: string, onPress: () => void): boolean {
    if (this.failAccelerators.has(accelerator)) return false
    this.registrations.set(accelerator, onPress)
    return true
  }
  unregister(accelerator: string): void {
    this.registrations.delete(accelerator)
  }
  press(accelerator: string): void {
    this.registrations.get(accelerator)?.()
  }
}

/** 受控权限服务：granted 集合决定 global-shortcut 门禁。 */
function fakePermissions(granted: Set<string>): IPermission {
  return {
    check: (moduleId: string, permission: string) =>
      permission === 'global-shortcut' && granted.has(moduleId)
  } as unknown as IPermission
}

function makeRig(): { host: FakeHost; shortcuts: ReturnType<typeof createShortcuts>; granted: Set<string> } {
  const granted = new Set<string>()
  const host = new FakeHost()
  const shortcuts = createShortcuts({ logger: testLogger(), permissions: fakePermissions(granted), host })
  return { host, shortcuts, granted }
}

const A = 'CommandOrControl+Shift+P'
const B = 'CommandOrControl+Alt+K'
const X = 'CommandOrControl+F9'

/* ---------- 注册与触发 ---------- */

describe('注册与触发', () => {
  it('register 全链路：host 注册、list 可见、触发分发 handler', () => {
    const { host, shortcuts, granted } = makeRig()
    granted.add('mod-a')
    let fired = 0
    const result = shortcuts.register('mod-a', 'send', A, () => {
      fired += 1
    })
    expect(result).toEqual({ ok: true, errors: [] })
    expect(host.registrations.has(A)).toBe(true)
    expect(shortcuts.list()).toEqual([
      { moduleId: 'mod-a', id: 'send', accelerator: A, registeredAt: expect.any(Number) }
    ])
    host.press(A)
    expect(fired).toBe(1)
  })

  it('参数校验：空 moduleId / 空 id / 空 accelerator / 非函数 handler → 显式失败', () => {
    const { shortcuts, granted } = makeRig()
    granted.add('mod-a')
    expect(shortcuts.register('', 'send', A, () => {}).ok).toBe(false)
    expect(shortcuts.register('mod-a', '', A, () => {}).ok).toBe(false)
    expect(shortcuts.register('mod-a', 'send', '', () => {}).ok).toBe(false)
    expect(shortcuts.register('mod-a', 'send', A, undefined as unknown as () => {}).ok).toBe(false)
    expect(shortcuts.list()).toEqual([])
  })

  it('upsert：同 id 换 accelerator，旧键注销、新键生效', () => {
    const { host, shortcuts, granted } = makeRig()
    granted.add('mod-a')
    let old = 0
    let next = 0
    expect(shortcuts.register('mod-a', 'send', A, () => { old += 1 }).ok).toBe(true)
    expect(shortcuts.register('mod-a', 'send', B, () => { next += 1 }).ok).toBe(true)

    expect(host.registrations.has(A)).toBe(false)
    expect(host.registrations.has(B)).toBe(true)
    expect(shortcuts.list()[0]?.accelerator).toBe(B)
    host.press(A)
    host.press(B)
    expect(old).toBe(0)
    expect(next).toBe(1)
  })

  it('upsert 同 accelerator：仅替换 handler，注册不中断', () => {
    const { host, shortcuts, granted } = makeRig()
    granted.add('mod-a')
    let first = 0
    let second = 0
    expect(shortcuts.register('mod-a', 'send', A, () => { first += 1 }).ok).toBe(true)
    expect(shortcuts.register('mod-a', 'send', A, () => { second += 1 }).ok).toBe(true)

    expect(host.registrations.size).toBe(1)
    host.press(A)
    expect(first).toBe(0)
    expect(second).toBe(1)
  })

  it('upsert 新键注册失败：旧条目原样保留（无中间态）', () => {
    const { host, shortcuts, granted } = makeRig()
    granted.add('mod-a')
    let old = 0
    expect(shortcuts.register('mod-a', 'send', A, () => { old += 1 }).ok).toBe(true)

    host.failAccelerators.add(B)
    const result = shortcuts.register('mod-a', 'send', B, () => {})
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('unavailable')
    expect(shortcuts.list()[0]?.accelerator).toBe(A)
    host.press(A)
    expect(old).toBe(1)
  })
})

/* ---------- 冲突与占用 ---------- */

describe('冲突与占用', () => {
  it('跨模块同 accelerator：后注册方失败、冲突环记录、先注册方不受影响', () => {
    const { host, shortcuts, granted } = makeRig()
    granted.add('mod-a')
    granted.add('mod-b')
    let aFired = 0
    let bFired = 0
    expect(shortcuts.register('mod-a', 'send', X, () => { aFired += 1 }).ok).toBe(true)

    const result = shortcuts.register('mod-b', 'send', X, () => { bFired += 1 })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('conflict')
    expect(result.errors[0]).toContain('mod-a')

    host.press(X)
    expect(aFired).toBe(1)
    expect(bFired).toBe(0)

    const conflicts = shortcuts.diagnostics().conflicts
    expect(conflicts).toEqual([
      expect.objectContaining({ moduleId: 'mod-b', id: 'send', accelerator: X, heldBy: 'mod-a' })
    ])
  })

  it('系统占用：host 注册失败 → 显式失败、不入 list、环记录 heldBy=system', () => {
    const { host, shortcuts, granted } = makeRig()
    granted.add('mod-a')
    host.failAccelerators.add(X)

    const result = shortcuts.register('mod-a', 'send', X, () => {})
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('unavailable')
    expect(shortcuts.list()).toEqual([])
    expect(shortcuts.diagnostics().conflicts[0]).toEqual(
      expect.objectContaining({ moduleId: 'mod-a', accelerator: X, heldBy: 'system' })
    )
  })
})

/* ---------- 权限门禁 ---------- */

describe('权限门禁', () => {
  it('注册时权限未授予 → 失败且不入 list', () => {
    const { shortcuts } = makeRig()
    const result = shortcuts.register('mod-a', 'send', A, () => {})
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('global-shortcut')
    expect(shortcuts.list()).toEqual([])
  })

  it('触发时权限已撤销：handler 不触发且条目自动反注册（撤销即时生效）', () => {
    const { host, shortcuts, granted } = makeRig()
    granted.add('mod-a')
    let fired = 0
    expect(shortcuts.register('mod-a', 'send', A, () => { fired += 1 }).ok).toBe(true)

    granted.delete('mod-a')
    host.press(A)
    expect(fired).toBe(0)
    expect(shortcuts.list()).toEqual([])
    expect(host.registrations.has(A)).toBe(false)
  })
})

/* ---------- 注销与隔离 ---------- */

describe('注销与隔离', () => {
  it('unregister：自己的 true 并释放 host；他人/未知 id → false', () => {
    const { host, shortcuts, granted } = makeRig()
    granted.add('mod-a')
    expect(shortcuts.register('mod-a', 'send', A, () => {}).ok).toBe(true)

    expect(shortcuts.unregister('mod-b', 'send')).toBe(false)
    expect(shortcuts.unregister('mod-a', 'send')).toBe(true)
    expect(host.registrations.has(A)).toBe(false)
    expect(shortcuts.unregister('mod-a', 'send')).toBe(false)
  })

  it('removeModule：该模块全部反注册、触发不再分发，他人不受影响', () => {
    const { host, shortcuts, granted } = makeRig()
    granted.add('mod-a')
    granted.add('mod-b')
    let aFired = 0
    let bFired = 0
    shortcuts.register('mod-a', 'one', A, () => { aFired += 1 })
    shortcuts.register('mod-a', 'two', B, () => { aFired += 1 })
    shortcuts.register('mod-b', 'send', X, () => { bFired += 1 })

    shortcuts.removeModule('mod-a')
    expect(shortcuts.list().map((r) => r.moduleId)).toEqual(['mod-b'])
    host.press(A)
    host.press(B)
    host.press(X)
    expect(aFired).toBe(0)
    expect(bFired).toBe(1)
  })

  it('handler 抛错：不影响其它快捷键与后续触发', () => {
    const { host, shortcuts, granted } = makeRig()
    granted.add('mod-a')
    let clean = 0
    shortcuts.register('mod-a', 'bad', A, () => {
      throw new Error('kaboom')
    })
    shortcuts.register('mod-a', 'good', B, () => { clean += 1 })

    expect(() => host.press(A)).not.toThrow()
    host.press(B)
    expect(clean).toBe(1)
  })
})

/* ---------- 诊断 ---------- */

describe('诊断', () => {
  it('diagnostics：registered 计数、byModule 分组、冲突环上限 20', () => {
    const { shortcuts, granted } = makeRig()
    granted.add('mod-a')
    expect(shortcuts.register('mod-a', 'send', X, () => {}).ok).toBe(true)

    for (let i = 0; i < 25; i++) {
      const challenger = `challenger-${i}`
      granted.add(challenger)
      shortcuts.register(challenger, 'send', X, () => {})
    }

    const diag = shortcuts.diagnostics()
    expect(diag.registered).toBe(1)
    expect(diag.byModule).toEqual([{ moduleId: 'mod-a', ids: ['send'] }])
    expect(diag.conflicts.length).toBe(20)
    expect(diag.conflicts[diag.conflicts.length - 1]).toEqual(
      expect.objectContaining({ moduleId: 'challenger-24', heldBy: 'mod-a' })
    )
  })
})
