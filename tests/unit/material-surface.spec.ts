import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 宿主面层材质守卫（两条纪律，都来自实测缺陷与官方口径）。
 *
 * ## 一、`--mat-veil` 已退休
 * 用户实测「所有功能菜单部分的矩形分区卡片下有一层半透明的灰色底图」。
 * 根因：材质 3 档下 `--mat-veil` 是一层 24% `--bg-card` 的**平面渐变**，被同时刷在卡片与槽位上
 * ⇒ 等于把不透明度刷两遍、并在深色主题下显成灰膜。修过一次又因契约旧模板复发，现已彻底退休。
 *
 * ## 二、层级纪律（T36，依据 Apple HIG「Don't use Liquid Glass in the content layer」）
 * - **内容层**（`.card` / `.module-page-host` / `.tool-slot`）用**标准材质**：
 *   半实色面（`--std-bg`）+ 描边（`--std-border`）+ 层级阴影，**不得有常驻 `backdrop-filter`**；
 * - **chrome 层**（`.side` 侧栏 / `.tool-bar` 工具条 / `.nav-dropdown` 下拉 /
 *   `.modal-panel` 弹窗 / `.toast` 提示）**保留玻璃**（`--card-bg` + `backdrop-filter`）。
 *
 * 收益：层次可辨（导航/内容/浮层一眼区分）+ 常驻模糊面积大幅下降（本方案性能收益最大的一步）。
 */

const CSS_PATH = join(process.cwd(), 'src/renderer/src/renderer.css')
const TOKENS_PATH = join(process.cwd(), 'src/renderer/src/ui-tokens.ts')

/** 抽出某个选择器的规则体（取第一处 `selector {` … 匹配的 `}`）。 */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `renderer.css 找不到规则 ${selector}`).toBeGreaterThanOrEqual(0)
  const end = css.indexOf('}', start)
  return css.slice(start, end + 1)
}

const CONTENT_SURFACES = ['.card', '.module-page-host', '.tool-slot']
const CHROME_SURFACES = ['.side', '.tool-bar', '.nav-dropdown', '.modal-panel', '.toast']

describe('层级纪律：内容层标准材质 / chrome 层玻璃（Apple HIG）', () => {
  it('内容层面：恢复原有玻璃配方（用户要求；配方与 chrome 同源，但不含 veil）', async () => {
    const css = await readFile(CSS_PATH, 'utf8')
    for (const selector of CONTENT_SURFACES) {
      const body = ruleBody(css, selector)
      // 用户明确要求"恢复原有三档材质效果" ⇒ 内容层回到 T36 之前的玻璃配方：
      // 半透明底（--card-bg）+ blur/saturate + 材质描边 + 边缘高光/厚度/光晕/阴影。
      expect(
        body.includes('--card-bg'),
        `${selector} 应使用玻璃底 --card-bg（内容层已恢复原有玻璃配方）`
      ).toBe(true)
      expect(
        /backdrop-filter\s*:\s*blur\(var\(--mat-blur\)\)/.test(body),
        `${selector} 应有材质模糊（与档位令牌联动）`
      ).toBe(true)
      expect(
        body.includes('--mat-edge-light'),
        `${selector} 应消费材质边缘高光令牌`
      ).toBe(true)
      // 唯一仍然禁止的：整面薄纱（AI_RULES 24）
      expect(/var\(--mat-veil\)/.test(body), `${selector} 不得使用整面薄纱 --mat-veil`).toBe(false)
    }
  })

  it('chrome 层面：保留玻璃（--card-bg + backdrop-filter）', async () => {
    const css = await readFile(CSS_PATH, 'utf8')
    for (const selector of CHROME_SURFACES) {
      const body = ruleBody(css, selector)
      expect(
        /backdrop-filter\s*:/.test(body),
        `${selector} 属 chrome，应保留玻璃光学（backdrop-filter）`
      ).toBe(true)
      expect(body.includes('--card-bg') || body.includes('--bg-card'), `${selector} 缺玻璃底色`).toBe(
        true
      )
    }
  })

  it('标准材质令牌在位（内容层配方：底色 + 描边 + 阴影，且随主题）', async () => {
    const css = await readFile(CSS_PATH, 'utf8')
    for (const t of ['--std-bg:', '--std-border:', '--std-shadow-1:', '--std-shadow-2:']) {
      expect(css.includes(t), `renderer.css 缺少标准材质令牌 ${t}`).toBe(true)
    }
    // 浅色主题需要更轻的阴影（同一套黑色阴影压在白面上会脏）
    const lightStart = css.indexOf("[data-theme='light'] {")
    expect(lightStart).toBeGreaterThanOrEqual(0)
    const lightBody = css.slice(lightStart, css.indexOf('}', lightStart))
    expect(lightBody.includes('--std-shadow-1'), '浅色主题应覆盖标准材质阴影').toBe(true)
  })

  it('标准材质令牌注入模块页（模块页也是内容层）', async () => {
    const tokens = await readFile(TOKENS_PATH, 'utf8')
    for (const t of ["'--std-bg'", "'--std-border'", "'--std-shadow-1'", "'--std-shadow-2'"]) {
      expect(tokens.includes(t), `ui-tokens 白名单缺少 ${t}`).toBe(true)
    }
  })
})

describe('宿主面层材质：--mat-veil 已退休', () => {
  it('renderer.css 里既无定义也无使用', async () => {
    const css = await readFile(CSS_PATH, 'utf8')
    const lines = css.split('\n')
    const defs: number[] = []
    const uses: number[] = []
    lines.forEach((line, i) => {
      // 只看**声明与使用**：注释里解释"已退休"是允许且鼓励的
      if (/^\s*--mat-veil\s*:/.test(line)) defs.push(i + 1)
      if (line.includes('var(--mat-veil)')) uses.push(i + 1)
    })
    expect(defs, `--mat-veil 的令牌定义必须删除（仍在第 ${defs.join(', ')} 行）`).toEqual([])
    expect(uses, `--mat-veil 的使用必须清空（仍在第 ${uses.join(', ')} 行）`).toEqual([])
  })

  it('注入白名单同样不再暴露 --mat-veil', async () => {
    const tokens = await readFile(TOKENS_PATH, 'utf8')
    expect(tokens.includes("'--mat-veil'"), 'ui-tokens 白名单不得再注入 --mat-veil').toBe(false)
  })
})
