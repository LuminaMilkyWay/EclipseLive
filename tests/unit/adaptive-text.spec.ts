import { describe, expect, it } from 'vitest'
import {
  clearLumaCache,
  compositeLuma,
  LUMA_SAMPLE_SIZE,
  lumaCacheSize,
  meanLuma,
  pickTextTone
} from '../../src/renderer/src/adaptive-text'

/**
 * 自适应文字色（用户要求："识别下方元素颜色，切换黑色或者白色字体"）。
 *
 * 本文件只测**纯函数**（亮度均值、合成亮度、明暗选择）；采样是薄适配层，失败即返回 null
 * （调用方保持主题默认 ⇒ 采样失败绝不改变观感）。
 */
describe('自适应文字色：亮度与合成', () => {
  it('meanLuma：纯黑 0 / 纯白 1 / 中灰 ≈0.502（Rec.709，绿权重最高）', () => {
    const px = (...v: number[]): Uint8ClampedArray => new Uint8ClampedArray(v)
    expect(meanLuma(px(0, 0, 0, 255))).toBe(0)
    expect(meanLuma(px(255, 255, 255, 255))).toBeCloseTo(1, 5)
    expect(meanLuma(px(128, 128, 128, 255))).toBeCloseTo(0.502, 2)
    expect(meanLuma(new Uint8ClampedArray([]))).toBe(0)
  })

  it('★ compositeLuma：文字看到的是「面板色 × α + 底图 × (1-α)」', () => {
    const darkPanel = { r: 16, g: 22, b: 36, a: 0.5 }
    // 透明面板 ⇒ 完全等于底图
    expect(compositeLuma({ ...darkPanel, a: 0 }, 0.9)).toBeCloseTo(0.9, 3)
    // 全不透明面板 ⇒ 完全等于面板色
    expect(compositeLuma({ ...darkPanel, a: 1 }, 0.9)).toBeCloseTo(meanLuma(new Uint8ClampedArray([16, 22, 36, 255])), 5)
    // 半透明 ⇒ 两者之间
    const mid = compositeLuma(darkPanel, 0.9)
    expect(mid).toBeGreaterThan(compositeLuma({ ...darkPanel, a: 1 }, 0.9))
    expect(mid).toBeLessThan(0.9)
  })

  it('★ pickTextTone：合成偏亮 ⇒ 深色字；偏暗 ⇒ 浅色字（阈值 0.5）', () => {
    expect(pickTextTone(0.9)).toBe('dark')
    expect(pickTextTone(0.51)).toBe('dark')
    expect(pickTextTone(0.5)).toBe('light')
    expect(pickTextTone(0.1)).toBe('light')
  })

  it('真实场景：深色面板 + 亮底图 ⇒ 合成仍偏亮时要给深色字（这正是此前白字看不清的成因）', () => {
    // 面板 --bg-card 约 rgb(13,19,34)（很暗），α=0.42（档 4）
    const panel = { r: 13, g: 19, b: 34, a: 0.42 }
    const brightWallpaper = 0.95
    const luma = compositeLuma(panel, brightWallpaper)
    expect(luma).toBeGreaterThan(0.5)
    expect(pickTextTone(luma)).toBe('dark')
  })

  it('缓存接口可用（采样一次）', () => {
    clearLumaCache()
    expect(lumaCacheSize()).toBe(0)
    expect(LUMA_SAMPLE_SIZE).toBeGreaterThan(0)
  })
})
