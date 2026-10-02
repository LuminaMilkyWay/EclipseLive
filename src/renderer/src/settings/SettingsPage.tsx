/**
 * 设置页（自 App.tsx 拆出；纯搬运，逻辑与语句顺序未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 1 轮。
 * 原 App.tsx 行号：SettingsPage 1084-1516；ModuleManagePanel 805-917；
 * SETTINGS_PENDING 918-932；WebToolUrl 1517-1528；WebToolButton 1529-1551。
 * 同轮搬出的理由：后四者只被 SettingsPage 使用，留在 App.tsx 会变成孤儿或形成循环导入。
 * 后续轮次：ModuleManagePanel 于第 3 轮、WebToolUrl/WebToolButton 于第 4 轮再拆成独立文件。
 */
import { useEffect, useState } from 'react'
import type { DiagnosticsSnapshot } from '@shared/diagnostics'
import { SETTINGS_GROUPS } from '@shared/settingsGroups'
import {
  
  
  
  
  type UiSettings
} from '@shared/theme'
import type { AppSettings } from '@shared/appSettings'
import type { PageProps } from '../page-props'
import {
  
  Btn,
  
  EmptyState,
  
  Modal,
  SegGroup,
  Slider,
  Switch,
  TextInput
} from '../ui'
import { ModuleManagePanel } from './ModuleManagePanel'

const SETTINGS_PENDING: Record<string, string> = {
  appearance: '减少透明度 / 高对比度 / 减少动态效果。',
  features: '关闭到托盘、检查更新（默认关闭）。',
  modules: '安装 / 导入、启停 / 卸载、网页工具开关、导出样式包、权限查看与撤销、恢复预设。',
  connection: 'OBS WebSocket 端口 / 密码 / 自动重连、本地网关信息。',
  diagnostics: '日志查看、诊断刷新、诊断包导出。',
  advanced: '配置导入导出、缓存清理、模块崩溃自动重启：新功能排独立小卡，在 UI 卡之后。'
}

/**
 * T31 模块页槽位：挂载即 openWebTool（webtools 容器承载，会话保活），
 * ResizeObserver + resize 实时上报壳矩形（WebContentsView 叠于 React 之上）。
 * 互斥规则（最后激活者赢）：进入时隐藏其它 open 视图（页面/工具），
 * 卸载时隐藏自身并恢复第三方工具显示（回归 T11 chip 行为）。
 */

