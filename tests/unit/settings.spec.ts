import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SETTINGS_GROUPS } from '../../src/shared/settingsGroups'

/* ---------- SETTINGS_GROUPS（T16 设置框架） ---------- */

describe('SETTINGS_GROUPS', () => {
  it('恰好 6 组，id 与顺序符合规格', () => {
    expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual([
      'appearance',
      'features',
      'modules',
      'connection',
      'diagnostics',
      'advanced'
    ])
  })

  it('id 唯一、title/description 非空', () => {
    const ids = new Set(SETTINGS_GROUPS.map((g) => g.id))
    expect(ids.size, '组 id 需唯一').toBe(SETTINGS_GROUPS.length)
    for (const g of SETTINGS_GROUPS) {
      expect(g.title.length, `${g.id} title`).toBeGreaterThan(0)
      expect(g.description.length, `${g.id} description`).toBeGreaterThan(0)
    }
  })
})

/* ---------- renderer.css 设置组（T16） ---------- */

describe('renderer.css 设置组', () => {
  it('分组卡片与分段控件消费设计令牌（间距/圆角/强调色）', async () => {
    const css = await readFile(resolve(__dirname, '../../src/renderer/src/renderer.css'), 'utf8')
    expect(css, '.settings-group 应消费 --sp-* 间距').toMatch(/\.settings-group\s*\{[^}]*var\(--sp-/)
    expect(css, '.seg 应消费 --r-md 圆角').toMatch(/\.seg\s*\{[^}]*var\(--r-md\)/)
    // v0.1.8-beta1.1：控件描边改走 --ctrl-line（浅色下 --line 与卡片同色，控件会"消失"）
    expect(css, '.seg 应消费 --ctrl-line 描边').toMatch(/\.seg\s*\{[^}]*var\(--ctrl-line\)/)
    expect(css, '.seg.active 应消费 --acc 实底').toMatch(/\.seg\.active\s*\{[^}]*var\(--acc\)/)
    // 原先断言「必须消费 --acc-soft」——那正是对比度缺陷（--acc-soft 底 + 白字 ≈1.5:1）；
    // 现改为要求专用前景色 --ink-on-acc（≈8.5:1），且不得再用 --acc-soft 作底。
    expect(css, '.seg.active 应消费 --ink-on-acc 前景').toMatch(/\.seg\.active\s*\{[^}]*var\(--ink-on-acc\)/)
    expect(css, '.seg.active 不得用 --acc-soft 作底').not.toMatch(/\.seg\.active\s*\{[^}]*var\(--acc-soft\)/)
  })
})
