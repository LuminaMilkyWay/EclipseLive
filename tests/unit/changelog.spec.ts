import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import type { IConfig } from '@contracts/config'
import { CHANGELOG_IN_APP_VERSIONS, type ChangelogRelease } from '@shared/changelog'
import { createConfig } from '../../src/main/core/config'
import { parseChangelog, createChangelog } from '../../src/main/core/changelog'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * T34 应用内更新日志：解析器 + 服务。
 *
 * **真源是仓库根 CHANGELOG.md**（不另存一份）。故这里有一条针对**真实文件**的测试：
 * 它既是解析器测试，也是"格式契约"守卫 —— 若以后有人把版本段写成解析器认不出的样子，
 * 应用内更新日志会静默变空，这条测试会先红。
 */

function testLogger(): ILogger {
  const make = (): ILogger => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => make(),
    setLevel: () => {}
  })
  return make()
}

const SAMPLE = [
  '# Changelog',
  '',
  '本文件记录每次可见变更。',
  '',
  '## [1.2.3] — 2026-01-02',
  '',
  '> 一句话摘要：新增了某某功能。',
  '> 第二行摘要。',
  '',
  '### Added — 某某功能（2026-01-02）',
  '',
  '- **加粗**与 `代码` 标记应被清理：见 [文档](https://example.com/doc)',
  '- 第二条',
  '  这是续行，应并入上一条',
  '',
  '### Fixed — 修了一个问题',
  '',
  '- 修复项',
  '',
  '## [1.2.2] — 2026-01-01',
  '',
  '### Changed — 无摘要的版本（应容忍）',
  '',
  '- 变更项',
  '',
  '## [Unreleased]',
  '',
  '### Added — 未发布的不该出现',
  '',
  '- 不该出现',
  '',
  '## [1.2.1] — 2025-12-31',
  '',
  '### Added — 第三个版本',
  '',
  '- 很旧的项',
  '',
  '## [1.2.0] — 2025-12-30',
  '',
  '### Added — 第四个版本（超出上限应被截断）',
  '',
  '- 更旧的项'
].join('\n')

describe('T34 parseChangelog', () => {
  it('解析版本号/日期/摘要/小节/条目，并清理 markdown 标记', () => {
    const rel = parseChangelog(SAMPLE, 5)
    expect(rel.map((r) => r.version)).toEqual(['1.2.3', '1.2.2', '1.2.1', '1.2.0'])

    const first = rel[0]
    expect(first.date).toBe('2026-01-02')
    expect(first.summary).toEqual(['一句话摘要：新增了某某功能。', '第二行摘要。'])
    expect(first.sections.map((s) => s.title)).toEqual([
      'Added — 某某功能（2026-01-02）',
      'Fixed — 修了一个问题'
    ])
    // markdown 标记被清理，链接只留文字
    expect(first.sections[0].items[0]).toBe('加粗与 代码 标记应被清理：见 文档')
    // 续行并入上一条
    expect(first.sections[0].items[1]).toBe('第二条 这是续行，应并入上一条')
    expect(first.sections[1].items).toEqual(['修复项'])
  })

  it('只保留最近 N 个版本（应用内约定 3 个）', () => {
    expect(parseChangelog(SAMPLE, 3).map((r) => r.version)).toEqual(['1.2.3', '1.2.2', '1.2.1'])
    expect(CHANGELOG_IN_APP_VERSIONS).toBe(3)
  })

  it('跳过非版本标题（如 Unreleased），不把它的条目并进上一个版本', () => {
    const rel = parseChangelog(SAMPLE, 5)
    const all = rel.flatMap((r) => r.sections.flatMap((s) => s.items))
    expect(all).not.toContain('不该出现')
    expect(rel.find((r) => r.version === '1.2.2')?.sections[0].items).toEqual(['变更项'])
  })

  it('容忍无摘要的版本段', () => {
    const rel = parseChangelog(SAMPLE, 5)
    expect(rel.find((r) => r.version === '1.2.2')?.summary).toEqual([])
  })

  it('畸形/空输入返回空数组且不抛', () => {
    for (const v of ['', '   ', '# 只有标题', '## 不是版本号', null, undefined]) {
      expect(() => parseChangelog(v as string, 3)).not.toThrow()
      expect(parseChangelog(v as string, 3)).toEqual([])
    }
  })

  it('★ 真实 RELEASE_NOTES.md 可解析：顶部是当前版本，且有摘要与条目（格式契约守卫）', async () => {
    // 迁移第 2 步：应用内更新日志的真源已改为 RELEASE_NOTES.md（CHANGELOG.md 退为开发者记录）。
    const md = await readFile(resolve(process.cwd(), 'RELEASE_NOTES.md'), 'utf8')
    const rel = parseChangelog(md, CHANGELOG_IN_APP_VERSIONS)

    expect(rel.length, '至少应解析出 1 个版本段').toBeGreaterThanOrEqual(1)
    expect(rel.length).toBeLessThanOrEqual(CHANGELOG_IN_APP_VERSIONS)

    const pkg = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      version: string
    }
    expect(rel[0].version, 'RELEASE_NOTES 顶部版本必须等于 package.json version').toBe(pkg.version)
    expect(rel[0].date, '当前版本段必须写日期').toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(rel[0].summary.length, '当前版本段必须写面向用户的摘要引用块').toBeGreaterThan(0)
    expect(rel[0].sections.length).toBeGreaterThan(0)

    // 渲染层直接展示这些字符串，残留 markdown 标记会露出来
    const all = rel.flatMap((r) => [
      ...r.summary,
      ...r.sections.flatMap((s) => [s.title, ...s.items])
    ])
    for (const text of all) {
      expect(text, `条目不应残留 ** 标记：${text.slice(0, 60)}`).not.toContain('**')
      expect(text, `条目不应残留反引号：${text.slice(0, 60)}`).not.toContain('`')
    }
    // 每个版本段都应有条目，否则应用内会显示空版本
    for (const r of rel) {
      expect(r.sections.length, `${r.version} 段应有小节`).toBeGreaterThan(0)
    }
  })

  it('★ 当前版本段必须是"给用户看"的写法：分节且不出现内部细节', async () => {
    // 迁移第 2 步：真源改为 RELEASE_NOTES.md
    const md = await readFile(resolve(process.cwd(), 'RELEASE_NOTES.md'), 'utf8')
    const current = parseChangelog(md, CHANGELOG_IN_APP_VERSIONS)[0]

    // 分节用语：至少要有 新增 / 修复 / 调整 之一（用户口径的三类）
    const titles = current.sections.map((s) => s.title)
    expect(
      titles.some((t) => ['新增', '改进', '修复', '调整'].includes(t)),
      `当前版本段应按 新增/修复/调整 分节，实际：${titles.join('、')}`
    ).toBe(true)

    // 文风守卫：这些是实现细节，用户不关心，不该出现在更新日志里
    const FORBIDDEN = ['单测', 'typecheck', 'spec.ts', 'package.json', 'commit', '/src/', 'require(', 'npm run']
    const texts = [...current.summary, ...current.sections.flatMap((s) => [s.title, ...s.items])]
    for (const text of texts) {
      for (const bad of FORBIDDEN) {
        expect(
          text,
          `当前版本段不该出现内部细节「${bad}」：${text.slice(0, 80)}`
        ).not.toContain(bad)
      }
    }
  })
})