export function SettingsPage({
  ui,
  snap,
  run,
  onRefresh,
  setMessage,
  onPatch,
  onInstallWallpaper,
  onResetWallpaper,
  fpsDegraded,
  isBusy
}: {
  ui: UiSettings | null
  snap: DiagnosticsSnapshot | null
  run: PageProps['run']
  onRefresh: () => void
  setMessage: (text: string) => void
  onPatch: (patch: Partial<UiSettings>) => void
  onInstallWallpaper: () => void
  onResetWallpaper: () => void
  /** T28：档 3 帧率降档运行态（提示语 + 重选复位由 App 侧 patchUi 处理）。 */
  fpsDegraded: boolean
  /** T-A3：在途操作查询，透传给模块管理面板的安装/导入按钮。 */
  isBusy: PageProps['isBusy']
}) {
  // T21 设置项状态：应用/生命周期/OBS 连接配置 + 权限即时态（防快照刷新竞态）+ 日志弹层。
  const [appCfg, setAppCfg] = useState<AppSettings | null>(null)
  const [life, setLife] = useState<{ closeToTray: boolean } | null>(null)
  const [obsCfg, setObsCfg] = useState<{ port: number; autoReconnect: boolean } | null>(null)
  const [obsPort, setObsPort] = useState('')
  const [obsPassword, setObsPassword] = useState('')
  const [permGranted, setPermGranted] = useState<Record<string, boolean>>({})
  const [logs, setLogs] = useState<string[] | null>(null)

  useEffect(() => {
    void window.eclipselive.appSettings().then(setAppCfg).catch(() => {})
    void window.eclipselive.lifecycleSettings().then(setLife).catch(() => {})
    void window.eclipselive
      .obsConfig()
      .then((c) => {
        setObsCfg(c)
        setObsPort(String(c.port))
      })
      .catch(() => {})
  }, [])

  // 检查更新（默认关闭）：关闭时主进程零请求，直接回「检查更新已关闭」。
  const checkUpdate = (): void => {
    void window.eclipselive
      .checkUpdate()
      .then((r) => {
        if (r.status === 'update-available') setMessage(`发现新版本 ${r.latest ?? ''}`.trim())
        else if (r.status === 'up-to-date') setMessage('已是最新版本')
        else setMessage(r.error || '检查更新失败')
      })
      .catch(() => setMessage('检查更新失败'))
  }

  // OBS 连接参数应用：密码留空不修改（写入凭据存储，不落明文不回显）。
  const applyObs = (): void => {
    void window.eclipselive
      .setObsConfig({ port: Number(obsPort), password: obsPassword || undefined })
      .then(async (r) => {
        setMessage(r.ok ? 'OBS 连接设置已保存' : `OBS 连接设置失败：${r.errors.join('；')}`)
        if (r.ok) {
          setObsPassword('')
          setObsCfg(await window.eclipselive.obsConfig())
        }
      })
      .catch(() => {})
  }

  const openLogs = (): void => {
    void window.eclipselive
      .viewLogs()
      .then(setLogs)
      .catch(() => setLogs([]))
  }

  return (
    <div className="page">
      <div className="settings-groups">
        {SETTINGS_GROUPS.map((g) => (
          <section
            key={g.id}
            className="card settings-group"
            data-testid={`settings-group-${g.id}`}
          >
            <h2>{g.title}</h2>
            <p className="dim">{g.description}</p>
            {g.id === 'appearance' && ui && (
              <>
                <div className="settings-row">
                  <span className="settings-row-label">主题模式</span>
                  <SegGroup
                    testId="seg-theme"
                    value={ui.themeMode}
                    options={[
                      ['light', '浅色'],
                      ['dark', '深色'],
                      ['system', '跟随系统']
                    ]}
                    onPick={(v) => onPatch({ themeMode: v })}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">强调色</span>
                  <SegGroup
                    testId="seg-accent"
                    value={ui.accent}
                    options={[
                      ['corona-orange', '日珥橙'],
                      ['cyan-blue', '青蓝']
                    ]}
                    onPick={(v) => onPatch({ accent: v })}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">材质档位</span>
                  <SegGroup
                    testId="seg-material"
                    value={ui.material}
                    options={[
                      [1, '档 1 纯模糊'],
                      [2, '档 2 玻璃'],
                      [3, '档 3 液态玻璃'],
                      [4, '档 4 全液态']
                    ]}
                    onPick={(v) => onPatch({ material: v })}
                  />
                </div>
                {ui.material === 3 && ui.highContrast && (
                  <p className="dim" data-testid="material-degrade-hint">
                    高对比度下档 3 文字对比度不足，已自动按档 2 渲染
                  </p>
                )}
                {ui.material === 3 && fpsDegraded && (
                  <p className="dim" data-testid="material-fps-degrade-hint">
                    检测到帧率下降，档 3 已自动按档 2 渲染；重新选择档 3 可再次尝试
                  </p>
                )}
                <div className="settings-row">
                  <span className="settings-row-label">全局底图</span>
                  <div className="settings-actions">
                    <Btn onClick={onInstallWallpaper}>选择图片</Btn>
                    <Btn data-testid="wallpaper-reset" onClick={onResetWallpaper}>
                      恢复默认
                    </Btn>
                  </div>
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">显示方式</span>
                  <SegGroup
                    testId="seg-wallpaper-fit"
                    value={ui.wallpaperFit}
                    options={[
                      ['fill', '填充'],
                      ['fit', '适应'],
                      ['tile', '平铺'],
                      ['center', '居中'],
                      ['stretch', '拉伸']
                    ]}
                    onPick={(v) => onPatch({ wallpaperFit: v })}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">透明度</span>
                  <Slider
                    data-testid="wallpaper-opacity"
                    min={0}
                    max={1}
                    step={0.05}
                    value={ui.wallpaperOpacity}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      // 同步写根节点变量（即时生效、断言无重试竞态），持久化走 onPatch。
                      document.documentElement.style.setProperty('--wallpaper-opacity', String(v))
                      onPatch({ wallpaperOpacity: v })
                    }}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">模糊度</span>
                  <Slider
                    data-testid="wallpaper-blur"
                    min={0}
                    max={24}
                    step={1}
                    value={ui.wallpaperBlur}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      document.documentElement.style.setProperty('--wallpaper-blur', `${v}px`)
                      onPatch({ wallpaperBlur: v })
                    }}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">低配模式（关模糊与底图）</span>
                  <Switch
                    testId="switch-low-spec"
                    checked={ui.reduceTransparency && ui.reduceMotion}
                    onChange={(v) => onPatch({ reduceTransparency: v, reduceMotion: v })}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">减少透明度</span>
                  <Switch
                    testId="switch-reduce-transparency"
                    checked={ui.reduceTransparency}
                    onChange={(v) => onPatch({ reduceTransparency: v })}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">高对比度</span>
                  <Switch
                    testId="switch-high-contrast"
                    checked={ui.highContrast}
                    onChange={(v) => onPatch({ highContrast: v })}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">减少动态效果</span>
                  <Switch
                    testId="switch-reduce-motion"
                    checked={ui.reduceMotion}
                    onChange={(v) => onPatch({ reduceMotion: v })}
                  />
                </div>
              </>
            )}
            {g.id === 'features' && (
              <>
                <div className="settings-row">
                  <span className="settings-row-label">关闭到托盘</span>
                  <Switch
                    testId="switch-close-to-tray"
                    checked={life?.closeToTray ?? true}
                    onChange={(v) => {
                      setLife({ closeToTray: v })
                      void window.eclipselive.setLifecycleSettings({ closeToTray: v }).catch(() => {})
                    }}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">检查更新（默认关闭，仅查 GitHub Releases）</span>
                  <Switch
                    testId="switch-check-updates"
                    checked={appCfg?.checkUpdatesEnabled ?? false}
                    onChange={(v) => {
                      setAppCfg({ checkUpdatesEnabled: v })
                      void window.eclipselive.setAppSettings({ checkUpdatesEnabled: v }).catch(() => {})
                    }}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">更新检查</span>
                  <div className="settings-actions">
                    <Btn data-testid="update-check" onClick={checkUpdate}>
                      立即检查
                    </Btn>
                  </div>
                </div>
              </>
            )}
            {g.id === 'modules' && snap && (
              <>
                {/* 模块资源管理（原模块管理页迁入本分区卡） */}
                <ModuleManagePanel snap={snap} run={run} isBusy={isBusy} />
                <h3>权限</h3>
                {snap.permissions.length === 0 && <EmptyState text="暂无已声明权限" />}
                {snap.permissions.map((p) =>
                  p.declared.map((perm) => {
                    const key = `${p.moduleId}:${perm}`
                    const granted = permGranted[key] ?? p.granted.includes(perm)
                    return (
                      <div className="settings-row" key={key}>
                        <span className="settings-row-label">
                          {p.moduleId} · {perm}
                        </span>
                        <Btn
                          data-testid={`module-perm-${p.moduleId}-${perm}`}
                          onClick={() => {
                            const next = !granted
                            setPermGranted({ ...permGranted, [key]: next })
                            void run('权限变更', () =>
                              window.eclipselive.setModulePermission({
                                moduleId: p.moduleId,
                                permission: perm,
                                granted: next
                              })
                            )
                          }}
                        >
                          {granted ? '已授权' : '已撤销'}
                        </Btn>
                      </div>
                    )
                  })
                )}
                <h3>恢复预设</h3>
                {snap.modules.length === 0 && <EmptyState text="暂无模块" />}
                {snap.modules.map((m) => (
                  <div className="settings-row" key={m.id}>
                    <span className="settings-row-label">{m.name ?? m.id}</span>
                    <Btn
                      data-testid={`module-preset-${m.id}`}
                      onClick={() =>
                        void run('恢复预设', () => window.eclipselive.resetModuleConfig(m.id))
                      }
                    >
                      恢复预设
                    </Btn>
                  </div>
                ))}
              </>
            )}
            {g.id === 'connection' && (
              <>
                <div className="settings-row">
                  <span className="settings-row-label">OBS WebSocket 端口</span>
                  <TextInput
                    data-testid="obs-port"
                    value={obsPort}
                    onChange={(e) => setObsPort(e.target.value)}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">OBS 密码（留空不修改）</span>
                  <TextInput
                    type="password"
                    value={obsPassword}
                    placeholder="不修改"
                    onChange={(e) => setObsPassword(e.target.value)}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">自动重连</span>
                  <Switch
                    testId="switch-obs-reconnect"
                    checked={obsCfg?.autoReconnect ?? true}
                    onChange={(v) => {
                      setObsCfg({ port: obsCfg?.port ?? 4455, autoReconnect: v })
                      void window.eclipselive.setObsConfig({ autoReconnect: v }).catch(() => {})
                    }}
                  />
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">连接参数</span>
                  <div className="settings-actions">
                    <Btn data-testid="obs-apply" onClick={applyObs}>
                      应用
                    </Btn>
                  </div>
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">本地网关</span>
                  <span data-testid="conn-gateway-started">
                    {snap?.gateway.started ? '运行中' : '未启动'}
                  </span>
                  <span className="dim">
                    端口 <span data-testid="conn-gateway-port">{snap?.gateway.port ?? '—'}</span>
                  </span>
                </div>
              </>
            )}
            {g.id === 'diagnostics' && (
              <>
                <div className="settings-row">
                  <span className="settings-row-label">日志</span>
                  <div className="settings-actions">
                    <Btn data-testid="logs-view" onClick={openLogs}>
                      查看日志
                    </Btn>
                  </div>
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">诊断</span>
                  <div className="settings-actions">
                    <Btn
                      data-testid="diag-refresh"
                      onClick={() =>
                        void run('刷新诊断', async () => {
                          onRefresh()
                          return { ok: true, errors: [] }
                        })
                      }
                    >
                      刷新诊断
                    </Btn>
                    <Btn
                      data-testid="diag-export"
                      onClick={() =>
                        void run('导出诊断包', () => window.eclipselive.exportDiagnostics())
                      }
                    >
                      导出诊断包
                    </Btn>
                  </div>
                </div>
              </>
            )}
            <p className="settings-pending dim">{SETTINGS_PENDING[g.id]}</p>
          </section>
        ))}
      </div>

      {logs !== null && (
        <Modal onClose={() => setLogs(null)}>
          <h2>日志</h2>
          {logs.length === 0 ? (
            <EmptyState text="暂无日志" />
          ) : (
            <pre className="log-view">{logs.join('\n')}</pre>
          )}
          <div className="settings-actions">
            <Btn data-testid="logs-close" onClick={() => setLogs(null)}>
              关闭
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * 声明式网页工具（pinned）：URL 提示行与「打开/关闭工具」按钮**分开导出**。
 *
 * ⚠️ 不能用同一个组件既渲染 URL 又渲染操作容器：那样模块卡里会出现**两个**
 * `.module-actions`（网页工具一个 + 生命周期一个）⇒ 按钮被拆成两行、行高参差
 * （用户反馈"功能控件的高度和位置有些问题，例如设置页的模块管理部分"）。
 * 现在按钮由调用方放进**同一个** `.module-actions` 行里。
 */

