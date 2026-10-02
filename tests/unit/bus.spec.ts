import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import { createEventBus } from '../../src/main/core/bus'

/* ---------- 测试辅助 ---------- */

function testLogger() {
  const errors: string[] = []
  const make = (source: string): ILogger => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (m) => { errors.push(`${source}: ${m}`) },
    child: (s) => make(s),
    setLevel: () => {}
  })
  return { logger: make('root'), errors }
}

/* ---------- 事件格式 ---------- */

describe('事件格式', () => {
  it('标准信封：type/source/time/version；payload 未传时字段不存在；clock 可注入', () => {
    const bus = createEventBus({ logger: testLogger().logger, clock: () => 123456 })
    const e1 = bus.publish('test:a')
    expect(e1).toEqual({ type: 'test:a', source: 'core', time: 123456, version: 1 })
    expect('payload' in e1).toBe(false)

    const e2 = bus.publish<{ x: number }>('test:b', { x: 1 }, { source: 'moduleA', version: 2 })
    expect(e2.source).toBe('moduleA')
    expect(e2.version).toBe(2)
    expect(e2.payload).toEqual({ x: 1 })
  })

  it('无订阅者时 publish 正常返回（纯路由不报错）', () => {
    const bus = createEventBus({ logger: testLogger().logger })
    const e = bus.publish('nobody:cares', { a: 1 })
    expect(e.type).toBe('nobody:cares')
  })

  it('userId：bus 级默认注入，单次发布可覆盖；未配置时匿名（字段缺省）', () => {
    const bus = createEventBus({ logger: testLogger().logger, userId: 'machine-1' })
    expect(bus.publish('x').userId).toBe('machine-1')
    expect(bus.publish('x', undefined, { userId: 'override' }).userId).toBe('override')
    const anonymous = createEventBus({ logger: testLogger().logger })
    expect(anonymous.publish('x').userId).toBeUndefined()
  })
})

/* ---------- 同步订阅 ---------- */

describe('同步订阅', () => {
  it('publish 返回前 handler 已执行；多订阅者按注册顺序', () => {
    const bus = createEventBus({ logger: testLogger().logger })
    const order: string[] = []
    bus.subscribe('x', () => order.push('a'))
    bus.subscribe('x', () => order.push('b'))
    bus.publish('x')
    expect(order).toEqual(['a', 'b'])
  })

  it('同一函数重复订阅按一次处理；退订后不再收到', () => {
    const bus = createEventBus({ logger: testLogger().logger })
    let count = 0
    const bump = (): void => { count += 1 }
    const off = bus.subscribe('x', bump)
    bus.subscribe('x', bump)
    bus.publish('x')
    expect(count).toBe(1)
    off()
    bus.publish('x')
    expect(count).toBe(1)
    // 再次退订安全
    expect(() => off()).not.toThrow()
  })

  it('handler 抛错：不影响其余订阅者、不向发布者抛、错误被记录', () => {
    const { logger, errors } = testLogger()
    const bus = createEventBus({ logger })
    const seen: number[] = []
    bus.subscribe('x', () => { throw new Error('boom') })
    bus.subscribe('x', () => seen.push(1))
    expect(() => bus.publish('x')).not.toThrow()
    expect(seen).toEqual([1])
    expect(errors.join('\n')).toContain('event handler threw')
  })

  it('派发期间的订阅/退订不影响本轮（快照语义）', () => {
    const bus = createEventBus({ logger: testLogger().logger })
    const seen: string[] = []
    let added = false
    bus.subscribe('x', () => {
      if (!added) {
        added = true
        bus.subscribe('x', () => seen.push('late'))
      }
      seen.push('first')
    })
    bus.publish('x')
    expect(seen).toEqual(['first'])
    bus.publish('x')
    expect(seen).toEqual(['first', 'first', 'late'])
  })
})

/* ---------- once ---------- */

describe('once', () => {
  it('只触发一次；多个 once 各自一次', () => {
    const bus = createEventBus({ logger: testLogger().logger })
    let a = 0
    let b = 0
    bus.once('x', () => { a += 1 })
    bus.once('x', () => { b += 1 })
    bus.publish('x')
    bus.publish('x')
    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  it('once 触发前可退订', () => {
    const bus = createEventBus({ logger: testLogger().logger })
    let c = 0
    const off = bus.once('y', () => { c += 1 })
    off()
    bus.publish('y')
    expect(c).toBe(0)
  })

  it('once 的 handler 抛错也只消耗一次', () => {
    const { logger } = testLogger()
    const bus = createEventBus({ logger })
    let calls = 0
    bus.once('z', () => { calls += 1; throw new Error('boom') })
    expect(() => bus.publish('z')).not.toThrow()
    bus.publish('z')
    expect(calls).toBe(1)
  })
})

/* ---------- 异步派发 ---------- */

describe('异步派发', () => {
  it('publishAsync：调用后未派发，await 后已派发；连续两次保持 FIFO 顺序', async () => {
    const bus = createEventBus({ logger: testLogger().logger })
    const sources: string[] = []
    bus.subscribe('a', (e) => sources.push(e.source))
    const p1 = bus.publishAsync('a', undefined, { source: 's1' })
    const p2 = bus.publishAsync('a', undefined, { source: 's2' })
    expect(sources).toEqual([]) // 微任务尚未执行
    await p1
    await p2
    expect(sources).toEqual(['s1', 's2'])
  })

  it('异步派发的 handler 抛错同样隔离', async () => {
    const { logger } = testLogger()
    const bus = createEventBus({ logger })
    const seen: number[] = []
    bus.subscribe('a', () => { throw new Error('boom') })
    bus.subscribe('a', () => seen.push(1))
    await bus.publishAsync('a')
    expect(seen).toEqual([1])
  })
})
