import { describe, expect, it } from 'vitest'
import {
  bakeDisplacementPixels,
  bakeHighlightPixels,
  buildBakedFilterMarkup,
  DISPLACEMENT_SIZE,
  HIGHLIGHT_SIZE,
  lightAngleFromPointer
} from '../../src/renderer/src/glass-bake'

/**
 * T37 烘焙材质生成器（**纯像素**，不含 canvas：可在 node 环境单测）。
 *
 * 为什么"烘焙"：档 4 的光学（SDF 位移图 + 镜面高光贴图）如果每帧/每次交互重算，
 * 会把 GPU/CPU 吃光 —— 参照范本工程的教训（研究文档 §6 明确列为"不借鉴"：
 * 每次 mousemove 重建位移图、每次 resize 重建整段 SVG 字符串）。
 * 正确做法：**一次性生成、按参数缓存、尺寸无关**（objectBoundingBox 归一化）。
 *
 * 本文件只测"生成器是否为确定性纯函数 + 通道打包是否正确"；
 * canvas/PNG 编码与 DOM 注入是薄适配层，走集成测试。
 */
describe('T37 烘焙位移图（SDF 方向场，R/G 通道打包）', () => {
  it('确定性：同参数两次生成完全一致（可缓存、可在测试里断言）', () => {
    const a = bakeDisplacementPixels({ size: DISPLACEMENT_SIZE, depth: 24, strength: 1 })
    const b = bakeDisplacementPixels({ size: DISPLACEMENT_SIZE, depth: 24, strength: 1 })
    expect(a.length).toBe(b.length)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('尺寸正确（RGBA × size²）', () => {
    const px = bakeDisplacementPixels({ size: 64, depth: 8, strength: 1 })
    expect(px.length).toBe(64 * 64 * 4)
  })

  it('★ 中性基色：无位移处 R=G=128（0x80 = 零位移），且 B 通道恒定', () => {
    const size = 64
    const px = bakeDisplacementPixels({ size, depth: 8, strength: 1 })
    // 取正中心（倒角之外 ⇒ 应为中性、零位移）
    const c = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4
    expect(px[c]).toBe(128)
    expect(px[c + 1]).toBe(128)
    // B 通道恒定（不参与位移；保持常量便于将来打包其它信息）
    const bs = new Set<number>()
    for (let i = 3; i < px.length; i += 4) bs.add(px[i])
    expect(bs.size, 'B 通道应为常量').toBe(1)
  })

  it('★ 边缘有方向且分轴正确（水平倒角只动 R、垂直倒角只动 G、正中两轴都中性）', () => {
    const size = 64
    const depth = 12
    const px = bakeDisplacementPixels({ size, depth, strength: 1 })
    const R = (x: number, y: number): number => px[(y * size + x) * 4]
    const G = (x: number, y: number): number => px[(y * size + x) * 4 + 1]
    const mid = Math.floor(size / 2)
    // 左边缘（中层行）：水平倒角 ⇒ R 显著偏离、G 保持中性
    expect(Math.abs(R(1, mid) - 128), '左边缘应产生水平位移').toBeGreaterThan(20)
    expect(Math.abs(G(1, mid) - 128), '左边缘不该产生垂直位移').toBe(0)
    // 上边缘（中层列）：垂直倒角 ⇒ G 显著偏离、R 保持中性
    expect(Math.abs(G(mid, 1)), '上边缘应产生垂直位移（0x80 基准）').toBeGreaterThan(0)
    expect(Math.abs(G(mid, 1) - 128), '上边缘应产生垂直位移').toBeGreaterThan(20)
    expect(Math.abs(R(mid, 1) - 128), '上边缘不该产生水平位移').toBe(0)
    // 正中：两轴都中性（真正的"平面区"，不平移）
    expect(R(mid, mid)).toBe(128)
    expect(G(mid, mid)).toBe(128)
    // 方向正确：左边缘负向、右边缘正向（透镜向内弯折）
    expect(R(1, mid)).toBeLessThan(128)
    expect(R(size - 2, mid)).toBeGreaterThan(128)
  })

  it('★ 边界位移必须为 0（否则会吸进元素外的透明像素 ⇒ 四周一圈黑边，用户实测）', () => {
    const size = 64
    const px = bakeDisplacementPixels({ size, depth: 12, strength: 1 })
    const R = (x: number, y: number): number => px[(y * size + x) * 4]
    const G = (x: number, y: number): number => px[(y * size + x) * 4 + 1]
    const mid = Math.floor(size / 2)
    // 四条边界线与四个角：都必须是中性 128（零位移）
    for (const [x, y] of [
      [0, mid],
      [size - 1, mid],
      [mid, 0],
      [mid, size - 1],
      [0, 0],
      [size - 1, size - 1]
    ]) {
      expect(R(x, y), `(${x},${y}) 边界处 R 必须为中性`).toBe(128)
      expect(G(x, y), `(${x},${y}) 边界处 G 必须为中性`).toBe(128)
    }
    // 位移峰值应落在**倒角中间**（两端都归零 ⇒ 采样不会越界）
    const peakX = (() => {
      let best = 0
      let bestV = 0
      for (let d = 0; d < 12; d++) {
        const v = Math.abs(R(d, mid) - 128)
        if (v > bestV) {
          bestV = v
          best = d
        }
      }
      return best
    })()
    expect(peakX, '位移峰值应在倒角中间而非最外圈').toBeGreaterThan(2)
    expect(peakX).toBeLessThan(11)
  })

  it('strength 缩放位移幅度（0 ⇒ 全中性）', () => {
    const size = 64
    const zero = bakeDisplacementPixels({ size, depth: 12, strength: 0 })
    for (let i = 0; i < zero.length; i += 4) {
      expect(zero[i]).toBe(128)
      expect(zero[i + 1]).toBe(128)
    }
  })
})

describe('T37 烘焙高光贴图（角度参数化，可随指针轻推）', () => {
  it('确定性：同角度两次一致；不同角度结果不同', () => {
    const a = bakeHighlightPixels({ size: HIGHLIGHT_SIZE, lightAngle: 45 })
    const b = bakeHighlightPixels({ size: HIGHLIGHT_SIZE, lightAngle: 45 })
    const c = bakeHighlightPixels({ size: HIGHLIGHT_SIZE, lightAngle: 225 })
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(Array.from(a)).not.toEqual(Array.from(c))
  })

  it('尺寸与取值域正确（灰度、0..255）', () => {
    const px = bakeHighlightPixels({ size: 64, lightAngle: 45 })
    expect(px.length).toBe(64 * 64 * 4)
    for (let i = 0; i < px.length; i++) {
      expect(px[i]).toBeGreaterThanOrEqual(0)
      expect(px[i]).toBeLessThanOrEqual(255)
    }
  })

  it('高光集中在受光侧（角度改变 ⇒ 峰值位置改变）', () => {
    const size = 64
    const peakAt = (angle: number): { x: number; y: number } => {
      const px = bakeHighlightPixels({ size, lightAngle: angle })
      let best = { x: 0, y: 0, v: -1 }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const v = px[(y * size + x) * 4]
          if (v > best.v) best = { x, y, v }
        }
      }
      return { x: best.x, y: best.y }
    }
    const left = peakAt(180) // 光来自左侧 ⇒ 左半更亮
    const right = peakAt(0) // 光来自右侧 ⇒ 右半更亮
    expect(left.x).toBeLessThan(size / 2)
    expect(right.x).toBeGreaterThan(size / 2)
  })
})

