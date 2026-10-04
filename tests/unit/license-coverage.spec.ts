import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 协议一致性守卫：**"我们声明了什么"必须等于"事实是什么"**。
 *
 * 为什么值得一条守卫：本项目的核心卖点之一是**协议边界清晰**。而"NOTICE 里的对照表"
 * 与实际文件脱节，是最难靠人眼发现的漂移（本项目已发生过：`docs/**` 在表里出现两行且
 * 协议不同、`sdk/**` 未入表、`NOTICE` §5 承诺保留第三方许可证但没有落地文件）。
 *
 * 钉住四件事：
 *  ① 每类"自带 MIT"的目录都必须真的带 LICENSE（contracts / templates / sdk / docs / module 模板）；
 *  ② NOTICE 第 2 节必须列出 `sdk/**`，且**不得**再出现重复的 `docs/**` 行（曾经的冲突源）；
 *  ③ `THIRD-PARTY-NOTICES.md` 必须覆盖 `package.json` 的**每一个**运行时依赖；
 *  ④ 内部文档必须在 NOTICE 中标为"不对外授权"，且不得出现在公开发布白名单里（后者由发布脚本自检兜底）。
 */
const ROOT = resolve(process.cwd())
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')

describe('协议一致性（NOTICE ⇄ 事实）', () => {
  it('① 自带 MIT 的目录都真的带 LICENSE', () => {
    for (const p of ['src/contracts/LICENSE', 'templates/LICENSE', 'templates/module/LICENSE', 'sdk/LICENSE', 'docs/LICENSE']) {
      expect(existsSync(resolve(ROOT, p)), `缺 ${p}`).toBe(true)
      expect(read(p), `${p} 应为 MIT`).toContain('MIT License')
      expect(read(p), `${p} 不得是 AGPL`).not.toContain('GNU AFFERO')
    }
  })

  it('② NOTICE 覆盖 sdk/**，且 docs/** 不再出现相互冲突的两行', () => {
    const notice = read('NOTICE')
    expect(notice, 'NOTICE 第 2 节必须列出 sdk/**（模块作者入口）').toContain('`sdk/**`')
    // 真实风险有两个：① 曾出现两行给出**不同协议**（docs/** 既 CC BY-SA 又 MIT）；
    // ② 路径重复会让读者无从判断。这里直接钉住这两点。
    expect(notice, '不得再出现与 MIT 冲突的 CC BY-SA 授权行').not.toContain('CC-BY-SA')
    expect(notice, 'NOTICE 必须覆盖 docs/** 的授权规则').toContain('`docs/**`')
    const firstCells = notice
      .split('\n')
      .filter((l) => l.trim().startsWith('|'))
      .map((l) => (l.split('|')[1] ?? '').replace(/[`*\s]/g, ''))
      .filter((c) => c && c !== '路径' && !c.startsWith('---'))
    const dupes = [...new Set(firstCells.filter((c, i) => firstCells.indexOf(c) !== i))]
expect(dupes, `NOTICE 表格出现重复条目：${dupes.join(', ')}`).toEqual([])
    expect(notice, '内部文档必须标明不对外授权').toContain('docs/internal/**')
  })

  it('③ THIRD-PARTY-NOTICES 覆盖 package.json 的每个运行时依赖', () => {
    const deps = Object.keys(JSON.parse(read('package.json')).dependencies ?? {})
    expect(deps.length, '运行时依赖不应为空').toBeGreaterThan(0)
    const tpn = read('THIRD-PARTY-NOTICES.md')
    const missing = deps.filter((d) => !tpn.includes(`\`${d}\``))
    expect(missing, `第三方声明缺少：${missing.join(', ')}`).toEqual([])
    expect(tpn, '必须说明 Electron/Chromium 的声明随包提供').toContain('LICENSES.chromium.html')
    expect(tpn, '必须列出仓库内嵌的第三方（vendor）').toContain('vendor/vtubestudio')
  })

  it('④ NOTICE 第 5 节指向第三方声明文件（把承诺落地）', () => {
    expect(read('NOTICE')).toContain('THIRD-PARTY-NOTICES.md')
  })
})
