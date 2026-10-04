import { describe, expect, it } from 'vitest'
import { computeSlotReport } from '../../src/renderer/src/slots/report-rect'

/**
 * 槽位矩形上报守卫（回归现场来自运行实例日志）。
 *
 * 钉三件事：
 * ① **动画中的缩放盒不上报**（日志回归用例：rect.width 1846 vs offsetWidth 754 ⇒ null）；
 * ② 正常盒按壳内距内缩（工具槽 12px；模块页槽 0）；
 * ③ **一律夹取到窗口可视区** —— 用户可见症状"视图比窗口还大、盖住一切"从机制上不可能再发生。
 */
const VIEWPORT = { width: 1104, height: 681 }

describe('槽位矩形上报：让开被 DOM 覆盖层挡住的边界（原生视图在 DOM 之上）', () => {
  const base = {
    rect: { x: 0, y: 25, width: 1078, height: 567 },
    offsetWidth: 1078,
    offsetHeight: 567,
    pad: 0,
    viewport: { width: 1078, height: 658 }
  }

  it('①c 未传遮挡边界 ⇒ 行为与原先完全一致（不改变既有语义）', () => {
    expect(computeSlotReport(base)).toEqual({ x: 0, y: 25, width: 1078, height: 567 })
  })

  it('①d 传入侧栏右缘 ⇒ 左侧让开那一条（视图不再压住侧栏）', () => {
    const out = computeSlotReport({ ...base, occluded: { left: 56 } })
    expect(out?.x, '左边从侧栏右缘开始').toBe(56)
    expect(out?.width, '宽度相应减少').toBe(1078 - 56)
    expect(out?.y, '未遮挡的维度不动').toBe(25)
  })

  it('①e 传入顶栏下缘 ⇒ 顶部让开；两者同时传都能生效', () => {
    const out = computeSlotReport({ ...base, occluded: { left: 56, top: 36 } })
    expect(out).toEqual({ x: 56, y: 36, width: 1078 - 56, height: 567 - (36 - 25) })
  })

  it('①f 遮挡边界小于等于当前边 ⇒ 不生效（不反向扩大）', () => {
    const out = computeSlotReport({ ...base, occluded: { left: 0, top: 0 } })
    expect(out).toEqual({ x: 0, y: 25, width: 1078, height: 567 })
  })

  it('①g 让开后无有效面积 ⇒ 不上报（避免出现 0 宽视图）', () => {
    expect(computeSlotReport({ ...base, occluded: { left: 1078 } })).toBeNull()
    expect(computeSlotReport({ ...base, occluded: { left: 2000 } })).toBeNull()
  })
})

describe('槽位矩形上报', () => {
  it('① 动画中的缩放盒：不上报（日志回归用例 1846 ≠ 754）', () => {
    const out = computeSlotReport({
      rect: { x: 677, y: 37, width: 1846, height: 1231 },
      offsetWidth: 754,
      offsetHeight: 543,
      pad: 12,
      viewport: VIEWPORT
    })
    expect(out, '缩放中的包围盒必须跳过本次上报').toBeNull()
  })

  it('①b 缩放盒（比布局盒小）同样不上报', () => {
    expect(
      computeSlotReport({
        rect: { x: 300, y: 30, width: 400, height: 300 },
        offsetWidth: 754,
        offsetHeight: 543,
        pad: 12,
        viewport: VIEWPORT
      })
    ).toBeNull()
  })

  it('② 正常盒：按壳内距内缩（工具槽 pad=12）', () => {
    const out = computeSlotReport({
      rect: { x: 313, y: 37, width: 754, height: 543 },
      offsetWidth: 754,
      offsetHeight: 543,
      pad: 12,
      viewport: VIEWPORT
    })
    expect(out).toEqual({ x: 325, y: 49, width: 730, height: 519 })
  })

  it('②b 模块页槽 pad=0：原样上报（但同样夹取）', () => {
    const out = computeSlotReport({
      rect: { x: 301, y: 25, width: 778, height: 567 },
      offsetWidth: 778,
      offsetHeight: 567,
      pad: 0,
      viewport: VIEWPORT
    })
    expect(out).toEqual({ x: 301, y: 25, width: 778, height: 567 })
  })

  it('③ 夹取：任何异常盒都不会超出窗口可视区', () => {
    // 即便 offsetWidth 与 rect.width 一致（无缩放），越界也必须被夹回
    const out = computeSlotReport({
      rect: { x: 1000, y: 600, width: 900, height: 800 },
      offsetWidth: 900,
      offsetHeight: 800,
      pad: 0,
      viewport: VIEWPORT
    })
    expect(out).not.toBeNull()
    expect(out!.x + out!.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(out!.y + out!.height).toBeLessThanOrEqual(VIEWPORT.height)
    // 负坐标同样被夹回
    const neg = computeSlotReport({
      rect: { x: -50, y: -20, width: 400, height: 300 },
      offsetWidth: 400,
      offsetHeight: 300,
      pad: 0,
      viewport: VIEWPORT
    })
    expect(neg).toEqual({ x: 0, y: 0, width: 350, height: 280 })
  })

  it('③b 非法/零尺寸不上报（不把 NaN 传给主进程）', () => {
    for (const rect of [
      { x: Number.NaN, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 10 },
      { x: 0, y: 0, width: 10, height: Number.POSITIVE_INFINITY }
    ]) {
      expect(computeSlotReport({ rect, offsetWidth: 10, offsetHeight: 10, pad: 0, viewport: VIEWPORT })).toBeNull()
    }
  })
})
