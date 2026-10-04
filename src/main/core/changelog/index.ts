import type { ILogger } from '@contracts/logger'
import type { IConfig } from '@contracts/config'
import {
  CHANGELOG_IN_APP_VERSIONS,
  type ChangelogRelease,
  type ChangelogSection,
  type ChangelogSnapshot
} from '@shared/changelog'

/**
 * 应用内更新日志服务（T34，Electron-free：文件读取注入，便于测试与打包路径差异）。
 *
 * **唯一真源是仓库根 `CHANGELOG.md`**——不另存一份结构化副本，否则必然双份漂移。
 * 主进程读取并解析，渲染层只拿结构化结果。
 *
 * 格式契约（写进 AI_RULES，解析器认得出才显示得出来）：
 * ```
 * ## [1.2.3] — 2026-01-02        ← 版本段（方括号可省；分隔符 — / – / - 皆可）
 * > 面向用户的一句话摘要          ← 可选引用块：应用内"本次更新"优先展示
 * ### Added — 某个改动            ← 小节
 * - 条目（一行一条；续行会并入上一条）
 * ```
 */

/** 版本段标题：`## [1.2.3] — 2026-01-02` / `## 1.2.3 - 2026-01-02` / `## [1.2.3]`。 */
const VERSION_HEADING = /^##\s+\[?(\d+\.\d+\.\d+[^\s\]]*)\]?(?:\s*[—–-]\s*(.+))?$/
/** 任意二级标题（用于识别"非版本段"，如 `## [Unreleased]`）。 */
const ANY_H2 = /^##\s+/
/** 三级标题 → 小节。 */
const SECTION_HEADING = /^###\s+(.*)$/
/** 引用块（摘要）。 */
const BLOCKQUOTE = /^>\s?(.*)$/
/** 列表项。 */
const BULLET = /^[-*]\s+(.*)$/
/** 分隔线 / 表格行：既不是条目也不是续行，必须显式跳过。 */
const SEPARATOR_OR_TABLE = /^([-*_]{3,}|\|.*\|?)$/

/** 去掉行内 markdown 标记：渲染层直接展示这些字符串，留着会露出星号与反引号。 */
function cleanInline(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 解析 CHANGELOG.md，取最近 `maxVersions` 个版本段（按文档顺序，新 → 旧）。
 *
 * 容错：非字符串/空/畸形一律返回 `[]`，**绝不抛** —— 更新日志缺失不该影响软件启动。
 */
export function parseChangelog(markdown: unknown, maxVersions: number): ChangelogRelease[] {
  if (typeof markdown !== 'string' || markdown.length === 0) return []
  const limit =
    Number.isFinite(maxVersions) && maxVersions > 0
      ? Math.floor(maxVersions)
      : CHANGELOG_IN_APP_VERSIONS

  /** @type {ChangelogRelease[]} */
  const releases: ChangelogRelease[] = []
  let current: ChangelogRelease | null = null
  let section: ChangelogSection | null = null

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()

    const version = VERSION_HEADING.exec(line)
    if (version) {
      if (releases.length >= limit) {
        // 已够数：继续扫描以正确"关闭"当前段，但不再收集
        current = null
        section = null
        continue
      }
      current = {
        version: version[1],
        date: (version[2] ?? '').trim(),
        summary: [],
        sections: []
      }
      releases.push(current)
      section = null
      continue
    }

    if (ANY_H2.test(line)) {
      // `## [Unreleased]` 之类：不是版本段，且必须**结束**当前段，
      // 否则它的条目会被并进上一个版本（真实踩过的坑）
      current = null
      section = null
      continue
    }

    if (!current) continue

    const heading = SECTION_HEADING.exec(line)
    if (heading) {
      section = { title: cleanInline(heading[1]), items: [] }
      current.sections.push(section)
      continue
    }

    const quote = BLOCKQUOTE.exec(line)
    if (quote) {
      const text = cleanInline(quote[1])
      if (text.length > 0) current.summary.push(text)
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      const text = cleanInline(bullet[1])
      if (section && text.length > 0) section.items.push(text)
      continue
    }

    if (SEPARATOR_OR_TABLE.test(line)) continue

    // 续行：并入上一个条目（CHANGELOG 里长条目会折行）
    if (section && section.items.length > 0 && line.length > 0) {
      const text = cleanInline(line)
      if (text.length > 0) section.items[section.items.length - 1] += ' ' + text
    }
  }

  return releases
}

/** 配置分区 id：只存"上次已读版本"，属内部记账，不混进用户可见的应用设置。 */
const SECTION_ID = 'core.changelog'

export interface ChangelogOptions {
  logger: ILogger
  config: IConfig
  /** 当前运行版本（`app.getVersion()`）。 */
  appVersion: string
  /** 读取 CHANGELOG.md 全文（注入以便测试；打包态与开发态路径不同）。 */
  readSource: () => Promise<string>
}

export interface ChangelogService {
  get(): Promise<ChangelogSnapshot>
  /** 记录"当前版本已读"，之后不再自动弹"本次更新"。 */
  markSeen(): void
}

export function createChangelog(options: ChangelogOptions): ChangelogService {
  let cached: ChangelogRelease[] | null = null

  async function releases(): Promise<ChangelogRelease[]> {
    if (cached) return cached
    try {
      cached = parseChangelog(await options.readSource(), CHANGELOG_IN_APP_VERSIONS)
    } catch (e) {
      // 读不到（缺文件/权限/打包遗漏）时静默降级：应用内不显示更新日志，
      // 但绝不因此影响启动（并在日志里留痕便于排查打包问题）。
      options.logger.warn('changelog source unreadable', { error: String(e) })
      cached = []
    }
    return cached
  }

  function lastSeen(): string {
    const section = options.config.get<{ lastSeenVersion?: unknown }>(SECTION_ID)
    return section && typeof section.lastSeenVersion === 'string' ? section.lastSeenVersion : ''
  }

  return {
    async get(): Promise<ChangelogSnapshot> {
      const list = await releases()
      const current = options.appVersion
      return {
        current,
        releases: list,
        // 只有"当前版本确实在更新日志里"才提示——否则会弹一个空对话框
        showWhatsNew: list.some((r) => r.version === current) && lastSeen() !== current
      }
    },

    markSeen(): void {
      const res = options.config.set(SECTION_ID, { lastSeenVersion: options.appVersion })
      if (!res.ok) options.logger.warn('changelog markSeen failed', { errors: res.errors })
    }
  }
}
