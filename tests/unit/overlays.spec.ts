import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import type { IPermission } from '@contracts/permission'
import type {
  OverlayBounds,
  OverlayHostHooks,
  OverlayScreen,
  OverlayWindowHost,
  OverlayWindowSpec
} from '@contracts/overlays'
import { createOverlayWindows } from '../../src/main/core/overlay-windows'

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

interface FakeWindow {
  spec: OverlayWindowSpec
  hooks: OverlayHostHooks
  bounds: OverlayBounds
  clickThrough: boolean
  alwaysOnTop: boolean
}

/** 受控宿主：windows 按 handle 记录；failCreate 模拟创建失败。 */
class FakeHost implements OverlayWindowHost {
  byHandle = new Map<object, FakeWindow>()
  failCreate = false
  screens(): OverlayScreen[] {
    return [
      { id: 'p1', primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 'p2', primary: false, bounds: { x: 1920, y: 0, width: 1080, height: 1920 } }
    ]
  }
  create(spec: OverlayWindowSpec, hooks: OverlayHostHooks): object | null {
    if (this.failCreate) return null
    const rec: FakeWindow = {
      spec,
      hooks,
      bounds: spec.bounds ?? { x: 760, y: 420, width: 400, height: 280 },
      clickThrough: spec.clickThrough ?? false,
      alwaysOnTop: spec.alwaysOnTop ?? true
    }
    const handle = { h: this.byHandle.size }
    this.byHandle.set(handle, rec)
    return handle
  }
  destroy(handle: object): void {
    this.byHandle.delete(handle)
  }
  setClickThrough(handle: object, on: boolean): void {
    const rec = this.byHandle.get(handle)
    if (rec) rec.clickThrough = on
  }
  setAlwaysOnTop(handle: object, on: boolean): void {
    const rec = this.byHandle.get(handle)
    if (rec) rec.alwaysOnTop = on
  }
  setBounds(handle: object, bounds: OverlayBounds): void {
    const rec = this.byHandle.get(handle)
    if (rec) rec.bounds = bounds
  }
  getBounds(handle: object): OverlayBounds {
    const rec = this.byHandle.get(handle)
    if (!rec) throw new Error('no such window')
    return rec.bounds
  }
  win(moduleId: string, id: string): FakeWindow | undefined {
    for (const rec of this.byHandle.values()) {
      if (rec.spec.url.includes(moduleId) && rec.spec.url.includes(id)) return rec
    }
    return undefined
  }
}

/** 受控权限服务：granted 集合决定 window-overlay 门禁。 */
function fakePermissions(granted: Set<string>): IPermission {
  return {
    check: (moduleId: string, permission: string) =>
      permission === 'window-overlay' && granted.has(moduleId)
  } as unknown as IPermission
}

function makeRig(): {
  host: FakeHost
  overlays: ReturnType<typeof createOverlayWindows>
  granted: Set<string>
} {
  const granted = new Set<string>()
  const host = new FakeHost()
  const overlays = createOverlayWindows({ logger: testLogger(), permissions: fakePermissions(granted), host })
  return { host, overlays, granted }
}

const URL_A = 'http://127.0.0.1:23334/float-a?token=t'
const URL_B = 'http://127.0.0.1:23334/float-b?token=t'

/* ---------- 注册与默认值 ---------- */

