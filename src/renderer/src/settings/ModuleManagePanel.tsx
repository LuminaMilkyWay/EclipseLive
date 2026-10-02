/**
 * ModuleManagePanel（自 SettingsPage.tsx 拆出；纯搬运，逻辑与语句顺序未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md。
 * 原 SettingsPage.tsx 行号：35-147。
 */
/**
 * 设置页（自 App.tsx 拆出；纯搬运，逻辑与语句顺序未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 1 轮。
 * 原 App.tsx 行号：SettingsPage 1084-1516；ModuleManagePanel 805-917；
 * SETTINGS_PENDING 918-932；WebToolUrl 1517-1528；WebToolButton 1529-1551。
 * 同轮搬出的理由：后四者只被 SettingsPage 使用，留在 App.tsx 会变成孤儿或形成循环导入。
 * 后续轮次：ModuleManagePanel 于第 3 轮、WebToolUrl/WebToolButton 于第 4 轮再拆成独立文件。
 */
import { useState } from 'react'
import {
} from '@shared/theme'
import type { PageProps } from '../page-props'
import {
  Badge,
  Btn,
  ConfirmDialog,
  EmptyState,
  ListRow
} from '../ui'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'

export function ModuleManagePanel({ snap, run, isBusy }: PageProps) {
  // T20：卸载确认走 ConfirmDialog（记录待确认模块 id，取消即关闭对话框）。
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null)
  if (!snap) {
    return (
      <div className="card">
        <p>加载中…</p>
      </div>
    )
  }
  return (
    <div className="module-manage">
      <div className="settings-actions">
        <Btn
          loading={isBusy('安装模块包')}
          onClick={() => void run('安装模块包', () => window.eclipselive.installPackage())}
        >
          从文件安装（.elm）
        </Btn>
        <Btn
          loading={isBusy('导入样式包')}
          onClick={() => void run('导入样式包', () => window.eclipselive.importStylePack())}
        >
          导入样式包（.elstyle）
        </Btn>
      </div>

      <div className="module-list">
        {snap.modules.length === 0 && <EmptyState text="暂无模块" />}
        {snap.modules.map((m) => (
          <section className="card module-card" key={m.id} data-testid={`module-card-${m.id}`}>
            <div className="module-head">
              <div>
                <h2>
                  {m.name ?? m.id} <span className="dim">{m.id}</span>
                </h2>
                <span className="dim">{m.version ?? ''}</span>
                {/* P3/T66：模块协议；缺失时明确标注「未声明」（核心不替作者授权） */}
                {m.license ? (
                  <span className="chip chip-license" data-testid="module-license">{m.license}</span>
                ) : (
                  <span className="chip chip-warn" data-testid="module-license-missing" title="该模块未声明协议：使用与分发前请自行确认授权">未声明协议</span>
                )}
              </div>
              <Badge variant={m.status}>{m.status}</Badge>
            </div>
            {m.error && <p className="module-error">{m.error}</p>}
            {m.permissions.length > 0 && (
              <div className="chips">
                {m.permissions.map((p) => (
                  <span key={p} className="chip">
                    {p}
                  </span>
                ))}
              </div>
            )}
            {m.web && <WebToolUrl moduleId={m.id} snap={snap} />}
            <div className="module-actions">
              {m.web && <WebToolButton moduleId={m.id} snap={snap} run={run} />}
              {m.status === 'disabled' ? (
                <Btn onClick={() => void run('启用', () => window.eclipselive.enableModule(m.id))}>
                  启用
                </Btn>
              ) : (
                <Btn onClick={() => void run('禁用', () => window.eclipselive.disableModule(m.id))}>
                  禁用
                </Btn>
              )}
              <Btn variant="danger" onClick={() => setPendingUninstall(m.id)}>
                卸载
              </Btn>
            </div>
          </section>
        ))}
      </div>

      {snap.styles.applied.length > 0 && (
        <section className="card">
          <h1>已应用样式</h1>
          <ul className="style-list">
            {snap.styles.applied.map((s) => (
              <ListRow
                key={`${s.moduleId}:${s.styleType}`}
                actions={
                  <Btn
                    onClick={() =>
                      void run('导出样式包', () =>
                        window.eclipselive.exportStylePack(s.moduleId, s.styleType)
                      )
                    }
                  >
                    导出
                  </Btn>
                }
              >
                {s.moduleId} · {s.styleType} · v{s.version}
              </ListRow>
            ))}
          </ul>
        </section>
      )}

      {pendingUninstall && (
        <ConfirmDialog
          message={`卸载 ${pendingUninstall}？配置与撤销记忆将保留。`}
          confirmLabel="卸载"
          onConfirm={() => {
            const id = pendingUninstall
            setPendingUninstall(null)
            void run('卸载', () => window.eclipselive.uninstallModule(id))
          }}
          onCancel={() => setPendingUninstall(null)}
        />
      )}
    </div>
  )
}

/** T16：尚未实装设置项的归属标注（PRODUCT.md 设置界面 6 组规格）。 */

function WebToolUrl({
  moduleId,
  snap
}: {
  moduleId: string
  snap: DiagnosticsSnapshot
}) {
  const status = snap.webtools.statuses.find((s) => s.moduleId === moduleId)
  if (!status) return null
  return <p className="dim web-url">{status.url}</p>
}

function WebToolButton({
  moduleId,
  snap,
  run
}: {
  moduleId: string
  snap: DiagnosticsSnapshot
  run: PageProps['run']
}) {
  const status = snap.webtools.statuses.find((s) => s.moduleId === moduleId)
  if (!status) return null
  return status.state === 'open' ? (
    <Btn onClick={() => void run('关闭工具', () => window.eclipselive.closeWebTool(moduleId))}>
      关闭工具
    </Btn>
  ) : (
    <Btn onClick={() => void run('打开工具', () => window.eclipselive.openWebTool(moduleId))}>
      打开
    </Btn>
  )
}

/** T18 标题页：全屏应用标识 + 进入入口；进入前主界面不挂载。 */