/* ---------- 服务 ---------- */

async function makeService(options: {
  markdown?: string
  readError?: boolean
  appVersion?: string
  lastSeen?: string
}): Promise<{
  service: ReturnType<typeof createChangelog>
  config: IConfig
}> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-chg-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  config.register('core.changelog', { defaults: { lastSeenVersion: '' }, version: 1 })
  if (options.lastSeen) config.set('core.changelog', { lastSeenVersion: options.lastSeen })
  await config.ready()
  const service = createChangelog({
    logger,
    config,
    appVersion: options.appVersion ?? '1.2.3',
    readSource: async () => {
      if (options.readError) throw new Error('ENOENT: CHANGELOG.md')
      return options.markdown ?? SAMPLE
    }
  })
  return { service, config }
}

describe('T34 createChangelog', () => {
  it('get() 返回当前版本 + 最近 3 个版本 + 是否需要弹"本次更新"', async () => {
    const { service } = await makeService({ appVersion: '1.2.3' })
    const snap = await service.get()
    expect(snap.current).toBe('1.2.3')
    expect(snap.releases.map((r: ChangelogRelease) => r.version)).toEqual(['1.2.3', '1.2.2', '1.2.1'])
    expect(snap.showWhatsNew, '从未读过 → 应弹一次').toBe(true)
  })

  it('markSeen() 记录版本号后不再弹（且落配置）', async () => {
    const { service, config } = await makeService({ appVersion: '1.2.3' })
    service.markSeen()
    const snap = await service.get()
    expect(snap.showWhatsNew).toBe(false)
    expect(config.get<{ lastSeenVersion: string }>('core.changelog')?.lastSeenVersion).toBe('1.2.3')
  })

  it('已读版本与当前相同 → 不弹', async () => {
    const { service } = await makeService({ appVersion: '1.2.3', lastSeen: '1.2.3' })
    expect((await service.get()).showWhatsNew).toBe(false)
  })

  it('已读版本是旧版 → 弹（这正是"升级后看一次"的路径）', async () => {
    const { service } = await makeService({ appVersion: '1.2.3', lastSeen: '1.2.2' })
    expect((await service.get()).showWhatsNew).toBe(true)
  })

  it('★ 读不到 CHANGELOG.md → 不抛、返回空列表且不弹空对话框', async () => {
    const { service } = await makeService({ readError: true })
    const snap = await service.get()
    expect(snap.releases).toEqual([])
    expect(snap.showWhatsNew, '没有内容就不该弹窗').toBe(false)
  })

  it('★ 当前版本不在 CHANGELOG 里（例如刚改过版本号）→ 不弹', async () => {
    const { service } = await makeService({ appVersion: '9.9.9' })
    const snap = await service.get()
    expect(snap.releases.length).toBeGreaterThan(0)
    expect(snap.showWhatsNew).toBe(false)
  })

  it('重复 get() 结果稳定（幂等，不写盘不改变状态）', async () => {
    const { service, config } = await makeService({ appVersion: '1.2.3' })
    const a = await service.get()
    const b = await service.get()
    expect(b).toEqual(a)
    expect(config.get<{ lastSeenVersion: string }>('core.changelog')?.lastSeenVersion).toBe('')
  })
})