describe('注册与默认值', () => {
  it('create 全链路：host 收到规格默认值、list/status 可见、bounds 回填', () => {
    const { host, overlays, granted } = makeRig()
    granted.add('mod-a')
    const result = overlays.create('mod-a', 'panel', { url: URL_A })
    expect(result).toEqual({ ok: true, errors: [] })
    expect(host.byHandle.size).toBe(1)
    const spec = [...host.byHandle.values()][0]!.spec
    expect(spec.transparent).toBe(true)
    expect(spec.alwaysOnTop).toBe(true)
    expect(spec.skipTaskbar).toBe(true)
    expect(spec.focusable).toBe(true)
    expect(spec.resizable).toBe(true)
    expect(spec.clickThrough).toBe(false)
    expect(spec.minSize).toEqual({ width: 200, height: 120 })

    const list = overlays.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      moduleId: 'mod-a',
      id: 'panel',
      url: URL_A,
      transparent: true,
      alwaysOnTop: true,
      clickThrough: false,
      focusable: true,
      resizable: true,
      createdAt: expect.any(Number)
    })
    // 未显式给 bounds → host 定位结果回填（fake 主屏居中）
    expect(list[0].bounds).toEqual({ x: 760, y: 420, width: 400, height: 280 })
  })

  it('参数校验：空 moduleId/id/url、非法回调 → 显式失败', () => {
    const { overlays, granted } = makeRig()
    granted.add('mod-a')
    expect(overlays.create('', 'panel', { url: URL_A }).ok).toBe(false)
    expect(overlays.create('mod-a', '', { url: URL_A }).ok).toBe(false)
    expect(overlays.create('mod-a', 'panel', { url: '' }).ok).toBe(false)
    expect(
      overlays.create('mod-a', 'panel', { url: URL_A, onClosed: 1 as unknown as () => void }).ok
    ).toBe(false)
    expect(overlays.list()).toEqual([])
  })

  it('create 时权限未授予 → 失败且不入表', () => {
    const { overlays } = makeRig()
    const result = overlays.create('mod-a', 'panel', { url: URL_A })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('window-overlay')
    expect(overlays.list()).toEqual([])
  })

  it('重复 create 同 id → 失败（先 destroy 再建）', () => {
    const { overlays, granted } = makeRig()
    granted.add('mod-a')
    expect(overlays.create('mod-a', 'panel', { url: URL_A }).ok).toBe(true)
    const again = overlays.create('mod-a', 'panel', { url: URL_A })
    expect(again.ok).toBe(false)
    expect(again.errors[0]).toContain('already exists')
  })

  it('bounds 钳制：负偏移拉回屏内、超 minSize 兜底、完全离屏回落主屏', () => {
    const { host, overlays, granted } = makeRig()
    granted.add('mod-a')
    // 负偏移 + 小于 minSize → 修正为 {0,0,200,120}
    expect(
      overlays.create('mod-a', 'a', { url: URL_A, bounds: { x: -100, y: -50, width: 100, height: 80 } }).ok
    ).toBe(true)
    expect(host.byHandle.size).toBe(1)
    expect([...host.byHandle.values()][0]!.bounds).toEqual({ x: 0, y: 0, width: 200, height: 120 })

    // 完全离屏 → 回落主屏并贴边
    expect(
      overlays.create('mod-a', 'b', { url: URL_B, bounds: { x: 5000, y: 5000, width: 300, height: 200 } }).ok
    ).toBe(true)
    expect(overlays.list().find((w) => w.id === 'b')?.bounds).toEqual({ x: 1620, y: 880, width: 300, height: 200 })
  })

  it('host 创建失败 → 显式失败不入表', () => {
    const { host, overlays, granted } = makeRig()
    granted.add('mod-a')
    host.failCreate = true
    const result = overlays.create('mod-a', 'panel', { url: URL_A })
    expect(result.ok).toBe(false)
    expect(overlays.list()).toEqual([])
  })
})

/* ---------- 所有权与操作 ---------- */

describe('所有权与操作', () => {
  it('destroy：自己的 true 并销毁 host 窗口；他人/未知/重复 → false', () => {
    const { host, overlays, granted } = makeRig()
    granted.add('mod-a')
    granted.add('mod-b')
    expect(overlays.create('mod-a', 'panel', { url: URL_A }).ok).toBe(true)

    expect(overlays.destroy('mod-b', 'panel')).toBe(false)
    expect(overlays.destroy('mod-a', 'ghost')).toBe(false)
    expect(overlays.destroy('mod-a', 'panel')).toBe(true)
    expect(host.byHandle.size).toBe(0)
    expect(overlays.destroy('mod-a', 'panel')).toBe(false)
  })

  it('setClickThrough/setAlwaysOnTop/setBounds 路由到 host；setBounds 同样钳制', () => {
    const { host, overlays, granted } = makeRig()
    granted.add('mod-a')
    expect(overlays.create('mod-a', 'panel', { url: URL_A }).ok).toBe(true)

    expect(overlays.setClickThrough('mod-a', 'panel', true)).toBe(true)
    const rec = [...host.byHandle.values()][0]!
    expect(rec.clickThrough).toBe(true)
    expect(overlays.list()[0].clickThrough).toBe(true)

    expect(overlays.setAlwaysOnTop('mod-a', 'panel', false)).toBe(true)
    expect(rec.alwaysOnTop).toBe(false)

    expect(overlays.setBounds('mod-a', 'panel', { x: -500, y: -500, width: 320, height: 200 })).toBe(true)
    expect(rec.bounds).toEqual({ x: 0, y: 0, width: 320, height: 200 })
    expect(overlays.getBounds('mod-a', 'panel')).toEqual({ x: 0, y: 0, width: 320, height: 200 })

    // 他人操作 → false
    expect(overlays.setClickThrough('mod-b', 'panel', false)).toBe(false)
    expect(overlays.setBounds('mod-b', 'panel', { x: 0, y: 0, width: 100, height: 100 })).toBe(false)
    expect(overlays.getBounds('mod-b', 'panel')).toBeNull()
  })

  it('screens 透传 host 显示器清单', () => {
    const { overlays } = makeRig()
    const screens = overlays.screens()
    expect(screens).toHaveLength(2)
    expect(screens[0]).toMatchObject({ id: 'p1', primary: true })
    expect(screens[1].bounds).toEqual({ x: 1920, y: 0, width: 1080, height: 1920 })
  })
})

/* ---------- 回调分发与隔离 ---------- */

