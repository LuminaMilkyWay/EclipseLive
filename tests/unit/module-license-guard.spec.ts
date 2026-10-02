import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LICENSE_SPDX_PATTERN } from '../../src/contracts/module'

/**
 * 模块协议守卫（P3 · 用户批准的最优方案）。
 *
 * 规则（与根 `NOTICE` 第 3 节一致）：
 *  ① 每个模块的 `manifest.json` **必须**声明 `license`（SPDX 标识符，可校验格式）；
 *  ② 模块目录内**必须**有 `LICENSE` 文件（包内携带协议，分发时才不丢）；
 *  ③ 模块骨架 `templates/module/` **必须**同时具备两者 ⇒ 新模块天然合规；
 *  ④ 缺失协议**不得**被默认当作 MIT（核心不替作者授权）—— 本守卫只强制**官方/模板**必须声明，
 *     社区模块由安装器另做"未声明 ⇒ 警示"处理（T65）。
 */
const MODULES = resolve(process.cwd(), 'modules')

describe('模块协议（manifest.license + LICENSE 文件）', () => {
  it('① 官方/示例模块：license 合法 + 目录内有 LICENSE', () => {
    const dirs = readdirSync(MODULES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    expect(dirs.length, '应至少扫到一个模块目录').toBeGreaterThan(0)
    const bad: string[] = []
    for (const d of dirs) {
      const mp = join(MODULES, d, 'manifest.json')
      if (!existsSync(mp)) continue
      const j = JSON.parse(readFileSync(mp, 'utf8')) as { license?: string; licenseFile?: string }
      if (!j.license) bad.push(`${d}: manifest.json 缺 license 字段`)
      else if (!LICENSE_SPDX_PATTERN.test(j.license)) bad.push(`${d}: license 不是合法 SPDX 标识符（${j.license}）`)
      const lf = j.licenseFile ?? 'LICENSE'
      if (!existsSync(join(MODULES, d, lf))) bad.push(`${d}: 目录内缺 ${lf}`)
    }
    expect(bad, '模块协议不合规：\n  ' + bad.join('\n  ')).toEqual([])
  })

  it('② 模块骨架 templates/module：自带 license 字段与 LICENSE（复制即可用）', () => {
    const mp = resolve(process.cwd(), 'templates/module/manifest.json')
    expect(existsSync(mp), '模板缺 manifest.json').toBe(true)
    const j = JSON.parse(readFileSync(mp, 'utf8')) as { license?: string }
    expect(j.license, '模板 manifest 必须声明 license（新模块天然合规）').toBe('MIT')
    expect(existsSync(resolve(process.cwd(), 'templates/module/LICENSE')), '模板目录缺 LICENSE').toBe(true)
  })

  it('③ 契约层提供 SPDX 校验模式（类型与常量，不引入实现）', () => {
    expect(LICENSE_SPDX_PATTERN.test('MIT')).toBe(true)
    expect(LICENSE_SPDX_PATTERN.test('AGPL-3.0-or-later')).toBe(true)
    expect(LICENSE_SPDX_PATTERN.test('UNLICENSED')).toBe(true)
    expect(LICENSE_SPDX_PATTERN.test('contains space')).toBe(false)
  })
})
