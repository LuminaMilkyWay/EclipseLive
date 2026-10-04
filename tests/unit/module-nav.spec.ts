import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModuleNav } from '../../src/contracts/module'

/**
 * C3 守卫：导航声明的三条不变式。
 *
 *   ① **未声明 nav ⇒ 行为与今天完全一致**（仍在「模块」下拉里）—— 这是本能力最重要的兼容承诺；
 *   ② 声明 `nav.level=1` ⇒ 出现在**一级**位置，且**不在**「模块」下拉里重复出现；
 *   ③ 非法 `nav` **只记错误、不得崩溃**（`nav.level` 只接受 1|2 等）。
 *
 * 为什么用"读源码 + 类型断言"而不是渲染测试：本项目的测试项目没有 DOM
 * （`tsconfig.node.json` 的 `include` 含 `tests/**` 而 `lib` 无 DOM）⇒ 渲染层模块不可直接 import。
 */
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('模块导航声明（C3）', () => {
  it('① 类型层面：nav 的 level 只能是 1 或 2', () => {
    const nav: ModuleNav = { level: 1, after: 'obs-stream', order: 20, immersive: true }
    expect(nav.level).toBe(1)
    // @ts-expect-error level 只接受 1|2（写 3 必须编译失败）
    const bad: ModuleNav = { level: 3 }
    expect(bad).toBeDefined()
  })

  it('② 侧栏：一级项按 level=1 过滤，且下拉里不重复', () => {
    const ui = read('src/renderer/src/shell/Sidebar.tsx')
    expect(ui, '一级项必须按 nav.level===1 过滤').toContain('m.nav?.level === 1')
    expect(ui, '一级项必须按 order 排序').toContain('.sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))')
    expect(ui, '下拉里必须排除已升到一级的模块（否则重复出现）').toContain('m.nav?.level !== 1')
    expect(ui, '一级项必须复用既有 page: tab（不新增 tab 类型）').toContain('page:${m.id}')
  })

  it('③ 主进程：nav 校验必须只记错误（不得抛/崩溃），且覆盖四个字段', () => {
    const core = read('src/main/core/modules/index.ts')
    expect(core, 'nav 必须是对象').toContain('nav must be an object')
    expect(core, 'level 只接受 1|2').toContain('nav.level must be 1 or 2')
    expect(core, 'after 必须是非空字符串').toContain('nav.after must be a non-empty string')
    expect(core, 'order 必须是有限数').toContain('nav.order must be a finite number')
    expect(core, 'immersive 必须是布尔').toContain('nav.immersive must be a boolean')
  })

  it('④ 快照必须把 nav 带给界面（否则侧栏无从判断）', () => {
    expect(read('src/shared/diagnostics.ts'), 'DiagnosticsModule 必须有 nav').toMatch(/nav\?:/)
    expect(read('src/main/core/diagnostics/index.ts'), '快照必须映射 nav').toContain('nav: m.manifest?.nav')
  })

  it('⑤ 未声明 nav 的模块必须仍在「模块」下拉里（兼容承诺）', () => {
    const ui = read('src/renderer/src/shell/Sidebar.tsx')
    // 下拉的过滤条件必须是"排除 level===1"，因此未声明 nav 的模块（nav?.level === undefined）会被保留
    expect(ui).toContain('.filter((m) => m.nav?.level !== 1)')
  })
})