describe('T37 指针 → 光源角度（单一光源，避免逐元素错位）', () => {
  const W = 1000
  const H = 800

  it('窗口右侧 → ~0°，左侧 → ~180°，上方 → ~270°，下方 → ~90°', () => {
    expect(lightAngleFromPointer(W - 10, H / 2, W, H)).toBeCloseTo(0, 0)
    expect(lightAngleFromPointer(10, H / 2, W, H)).toBeCloseTo(180, 0)
    // 屏幕坐标 y 向下 ⇒ 上方是负 dy ⇒ atan2 得 -90 ⇒ 归一化为 270
    expect(lightAngleFromPointer(W / 2, 10, W, H)).toBeCloseTo(270, 0)
    expect(lightAngleFromPointer(W / 2, H - 10, W, H)).toBeCloseTo(90, 0)
  })

  it('正中心不产生 NaN（dx=dy=0）', () => {
    const a = lightAngleFromPointer(W / 2, H / 2, W, H)
    expect(Number.isFinite(a)).toBe(true)
  })

  it('结果恒在 [0, 360)', () => {
    for (const [x, y] of [
      [0, 0],
      [W, H],
      [-500, 1200],
      [9999, -9999]
    ]) {
      const a = lightAngleFromPointer(x, y, W, H)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(360)
    }
  })
})

