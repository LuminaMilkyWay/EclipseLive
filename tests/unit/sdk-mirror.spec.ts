import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * P4 守卫：`sdk/` 必须是主仓的**逐字节镜像**。
 *
 * 为什么重要：`sdk/`（含 `contracts/` 与 `templates/`）采用 **MIT**，
 * 是"模块作者不必接触 AGPL 核心"这一承诺的**唯一物理载体**。
 * 一旦它与 `src/contracts/` 漂移，社区拿到的接口就是**过期或错误**的 ⇒ 生态信任崩塌。
 * 因此这里做**双向文件清单 + 逐字节比对**：任何差异（新增/删除/改动）都会变红。
 */
const ROOT = resolve(process.cwd())
const PAIRS: Array<[string, string]> = [
  ['src/contracts', 'sdk/contracts'],
  ['templates', 'sdk/templates']
]

/** 递归列出相对文件路径（排除空目录差异，只看文件）。 */
function listFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base))
    else out.push(relative(base, full).replace(/\\/g, '/'))
  }
  return out.sort()
}

describe('SDK 镜像一致性（P4）', () => {
  it('sdk/ 必须有 MIT LICENSE（授权落纸）', () => {
    const lic = readFileSync(join(ROOT, 'sdk/LICENSE'), 'utf8')
    expect(lic, 'sdk/LICENSE 应为 MIT 全文').toContain('MIT License')
    expect(lic, 'sdk/LICENSE 不得是 AGPL').not.toContain('GNU AFFERO')
  })

  for (const [src, dst] of PAIRS) {
    it(`${dst} 与 ${src} 文件清单一致`, () => {
      const a = listFiles(join(ROOT, src))
      const b = listFiles(join(ROOT, dst))
      expect(b, `${dst} 与 ${src} 的文件清单不同 —— 请运行 node scripts/sync-sdk.mjs`).toEqual(a)
    })

    it(`${dst} 与 ${src} 逐字节一致`, () => {
      const diffs: string[] = []
      for (const rel of listFiles(join(ROOT, src))) {
        const x = readFileSync(join(ROOT, src, rel))
        const y = readFileSync(join(ROOT, dst, rel))
        if (!x.equals(y)) diffs.push(rel)
      }
      expect(diffs, `${dst} 内容与 ${src} 不一致（运行 node scripts/sync-sdk.mjs）：${diffs.join(', ')}`).toEqual([])
    })
  }
})
