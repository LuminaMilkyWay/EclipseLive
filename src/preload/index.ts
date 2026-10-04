import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo } from '@shared/appInfo'
import type { ActionResult, DiagnosticsSnapshot } from '@shared/diagnostics'
import type { ChangelogSnapshot } from '@shared/changelog'
import { effectiveMaterial, resolveTheme, wallpaperUrl, type UiSettings } from '@shared/theme'
import type { AppSettings } from '@shared/appSettings'

/**
 * 受限桥：渲染层唯一入口。
 *
 * T0 暴露只读 app:info；T12 追加诊断页与模块管理页所需的最小动作面：
 * 1. 全部经 ipcRenderer.invoke（无 Node/Electron 原生 API 透传）；
 * 2. 动作统一返回 { ok, errors }；
 * 3. 同步更新 index.d.ts 类型声明（自动——window.eclipselive 即本文件 api 类型）。
 *
 * T14 追加主题设置：IPC resolve 后同步把主题/强调色/材质根节点属性写到根节点，
 * 消除"调用返回后立即读 DOM"的竞态（App.tsx 主题引擎兜底 + 跟随系统变化）。
 * T17 追加全局底图：壁纸根节点属性 + CSS 变量同规则同步应用；wallpaperInstall/
 * wallpaperReset 在 resolve 前走完「配置写入 + 应用」（集成测试断言无重试）。
 */

// preload 运行时有 DOM/matchMedia，但 tsconfig.node 无 DOM 类型——结构化访问。
const dom = globalThis as unknown as {
  document: {
    documentElement: {
      setAttribute(name: string, value: string): void
      style: { setProperty(name: string, value: string): void }
    }
  }
  matchMedia: (query: string) => { matches: boolean }
}

function applyUiSettings(s: UiSettings): void {
  const theme = resolveTheme(s.themeMode, dom.matchMedia('(prefers-color-scheme: dark)').matches)
  const root = dom.document.documentElement
  root.setAttribute('data-theme', theme)
  root.setAttribute('data-accent', s.accent)
  // T22 档 3 自动降档：data-material 写渲染值（持久化值不变）+ 三降级属性（'1'/'0'）。
  root.setAttribute('data-material', String(effectiveMaterial(s)))
  root.setAttribute('data-reduce-transparency', s.reduceTransparency ? '1' : '0')
  root.setAttribute('data-high-contrast', s.highContrast ? '1' : '0')
  root.setAttribute('data-reduce-motion', s.reduceMotion ? '1' : '0')
  // T17 全局底图：显示方式走根节点属性，图片/透明度/模糊度走 CSS 变量。
  root.setAttribute('data-wallpaper-fit', s.wallpaperFit)
  root.style.setProperty(
    '--wallpaper-url',
    s.wallpaperImage ? `url("${wallpaperUrl(s.wallpaperImage)}")` : 'none'
  )
  root.style.setProperty('--wallpaper-opacity', String(s.wallpaperOpacity))
  root.style.setProperty('--wallpaper-blur', `${s.wallpaperBlur}px`)
}

