/**
 * 应用内更新日志（T34）的共享类型。
 *
 * 真源是仓库根目录的 `CHANGELOG.md`（**唯一真源，不另存一份**，避免双份漂移）：
 * 主进程读取并解析后经 IPC 交给渲染层展示。打包时该文件进 `extraResources`。
 */

/** 应用内展示的版本数上限（更早的仍在 CHANGELOG.md 里）。 */
export const CHANGELOG_IN_APP_VERSIONS = 3

/** 一个 `###` 小节（标题 + 条目）。 */
export interface ChangelogSection {
  /** 小节标题原文，如 `Added — VTS-ControlPad 悬浮窗`。 */
  title: string
  /** 条目（已去 markdown 标记，便于直接渲染）。 */
  items: string[]
}

/** 一个版本段（对应 CHANGELOG.md 里的一个 `## [版本] — 日期`）。 */
export interface ChangelogRelease {
  /** 版本号（不含方括号）。 */
  version: string
  /** 日期原文；未写则为空串。 */
  date: string
  /**
   * 摘要行（版本标题后的 `> 引用块`）。
   * 约定：每个版本段以一段引用块写**面向用户的一句话摘要**，应用内"本次更新"优先展示它。
   */
  summary: string[]
  sections: ChangelogSection[]
}

/** `changelog:get` 的返回。 */
export interface ChangelogSnapshot {
  /** 当前运行版本（`app.getVersion()`）。 */
  current: string
  /** 最近若干个版本，按文档顺序（新 → 旧），最多 {@link CHANGELOG_IN_APP_VERSIONS} 个。 */
  releases: ChangelogRelease[]
  /**
   * 是否需要向用户展示"本次更新"：
   * 记录的上次已读版本 ≠ 当前版本 **且** 当前版本确实在 releases 里
   * （读不到内容时不弹空对话框）。
   */
  showWhatsNew: boolean
}
