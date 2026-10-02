import { describe, expect, it } from 'vitest'
import { createSettledReporter } from '../../src/renderer/src/slots/report-rect'

/**
 * 落定补报器守卫（T47）。
 *
 * 钉四件事：
 * ① poke 后**先同步试一次**（矩形已稳定时不引入额外帧延迟）；
 * ② 首次未上报 ⇒ 逐帧重试直到成功（单次补报被一致性检查吞掉 = 视图停在错误矩形的事故根源）；
 * ③ 超过 maxFrames 放弃（防御死循环）；
 * ④ cancel 后不再重试、poke 也不再响应（组件卸载语义）。
 *
 * 计时器全部注入（rAF 队列手动推进），单测不依赖 DOM。
 */

/** 手动推进的 rAF 队列。 */
function fakeRaf(): { raf: (cb: () => void) => number; caf: (id: number) => void; flush: (n?: number) => void; pending: () => number } {
  let nextId = 1
  const queue = new Map<number, () => void>()
  return {
    raf: (cb) => {
      const id = nextId++
      queue.set(id, cb)
      return id
    },
    caf: (id) => {
      queue.delete(id)
    },
    flush: (n = 1) => {
      for (let i = 0; i < n; i++) {
        const cbs = [...queue.values()]
        queue.clear()
        for (const cb of cbs) cb()
      }
    },
    pending: () => queue.size
  }
}

describe('落定补报器（T47）', () => {
  it('① poke 先同步尝试：一次成功则不排帧', () => {
    const f = fakeRaf()
    let calls = 0
    const s = createSettledReporter(() => {
      calls++
      return true
    }, f)
    s.poke()
    expect(calls).toBe(1)
    expect(f.pending(), '成功时不应排 rAF').toBe(0)
  })

  it('② 前两次未上报 ⇒ 逐帧重试，第三次成功后停止', () => {
    const f = fakeRaf()
    let calls = 0
    const s = createSettledReporter(() => {
      calls++
      return calls >= 3 // 第 1、2 次被"动画中"吞掉，第 3 次成功
    }, f)
    s.poke() // 第 1 次（同步）
    expect(calls).toBe(1)
    f.flush() // 第 2 次
    expect(calls).toBe(2)
    expect(f.pending(), '未成功必须继续排帧').toBe(1)
    f.flush() // 第 3 次
    expect(calls).toBe(3)
    expect(f.pending(), '成功后不再排帧').toBe(0)
    f.flush(5) // 多推几帧也不应再有调用
    expect(calls).toBe(3)
  })

  it('③ 一直失败 ⇒ 到达 maxFrames 后放弃', () => {
    const f = fakeRaf()
    let calls = 0
    const s = createSettledReporter(
      () => {
        calls++
        return false
      },
      { ...f, maxFrames: 4 }
    )
    s.poke() // attempt 1（同步）
    f.flush(10) // 推再多帧也不应超过上限
    expect(calls).toBe(4)
    expect(f.pending()).toBe(0)
  })

  it('④ cancel：进行中的重试停止；之后 poke 不再响应', () => {
    const f = fakeRaf()
    let calls = 0
    const s = createSettledReporter(() => {
      calls++
      return false
    }, f)
    s.poke()
    expect(f.pending()).toBe(1)
    s.cancel()
    expect(f.pending(), 'cancel 必须撤掉待执行帧').toBe(0)
    f.flush(3)
    expect(calls).toBe(1)
    s.poke() // 已取消：不再响应
    expect(calls).toBe(1)
  })

  it('⑤ 重复 poke：撤掉上一次未完成的重试，重新计帧', () => {
    const f = fakeRaf()
    let calls = 0
    const s = createSettledReporter(() => {
      calls++
      return calls >= 2
    }, f)
    s.poke() // 第 1 次失败，排了一帧
    expect(f.pending()).toBe(1)
    s.poke() // 再次 poke：撤掉旧帧、同步再试 ⇒ 第 2 次成功
    expect(calls).toBe(2)
    expect(f.pending(), '成功后无残留帧').toBe(0)
    f.flush(3)
    expect(calls).toBe(2)
  })
})
