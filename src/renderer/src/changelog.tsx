import type { ChangelogSnapshot } from '@shared/changelog'
import { CHANGELOG_IN_APP_VERSIONS } from '@shared/changelog'
import { formatAppVersion } from '@shared/appInfo'
import { Btn, EmptyState, Modal } from './ui'

/**
 * T34 应用内更新日志。
 *
 * 数据来自主进程（真源是仓库根 `CHANGELOG.md`，见 core/changelog 的 README）：
 * - `ChangelogPage`：「更新日志」页签的常驻内容，展示最近 N 个版本
 * - `WhatsNewDialog`：升级到新版本后首次启动弹一次（"像正式软件那样"）
 *
 * 说明：应用内**只显示最近 `CHANGELOG_IN_APP_VERSIONS` 个版本**（更早的仍在 CHANGELOG.md 里），
 * 页脚会明确写出来，避免用户以为历史被删了。
 */

/** 单条上限（用户口径：超过 50 字在界面上截断并显示省略号）。 */
const MAX_ITEM_CHARS = 50

function clip(text: string): string {
  return text.length <= MAX_ITEM_CHARS ? text : text.slice(0, MAX_ITEM_CHARS) + '…'
}

/** 版本段标题右侧的日期与"当前版本"标记。 */
function releaseHead(snapshot: ChangelogSnapshot, version: string, date: string) {
  return (
    <header className="changelog-head">
      <h2 className="changelog-version">{version}</h2>
      {date ? <span className="changelog-date">{date}</span> : null}
      {version === snapshot.current ? (
        <span className="chip chip-current" data-testid="changelog-current">
          当前版本
        </span>
      ) : null}
    </header>
  )
}

/** 一个版本段的正文（摘要 + 各小节）。对话框与页签共用，避免两处渲染逻辑漂移。 */
function ReleaseBody({ release }: { release: ChangelogSnapshot['releases'][number] }) {
  return (
    <>
      {release.summary.length > 0 ? (
        <div className="changelog-summary">
          {release.summary.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      ) : null}
      {release.sections.map((section) => (
        <div className="changelog-section" key={section.title}>
          <h3>{section.title}</h3>
          <ul>
            {section.items.map((item, i) => (
              <li key={i}>{clip(item)}</li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

export function ChangelogPage({ snapshot }: { snapshot: ChangelogSnapshot | null }) {
  if (!snapshot) {
    return (
      <div className="card">
        <p>正在读取更新日志…</p>
      </div>
    )
  }
  if (snapshot.releases.length === 0) {
    // 打包遗漏/文件缺失时的降级提示（主进程已记 warn，这里给用户一句人话）
    return <EmptyState text="暂无更新日志内容" />
  }
  return (
    <div className="page" data-testid="changelog-page">
      <div className="page-actions">
        <span className="changelog-title">更新日志</span>
        <span className="changelog-hint">当前版本 {formatAppVersion(snapshot.current)}</span>
      </div>
      {snapshot.releases.map((release) => (
        <section
          className="card changelog-release"
          key={release.version}
          data-testid={`changelog-${release.version}`}
        >
          {releaseHead(snapshot, release.version, release.date)}
          <ReleaseBody release={release} />
        </section>
      ))}
      <p className="changelog-foot">
        应用内只显示最近 {CHANGELOG_IN_APP_VERSIONS} 个版本。
      </p>
    </div>
  )
}

/** 升级后首次启动的"本次更新"对话框（单按钮，关闭即记为已读）。 */
export function WhatsNewDialog({
  snapshot,
  onClose
}: {
  snapshot: ChangelogSnapshot
  onClose: () => void
}) {
  const release = snapshot.releases.find((r) => r.version === snapshot.current)
  if (!release) return null
  return (
    <Modal onClose={onClose}>
      <div className="whatsnew" role="dialog" aria-modal="true" data-testid="whats-new">
        <h2 className="whatsnew-title">本次更新 · {release.version}</h2>
        {release.date ? <p className="whatsnew-date">{release.date}</p> : null}
        <div className="whatsnew-body">
          <ReleaseBody release={release} />
        </div>
        <div className="whatsnew-actions">
          <Btn variant="primary" onClick={onClose} data-testid="whats-new-close">
            知道了
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