describe('T37 烘焙滤镜标记（运行时注入用的 SVG 字符串）', () => {
  const url = 'data:image/png;base64,AAAA'

  it('确定性：同参数两次生成完全一致', () => {
    const a = buildBakedFilterMarkup({ id: 'glass-refract-baked', mapUrl: url, scale: 46 })
    const b = buildBakedFilterMarkup({ id: 'glass-refract-baked', mapUrl: url, scale: 46 })
    expect(a).toBe(b)
  })

  it('★ 结构符合研究文档约定：feImage 贴图 → feDisplacementMap 以 R/G 为位移通道', () => {
    const svg = buildBakedFilterMarkup({ id: 'glass-refract-baked', mapUrl: url, scale: 46 })
    expect(svg).toContain('<filter id="glass-refract-baked"')
    expect(svg).toContain('<feImage')
    expect(svg).toContain(url)
    expect(svg).toContain('xChannelSelector="R"')
    expect(svg).toContain('yChannelSelector="G"')
    expect(svg).toContain('scale="46"')
    // 归一到元素盒子 ⇒ 一张贴图覆盖任意尺寸面板（尺寸无关，研究文档 §6-5）
    expect(svg, 'feImage 需用 objectBoundingBox 单位铺满元素').toContain('primitiveUnits')
    expect(svg).toContain('preserveAspectRatio="none"')
    // 滤镜区域**贴合元素盒子**：外扩会让位移结果画到圆角之外（面板四周多一圈灰，用户实测）
    expect(svg, '滤镜区域应贴合元素盒子，不得外扩').toMatch(/x="0" y="0" width="100%" height="100%"/)
    expect(svg, '不得再外扩 40%').not.toContain('width="180%"')
  })

  it('scale 参数生效（不同强度 ⇒ 不同标记）', () => {
    const a = buildBakedFilterMarkup({ id: 'f', mapUrl: url, scale: 40 })
    const b = buildBakedFilterMarkup({ id: 'f', mapUrl: url, scale: 60 })
    expect(a).not.toBe(b)
    expect(a).toContain('scale="40"')
    expect(b).toContain('scale="60"')
  })

  it('dispersion=0（默认）⇒ 单次位移，不产生色散节点（向后兼容）', () => {
    const svg = buildBakedFilterMarkup({ id: 'f', mapUrl: url, scale: 46 })
    expect(svg.match(/<feDisplacementMap/g)?.length).toBe(1)
    expect(svg).not.toContain('feColorMatrix')
    expect(svg).not.toContain('feBlend')
  })

  it('★ 真三通道色散（研究文档 §6-3）：3 次位移递减 scale + 3 个抽通道 + 2 次 screen 合回', () => {
    const svg = buildBakedFilterMarkup({ id: 'f', mapUrl: url, scale: 46, dispersion: 3 })
    // 3 次位移，scale 依次为 s+2c / s+c / s
    const scales = [...svg.matchAll(/<feDisplacementMap[^>]*scale="(\d+)"/g)].map((m) => Number(m[1]))
    expect(scales).toEqual([52, 49, 46])
    // 3 个 feColorMatrix 各抽单通道（每行 20 个值：R/G/B 各抽一次）
    const matrices = [...svg.matchAll(/<feColorMatrix[^>]*values="([^"]+)"/g)]
    expect(matrices.length).toBe(3)
    for (const m of matrices) {
      expect(m[1].trim().split(/\s+/).length, 'feColorMatrix 需 4×5=20 个值').toBe(20)
    }
    // 通道抽取正确：第一个保留 R（首值为 1）、第二个保留 G（第 7 个值为 1）、第三个保留 B（第 13 个值为 1）
    const vals = matrices.map((m) => m[1].trim().split(/\s+/).map(Number))
    expect(vals[0][0]).toBe(1)
    expect(vals[1][6]).toBe(1)
    expect(vals[2][12]).toBe(1)
    // 两次 screen 合回（比"整面 screen 叠加"省：只合通道结果，不合整面）
    const blends = [...svg.matchAll(/<feBlend[^>]*mode="screen"/g)]
    expect(blends.length).toBe(2)
    // 仍以烘焙位移图为位移源
    expect(svg.match(/in2="bakedMap"/g)?.length).toBe(3)
  })
})
