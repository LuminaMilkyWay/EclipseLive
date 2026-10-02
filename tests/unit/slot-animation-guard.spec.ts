import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * 档 4 槽位动画守卫（用户实测回归：web 页在档 4"突破浮动面板"）。
 *
 * 机制定论：`.module-page-host` / `.tool-slot` 里嵌的是**原生 WebContentsView** ——
 * DOM 容器被缩放时原生层不跟着缩放 ⇒ 任何加在槽位上的入场/缩放动画都会让页面"顶出面板"。
 * 本守卫钉死：槽位在档 4 必须 `animation: none`，且 materialize 关键帧不得作用到槽位选择器。
 */
const CSS_PATH = resolve(__dirname, '../../src/renderer/src/renderer.css')

/** 去掉注释，避免注释里的示例选择器造成误判。 */
function strip(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('档 4：嵌原生视图的槽位不得参与动画', () => {
  it('存在"槽位 animation: none"的档 4 覆盖规则', async () => {
    const css = strip(await readFile(CSS_PATH, 'utf8'))
    const re = /\[data-material='4'\] \.module-page-host,\s*\[data-material='4'\] \.tool-slot\s*\{\s*animation:\s*none;\s*\}/
    expect(re.test(css), '缺少"档 4 槽位 animation: none"覆盖（web 页会突破浮动面板）').toBe(true)
  })

  it('materialize 关键帧不得再作用到槽位（提取规则块的选择器后断言）', async () => {
    const css = strip(await readFile(CSS_PATH, 'utf8'))
    // 逐个规则块提取：`选择器 { … 声明 … }`，只取含 animation-name: el-materialize-* 的块
    const re = /([^{}]+)\{([^{}]*animation-name:\s*el-materialize-[^{}]*)\}/g
    let m: RegExpExecArray | null
    let checked = 0
    while ((m = re.exec(css)) !== null) {
      checked++
      const selector = m[1].trim()
      expect(
        selector.includes('.tool-slot') || selector.includes('.module-page-host'),
        `materialize 动画不得作用在槽位上，实际选择器：${selector}`
      ).toBe(false)
    }
    expect(checked, '应至少找到一条 materialize 规则（否则守卫形同虚设）').toBeGreaterThan(0)
  })
})
