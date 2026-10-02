import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * T66 守卫：模块协议必须在**界面可见**（P3 第三步）。
 * ① 快照模块条目带 `license`（可选；缺失 = 未声明）；
 * ② 快照构建（core/diagnostics）带上 `manifest.license`；
 * ③ 界面渲染协议 chip，缺失时给出警示（不得静默隐藏）。
 */
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('模块协议在界面可见（T66/P3）', () => {
  it('① 快照契约：模块条目含可选 license', () => {
    expect(read('src/shared/diagnostics.ts'), '必须含 license?: string').toMatch(/license\?:\s*string/)
  })
  it('② 快照构建：core/diagnostics 带上 manifest.license', () => {
    expect(read('src/main/core/diagnostics/index.ts'), '快照必须携带 license').toMatch(/license:\s*m\.manifest\?\.license/)
  })
  it('③ 界面：渲染协议 chip，缺失时警示「未声明」', () => {
    const ui = read('src/renderer/src/settings/ModuleManagePanel.tsx')
    expect(ui, '必须渲染协议 chip').toContain('module-license')
    expect(ui, '缺失时必须警示（不得静默隐藏）').toContain('module-license-missing')
    expect(ui, '文案应明确「未声明协议」').toContain('未声明协议')
    const css = read('src/renderer/src/renderer.css')
    expect(css).toContain('.chip-license')
    expect(css).toContain('.chip-warn')
  })
})
