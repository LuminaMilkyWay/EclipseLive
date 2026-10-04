/**
 * DiagnosticsPage（自 App.tsx 拆出；纯搬运，逻辑与语句顺序未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md。
 * 原 App.tsx 行号：638-796。
 */
import { Btn, EmptyState } from '../ui'
import type { PageProps } from '../page-props'

export function DiagnosticsPage({ snap, onRefresh, run, isBusy }: PageProps) {
  if (!snap) {
    return (
      <div className="card">
        <p>加载中…</p>
      </div>
    )
  }
  const started = snap.modules.filter((m) => m.status === 'started').length
  return (
    <div className="page">
      <div className="page-actions">
        <Btn onClick={onRefresh}>立即刷新</Btn>
        <Btn
          loading={isBusy('导出诊断包')}
          onClick={() => void run('导出诊断包', () => window.eclipselive.exportDiagnostics())}
        >
          导出诊断包
        </Btn>
        <Btn
          loading={isBusy('OBS 重连')}
          onClick={() => void run('OBS 重连', () => window.eclipselive.reconnectObs())}
        >
          OBS 重连
        </Btn>
      </div>
      <div className="grid">
        <section className="card">
          <h1>网关</h1>
          <dl className="kv">
            <div>
              <dt>状态</dt>
              <dd data-testid="gateway-started">{snap.gateway.started ? '运行中' : '未启动'}</dd>
            </div>
            <div>
              <dt>端口</dt>
              <dd data-testid="gateway-port">{snap.gateway.port ?? '—'}</dd>
            </div>
            <div>
              <dt>token</dt>
              <dd data-testid="gateway-token">{snap.gateway.tokenPresent ? '已生成' : '无'}</dd>
            </div>
            <div>
              <dt>路由 / 频道</dt>
              <dd>
                {snap.gateway.routes.length} / {snap.gateway.channels.length}
              </dd>
            </div>
            <div>
              <dt>WS 连接</dt>
              <dd>{snap.gateway.wsClients}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h1>OBS</h1>
          <dl className="kv">
            <div>
              <dt>状态</dt>
              <dd data-testid="obs-status">{snap.obs.status}</dd>
            </div>
            <div>
              <dt>端口</dt>
              <dd>{snap.obs.port}</dd>
            </div>
            <div>
              <dt>重试次数</dt>
              <dd>{snap.obs.attempts}</dd>
            </div>
            {snap.obs.lastError && (
              <div>
                <dt>最近错误</dt>
                <dd className="dim">{snap.obs.lastError}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="card">
          <h1>模块</h1>
          <dl className="kv">
            <div>
              <dt>总数 / 运行</dt>
              <dd>
                {snap.modules.length} / {started}
              </dd>
            </div>
            <div>
              <dt>网页工具</dt>
              <dd>{snap.webtools.tools}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h1>网页工具 / 网络</h1>
          <dl className="kv">
            <div>
              <dt>打开 / 拒绝</dt>
              <dd>
                {snap.webtools.open} / {snap.webtools.denials}
              </dd>
            </div>
            <div>
              <dt>网络模式</dt>
              <dd data-testid="network-mode">{snap.network.mode}</dd>
            </div>
            <div>
              <dt>外发拒绝</dt>
              <dd>{snap.network.rejected}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h1>凭据 / 配置</h1>
          <dl className="kv">
            <div>
              <dt>凭据（弱保护）</dt>
              <dd>
                {snap.credentials.count}（{snap.credentials.weak}）
              </dd>
            </div>
            <div>
              <dt>配置分区</dt>
              <dd>{snap.config.sections.length}</dd>
            </div>
            <div>
              <dt>已应用样式</dt>
              <dd>{snap.styles.applied.length}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="card">
        <h1>最近错误</h1>
        {snap.gateway.recentErrors.length === 0 ? (
          <EmptyState text="暂无错误记录" />
        ) : (
          <ul className="error-list">
            {snap.gateway.recentErrors
              .slice(-5)
              .reverse()
              .map((e, i) => (
                <li key={`${e.time}-${i}`}>{e.message}</li>
              ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/**
 * 模块资源管理面板（原 ModulesPage 迁入设置页「模块」分区卡）：
 * 安装/导入、启停/卸载、打开关闭网页工具、导出样式包——与权限查看/撤销、恢复预设同卡。
 */
