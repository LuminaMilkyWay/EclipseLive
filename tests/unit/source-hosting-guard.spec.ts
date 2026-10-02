import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 源码托管一致性守卫（T61，用户 2026-10-02 决定"仓库地址暂时留空"）。
 *
 * 背景：核心为 AGPL-3.0 ⇒ **分发时必须能提供"对应源码"**。在托管地址确定之前，
 * 对外分发二进制是不合规的。本守卫把"留空"这件事变成**双向机械约束**：
 *   ① `package.json` 无 `repository`  ⇒ `NOTICE` **必须**含"源码托管地址待定"警示（防被无声删除）；
 *   ② `package.json` 有 `repository`  ⇒ 警示**必须**移除，且地址须出现在 `NOTICE` 中。
 * 这样"忘记补地址"与"忘记撤警示"都会在 CI 变红。
 */
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  repository?: string | { url?: string }
}

/** repository 支持字符串或 npm 标准对象 {type,url}（后者取 .url）。 */
function repoUrl(): string | null {
  const r = pkg.repository
  if (!r) return null
  const url = typeof r === 'string' ? r : (r.url ?? '')
  return url ? url.replace(/^git\+/, '').replace(/\.git$/, '') : null
}
const notice = readFileSync(resolve(process.cwd(), 'NOTICE'), 'utf8')
const PENDING = '源码托管地址待定'

describe('源码托管一致性（T61）', () => {
  it('repository 为空 ⇒ NOTICE 必须保留"源码托管地址待定"警示', () => {
    if (repoUrl()) return // 已有地址，由下一条断言负责
    expect(notice, `未设 repository 时 NOTICE 必须提示托管待定（AGPL 分发前提）`).toContain(PENDING)
  })

  it('repository 存在 ⇒ 必须撤掉警示，且地址写入 NOTICE', () => {
    const url = repoUrl()
    if (!url) return
    expect(notice, '已设 repository ⇒ 应移除"源码托管地址待定"警示').not.toContain(PENDING)
    expect(notice, 'NOTICE 应写明源码地址').toContain(url)
  })
})
