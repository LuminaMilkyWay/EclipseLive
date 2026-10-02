import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 模块页 UI 契约（MODULE_UI_CONTRACT.md §6）——机械强制，代替散文约束：
 * 扫描 modules 下各模块 pages 目录的 *.html，非豁免页面（无 canvas meta）逐条硬校验：
 *   1. 整页零颜色字面量（hex / rgb / hsl）——颜色只来自宿主注入令牌；
 *   2. border-radius 只许 var(--r-*)（零数字）；
 *   3. html,body 联合块：margin:0 + min-height（铺满槽位矩形 = 显示面积）；
 *   4. body 块必须 background: transparent（材质底由宿主槽位提供，不自绘画布）；
 *   5. 必须消费 --mat-*、--bg-*、--txt-*、--acc-*、--r-*、--sp-* 令牌。
 * 豁免（OBS 浏览器源 / 悬浮窗画布）必须在 head 显式声明
 * canvas meta（name=eclipse-ui-context），否则按非豁免处理。
 */

const MODULES_ROOT = resolve(process.cwd(), 'modules')
const CANVAS_META = /<meta\s+name="eclipse-ui-context"\s+content="canvas"\s*\/?>/i
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/
const BORDER_RADIUS_DIGIT = /border-radius\s*:\s*[^;}]*\d/
const HTML_BODY_AREA = /html\s*,\s*body\s*\{[^}]*margin:\s*0[^}]*min-height:\s*[^;}]*;?\s*\}/
const BODY_TRANSPARENT = /body\s*\{[^}]*background:\s*transparent[^}]*\}/
const CONSUMES_TOKENS = /var\(--(?:mat|bg|txt|acc|r-|sp-)/

/** 列出仓库 modules 下所有页面 HTML（无 pages 目录的模块自动跳过）。 */
async function listPageHtmlFiles(): Promise<string[]> {
  const out: string[] = []
  const modules = await readdir(MODULES_ROOT, { withFileTypes: true })
  for (const mod of modules) {
    if (!mod.isDirectory()) continue
    const pagesDir = join(MODULES_ROOT, mod.name, 'pages')
    let files: string[] = []
    try {
      files = await readdir(pagesDir)
    } catch {
      continue
    }
    for (const f of files) {
      if (f.endsWith('.html')) out.push(join(pagesDir, f))
    }
  }
  return out
}

describe('模块页 UI 契约（MODULE_UI_CONTRACT.md §6 机械强制）', () => {
  it('非豁免页面整页零颜色字面量（颜色只来自宿主注入令牌）', async () => {
    for (const file of await listPageHtmlFiles()) {
      const html = await readFile(file, 'utf8')
      if (CANVAS_META.test(html)) continue
      expect(
        COLOR_LITERAL.test(html),
        `${file} 含硬编码颜色字面量（MODULE_UI_CONTRACT.md §3-1）`
      ).toBe(false)
    }
  })

  it('非豁免页面 border-radius 只走 var(--r-*)（区域圆角，零数字）', async () => {
    for (const file of await listPageHtmlFiles()) {
      const html = await readFile(file, 'utf8')
      if (CANVAS_META.test(html)) continue
      expect(
        BORDER_RADIUS_DIGIT.test(html),
        `${file} 出现数字圆角（MODULE_UI_CONTRACT.md §3-4，只许 var(--r-*)）`
      ).toBe(false)
    }
  })

  it('非豁免页面铺满槽位矩形（html,body margin:0 + min-height = 显示面积）', async () => {
    for (const file of await listPageHtmlFiles()) {
      const html = await readFile(file, 'utf8')
      if (CANVAS_META.test(html)) continue
      expect(
        HTML_BODY_AREA.test(html),
        `${file} 未铺满槽位矩形：html,body 需 margin:0 + min-height（MODULE_UI_CONTRACT.md §5）`
      ).toBe(true)
    }
  })

  it('非豁免页面 body 透明（材质底由宿主槽位提供，不自绘画布底）', async () => {
    for (const file of await listPageHtmlFiles()) {
      const html = await readFile(file, 'utf8')
      if (CANVAS_META.test(html)) continue
      expect(
        BODY_TRANSPARENT.test(html),
        `${file} body 未声明 background: transparent（MODULE_UI_CONTRACT.md §3-3）`
      ).toBe(true)
    }
  })

  it('非豁免页面消费宿主令牌（--mat-*/--bg-*/--txt-*/--acc-*/--r-*/--sp-*）', async () => {
    for (const file of await listPageHtmlFiles()) {
      const html = await readFile(file, 'utf8')
      if (CANVAS_META.test(html)) continue
      expect(
        CONSUMES_TOKENS.test(html),
        `${file} 未消费任何宿主设计令牌（MODULE_UI_CONTRACT.md §1/§2）`
      ).toBe(true)
    }
  })

  /**
   * §2 强制模板 / §7 上线清单：**内容层标准材质**（T36 层级纪律）。
   *
   * 依据 Apple HIG「Don't use Liquid Glass in the content layer」：模块功能页属内容层，
   * 分组卡片 = `--std-bg`（半实色面）+ `--std-border` + `--std-shadow-1/2` + `--r-lg`。
   *
   * 两条反向禁令（都是踩过的坑）：
   * 用户 2026-10-02 拍板 **A**：推翻 T36"内容层不用玻璃"的约定 —— 模块功能页的分组卡片
   * **必须与宿主 `.card` 同配方**（玻璃材质），否则档 4 下模块页明显比周围"更平"（用户实测反馈）。
   * 仍然禁止：
   * - `--mat-veil`：材质 3 档下是 24% 平面渐变，会糊出"半透明灰色底图"（用户实测，复发过两次）；
   * - 硬编码颜色（另有用例保证）。
   */
  it('非豁免页面的分组卡片与宿主 .card 同配方（玻璃材质 + --mat-* + --r-lg；仍禁 --mat-veil）', async () => {
    for (const file of await listPageHtmlFiles()) {
      const html = await readFile(file, 'utf8')
      if (CANVAS_META.test(html)) continue
      for (const [needle, why] of [
        ['var(--card-bg)', '缺 var(--card-bg)（与宿主 .card 同底色）'],
        ['var(--mat-blur)', '缺 var(--mat-blur)（材质档位模糊）'],
        ['var(--mat-sat)', '缺 var(--mat-sat)（材质档位饱和度）'],
        ['var(--mat-border)', '缺 var(--mat-border)（材质描边）'],
        ['var(--r-lg)', '缺 var(--r-lg)（分组卡片圆角）']
      ] as Array<[string, string]>) {
        expect(
          html.includes(needle),
          `${file} ${why} —— 配方见 MODULE_UI_CONTRACT.md §2 / §7 与宿主 renderer.css 的 .card`
        ).toBe(true)
      }
      expect(
        html.includes('var(--mat-veil)'),
        `${file} 使用了 --mat-veil（已退休：3 档下是 24% 灰面，会糊出灰色底图）`
      ).toBe(false)
      // backdrop-filter：用户拍板 A 后**必需**（内容层与宿主一致）；canvas 豁免页已跳过
      expect(
        /backdrop-filter\s*:/.test(html),
        `${file} 缺 backdrop-filter —— 用户已拍板内容层与宿主 .card 同配方（玻璃材质）`
      ).toBe(true)
    }
  })
})