describe('回调分发与隔离', () => {
  function rigWithEvents() {
    const { host, overlays, granted } = makeRig()
    granted.add('mod-a')
    const events: string[] = []
    const lastBounds: OverlayBounds[] = []
    expect(
      overlays.create('mod-a', 'panel', {
        url: URL_A,
        onClosed: () => {
          events.push('closed')
        },
        onCrashed: (detail) => {
          events.push(`crashed:${detail}`)
        },
        onMoved: (b) => {
          events.push('moved')
          lastBounds.push(b)
        },
        onResized: (b) => {
          events.push('resized')
          lastBounds.push(b)
        }
      }).ok
    ).toBe(true)
    const handle = [...host.byHandle.keys()][0]!
    return { host, overlays, events, lastBounds, handle }
  }

  it('onMoved/onResized 携 bounds 分发并更新 status', () => {
    const { host, overlays, events, lastBounds } = rigWithEvents()
    const rec = [...host.byHandle.values()][0]!
    const b: OverlayBounds = { x: 12, y: 34, width: 420, height: 260 }
    rec.hooks.onMoved(b)
    rec.hooks.onResized({ ...b, width: 500 })
    expect(events).toEqual(['moved', 'resized'])
    expect(lastBounds).toEqual([b, { ...b, width: 500 }])
    expect(overlays.list()[0].bounds).toEqual({ x: 12, y: 34, width: 500, height: 260 })
  })

  it('onClosed 后出表、后续操作 false；回调只发一次', () => {
    const { host, overlays, events } = rigWithEvents()
    const rec = [...host.byHandle.values()][0]!
    rec.hooks.onClosed()
    rec.hooks.onClosed() // 二次（host 抖动）不应重复分发
    expect(events).toEqual(['closed'])
    expect(overlays.list()).toEqual([])
    expect(overlays.setClickThrough('mod-a', 'panel', true)).toBe(false)
    expect(overlays.destroy('mod-a', 'panel')).toBe(false)
  })

  it('onCrashed：上报 + 出表 + host 窗口销毁', () => {
    const { host, overlays, events } = rigWithEvents()
    const rec = [...host.byHandle.values()][0]!
    rec.hooks.onCrashed('oom')
    expect(events).toEqual(['crashed:oom'])
    expect(overlays.list()).toEqual([])
    expect(host.byHandle.size).toBe(0)
  })

  it('回调抛错隔离：不影响服务与他人', () => {
    const { host, overlays, granted } = makeRig()
    granted.add('mod-a')
    granted.add('mod-b')
    let bClosed = 0
    expect(
      overlays.create('mod-a', 'bad', {
        url: URL_A,
        onClosed: () => {
          throw new Error('kaboom')
        }
      }).ok
    ).toBe(true)
    expect(
      overlays.create('mod-b', 'good', {
        url: URL_B,
        onClosed: () => {
          bClosed += 1
        }
      }).ok
    ).toBe(true)

    const handles = [...host.byHandle.entries()]
    const bad = handles.find(([, rec]) => rec.spec.url === URL_A)![0]
    const good = handles.find(([, rec]) => rec.spec.url === URL_B)![0]
    expect(() => host.byHandle.get(bad)!.hooks.onClosed()).not.toThrow()
    host.byHandle.get(good)!.hooks.onClosed()
    expect(bClosed).toBe(1)
    expect(overlays.list()).toEqual([])
  })
})

/* ---------- removeModule 与诊断 ---------- */

describe('removeModule 与诊断', () => {
  it('removeModule：该模块全部销毁、回调不再分发，他人不受影响', () => {
    const { host, overlays, granted } = makeRig()
    granted.add('mod-a')
    granted.add('mod-b')
    let aMoved = 0
    let bMoved = 0
    overlays.create('mod-a', 'x', { url: URL_A, onMoved: () => { aMoved += 1 } })
    overlays.create('mod-a', 'y', { url: `${URL_A}&v=2`, onMoved: () => { aMoved += 1 } })
    overlays.create('mod-b', 'z', { url: URL_B, onMoved: () => { bMoved += 1 } })

    overlays.removeModule('mod-a')
    expect(overlays.list().map((w) => w.moduleId)).toEqual(['mod-b'])
    expect(host.byHandle.size).toBe(1)

    for (const rec of host.byHandle.values()) {
      if (rec.spec.url === URL_B) rec.hooks.onMoved({ x: 0, y: 0, width: 10, height: 10 })
    }
    expect(aMoved).toBe(0)
    expect(bMoved).toBe(1)
  })

  it('diagnostics：open 计数、byModule 分组、clickThroughCount', () => {
    const { overlays, granted } = makeRig()
    granted.add('mod-a')
    granted.add('mod-b')
    expect(overlays.create('mod-a', 'a', { url: URL_A }).ok).toBe(true)
    expect(overlays.create('mod-a', 'b', { url: `${URL_A}&v=2` }).ok).toBe(true)
    expect(overlays.create('mod-b', 'c', { url: URL_B, clickThrough: true }).ok).toBe(true)

    const diag = overlays.diagnostics()
    expect(diag.open).toBe(3)
    expect(diag.byModule).toEqual([
      { moduleId: 'mod-a', ids: ['a', 'b'] },
      { moduleId: 'mod-b', ids: ['c'] }
    ])
    expect(diag.clickThroughCount).toBe(1)
  })
})
