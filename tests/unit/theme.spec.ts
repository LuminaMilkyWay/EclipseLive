import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import {
  effectiveMaterial,
  migrateUiSettings,
  resolveTheme,
  shouldDegradeForFps,
  uiDefaults,
  validateUiSettings,
  type AccentId,
  type MaterialTier,
  type ThemeMode,
  type UiSettings
} from '../../src/shared/theme'
import { createConfig } from '../../src/main/core/config'

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

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'el-theme-'))
}

/** core.ui 分区定义（与 main 组装处同一形状）。 */
const uiDefinition = {
  defaults: uiDefaults,
  version: 4,
  validate: (value: unknown) => validateUiSettings(value),
  migrate: (data: unknown, fromVersion: number) => migrateUiSettings(data, fromVersion)
}

async function loadCss(): Promise<string> {
  return readFile(resolve(__dirname, '../../src/renderer/src/renderer.css'), 'utf8')
}

interface CssBlock {
  selector: string
  body: string
}

/** 简单 CSS 块解析（令牌断言用；不处理 @media 嵌套）。 */
function parseBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    blocks.push({ selector: m[1].trim(), body: m[2] })
  }
  return blocks
}

/**
 * 剥掉注释：`parseBlocks` 会把选择器前的注释一起吞进 selector，直接做
 * "选择器里不得含 X" 之类断言会被注释里的说明文字误伤（踩过三次）。
 * 断言选择器内容前一律先过这里，注释便可以自由解释设计意图。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').trim()
}

function varsOf(block: CssBlock): Map<string, string> {
  const out = new Map<string, string>()
  // 先剥注释：按 ';' 切分时，块内注释会吞掉紧随其后的那条声明
  // （如 `/* 说明 */\n  --r-pill: 999px;` → 名字变成 `/* 说明 */ --r-pill`，导致该令牌"消失"）。
  const body = block.body.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const line of body.split(';')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const name = line.slice(0, idx).trim()
    if (name.startsWith('--')) out.set(name, line.slice(idx + 1).trim())
  }
  return out
}

function isTokenBlock(selector: string): boolean {
  return (
    selector.includes(':root') ||
    selector.includes('data-theme') ||
    selector.includes('data-accent') ||
    selector.includes('data-material')
  )
}

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/

/* ---------- resolveTheme ---------- */

describe('resolveTheme', () => {
  it('light/dark 直通，忽略系统外观', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('system 跟随系统外观', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

/* ---------- validateUiSettings ---------- */

describe('validateUiSettings', () => {
  it('默认值合法', () => {
    expect(validateUiSettings(uiDefaults)).toEqual({ ok: true, errors: [] })
  })

  it('非法 themeMode / 非法 accent 被拒绝', () => {
    expect(validateUiSettings({ ...uiDefaults, themeMode: 'neon' }).ok).toBe(false)
    expect(validateUiSettings({ ...uiDefaults, accent: 'magenta' }).ok).toBe(false)
    expect(validateUiSettings(null).ok).toBe(false)
  })

  it('全部合法取值被接受', () => {
    const modes: ThemeMode[] = ['light', 'dark', 'system']
    const accents: AccentId[] = ['corona-orange', 'cyan-blue']
    for (const themeMode of modes) {
      for (const accent of accents) {
        expect(validateUiSettings({ ...uiDefaults, themeMode, accent }).ok).toBe(true)
      }
    }
  })

  it('material 1/2/3 接受', () => {
    for (const material of [1, 2, 3] as MaterialTier[]) {
      expect(validateUiSettings({ ...uiDefaults, material }).ok).toBe(true)
    }
  })

  it('material 0 / 5 / 字符串 / 缺失被拒绝（T37 起 4 合法）', () => {
    for (const material of [0, 5, '2']) {
      expect(validateUiSettings({ ...uiDefaults, material }).ok).toBe(false)
    }
    expect(
      validateUiSettings({
        themeMode: 'dark',
        accent: 'corona-orange',
        wallpaperImage: '',
        wallpaperFit: 'fill',
        wallpaperOpacity: 1,
        wallpaperBlur: 0
      }).ok
    ).toBe(false)
  })

  it('壁纸字段缺失被拒绝（v3 起全字段必填）', () => {
    expect(validateUiSettings({ themeMode: 'dark', accent: 'corona-orange', material: 2 }).ok).toBe(
      false
    )
  })

  it('三降级开关为必填布尔（v4）：true/false 接受，字符串/数字/缺失被拒绝', () => {
    for (const key of ['reduceTransparency', 'highContrast', 'reduceMotion'] as const) {
      expect(validateUiSettings({ ...uiDefaults, [key]: true }).ok).toBe(true)
      expect(validateUiSettings({ ...uiDefaults, [key]: false }).ok).toBe(true)
      expect(validateUiSettings({ ...uiDefaults, [key]: 'yes' }).ok).toBe(false)
      expect(validateUiSettings({ ...uiDefaults, [key]: 1 }).ok).toBe(false)
      const missing = { ...uiDefaults } as Record<string, unknown>
      delete missing[key]
      expect(validateUiSettings(missing).ok).toBe(false)
    }
  })
})

/* ---------- migrateUiSettings ---------- */

describe('migrateUiSettings', () => {
  it('v1 → v3：补默认 material: 2 与壁纸字段，保留既有字段', () => {
    expect(migrateUiSettings({ themeMode: 'light', accent: 'cyan-blue' }, 1)).toEqual({
      ...uiDefaults,
      themeMode: 'light',
      accent: 'cyan-blue'
    })
  })

  it('v2 → v3：补默认壁纸字段，保留既有字段', () => {
    const v2 = { themeMode: 'system', accent: 'corona-orange', material: 3 }
    expect(migrateUiSettings(v2, 2)).toEqual({ ...uiDefaults, ...v2 })
  })

  it('v3 → v4：补三降级开关默认 false，保留既有字段', () => {
    const v3 = {
      themeMode: 'system',
      accent: 'cyan-blue',
      material: 3,
      wallpaperImage: 'a.png',
      wallpaperFit: 'tile',
      wallpaperOpacity: 0.5,
      wallpaperBlur: 8
    }
    expect(migrateUiSettings(v3, 3)).toEqual({ ...uiDefaults, ...v3 })
  })

  it('v4 直通不改', () => {
    const v4 = { ...uiDefaults, themeMode: 'system', material: 3, highContrast: true }
    expect(migrateUiSettings(v4, 4)).toEqual(v4)
  })
})

/* ---------- effectiveMaterial（T22 档 3 自动降档） ---------- */

describe('effectiveMaterial', () => {
  it('高对比度下档 3 自动降为档 2', () => {
    expect(effectiveMaterial({ material: 3, highContrast: true })).toBe(2)
  })

  it('无高对比度时档 3 原样渲染', () => {
    expect(effectiveMaterial({ material: 3, highContrast: false })).toBe(3)
  })

  it('档 1/2 不受高对比度影响', () => {
    expect(effectiveMaterial({ material: 1, highContrast: true })).toBe(1)
    expect(effectiveMaterial({ material: 2, highContrast: true })).toBe(2)
    expect(effectiveMaterial({ material: 2, highContrast: false })).toBe(2)
  })
})

/* ---------- core.ui 配置分区 ---------- */

describe('core.ui 配置分区', () => {
  it('未持久化时返回默认值', async () => {
    const cfg = createConfig({ dir: await tempDir(), logger: testLogger() })
    cfg.register<UiSettings>('core.ui', uiDefinition)
    await cfg.flush()
    expect(cfg.get<UiSettings>('core.ui')).toEqual(uiDefaults)
  })

  it('set 合法值持久化并触发 onChange', async () => {
    const dir = await tempDir()
    const cfg = createConfig({ dir, logger: testLogger() })
    cfg.register<UiSettings>('core.ui', uiDefinition)
    await cfg.flush()
    const seen: unknown[] = []
    cfg.onChange('core.ui', (v) => seen.push(v))
    const next: UiSettings = {
      themeMode: 'system',
      accent: 'cyan-blue',
      material: 3,
      wallpaperImage: 'a.png',
      wallpaperFit: 'tile',
      wallpaperOpacity: 0.5,
      wallpaperBlur: 8,
      reduceTransparency: true,
      highContrast: false,
      reduceMotion: true
    }
    expect(cfg.set('core.ui', next)).toEqual({ ok: true, errors: [] })
    await cfg.flush()
    expect(cfg.get<UiSettings>('core.ui')).toEqual(next)
    expect(seen).toContainEqual(next)

    // 重启读回（持久化验证）
    const cfg2 = createConfig({ dir, logger: testLogger() })
    cfg2.register<UiSettings>('core.ui', uiDefinition)
    await cfg2.flush()
    expect(cfg2.get<UiSettings>('core.ui')).toEqual(next)
  })

  it('set 非法值不落盘、不触发 onChange', async () => {
    const cfg = createConfig({ dir: await tempDir(), logger: testLogger() })
    cfg.register<UiSettings>('core.ui', uiDefinition)
    await cfg.flush()
    const seen: unknown[] = []
    cfg.onChange('core.ui', (v) => seen.push(v))
    const bad = { themeMode: 'neon', accent: 'corona-orange', material: 2 }
    const r = cfg.set('core.ui', bad)
    expect(r.ok).toBe(false)
    await cfg.flush()
    expect(cfg.get<UiSettings>('core.ui')).toEqual(uiDefaults)
    expect(seen).toEqual([])
  })
})

/* ---------- renderer.css 设计令牌 ---------- */

describe('renderer.css 设计令牌', () => {
  it('dark/light 主题块变量齐全', async () => {
    const blocks = parseBlocks(await loadCss())
    const required = [
      '--txt-1',
      '--txt-2',
      '--txt-3',
      '--txt-link',
      '--bg-0',
      '--bg-card',
      '--bg-overlay',
      '--line',
      '--ok',
      '--bad',
      '--warn',
      // T22 高对比度备用令牌（override 块重映射源）
      '--txt-2-hc',
      '--txt-3-hc',
      '--line-hc',
      '--line-strong-hc'
    ]
    for (const theme of ['dark', 'light']) {
      const block = blocks.find((b) => b.selector.includes(`data-theme='${theme}'`))
      expect(block, `缺少 [data-theme='${theme}'] 令牌块`).toBeTruthy()
      const vars = varsOf(block!)
      for (const name of required) {
        expect(vars.has(name), `主题 ${theme} 缺少 ${name}`).toBe(true)
      }
    }
  })

  it('两个强调色块定义 --acc/--acc-soft', async () => {
    const blocks = parseBlocks(await loadCss())
    for (const accent of ['corona-orange', 'cyan-blue']) {
      const block = blocks.find((b) => b.selector.includes(`data-accent='${accent}'`))
      expect(block, `缺少 [data-accent='${accent}'] 令牌块`).toBeTruthy()
      const vars = varsOf(block!)
      expect(vars.has('--acc')).toBe(true)
      expect(vars.has('--acc-soft')).toBe(true)
    }
  })

  it('尺寸层令牌规格：圆角 8/12/16/24px + 胶囊档、间距 4 的倍数递增、--fs-scale 在位', async () => {
    const blocks = parseBlocks(await loadCss())
    const root = blocks.find((b) => b.selector.includes(':root'))
    expect(root).toBeTruthy()
    const vars = varsOf(root!)
    expect(vars.get('--r-sm')).toBe('8px')
    expect(vars.get('--r-md')).toBe('12px')
    expect(vars.get('--r-lg')).toBe('16px')
    expect(vars.get('--r-xl')).toBe('24px')
    // 胶囊档：徽章/开关轨道等「全圆端」元素走令牌，避免出现 999px 数字字面量
    expect(vars.get('--r-pill'), '缺少 --r-pill 胶囊圆角档').toBe('999px')
    // 主刻度 4→48 + 半档 20px（--sp-4h，位于 16 与 24 之间）
    const sps = [1, 2, 3, 4, 5, 6, 7].map((i) => vars.get(`--sp-${i}`))
    for (const sp of sps) {
      expect(sp, '--sp-* 缺失').toMatch(/^\d+px$/)
      const px = parseInt(sp!, 10)
      expect(px % 4).toBe(0)
      expect(px).toBeGreaterThanOrEqual(4)
      expect(px).toBeLessThanOrEqual(48)
    }
    const nums = sps.map((s) => parseInt(s!, 10))
    expect([...nums].sort((a, b) => a - b)).toEqual(nums)
    expect(vars.get('--sp-4h'), '缺少 --sp-4h 半档间距').toBe('20px')
    expect(vars.has('--fs-scale')).toBe(true)
  })

  it('圆角一律走令牌：非令牌块 border-radius 零数字（胶囊走 --r-pill）', async () => {
    const blocks = parseBlocks(await loadCss())
    const offenders: string[] = []
    for (const b of blocks) {
      if (isTokenBlock(b.selector)) continue
      const body = b.body.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of body.matchAll(/border-radius\s*:\s*([^;]+)/g)) {
        const value = m[1].trim()
        // `var(--r-*)` 走令牌；`inherit` 是伪元素跟随宿主圆角的正确写法
        if (!value.includes('var(') && value !== 'inherit') {
          offenders.push(`${b.selector} → border-radius: ${value}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('间距节奏：px 字面量只许 0/1/2/4/8/12/16/20/24/32/48（4px 体系 + 0/1/2 细线）', async () => {
    const ALLOWED = new Set([0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 48])
    const PROP = '(?:padding|margin|gap|row-gap|column-gap)'
    const blocks = parseBlocks(await loadCss())
    const offenders: string[] = []
    for (const b of blocks) {
      if (isTokenBlock(b.selector)) continue
      const body = b.body.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of body.matchAll(new RegExp(`(?:^|[;\\s])(${PROP}(?:-top|-right|-bottom|-left)?)\\s*:\\s*([^;]+)`, 'g'))) {
        for (const v of m[2].matchAll(/(\d+(?:\.\d+)?)px/g)) {
          const px = parseFloat(v[1])
          if (!ALLOWED.has(px)) offenders.push(`${b.selector} → ${m[1]}: ${m[2].trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('非令牌块零颜色字面量（#/rgb()/hsl()）', async () => {
    const blocks = parseBlocks(await loadCss())
    const offenders: string[] = []
    for (const b of blocks) {
      if (isTokenBlock(b.selector)) continue
      const body = b.body.replace(/\/\*[\s\S]*?\*\//g, '')
      if (COLOR_LITERAL.test(body)) {
        offenders.push(b.selector)
      }
    }
    expect(offenders).toEqual([])
  })
})

/* ---------- renderer.css 材质层（T15 令牌体系 / T28 玻璃光学重构） ---------- */

describe('renderer.css 材质层', () => {
  const MAT_VARS = [
    '--mat-blur',
    '--mat-sat',
    '--mat-alpha',
    // 角色不透明度：大面（侧栏/卡片）比小面（浮层）更不透明——Apple HIG
    '--mat-alpha-role',
    '--mat-edge-light',
    '--mat-edge-thick',
    // T-A8：悬停时轻移顶缘高光位置（强度与静止态一致）
    '--mat-edge-light-hover',
    '--mat-border',
    '--mat-refract',
    '--mat-scene-op',
    '--mat-disperse',
    '--mat-glow',
    '--mat-shadow-1',
    '--mat-shadow-2'
  ]

  function tierVars(blocks: CssBlock[], tier: string): Map<string, string> {
    const block = blocks.find((b) => b.selector.includes(`data-material='${tier}'`))
    expect(block, `缺少材质档令牌块: ${tier}`).toBeTruthy()
    return varsOf(block!)
  }

  it('参与 box-shadow 列表的令牌一律不得为 none（否则整条声明失效）', async () => {
    const blocks = parseBlocks(await loadCss())
    // box-shadow 是逗号分隔的多层列表，而 `none` 不是合法分量：任一层为 none，
    // 整条 box-shadow 会在计算值阶段失效 → 面板失去全部阴影与边缘高光。
    // 历史 bug：档 1 的 --mat-edge-thick 与档 2 的 --mat-glow 都是 none，
    // 导致默认档下玻璃面板的 box-shadow 实测为 none（只靠 1px 描边撑着）。
    const tierVarsOf = (tier: string): Map<string, string> => {
      const block = blocks.find((b) => b.selector.includes(`data-material='${tier}'`))
      expect(block, `缺少材质档令牌块: ${tier}`).toBeTruthy()
      return varsOf(block!)
    }
    const SHADOW_TOKENS = [
      '--mat-edge-light',
      '--mat-edge-thick',
      '--mat-glow',
      '--mat-shadow-1',
      '--mat-shadow-2'
    ]
    for (const tier of ['1', '2', '3']) {
      const vars = tierVarsOf(tier)
      for (const name of SHADOW_TOKENS) {
        expect(vars.get(name), `档 ${tier} 的 ${name} 不得为 none（会让整条 box-shadow 失效）`).not.toBe(
          'none'
        )
      }
    }
    // 降级块同样参与该列表
    const reduced = varsOf(
      blocks.find((b) => b.selector.includes("data-reduce-transparency='1'"))!
    )
    for (const name of SHADOW_TOKENS) {
      expect(reduced.get(name), `减少透明度降级块的 ${name} 不得为 none`).not.toBe('none')
    }
    // 悬停高光令牌同理
    for (const tier of ['1', '2', '3']) {
      expect(tierVarsOf(tier).get('--mat-edge-light-hover')).not.toBe('none')
    }
  })

  it('四档材质块变量名集合完全一致（只改变量值）', async () => {
    const blocks = parseBlocks(await loadCss())
    // T37 起含档 4。注意守卫取**首个**同名块 ⇒ 档 4 的"配套层"（控件/文字令牌）
    // 故意单独成块，不参与这里的集合比较（见 renderer.css 注释）。
    for (const tier of ['1', '2', '3', '4']) {
      const names = [...tierVars(blocks, tier).keys()].sort()
      expect(names, `档 ${tier} 变量名集合与规格不一致`).toEqual([...MAT_VARS].sort())
    }
  })

  it('blur/sat/alpha 在规格区间（T28：16/18/24 性能上限）', async () => {
    const blocks = parseBlocks(await loadCss())
    const blurOf = (tier: string): number => {
      const m = /^(\d+(?:\.\d+)?)px$/.exec(tierVars(blocks, tier).get('--mat-blur') ?? '')
      expect(m, `档 ${tier} --mat-blur 需为 px 值`).toBeTruthy()
      return parseFloat(m![1])
    }
    const numVar = (tier: string, name: string): number => {
      const v = parseFloat(tierVars(blocks, tier).get(name) ?? '')
      expect(Number.isNaN(v), `档 ${tier} ${name} 需为数值`).toBe(false)
      return v
    }
    // 档 1/2：blur 12–18px；档 3：blur 20–24px（性能上限）
    expect(blurOf('1'), '档 1 blur 下限').toBeGreaterThanOrEqual(12)
    expect(blurOf('1'), '档 1 blur 上限').toBeLessThanOrEqual(16)
    expect(blurOf('2'), '档 2 blur 下限').toBeGreaterThanOrEqual(12)
    expect(blurOf('2'), '档 2 blur 上限').toBeLessThanOrEqual(18)
    expect(blurOf('3'), '档 3 blur 下限').toBeGreaterThanOrEqual(20)
    expect(blurOf('3'), '档 3 blur 上限').toBeLessThanOrEqual(24)
    // 饱和度 1–2
    for (const tier of ['1', '2', '3']) {
      expect(numVar(tier, '--mat-sat'), `档 ${tier} sat 下限`).toBeGreaterThanOrEqual(1)
      expect(numVar(tier, '--mat-sat'), `档 ${tier} sat 上限`).toBeLessThanOrEqual(2)
    }
    // 透明度：frosted 半透明；档 2 0.6–0.75；档 3 0.5–0.7
    expect(numVar('1', '--mat-alpha'), '档 1 alpha 下限').toBeGreaterThanOrEqual(0.6)
    expect(numVar('1', '--mat-alpha'), '档 1 alpha 上限').toBeLessThanOrEqual(0.85)
    expect(numVar('2', '--mat-alpha'), '档 2 alpha 下限').toBeGreaterThanOrEqual(0.6)
    expect(numVar('2', '--mat-alpha'), '档 2 alpha 上限').toBeLessThanOrEqual(0.75)
    expect(numVar('3', '--mat-alpha'), '档 3 alpha 下限').toBeGreaterThanOrEqual(0.5)
    expect(numVar('3', '--mat-alpha'), '档 3 alpha 上限').toBeLessThanOrEqual(0.7)
  })

  it('档 1 frosted：inset 顶高光 + 白描边，无折射无色散无 veil 无光晕', async () => {
    const t1 = tierVars(parseBlocks(await loadCss()), '1')
    expect(t1.get('--mat-edge-light')).toContain('inset')
    expect(t1.get('--mat-border')).toContain('rgba')
    expect(t1.get('--mat-refract')).not.toContain('url(')
    expect(t1.get('--mat-disperse')).toBe('none')
    // `--mat-veil` 已退休（整面平面渐变会糊成灰膜）：任何档位都不该再有这个令牌
    expect(t1.has('--mat-veil')).toBe(false)
    // 无光晕要用**透明零阴影**表达：参与 box-shadow 列表的令牌若写 none，整条声明会失效
    expect(t1.get('--mat-glow'), '档 1 无光晕（须为透明零阴影而非 none）').toBe('0 0 0 transparent')
    expect(t1.get('--mat-scene-op')).toBe('0')
  })

  it('档 2 subtle liquid：SVG 位移折射 + 弱色散 + 底部厚度，无 veil', async () => {
    const t2 = tierVars(parseBlocks(await loadCss()), '2')
    expect(t2.get('--mat-refract')).toContain('url(#glass-refract-subtle)')
    expect(t2.get('--mat-disperse')).toContain('inset')
    expect(t2.get('--mat-edge-light')).toContain('inset')
    expect(t2.get('--mat-edge-thick')).toContain('inset')
    // `--mat-veil` 已退休：任何档位都不该再有这个令牌
    expect(t2.has('--mat-veil')).toBe(false)
    expect(parseFloat(t2.get('--mat-scene-op') ?? '')).toBeGreaterThanOrEqual(0.5)
  })

  it('档 3 liquid：强折射 + 色散 + 强调色光晕（无色字面量）；无 veil', async () => {
    const t3 = tierVars(parseBlocks(await loadCss()), '3')
    expect(t3.get('--mat-refract')).toContain('url(#glass-refract-strong)')
    expect(t3.get('--mat-disperse')).toContain('inset')
    // 可读性改由 --mat-alpha-role + blur 承担；整面薄纱已退休（否则卡片下糊灰膜）
    expect(t3.has('--mat-veil')).toBe(false)
    expect(Number(t3.get('--mat-alpha-role')), '档 3 大面不透明度即可读性旋钮').toBeGreaterThan(0.6)
    const glow = t3.get('--mat-glow') ?? ''
    expect(glow).toContain('var(--acc')
    expect(glow).not.toMatch(COLOR_LITERAL)
  })

  it('组件样式消费全部材质变量', async () => {
    const blocks = parseBlocks(await loadCss())
    const body = blocks
      .filter((b) => !b.selector.includes('data-material'))
      .map((b) => b.body)
      .join('\n')
    for (const name of MAT_VARS) {
      expect(body, `${name} 未被组件样式消费`).toContain(`var(${name})`)
    }
  })

  it('角色不透明度：--mat-alpha-role ≥ 基准 --mat-alpha（大面更不透明，Apple HIG）', async () => {
    const blocks = parseBlocks(await loadCss())
    const num = (v: string | undefined): number => parseFloat(v ?? '')
    for (const tier of ['1', '2', '3']) {
      const vars = tierVars(blocks, tier)
      const base = num(vars.get('--mat-alpha'))
      const role = num(vars.get('--mat-alpha-role'))
      expect(Number.isNaN(role), `档 ${tier} 缺少 --mat-alpha-role`).toBe(false)
      // 规范：Liquid Glass 在大面（侧栏）比小面（工具条/浮层）更不透明
      expect(role, `档 ${tier} 角色基准不得低于共享基准`).toBeGreaterThanOrEqual(base)
      expect(role, `档 ${tier} 角色基准不得越界`).toBeLessThanOrEqual(0.9)
    }
    // 三档在「同一角色」上的排序必须是递增不透明：档 1 > 档 2 > 档 3
    const roles = ['1', '2', '3'].map((t) => num(tierVars(blocks, t).get('--mat-alpha-role')))
    expect(roles[0]).toBeGreaterThan(roles[1])
    expect(roles[1]).toBeGreaterThan(roles[2])
  })

  it('减少透明度降级也定义 --mat-alpha-role（否则组件 var() 悬空）', async () => {
    const block = parseBlocks(await loadCss()).find((b) =>
      b.selector.includes("data-reduce-transparency='1'")
    )
    expect(block, '缺少减少透明度降级块').toBeTruthy()
    expect(block!.body, '降级块需定义角色不透明度').toContain('--mat-alpha-role: 1')
  })

  it('主题层提供卡片/状态层令牌：--card-bg 与 --state-hover/--state-press', async () => {
    const blocks = parseBlocks(await loadCss())
    for (const theme of ['dark', 'light']) {
      const vars = varsOf(blocks.find((b) => b.selector.includes(`data-theme='${theme}'`))!)
      for (const name of ['--card-bg', '--state-hover', '--state-press']) {
        expect(vars.has(name), `主题 ${theme} 缺少 ${name}`).toBe(true)
      }
      // 状态层必须是中性半透明（深色比浅色更重：Carbon 0.12 / 0.16）
      expect(vars.get('--state-hover')).toMatch(/rgba\(/)
    }
    const dark = varsOf(blocks.find((b) => b.selector.includes("data-theme='dark'"))!)
    const light = varsOf(blocks.find((b) => b.selector.includes("data-theme='light'"))!)
    const alphaOf = (v: string | undefined): number => parseFloat(/([\d.]+)\)\s*$/.exec(v ?? '')?.[1] ?? '')
    expect(alphaOf(dark.get('--state-hover'))).toBeGreaterThan(alphaOf(light.get('--state-hover')))
  })

  it('分层材质：内容层与 chrome 同用玻璃配方 --card-bg（原有材质效果，已按用户要求恢复）', async () => {
    const css = await loadCss()
    const blocks = parseBlocks(css)
    // 注意：parseBlocks 会把选择器前的注释一起吞进 selector，故用 includes 匹配
    // 用户明确要求"恢复原有三档材质的效果" ⇒ 内容层回到 T36 之前的玻璃配方
    // （半透明底 --card-bg + backdrop-filter + 材质边缘高光）；唯一仍禁止的是 --mat-veil 整面薄纱。
    for (const sel of ['.card', '.module-page-host', '.tool-slot', '.side', '.tool-bar', '.modal-panel']) {
      const b = blocks.find((x) => new RegExp(`(^|\\s)${sel.replace('.', '\\.')}$`).test(x.selector))
      expect(b, `缺少 ${sel} 块`).toBeTruthy()
      expect(b!.body, `${sel} 应消费玻璃底 --card-bg`).toContain('var(--card-bg)')
      expect(b!.body, `${sel} 应保留 backdrop-filter`).toMatch(/backdrop-filter\s*:/)
      expect(b!.body, `${sel} 不得使用整面薄纱 --mat-veil`).not.toContain('var(--mat-veil)')
    }
    const hover = blocks.find((b) => b.selector.includes('.nav-item:hover'))
    expect(hover, '缺少 .nav-item:hover 块').toBeTruthy()
    expect(hover!.body, '悬停态应消费中性状态层').toContain('var(--state-hover)')
    expect(hover!.body, '悬停态不得使用不透明底色').not.toContain('--bg-card-2')
  })

  it('强调色不得压在玻璃面上：卡片标题/分组标题走文字令牌', async () => {
    const css = await loadCss()
    const blocks = parseBlocks(css)
    const h1 = blocks.filter((b) => /\.card h1$/.test(b.selector))
    expect(h1.length, '缺少 .card h1 规则').toBeGreaterThan(0)
    for (const b of h1) {
      expect(b.body, 'Windows：不要在亚克力上放强调色文字').not.toContain('var(--acc)')
      expect(b.body, '中文标题不做 uppercase（字形不变、白做）').not.toContain('uppercase')
    }
  })

  it('分段选择器选中态：强调色实底 + --ink-on-acc 前景（对比度红线）', async () => {
    const css = await loadCss()
    const active = parseBlocks(css).find((b) => b.selector.includes('.seg.active'))
    expect(active, '缺少 .seg.active 规则').toBeTruthy()
    // 用 --acc-soft 作底 + 白字只有约 1.5:1；必须走专用前景色
    expect(active!.body, '选中态底色应为 --acc 实底').toContain('background: var(--acc)')
    expect(active!.body, '选中态前景应为 --ink-on-acc').toContain('color: var(--ink-on-acc)')
    expect(active!.body, '不得再用 --acc-soft 作底').not.toContain('--acc-soft')
  })

  it('控件底/描边走主题令牌（--ctrl-bg / --ctrl-line），浅色下不会与卡片同色', async () => {
    const css = await loadCss()
    const blocks = parseBlocks(css)
    for (const theme of ['dark', 'light']) {
      const vars = varsOf(blocks.find((b) => b.selector.includes(`data-theme='${theme}'`))!)
      expect(vars.has('--ctrl-bg'), `主题 ${theme} 缺少 --ctrl-bg`).toBe(true)
      expect(vars.has('--ctrl-line'), `主题 ${theme} 缺少 --ctrl-line`).toBe(true)
      // 浅色下卡片是纯白，控件底必须与之不同（否则控件"消失"）
      expect(vars.get('--ctrl-bg'), `主题 ${theme} 控件底不得等于卡片底`).not.toBe(
        vars.get('--bg-card')
      )
    }
    for (const sel of ['.seg', '.input', '.select']) {
      // 取真正的样式块（含 padding），避开 .seg{transition} / .btn,.nav-item,.seg 之类的聚合块
      const block = blocks.find(
        (b) => new RegExp(`(^|\\s)${sel.replace('.', '\\.')}$`).test(b.selector) && b.body.includes('padding')
      )
      expect(block, `缺少 ${sel} 样式块`).toBeTruthy()
      expect(block!.body, `${sel} 应消费 --ctrl-bg`).toContain('var(--ctrl-bg)')
      expect(block!.body, `${sel} 应消费 --ctrl-line`).toContain('var(--ctrl-line)')
    }
  })

  it('三档材质差异可感知：档间不透明度跨度 ≥ 0.1', async () => {
    const blocks = parseBlocks(await loadCss())
    const num = (t: string, name: string): number => parseFloat(tierVars(blocks, t).get(name) ?? '')
    const alpha = ['1', '2', '3'].map((t) => num(t, '--mat-alpha'))
    const role = ['1', '2', '3'].map((t) => num(t, '--mat-alpha-role'))
    expect(alpha[0] - alpha[2], '档 1 与档 3 的不透明度跨度不足（用户切档将看不出变化）').toBeGreaterThanOrEqual(0.3)
    expect(role[0] - role[2], '档 1 与档 3 的角色不透明度跨度不足').toBeGreaterThanOrEqual(0.15)
    // 档 1 应"接近不透明"（纯模糊档的定位）
    expect(role[0], '档 1 角色不透明度应接近 1').toBeGreaterThanOrEqual(0.88)
    // 档 3 应明显更透（液态档的定位）
    expect(alpha[2], '档 3 基准不透明度应明显更低').toBeLessThanOrEqual(0.55)
  })
})

/* ---------- 玻璃光学层（T28）：SVG 折射滤镜 / 伪元素 / 关键帧 ---------- */

describe('玻璃光学层（T28）', () => {
  async function loadHtml(): Promise<string> {
    return readFile(resolve(__dirname, '../../src/renderer/index.html'), 'utf8')
  }

  it('index.html 内嵌两个 SVG 位移滤镜（scale 20/42，静态无 animate）', async () => {
    const html = await loadHtml()
    expect(html).toContain('id="glass-refract-subtle"')
    expect(html).toContain('id="glass-refract-strong"')
    expect(html).toContain('baseFrequency="0.008"')
    expect(html).toMatch(/<feDisplacementMap[^>]*scale="20"/)
    expect(html).toMatch(/<feDisplacementMap[^>]*scale="42"/)
    expect(html).not.toContain('<animate')
    expect(html).toContain('feTurbulence')
  })

  it('折射场景层 ::before 覆盖内容层 + chrome（原有材质效果，已恢复）；固定附件 + 场景滤镜', async () => {
    const css = await loadCss()
    const rule = parseBlocks(css).find((b) => b.selector.includes('.side::before'))
    expect(rule, '缺少 .side::before 折射场景层').toBeTruthy()
    expect(rule!.body).toContain('background-attachment: fixed')
    expect(rule!.body).toContain('filter: var(--mat-refract)')
    expect(rule!.body).toContain('var(--mat-scene-op)')
    expect(rule!.body).toContain('var(--wallpaper-opacity)')
    expect(rule!.body).toContain('var(--wallpaper-url)')
    // 用户要求恢复原有材质效果 ⇒ 内容层 .card 重新参与折射（T36 曾把它移出）。
    // 注意：parseBlocks 会把选择器前的注释吞进 selector，故断言前**先剥注释**。
    expect(stripComments(rule!.selector), '内容层 .card 应重新参与折射场景层').toContain('.card')
  })

  it('色散层 ::after 覆盖内容层 + chrome（原有材质效果，已恢复）', async () => {
    const rule = parseBlocks(await loadCss()).find((b) => b.selector.includes('.side::after'))
    expect(rule, '缺少 .side::after 色散层').toBeTruthy()
    expect(rule!.body).toContain('mix-blend-mode: screen')
    expect(rule!.body).toContain('box-shadow: var(--mat-disperse)')
    expect(stripComments(rule!.selector), '内容层 .card 应重新参与色散层').toContain('.card')
  })

  it('壁纸 fit 令牌镜像到折射场景层（--scene-size/--scene-repeat）', async () => {
    const css = await loadCss()
    expect(css).toMatch(/\[data-wallpaper-fit='fill'\][^}]*--scene-size:\s*cover/)
    expect(css).toMatch(/\[data-wallpaper-fit='tile'\][^}]*--scene-repeat:\s*repeat/)
  })

  it('关键帧仅 transform/opacity（el-rise-in / el-pop-in / el-pop-out）', async () => {
    const css = await loadCss()
    function keyframeBody(name: string): string {
      const start = css.indexOf(`@keyframes ${name}`)
      expect(start, `缺少关键帧 ${name}`).toBeGreaterThanOrEqual(0)
      return css.slice(start, css.indexOf('\n}', start))
    }
    for (const name of ['el-rise-in', 'el-pop-in', 'el-pop-out']) {
      const body = keyframeBody(name)
      expect(body).toContain('opacity')
      expect(body).toContain('transform')
      for (const forbidden of [
        'width',
        'height',
        'margin',
        'padding',
        'background',
        'box-shadow',
        'filter',
        'left',
        'top',
        'color'
      ]) {
        expect(body, `${name} 不得动 ${forbidden}`).not.toContain(forbidden)
      }
    }
  })
})

/* ---------- renderer.css 可读性降级与动效（T22） ---------- */

/* ---------- renderer.css 动效令牌（T-A1：Fluent 风格非线性缓动 + 时长） ---------- */

describe('renderer.css 动效令牌（T-A1）', () => {
  /** 时长令牌：fast=退出、normal=浮层、enter=进入、slow=材质/主题切换。 */
  const DURATIONS: ReadonlyArray<readonly [string, string]> = [
    ['--duration-fast', '120ms'],
    ['--duration-normal', '180ms'],
    ['--duration-enter', '200ms'],
    ['--duration-slow', '250ms']
  ]
  const EASINGS = ['--ease-standard', '--ease-decelerate', '--ease-accelerate']

  function rootVars(blocks: CssBlock[]): Map<string, string> {
    const root = blocks.find((b) => b.selector.includes(':root'))
    expect(root, '缺少 :root 块').toBeTruthy()
    return varsOf(root!)
  }

  it('四档时长令牌就位，且全部 ≤300ms（克制上限）', async () => {
    const vars = rootVars(parseBlocks(await loadCss()))
    for (const [name, value] of DURATIONS) {
      expect(vars.get(name), `缺少 ${name}`).toBe(value)
      expect(parseFloat(value), `${name} 超出克制上限`).toBeLessThanOrEqual(300)
    }
  })

  it('三条缓动令牌就位且为非线性 cubic-bezier（禁 linear）', async () => {
    const vars = rootVars(parseBlocks(await loadCss()))
    for (const name of EASINGS) {
      const v = vars.get(name)
      expect(v, `缺少 ${name}`).toBeTruthy()
      expect(v, `${name} 必须是非线性 cubic-bezier`).toMatch(/^cubic-bezier\(/)
      expect(v, `${name} 不得含 linear`).not.toContain('linear')
    }
    // Fluent 语义：进入用减速曲线、退出用加速曲线，二者必须不同
    expect(vars.get('--ease-decelerate')).not.toBe(vars.get('--ease-accelerate'))
    // 标准曲线用于状态与材质过渡
    expect(vars.get('--ease-standard')).not.toBe(vars.get('--ease-decelerate'))
  })

  it('全站过渡/动画不再出现裸时长（必须走 --duration-* 令牌）', async () => {
    const blocks = parseBlocks(await loadCss())
    const offenders: string[] = []
    for (const b of blocks) {
      if (isTokenBlock(b.selector)) continue
      const body = b.body.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of body.matchAll(/(?:transition|animation)\s*:\s*([^;{}]+)/g)) {
        const value = m[1].trim()
        if (value === 'none') continue
        if (/(\d+(?:\.\d+)?)(ms|s)\b/.test(value)) offenders.push(`${b.selector} → ${value}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('全站过渡/动画不再出现裸缓动（必须走 --ease-* 令牌）', async () => {
    const blocks = parseBlocks(await loadCss())
    const offenders: string[] = []
    for (const b of blocks) {
      if (isTokenBlock(b.selector)) continue
      const body = b.body.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of body.matchAll(/(?:transition|animation)\s*:\s*([^;{}]+)/g)) {
        const value = m[1].trim()
        if (value === 'none') continue
        // 值里必须出现缓动令牌；裸 ease / ease-out / linear 一律算违规
        if (!value.includes('var(--ease-')) offenders.push(`${b.selector} → ${value}（缺缓动令牌）`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('关键帧本体仍只允许 transform/opacity（不得引入 filter/box-shadow 等）', async () => {
    const css = (await loadCss()).replace(/\/\*[\s\S]*?\*\//g, '')
    const names = [...css.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)].map((m) => m[1])
    expect(names.length, '关键帧数量异常').toBeGreaterThanOrEqual(4)
    for (const name of names) {
      const start = css.indexOf(`@keyframes ${name}`)
      const body = css.slice(start, css.indexOf('\n}', start))
      for (const forbidden of ['filter', 'box-shadow', 'backdrop-filter', 'width', 'height', 'margin', 'padding']) {
        expect(body, `${name} 不得动 ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('玻璃面过渡不含 backdrop-filter（换档模糊瞬时到位，避免整面重绘）', async () => {
    const blocks = parseBlocks(await loadCss())
    const surface = blocks.find(
      (b) => !isTokenBlock(b.selector) && b.selector.includes('.toast') && b.body.includes('transition')
    )
    expect(surface, '缺少玻璃面过渡块').toBeTruthy()
    expect(surface!.body, '材质切换不得过渡 backdrop-filter').not.toContain('backdrop-filter')
    expect(surface!.body, '材质切换应消费时长令牌').toContain('var(--duration-')
    expect(surface!.body, '材质切换应消费缓动令牌').toContain('var(--ease-')
  })
})

/* ---------- renderer.css 全局动效几何（T-A5） ---------- */

describe('renderer.css 全局动效几何（T-A5）', () => {
  function keyframeBody(css: string, name: string): string {
    const start = css.indexOf(`@keyframes ${name}`)
    expect(start, `缺少关键帧 ${name}`).toBeGreaterThanOrEqual(0)
    return css.slice(start, css.indexOf('\n}', start))
  }

  it('进入类动效几何：上移 8px + 淡入（页面/标签/模块页槽位）', async () => {
    const css = (await loadCss()).replace(/\/\*[\s\S]*?\*\//g, '')
    const rise = keyframeBody(css, 'el-rise-in')
    expect(rise, '进入应自 8px 上移开始').toMatch(/translateY\(8px\)/)
    expect(rise, '进入应自透明开始').toMatch(/opacity:\s*0/)
    // Toast 同族：位移 8px
    expect(keyframeBody(css, 'el-toast-in'), 'Toast 进入应上移 8px').toMatch(/translateY\(8px\)/)
  })

  it('浮层动效几何：缩放 0.96 ↔ 1（弹窗面板进与出）', async () => {
    const css = (await loadCss()).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(keyframeBody(css, 'el-pop-in'), '浮层进入应自 scale(0.96) 开始').toMatch(/scale\(0\.96\)/)
    expect(keyframeBody(css, 'el-pop-out'), '浮层退出应收敛到 scale(0.96)').toMatch(/scale\(0\.96\)/)
  })

  it('导航二级下拉：展开与折叠各有动画，且规模小于进入类（180ms 量级）', async () => {
    const css = await loadCss()
    const blocks = parseBlocks(css)
    const base = blocks.find((b) => /(^|\s)\.nav-dropdown$/.test(b.selector))
    expect(base, '缺少 .nav-dropdown 基础块').toBeTruthy()
    expect(base!.body, '展开应使用 el-drop-in').toContain('el-drop-in')
    expect(base!.body, '展开时长应走令牌').toContain('var(--duration-')
    const closing = blocks.find((b) => b.selector.includes(".nav-dropdown[data-closing='true']"))
    expect(closing, '缺少折叠态动画（收起应可动效化）').toBeTruthy()
    expect(closing!.body, '折叠应使用 el-drop-out').toContain('el-drop-out')
    expect(closing!.body, '折叠需 forwards 保持终态').toContain('forwards')
    // 两个关键帧都必须存在
    for (const name of ['el-drop-in', 'el-drop-out']) {
      expect(css, `缺少 ${name} 关键帧`).toContain(`@keyframes ${name}`)
    }
  })

  it('下拉动效只动 opacity/transform：不得退化为 height 过渡', async () => {
    const css = (await loadCss()).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const name of ['el-drop-in', 'el-drop-out']) {
      const body = keyframeBody(css, name)
      expect(body, `${name} 应使用 transform`).toContain('transform')
      expect(body, `${name} 应使用 opacity`).toContain('opacity')
      for (const banned of ['height', 'width', 'margin', 'padding', 'top', 'left', 'filter']) {
        expect(body, `${name} 不得动 ${banned}`).not.toContain(banned)
      }
    }
  })

  it('折叠快于展开（退出 120ms < 进入 200ms）', async () => {
    const root = varsOf(parseBlocks(await loadCss()).find((b) => b.selector.includes(':root'))!)
    const fast = parseFloat(root.get('--duration-fast') ?? '')
    const enter = parseFloat(root.get('--duration-enter') ?? '')
    expect(fast, '退出时长令牌缺失').toBeGreaterThan(0)
    expect(enter, '进入时长令牌缺失').toBeGreaterThan(0)
    expect(fast, '折叠应快于展开').toBeLessThan(enter)
  })
})

describe('renderer.css 可读性降级与动效', () => {
  function blockOf(blocks: CssBlock[], tag: string): CssBlock {
    const block = blocks.find((b) => b.selector.includes(tag))
    expect(block, `缺少降级 override 块: ${tag}`).toBeTruthy()
    return block!
  }

  it('减少透明度：材质退化为纯色（alpha 1、光学令牌全归零、模糊 0）', async () => {
    const body = blockOf(parseBlocks(await loadCss()), "data-reduce-transparency='1'").body
    expect(body).toContain('--mat-alpha: 1')
    expect(body).toMatch(/--mat-blur:\s*0px/)
    expect(body).toContain('--mat-edge-light: inset 0 0 0 transparent')
    expect(body).toContain('--mat-edge-thick: inset 0 0 0 transparent')
    expect(body).toContain('--mat-disperse: none')
    expect(body).not.toContain('--mat-veil')
    expect(body).toContain('--mat-glow: 0 0 0 transparent')
    expect(body).toContain('--mat-scene-op: 0')
    expect(body).toContain('--mat-refract: none')
  })

  it('高对比度：文字/描边重映射到 -hc 增强备用值', async () => {
    const body = blockOf(parseBlocks(await loadCss()), "data-high-contrast='1'").body
    expect(body).toContain('--txt-2: var(--txt-2-hc)')
    expect(body).toContain('--txt-3: var(--txt-3-hc)')
    expect(body).toContain('--line: var(--line-hc)')
    expect(body).toContain('--line-strong: var(--line-strong-hc)')
  })

  it('减少动态效果：全局过渡与动画禁用', async () => {
    const body = blockOf(parseBlocks(await loadCss()), "data-reduce-motion='1'").body
    expect(body).toContain('transition: none')
    expect(body).toContain('animation: none')
  })

  it('转场克制：全部动效时长 ≤ 300ms', async () => {
    const css = (await loadCss()).replace(/\/\*[\s\S]*?\*\//g, '')
    const durations: number[] = []
    for (const m of css.matchAll(/(?:transition|animation)\s*:[^;{}]+/g)) {
      for (const t of m[0].matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) {
        durations.push(t[2] === 's' ? parseFloat(t[1]) * 1000 : parseFloat(t[1]))
      }
    }
    for (const d of durations) {
      expect(d, `动效时长 ${d}ms 超出克制上限`).toBeLessThanOrEqual(300)
    }
  })
})

/* ---------- 降级与系统偏好（T-A7） ---------- */

describe('降级与系统偏好（T-A7）', () => {
  const APP_PATH = resolve(__dirname, '../../src/renderer/src/App.tsx')
const SP_PATH = resolve(__dirname, '../../src/renderer/src/settings/SettingsPage.tsx')

  it('尊重系统 prefers-reduced-motion：独立根属性同样关闭全部动效', async () => {
    const blocks = parseBlocks(await loadCss())
    const sys = blocks.find((b) => b.selector.includes("data-sys-reduce-motion='1'"))
    expect(sys, '缺少 [data-sys-reduce-motion] 规则（系统偏好未接入）').toBeTruthy()
    expect(sys!.body, '系统偏好应关闭过渡').toContain('transition: none')
    expect(sys!.body, '系统偏好应关闭动画').toContain('animation: none')
    // 应用内开关语义不得被系统偏好污染：既有集成测试断言 data-reduce-motion 反映用户设置
    const user = blocks.find((b) => b.selector.includes("data-reduce-motion='1'"))
    expect(user, '缺少 [data-reduce-motion] 规则').toBeTruthy()
    expect(user!.body, '用户开关同样关闭过渡').toContain('transition: none')
  })

  it('低配模式：减少透明度 + 减少动态效果同时开启即隐藏底图层（等价"关底图"）', async () => {
    const blocks = parseBlocks(await loadCss())
    const rule = blocks.find(
      (b) =>
        b.selector.includes("data-reduce-transparency='1'") &&
        b.selector.includes("data-reduce-motion='1'") &&
        b.selector.includes('.wallpaper')
    )
    expect(rule, '缺少低配模式隐藏底图的规则').toBeTruthy()
    expect(rule!.body, '低配模式应隐藏底图层').toContain('display: none')
  })

  it('帧率降级改用通用选择器（不再维护元素清单，避免漏项）', async () => {
    const blocks = parseBlocks(await loadCss())
    const block = blocks.find((b) => b.selector.includes("data-motion-low='1'"))
    expect(block, '缺少 [data-motion-low] 规则').toBeTruthy()
    // 注意剥注释：parseBlocks 会把前置注释并入 selector，而注释结尾的 `*/` 含 `*`，
    // 不剥就会"因错误理由通过"。
    const sel = block!.selector.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(sel, 'motion-low 应作用于全部元素（含开关滑块等易漏项）').toContain('*')
    expect(sel, '不应再逐个列元素').not.toContain('.switch-knob')
  })

  it('降级规则特异性必须高于组件规则（否则被后置的 .card{transition} 覆盖）', async () => {
    const blocks = parseBlocks(await loadCss())
    // 历史 bug：`[data-reduce-motion='1'] *` 特异性 (0,1,0) 与 `.card{transition}` 相同，
    // 且位置更靠前 → 被覆盖，"减少动态效果"只改了属性却没真关掉动效（运行时实测发现）。
    // 故三条降级规则必须带 `:root` 前缀（→ (0,2,0)）。
    for (const attr of ['data-reduce-motion', 'data-sys-reduce-motion', 'data-motion-low']) {
      const block = blocks.find((b) => b.selector.includes(`${attr}='1'`))
      expect(block, `缺少 ${attr} 降级规则`).toBeTruthy()
      const sel = block!.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim()
      expect(sel, `${attr} 降级规则必须以 :root 提升特异性`).toMatch(/^:root\[/)
    }
  })

  it('App 接入系统偏好：监听 prefers-reduced-motion 并写独立根属性', async () => {
    const src = (await readFile(APP_PATH, 'utf8')) + (await readFile(SP_PATH, 'utf8'))
    expect(src, '应监听 prefers-reduced-motion').toContain('prefers-reduced-motion: reduce')
    expect(src, '应写 data-sys-reduce-motion 根属性').toContain('data-sys-reduce-motion')
    expect(src, '系统偏好变化应可响应（addEventListener change）').toMatch(/addEventListener\('change'/)
  })

  it('低配模式主开关：由两个既有开关派生，不新增配置字段', async () => {
    const src = (await readFile(APP_PATH, 'utf8')) + (await readFile(SP_PATH, 'utf8'))
    expect(src, '缺少低配模式开关').toContain('switch-low-spec')
    // 派生而非新字段：checked 必须同时依赖两个既有布尔
    const m = /switch-low-spec[\s\S]{0,400}?checked=\{([^}]+)\}/.exec(src)
    expect(m, '未找到低配模式开关的 checked 表达式').toBeTruthy()
    expect(m![1], '低配模式应由 reduceTransparency 派生').toContain('reduceTransparency')
    expect(m![1], '低配模式应由 reduceMotion 派生').toContain('reduceMotion')
  })
})

/* ---------- 玻璃悬停高光（T-A8） ---------- */

describe('玻璃悬停高光（T-A8）', () => {
  const GLASS_HOVER_SELECTORS = ['.side', '.tool-bar', '.modal-panel', '.nav-dropdown', '.tool-slot']

  /** 取某档材质令牌块（tierVars 定义在另一个 describe 内，此处需本地副本）。 */
  function tierVarsOf(blocks: CssBlock[], tier: string): Map<string, string> {
    const block = blocks.find((b) => b.selector.includes(`data-material='${tier}'`))
    expect(block, `缺少材质档令牌块: ${tier}`).toBeTruthy()
    return varsOf(block!)
  }

  it('三档材质都定义 --mat-edge-light-hover（同名同集约束）', async () => {
    const blocks = parseBlocks(await loadCss())
    for (const tier of ['1', '2', '3']) {
      expect(tierVarsOf(blocks, tier).has('--mat-edge-light-hover'), `档 ${tier} 缺少悬停高光令牌`).toBe(
        true
      )
    }
  })

  it('悬停只轻移顶缘高光位置：幅度 ≤4px 且强度不变', async () => {
    const blocks = parseBlocks(await loadCss())
    const alphaOf = (v: string | undefined): string =>
      (/([\d.]+)\s*\)/.exec(v ?? '') ?? [])[1] ?? ''
    const offsetOf = (v: string | undefined): number =>
      parseFloat(/(?:inset\s+0\s+)([\d.]+)px/.exec(v ?? '')?.[1] ?? '')
    for (const tier of ['1', '2', '3']) {
      const vars = tierVarsOf(blocks, tier)
      const rest = vars.get('--mat-edge-light')
      const hover = vars.get('--mat-edge-light-hover')
      expect(hover, `档 ${tier} 悬停高光应为 inset 阴影`).toContain('inset')
      const off = offsetOf(hover)
      expect(off, `档 ${tier} 悬停高光应有位移`).toBeGreaterThan(0)
      expect(off, `档 ${tier} 悬停高光位移 ${off}px 过大（应 ≤4px）`).toBeLessThanOrEqual(4)
      expect(off, `档 ${tier} 悬停高光位移应大于静止态（即"动了位置"）`).toBeGreaterThan(offsetOf(rest))
      expect(alphaOf(hover), `档 ${tier} 悬停只动位置、不动强度`).toBe(alphaOf(rest))
    }
  })

  it('不给每个卡片加：悬停高光只作用于 chrome 与浮层', async () => {
    const css = (await loadCss()).replace(/\/\*[\s\S]*?\*\//g, '')
    const hoverBlocks = parseBlocks(css).filter((b) => b.body.includes('var(--mat-edge-light-hover)'))
    expect(hoverBlocks.length, '缺少悬停高光消费规则').toBeGreaterThan(0)
    const all = hoverBlocks.map((b) => b.selector).join(' ')
    for (const sel of GLASS_HOVER_SELECTORS) {
      expect(all, `悬停高光应覆盖 ${sel}`).toContain(sel)
    }
    expect(all, '.card 属于静态卡片，不得加悬停高光').not.toMatch(/\.card\b/)
  })

  it('不持续流动：无无限动画、无背景位移/视差', async () => {
    const css = (await loadCss()).replace(/\/\*[\s\S]*?\*\//g, '')
    const hoverBlocks = parseBlocks(css).filter((b) => b.body.includes('var(--mat-edge-light-hover)'))
    for (const b of hoverBlocks) {
      expect(b.body, '悬停高光不得用动画（只做状态过渡）').not.toContain('animation')
      expect(b.body, '不得做背景位移（视差/流动）').not.toContain('background-position')
      expect(b.body, '不得做持续流动').not.toContain('infinite')
    }
  })
})

/* ---------- 列表项错峰入场（T-A6） ---------- */

describe('列表项错峰入场（T-A6）', () => {
  function keyframeBody(css: string, name: string): string {
    const start = css.indexOf(`@keyframes ${name}`)
    expect(start, `缺少关键帧 ${name}`).toBeGreaterThanOrEqual(0)
    return css.slice(start, css.indexOf('\n}', start))
  }

  it('新增错峰步长令牌，取值落在规范区间 20–30ms', async () => {
    const root = varsOf(parseBlocks(await loadCss()).find((b) => b.selector.includes(':root'))!)
    const raw = root.get('--duration-stagger')
    expect(raw, '缺少 --duration-stagger').toBeTruthy()
    const ms = parseFloat(raw!)
    expect(ms, `错峰步长 ${ms}ms 低于 20ms`).toBeGreaterThanOrEqual(20)
    expect(ms, `错峰步长 ${ms}ms 高于 30ms`).toBeLessThanOrEqual(30)
  })

  it('错峰入场关键帧：淡入 + 上移，只动 opacity/transform', async () => {
    const css = (await loadCss()).replace(/\/\*[\s\S]*?\*\//g, '')
    const body = keyframeBody(css, 'el-item-in')
    expect(body, '应自透明开始').toMatch(/opacity:\s*0/)
    expect(body, '应有位移（上移）').toMatch(/translateY\(/)
    for (const banned of ['width', 'height', 'margin', 'padding', 'filter', 'box-shadow', 'left', 'top']) {
      expect(body, `不得动 ${banned}`).not.toContain(banned)
    }
  })

  it('列表项消费错峰令牌 + backwards 填充（避免延迟期间闪现终态）', async () => {
    const css = await loadCss()
    const item = parseBlocks(css).find((b) => /(^|\s)\.nav-dropdown-item$/.test(b.selector))
    expect(item, '缺少 .nav-dropdown-item 基础块').toBeTruthy()
    expect(item!.body, '列表项应有错峰入场动画').toContain('el-item-in')
    expect(item!.body, '动画应消费时长令牌').toContain('var(--duration-')
    expect(item!.body, '动画应消费缓动令牌').toContain('var(--ease-')
    expect(item!.body, '需 backwards 填充：延迟期间保持起始态，否则会闪一下终态').toContain('backwards')
    // 逐项延迟必须走错峰令牌（不得出现裸 ms）
    const delays = [...css.matchAll(/animation-delay:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(delays.length, '缺少逐项延迟规则').toBeGreaterThan(0)
    for (const d of delays) {
      expect(d, `延迟 ${d} 应消费错峰令牌`).toContain('var(--duration-stagger)')
    }
  })

  it('错峰步数有上限：末档延迟 + 动画时长 ≤ 300ms 预算', async () => {
    const css = await loadCss()
    const root = varsOf(parseBlocks(css).find((b) => b.selector.includes(':root'))!)
    const stagger = parseFloat(root.get('--duration-stagger')!)
    const anim = parseFloat(root.get('--duration-fast')!)
    // 取延迟表达式里的最大倍数
    const mults = [...css.matchAll(/animation-delay:\s*calc\(var\(--duration-stagger\)\s*\*\s*(\d+)\)/g)].map(
      (m) => parseInt(m[1], 10)
    )
    expect(mults.length, '未找到 calc 形式的延迟').toBeGreaterThan(0)
    const maxMult = Math.max(...mults)
    const total = maxMult * stagger + anim
    expect(total, `错峰总时长 ${total}ms 超出 300ms 预算`).toBeLessThanOrEqual(300)
    // 上限应显式落在第 6 项（n+6）上，避免长列表无限递增
    expect(css, '应有一条覆盖第 6 项及以后的延迟规则').toMatch(/nth-child\(n\s*\+\s*6\)/)
  })

  it('不给每个卡片加动画（规范明确排除静态卡片）', async () => {
    const css = (await loadCss()).replace(/\/\*[\s\S]*?\*\//g, '')
    // .card 自身不得带入场动画；错峰只作用于真正的列表项
    const card = parseBlocks(css).find((b) => /(^|\s)\.card$/.test(b.selector))
    expect(card, '缺少 .card 块').toBeTruthy()
    expect(card!.body, '.card 不得加入场动画').not.toContain('animation')
    expect(css, '设置分组卡不得加错峰动画').not.toMatch(/\.settings-group[^{]*\{[^}]*animation/)
  })
})

/* ---------- 字体随包可用（修既有缺陷：@font-face 404 静默回退） ---------- */

describe('字体随包可用', () => {
  const CSS_SRC = resolve(__dirname, '../../src/renderer/src/renderer.css')

  it('@font-face 的 url() 必须能在 CSS 源文件旁解析（否则打包后 404 → 静默回退系统字体）', async () => {
    // 剥注释：说明性注释里会引用历史上写错的 url('fonts/...')，不剥会被误判为真实引用
    const css = (await loadCss()).replace(/\/\*[\s\S]*?\*\//g, '')
    const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1].trim())
    const files = urls.filter((u) => !/^(data:|https?:|#|eclipse|var\()/.test(u))
    expect(files.length, '应存在本地字体引用').toBeGreaterThanOrEqual(5)
    const dir = dirname(CSS_SRC)
    for (const u of files) {
      const p = resolve(dir, u)
      expect(
        existsSync(p),
        `引用无法解析：${u} → ${p}（Vite 会在构建期报 "didn't resolve at build time"，` +
          `构建后 CSS 位于 assets/ 子目录，相对路径会指向不存在的目录）`
      ).toBe(true)
    }
  })

  it('字体不得留在 publicDir（public 资源无法被嵌套输出的 CSS 用相对路径解析）', () => {
    expect(
      existsSync(resolve(__dirname, '../../src/renderer/public/fonts')),
      '字体应放在 src/assets 下交由 Vite 构建期解析，而非 public/'
    ).toBe(false)
  })

  it('表单控件必须继承应用字体（Chromium UA 样式会强制 Arial）', async () => {
    const blocks = parseBlocks(await loadCss())
    const rule = blocks.find((b) => b.body.includes('font-family: inherit') && /button/.test(b.selector))
    expect(rule, '缺少 button/input/select/textarea 的 font-family: inherit').toBeTruthy()
    for (const el of ['button', 'input', 'select', 'textarea']) {
      expect(rule!.selector, `规则应覆盖 ${el}`).toContain(el)
    }
  })
})

/* ---------- 字体随包可用 END ---------- */

/* ---------- 键盘焦点环（T48） ---------- */

describe('键盘焦点环（T48）', () => {
  it('全站交互控件必须有 :focus-visible 焦点环（2px var(--acc)），缺一类即红', async () => {
    // parseBlocks 会把规则前的注释吞进 selector —— 一律先 stripComments 再断言（既有教训）。
    const blocks = parseBlocks(await loadCss()).map((b) => ({
      selector: stripComments(b.selector),
      body: b.body
    }))
    const focusBlocks = blocks.filter(
      (b) => b.selector.includes(':focus-visible') && b.body.includes('var(--acc)')
    )
    // 直接聚焦的控件类（环画在元素自身）
    const covered = [
      '.btn',
      '.nav-item',
      '.dock-item',
      '.dock-close-btn',
      '.seg',
      '.chip',
      '.input',
      '.select',
      '.slider'
    ]
    for (const cls of covered) {
      const hit = focusBlocks.find((b) =>
        b.selector.split(',').some((s) => s.trim().startsWith(`${cls}:focus-visible`))
      )
      expect(hit, `缺少 ${cls}:focus-visible 焦点环规则（颜色须为 var(--acc)）`).toBeTruthy()
      expect(hit!.body, `${cls} 焦点环必须是 2px outline`).toContain('outline: 2px solid')
    }
    // 开关：焦点在视觉隐藏的 input 上，环必须画在可见的轨道上
    const sw = focusBlocks.find((b) => b.selector.includes('.switch input:focus-visible + .switch-track'))
    expect(sw, '开关焦点环必须画在 .switch-track（input 视觉隐藏）').toBeTruthy()
  })

  it('焦点环不得用硬编码颜色（只许 var(--acc)）', async () => {
    const blocks = parseBlocks(await loadCss()).map((b) => ({
      selector: stripComments(b.selector),
      body: b.body
    }))
    for (const b of blocks.filter((x) => x.selector.includes(':focus-visible'))) {
      expect(b.body, `${b.selector} 的焦点环颜色必须走令牌`).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })
})

/* ---------- 键盘焦点环 END ---------- */

/* ---------- 档 3 帧率自动降档（T28） ---------- */

describe('shouldDegradeForFps（T28 档 3 帧率降档纯函数）', () => {
  it('空/样本不足 → 不降档', () => {
    expect(shouldDegradeForFps([])).toBe(false)
    expect(shouldDegradeForFps(Array(59).fill(30))).toBe(false)
  })

  it('60fps 健康（16.7ms 间隔）→ 不降档；低帧率（30ms 间隔 ≈33fps）→ 降档', () => {
    expect(shouldDegradeForFps(Array(120).fill(16.7))).toBe(false)
    expect(shouldDegradeForFps(Array(120).fill(30))).toBe(true)
    expect(shouldDegradeForFps(Array(120).fill(25))).toBe(true)
  })

  it('非正间隔样本 → 不降档（防御）', () => {
    expect(shouldDegradeForFps([0, 0, ...Array(60).fill(30)])).toBe(false)
    expect(shouldDegradeForFps(Array(60).fill(-5))).toBe(false)
  })

  it('阈值边界：<45 降、≥45 不降（含自定义阈值）', () => {
    // 22.2ms ≈ 45fps
    expect(shouldDegradeForFps(Array(60).fill(22.3))).toBe(true)
    expect(shouldDegradeForFps(Array(60).fill(22.1))).toBe(false)
    expect(shouldDegradeForFps(Array(60).fill(11.2), 90)).toBe(true) // 89fps < 90 阈值
  })
})