const api = {
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  diagnostics: (): Promise<DiagnosticsSnapshot> => ipcRenderer.invoke('app:diagnostics'),
  // T34 应用内更新日志（真源 CHANGELOG.md，主进程解析后交给渲染层）
  changelogGet: (): Promise<ChangelogSnapshot> => ipcRenderer.invoke('changelog:get'),
  changelogSeen: (): Promise<ActionResult> => ipcRenderer.invoke('changelog:seen'),
  // T43 增量 2：内置迷你中控悬浮窗（置顶 / 透明 / 穿透；与模块悬浮窗隔离）
  overlayMiniOpen: (): Promise<ActionResult> => ipcRenderer.invoke('overlay:mini:open'),
  overlayMiniClose: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('overlay:mini:close'),
  overlayMiniState: (): Promise<{
    open: boolean
    alwaysOnTop: boolean
    clickThrough: boolean
    bounds: { x: number; y: number; width: number; height: number } | null
  }> => ipcRenderer.invoke('overlay:mini:state'),
  overlayMiniSet: (opts: {
    alwaysOnTop?: boolean
    clickThrough?: boolean
  }): Promise<ActionResult> => ipcRenderer.invoke('overlay:mini:set', opts),
  enableModule: (moduleId: string): Promise<ActionResult> =>
    ipcRenderer.invoke('module:enable', moduleId),
  disableModule: (moduleId: string): Promise<ActionResult> =>
    ipcRenderer.invoke('module:disable', moduleId),
  uninstallModule: (moduleId: string): Promise<ActionResult> =>
    ipcRenderer.invoke('module:uninstall', moduleId),
  installPackage: (): Promise<ActionResult> => ipcRenderer.invoke('package:install'),
  importStylePack: (): Promise<ActionResult> => ipcRenderer.invoke('style:import'),
  exportStylePack: (moduleId: string, styleType: string): Promise<ActionResult> =>
    ipcRenderer.invoke('style:export', { moduleId, styleType }),
  openWebTool: (moduleId: string): Promise<ActionResult> =>
    ipcRenderer.invoke('webtool:open', moduleId),
  closeWebTool: (moduleId: string): Promise<ActionResult> =>
    ipcRenderer.invoke('webtool:close', moduleId),
  // T30 模块页槽位（主窗渲染层专用；sender 校验拒外来调用）：
  reportModulePageRect: (
    moduleId: string,
    rect: { x: number; y: number; width: number; height: number }
  ): Promise<ActionResult> => ipcRenderer.invoke('module-page:rect', { moduleId, rect }),
  setModulePageVisible: (moduleId: string, visible: boolean): Promise<ActionResult> =>
    ipcRenderer.invoke('module-page:visible', { moduleId, visible }),
  // T33 模块页 UI 令牌：把宿主设计令牌当前解析值推送给模块页（renderer 读计算值，主进程注入）。
  setModulePageUiTokens: (
    moduleId: string,
    tokens: Record<string, string>
  ): Promise<ActionResult> => ipcRenderer.invoke('module-page:tokens', { moduleId, tokens }),
  reconnectObs: (): Promise<ActionResult> => ipcRenderer.invoke('obs:reconnect'),
  exportDiagnostics: (): Promise<ActionResult> => ipcRenderer.invoke('diagnostics:export'),
  // T14：读取即对齐根节点属性；set 成功后同步应用（失败不应用，原值不变）。
  uiSettings: (): Promise<UiSettings> =>
    ipcRenderer.invoke('ui:settings:get').then((s: UiSettings) => {
      applyUiSettings(s)
      return s
    }),
  setUiSettings: (patch: Partial<UiSettings>): Promise<ActionResult> =>
    ipcRenderer.invoke('ui:settings:set', patch).then(async (r: ActionResult) => {
      if (r.ok) applyUiSettings(await ipcRenderer.invoke('ui:settings:get'))
      return r
    }),
  // T17 全局底图：install 无参走主进程对话框（sourcePath 为测试缝）；
  // 成功后主进程写 core.ui，resolve 前同步应用（返回壁纸安全唯一名）。
  wallpaperInstall: (sourcePath?: string): Promise<ActionResult & { name: string }> =>
    ipcRenderer
      .invoke('wallpaper:install', sourcePath)
      .then(async (r: ActionResult & { name: string }) => {
        if (r.ok) applyUiSettings(await ipcRenderer.invoke('ui:settings:get'))
        return r
      }),
  wallpaperReset: (): Promise<ActionResult> =>
    ipcRenderer.invoke('wallpaper:reset').then(async (r: ActionResult) => {
      if (r.ok) applyUiSettings(await ipcRenderer.invoke('ui:settings:get'))
      return r
    }),
  // T21 设置项补全：应用/生命周期/OBS 连接配置、模块预设与权限、日志查看、检查更新。
  appSettings: (): Promise<AppSettings> => ipcRenderer.invoke('app-settings:get'),
  setAppSettings: (patch: Partial<AppSettings>): Promise<ActionResult> =>
    ipcRenderer.invoke('app-settings:set', patch),
  lifecycleSettings: (): Promise<{ closeToTray: boolean }> =>
    ipcRenderer.invoke('lifecycle:get'),
  setLifecycleSettings: (patch: { closeToTray: boolean }): Promise<ActionResult> =>
    ipcRenderer.invoke('lifecycle:set', patch),
  /** T40（用户批准的新增能力）：代理既有 OBS 桥 send()；请求体可能含密钥，调用方自行脱敏。 */
  /** T41：自动拉起 OBS（路径探测 + 启动；已在本软件启动时不重复启动）。 */
  obsLaunch: (path?: string): Promise<{ ok: boolean; pid?: number; path?: string; found?: string[]; errors?: string[] }> =>
    ipcRenderer.invoke('obs:launch', { path }),
  /** T41：手动选择 OBS 可执行文件（Steam/自定义安装找不到时的兜底）。 */
  obsPick: (): Promise<{ ok: boolean; path?: string; errors?: string[] }> => ipcRenderer.invoke('obs:pick'),
  /** T41：仅当 OBS 由本软件启动时才终止（用户手动启动的实例永不受影响）。 */
  obsTerminate: (): Promise<{ ok: boolean; errors?: string[] }> => ipcRenderer.invoke('obs:terminate'),

  obsSend: (requestType: string, requestData?: unknown): Promise<{ ok: boolean; status?: unknown; data?: unknown; errors?: string[] }> =>
    ipcRenderer.invoke('obs:send', { requestType, requestData }),
  obsConfig: (): Promise<{ port: number; autoReconnect: boolean }> =>
    ipcRenderer.invoke('obs:config:get'),
  setObsConfig: (arg: {
    port?: number
    autoReconnect?: boolean
    password?: string
  }): Promise<ActionResult> => ipcRenderer.invoke('obs:config:set', arg),
  resetModuleConfig: (moduleId: string): Promise<ActionResult> =>
    ipcRenderer.invoke('module:reset-config', moduleId),
  setModulePermission: (arg: {
    moduleId: string
    permission: string
    granted: boolean
  }): Promise<ActionResult> => ipcRenderer.invoke('module:permission:set', arg),
  viewLogs: (): Promise<string[]> => ipcRenderer.invoke('logs:tail'),
  checkUpdate: (): Promise<{
    ok: boolean
    status: string
    current: string
    latest?: string
    url?: string
    error?: string
  }> => ipcRenderer.invoke('update:check')
}

contextBridge.exposeInMainWorld('eclipselive', api)

export type EclipseLiveApi = typeof api
