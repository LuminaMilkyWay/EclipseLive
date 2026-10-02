import {
  app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, protocol,
  shell
} from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { APP_NAME, type AppInfo } from '@shared/appInfo'
import type { ActionResult } from '@shared/diagnostics'
import type { ChangelogSnapshot } from '@shared/changelog'
import {
  migrateUiSettings,
  uiDefaults,
  validateUiSettings,
  WALLPAPER_EXTS,
  type UiSettings
} from '@shared/theme'
import { createLogger } from './core/logger'
import { createConfig } from './core/config'
import { createEventBus } from './core/bus'
import { createPermissions } from './core/permissions'
import { createGateway } from './core/gateway'
import { createModules } from './core/modules'
import { createPackages, seedPresetModules } from './core/packages'
import { createObs } from './core/obs'
import { createCredentialStore } from './core/credentials'
import { existsSync } from 'node:fs'
import { createProcessService } from './core/process'
import { join as joinPath } from 'node:path'
import {
  buildObsCandidates,
  dedupePaths,
  OBS_SHORTCUT_DIRS,
  OBS_SHORTCUT_NAMES,
  exeFromInstallDir,
  OBS_LAUNCH_ARGS,
  OBS_REGISTRY_KEY,
  isObsProcessListed,
  parseRegQueryDefault,
  pickObsExecutable
} from '@shared/obs-paths'
import { createElectronCipher } from './core/credentials/electron-cipher'
import { createExternalWs } from './core/external-ws'
import { createExternalWsHost } from './core/external-ws/electron-host'
import { createNetworkClient } from './core/network'
import { createChangelog } from './core/changelog'
import { createStylePacks } from './core/styles'
import { createWebTools } from './core/webtools'
import { createElectronWebToolHost, pickParentWindow } from './core/webtools/electron-host'
import { DOCK_HEIGHT_PX } from '@shared/layout'
import { createShortcuts } from './core/shortcuts'
import { createElectronShortcutHost } from './core/shortcuts/electron-host'
import { createOverlayWindows } from './core/overlay-windows'
import {
  applyOverlayResize,
  createElectronOverlayHost,
  isOverlayWindow
} from './core/overlay-windows/electron-host'
import type { IOverlayWindows } from '@contracts/overlays'
import { createWallpaperStore, serveWallpaper, type WallpaperInstallResult } from './core/wallpaper'
import {
  buildDiagnosticBundle,
  collectDiagnostics,
  readLogTail,
  type DiagnosticsDeps
} from './core/diagnostics'
import {
  APP_SETTINGS_VERSION,
  appDefaults,
  validateAppSettings,
  type AppSettings
} from '@shared/appSettings'
import { createUpdateChecker, type UpdateCheckResult } from './core/updates'
import { isPermissionType } from '@contracts/permission'

/**
 * Assembly root: wires every core service, completes the lifecycle (tray,
 * close-to-tray, explicit quit) and exposes the minimal IPC surface the
 * renderer needs (diagnostics page + module management, T12).
 */

// T17 全局底图自定义协议（方案 A）：特权注册必须在 app ready 之前完成；
// corsEnabled + supportFetchAPI 保证浏览器源页面可 fetch 取图。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'eclipse-wallpaper',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

// 测试专用 userData 注入点：Windows 下 Electron userData 由 Shell Known Folder 解析、
// 不读 APPDATA 环境变量，集成测试须显式重定向（EL_TEST_USERDATA）以免污染真实配置、
// 与运行中的实例争抢单实例锁。必须在 requestSingleInstanceLock（锁位于 userData）之前生效。
if (process.env.EL_TEST_USERDATA) {
  app.setPath('userData', process.env.EL_TEST_USERDATA)
}

// Minimal single-instance guard; the second instance focuses our window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// Core logger: user-input keys and sensitive keys are masked before writing.
const logger = createLogger({
  dir: join(app.getPath('userData'), 'logs'),
  level: app.isPackaged ? 'info' : 'debug'
})
const log = logger.child('lifecycle')
log.info('app starting', {
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform
})

// Core config center: modules declare (defaults + version), never touch files.
const config = createConfig({
  dir: join(app.getPath('userData'), 'config'),
  logger,
  appVersion: app.getVersion()
})
config.register('lifecycle', { defaults: { closeToTray: true }, version: 1 })
// T14 UI 设置分区 + T15 材质档 + T17 全局底图 + T22 可读性降级三开关
// （shape v4：v1–v3 落盘数据经 migrate 补默认）。
config.register('core.ui', {
  defaults: uiDefaults,
  version: 4,
  validate: validateUiSettings,
  migrate: migrateUiSettings
})
// T21 应用设置分区（检查更新默认关闭——不触网红线由 update:check handler 把关）。
config.register('core.app', {
  defaults: appDefaults,
  version: APP_SETTINGS_VERSION,
  validate: (v: unknown) => {
    const r = validateAppSettings(v)
    return r.ok ? { ok: true, errors: [] } : { ok: false, errors: r.errors }
  }
})
// T34 更新日志分区：只存"上次已读版本"（内部记账，不混进用户可见的应用设置）
config.register('core.changelog', { defaults: { lastSeenVersion: '' }, version: 1 })
log.info('config ready', {
  closeToTray: config.get<{ closeToTray: boolean }>('lifecycle')?.closeToTray
})

// Core event bus: the only legal channel between modules (pure router).
const bus = createEventBus({ logger })
bus.subscribe('lifecycle:started', (e) => {
  log.info('lifecycle started event', { source: e.source, version: e.version })
})
bus.publish('lifecycle:started', { pid: process.pid }, { source: 'lifecycle' })

// Core gateway: the ONLY network surface (127.0.0.1, token-gated HTTP+WS).
const gateway = createGateway({ logger, config, bus })

// Dev reads the repo `modules/` directory; packaged builds read
// `userData/modules` (populated by the T7 package service).
const modulesDir = app.isPackaged
  ? join(app.getPath('userData'), 'modules')
  : join(app.getAppPath(), 'modules')

const OK: ActionResult = { ok: true, errors: [] }

/** T27 托盘逃生入口引用：装配 IIFE 与 createTray 之间的模块级桥（晚绑定，null 时无害）。 */
let trayOverlays: IOverlayWindows | null = null

/** 主窗引用：web 工具嵌入视图的父窗口。不能用 getAllWindows()[0]——打字机模块等
 *  启动期创建的 overlay 悬浮窗与主窗竞态创建，列表首位未必是主窗（T31 回归修复）。 */
let mainWindow: BrowserWindow | null = null

// T17 全局底图：图片落 userData/wallpapers/（whenReady 时建目录），经
// eclipse-wallpaper:// 协议提供；仓库与协议服务/IPC 共用（白名单防穿越）。
const wallpaperDir = join(app.getPath('userData'), 'wallpapers')
const wallpaperStore = createWallpaperStore({ dir: wallpaperDir, logger })

void (async () => {
  // Core permission service: async factory awaits persisted revocations
  // before accepting declarations (no startup race window).
  const permissions = await createPermissions({ logger, config })
  permissions.declare('lifecycle', ['obs-control'])
  log.info('permissions ready', { granted: permissions.status('lifecycle').granted })

  // T23/T24 global shortcut service: permission-gated registration with the
  // Electron globalShortcut adapter as the injected host (core stays
  // Electron-free). From here on ctx.shortcuts is live for modules.
  const shortcuts = createShortcuts({ logger, permissions, host: createElectronShortcutHost() })
  log.info('shortcuts ready', { registered: 0 })

  // T25/T26 overlay window service: BrowserWindow adapter as the injected
  // host (frameless/transparent/always-on-top/showInactive — see the host).
  // From here on ctx.overlays is live for modules; overlay windows load
  // the module's own gateway page with the dedicated minimal preload bridge.
  const overlays = createOverlayWindows({ logger, permissions, host: createElectronOverlayHost() })
  trayOverlays = overlays
  log.info('overlays ready', { open: 0 })

  // T26 resize bridge (transparent windows have no system resize on
  // Windows): sender must be an overlay window's webContents — the main
  // window, web tools and foreign senders are silently ignored.
  ipcMain.on('overlay:resize', (event, delta: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !isOverlayWindow(win)) return
    applyOverlayResize(win, (delta ?? {}) as { dx?: unknown; dy?: unknown; dw?: unknown; dh?: unknown })
  })

  await gateway.start()
  // Never log generated URLs — they embed the token.
  log.info('gateway ready', {
    port: gateway.getPort(),
    browserSourceUrl: !!gateway.getBrowserSourceUrl('/')
  })

  // T10 style pack service: .elstyle import/export; modules register their
  // style handlers through the scoped ctx.styles facade.
  const styles = await createStylePacks({
    logger,
    config,
    bus,
    resourcesDir: join(app.getPath('userData'), 'styles'),
    appVersion: app.getVersion()
  })
  log.info('styles ready', {})

  // T13: packaged builds seed the preset modules (resources/modules) into
  // the user's modules directory on first run — user data always wins.
  if (app.isPackaged) {
    await seedPresetModules(join(process.resourcesPath, 'modules'), modulesDir)
  }

  // T9 secure credential store: safeStorage cipher (DPAPI/Keychain/libsecret);
  // the core service itself is Electron-free with an injected cipher.
  // 位置说明（C0）：必须在 createModules 之前 —— 模块上下文里带有命名空间化凭据门面，
  // 而上下文是在 startAll() 加载模块时构建的，晚于此点创建就拿不到 store。
  const credentialCipher = createElectronCipher()
  const credentials = await createCredentialStore({
    logger,
    dir: join(app.getPath('userData'), 'credentials'),
    cipher: credentialCipher
  })
  // Round-trip probe: verifies OS-level encryption works in this environment.
  credentials.set('lifecycle:probe', 'roundtrip-check')
  log.info('credentials ready', {
    protection: credentialCipher.protection,
    roundtrip: credentials.get('lifecycle:probe') === 'roundtrip-check'
  })
  credentials.delete('lifecycle:probe')

  // C0 outbound WebSocket client for modules: loopback-only + permission gated.
  // Electron-free service with an injected `ws` host (same split as
  // overlay-windows / credentials).
  const externalWs = createExternalWs({
    logger,
    permissions,
    host: createExternalWsHost()
  })
  log.info('external websocket client ready', { loopbackOnly: true })

  const modules = createModules({
    logger,
    config,
    bus,
    permissions,
    gateway,
    modulesDir,
    styles,
    shortcuts,
    overlays,
    externalWs,
    credentials
  })
  const summary = await modules.startAll()
  log.info('modules ready', {
    discovered: summary.discovered,
    started: summary.started,
    failed: summary.failed
  })

  // T11 web tool container + T29 module pages: relative web.url resolves
  // through the gateway (token + dynamic port). The renderer keeps a 48px
  // bottom toolbar for open tools; embedded views inset accordingly (see
  // electron-host).
  // T38：任务栏高度改为**单一真源**（src/shared/layout.ts）—— CSS 与本值由守卫锁定一致。
const WEB_TOOLBAR_PX = DOCK_HEIGHT_PX
  const webtools = createWebTools({
    logger,
    modules,
    gateway,
    host: createElectronWebToolHost(
      () => pickParentWindow(BrowserWindow.getAllWindows(), mainWindow),
      () => WEB_TOOLBAR_PX,
      log
    )
  })
  // T29 端口漂移跟随：网关端口变化后，已打开的模块页面重新解析 URL 加载。
  bus.subscribe('gateway:port-changed', () => {
    for (const s of webtools.list()) {
      if (s.page && s.state === 'open') webtools.reload(s.moduleId)
    }
  })
  log.info('webtools ready', { tools: webtools.list().length })

  // T7 .elm package service: watches the modules directory — new/changed
  // .elm files auto-install and load; vanished module dirs auto-unload.
  const packages = createPackages({
    logger,
    modules,
    modulesDir,
    appVersion: app.getVersion()
  })
  await packages.watch()
  log.info('packages ready', { watching: modulesDir })

  // T9 secure credential store 已在 createModules 之前创建（见上方位置说明）。

  // T9 unified network client: interface + local empty implementation —
  // every outbound request is rejected (no cloud endpoints, red line).
  const network = createNetworkClient({ logger })
  log.info('network client ready', { mode: network.diagnostics().mode })

  // T8 OBS bridge: outbound obs-websocket client. connect() never blocks
  // startup — OBS-not-running lands in diagnostics with auto-retry.
  // Password resolution prefers the credential store (T9 upgrade).
  const obs = createObs({ logger, config, bus, gateway, credentials })
  void obs.connect().then(() => {
    const diag = obs.diagnostics()
    log.info('obs bridge ready', { status: diag.status, port: diag.port })
  })

  // T12 diagnostics aggregation + the renderer's minimal action surface.
  const deps: DiagnosticsDeps = {
    app: {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      node: process.versions.node
    },
    config,
    gateway,
    modules,
    permissions,
    obs,
    webtools,
    network,
    credentials,
    shortcuts,
    overlays
  }

  ipcMain.handle('app:diagnostics', () => collectDiagnostics(deps))

  // T34/迁移第 2 步：应用内更新日志的**真源改为仓库根 RELEASE_NOTES.md**（面向用户、每条 ≤50 字），
// CHANGELOG.md 退为开发者记录（仍随包分发但不被界面读取）。
  // 读不到就降级为空且不弹窗，绝不因此影响启动。
  const changelogSource = app.isPackaged
    ? join(process.resourcesPath, 'RELEASE_NOTES.md')
    : join(app.getAppPath(), 'RELEASE_NOTES.md')
  const changelog = createChangelog({
    logger,
    config,
    appVersion: app.getVersion(),
    readSource: () => readFile(changelogSource, 'utf8')
  })
  log.info('changelog ready', { source: changelogSource })
  ipcMain.handle('changelog:get', async (): Promise<ChangelogSnapshot> => {
    const snapshot = await changelog.get()
    // 测试缝（EL_TEST_SKIP_WHATS_NEW）：集成测试每个 spec 都用全新 userData 启动，
    // 不关掉的话每个都会弹"本次更新"，遮罩挡住一切界面交互。与 EL_TEST_SKIP_TITLE 同类。
    return process.env.EL_TEST_SKIP_WHATS_NEW === '1'
      ? { ...snapshot, showWhatsNew: false }
      : snapshot
  })
  ipcMain.handle('changelog:seen', (): ActionResult => {
    changelog.markSeen()
    return { ok: true, errors: [] }
  })
  ipcMain.handle('module:enable', async (_e, moduleId: string) => {
    await modules.enable(moduleId)
    return OK
  })
  ipcMain.handle('module:disable', async (_e, moduleId: string) => {
    await modules.disable(moduleId)
    return OK
  })
  ipcMain.handle('module:uninstall', async (_e, moduleId: string) => {
    // 用户报障「设置里的卸载模块不能用」：`packages.uninstall` 契约是 Promise<void>（失败即抛），
    // 原实现 await 后直接 return OK —— 一旦抛错（典型：模块目录被占用导致 rm 失败、或 unload 失败），
    // 异常会让整条 IPC 拒绝，界面只表现为"点了没反应"，**看不到真实原因**。
    // 这里捕获并按动作契约回传原因（{ ok, errors }），同时写日志便于下一次直接定位。
    try {
      await packages.uninstall(moduleId)
      log.info('module uninstalled via settings', { moduleId })
      return OK
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      log.warn('module uninstall failed', { moduleId, reason })
      return { ok: false, errors: [`卸载失败：${reason}`] }
    }
  })
  ipcMain.handle('package:install', async (): Promise<ActionResult> => {
    const picked = await dialog.showOpenDialog({
      title: '安装模块包（.elm）',
      properties: ['openFile'],
      filters: [{ name: 'EclipseLIVE 模块包', extensions: ['elm'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, errors: ['已取消'] }
    const result = await packages.install(picked.filePaths[0])
    if (result.ok && result.moduleId) {
      await modules.discover()
      const loaded = await modules.load(result.moduleId)
      if (loaded.ok) await modules.start(result.moduleId)
    }
    return result
  })
  ipcMain.handle('style:import', async (): Promise<ActionResult> => {
    const picked = await dialog.showOpenDialog({
      title: '导入样式包（.elstyle）',
      properties: ['openFile'],
      filters: [{ name: 'EclipseLIVE 样式包', extensions: ['elstyle'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, errors: ['已取消'] }
    return styles.importPack(picked.filePaths[0])
  })
  ipcMain.handle(
    'style:export',
    async (_e, arg: { moduleId: string; styleType: string }): Promise<ActionResult> => {
      const picked = await dialog.showSaveDialog({
        title: '导出样式包',
        defaultPath: `${arg.moduleId}-${arg.styleType}.elstyle`,
        filters: [{ name: 'EclipseLIVE 样式包', extensions: ['elstyle'] }]
      })
      if (picked.canceled || !picked.filePath) return { ok: false, errors: ['已取消'] }
      return styles.exportPack(arg.moduleId, arg.styleType, picked.filePath)
    }
  )
  ipcMain.handle('webtool:open', (_e, moduleId: string) => webtools.open(moduleId))
  ipcMain.handle('webtool:close', async (_e, moduleId: string) => {
    webtools.close(moduleId)
    return OK
  })
  // T30 模块页/工具槽位几何/显隐：仅主窗渲染层可上报（工具窗/悬浮窗/外来 sender 忽略）。
  // 用 mainWindow 引用而非 getAllWindows()[0]——overlay 悬浮窗与主窗竞态创建，列表首位未必是主窗。
  const isMainWindowSender = (sender: Electron.WebContents): boolean =>
    mainWindow?.webContents === sender
  ipcMain.handle(
    'module-page:rect',
    (
      e,
      arg: { moduleId: string; rect: { x: number; y: number; width: number; height: number } }
    ): ActionResult => {
      if (!isMainWindowSender(e.sender)) return { ok: false, errors: ['sender not allowed'] }
      webtools.setRect(arg.moduleId, arg.rect)
      return OK
    }
  )
  ipcMain.handle(
    'module-page:visible',
    (e, arg: { moduleId: string; visible: boolean }): ActionResult => {
      if (!isMainWindowSender(e.sender)) return { ok: false, errors: ['sender not allowed'] }
      if (arg.visible) webtools.show(arg.moduleId)
      else webtools.hide(arg.moduleId)
      return OK
    }
  )
  // T33 模块页 UI 令牌（宿主设计令牌当前解析值 → 模块页 :root）：仅主窗渲染层可推送，
  // 值域在服务层清洗（-- 前缀键 + 无 ;{} 值），注入内容永不逃出令牌块。
  ipcMain.handle(
    'module-page:tokens',
    (e, arg: { moduleId: string; tokens: Record<string, string> }): ActionResult => {
      if (!isMainWindowSender(e.sender)) return { ok: false, errors: ['sender not allowed'] }
      webtools.setUiTokens(arg.moduleId, arg.tokens)
      return OK
    }
  )
  // T41（用户批准的新增能力）：自动拉起 OBS —— 路径探测 + 启动 + 生命周期。
  // 只在"OBS 未在运行"时启动（由渲染层先判连接）；启动的进程 detached ⇒ 退出软件默认保留。
  const processes = createProcessService({ logger: log })
  /** 由本软件启动的 OBS 进程号（用户手动启动的实例不在此列 ⇒ 永不关闭）。 */
  let obsLaunchedPid: number | null = null

  /** 用户手动指定的路径（本会话内有效；T41 增量 2）。 */
  let obsUserPath: string | null = null

  /**
   * 发现**全部** OBS 实例（用户实测机器上有两个：桌面快捷方式 + Steam 版）。
   * 顺序即优先级：用户已选 → 桌面/开始菜单快捷方式（解析 .lnk 目标）→ 常见安装 → Steam → 注册表 → 环境变量。
   * `.lnk` 用 Electron 自带的 `shell.readShortcutLink` 解析（零新依赖）。
   */
  const findAllObs = async (): Promise<string[]> => {
    const env = process.env as Record<string, string | undefined>
    const found: string[] = []
    if (obsUserPath !== null && existsSync(obsUserPath)) found.push(obsUserPath)

    // 桌面/OneDrive 桌面的快捷方式
    const home = app.getPath('home')
    const publicDir = env['PUBLIC'] ?? 'C:\\Users\\Public'
    for (const dir of OBS_SHORTCUT_DIRS) {
      for (const base of [joinPath(home, dir), joinPath(publicDir, dir)]) {
        for (const name of OBS_SHORTCUT_NAMES) {
          const lnk = joinPath(base, name)
          if (!existsSync(lnk)) continue
          try {
            const target = shell.readShortcutLink(lnk).target
            if (target !== '' && existsSync(target)) found.push(target)
          } catch {
            /* 解析失败就跳过（非致命） */
          }
        }
      }
    }

    const quick = pickObsExecutable(buildObsCandidates([]), env, existsSync)
    if (quick !== null) found.push(quick)

    const q = await processes.query('reg.exe', ['query', OBS_REGISTRY_KEY, '/ve'])
    if (q.ok) {
      const dir = parseRegQueryDefault(q.stdout)
      if (dir !== null) {
        const exe = exeFromInstallDir(dir)
        if (exe !== '' && existsSync(exe)) found.push(exe)
      }
    }

    const fromEnv = env['OBS_EXE']
    if (fromEnv !== undefined && fromEnv !== '' && existsSync(fromEnv)) found.push(fromEnv)

    return dedupePaths(found)
  }

  ipcMain.handle(
    'obs:launch',
    async (
      _e,
      arg?: { path?: string }
    ): Promise<{ ok: boolean; pid?: number; path?: string; found?: string[]; errors?: string[] }> => {
    // 允许渲染层指定用哪一个（多实例时由用户选择）
    if (typeof arg?.path === 'string' && arg.path !== '' && existsSync(arg.path)) obsUserPath = arg.path
    const found = await findAllObs()
    const exe = found[0] ?? null
    if (exe === null) return { ok: false, found: [], errors: ['未找到 OBS，请手动选择可执行文件'] }
    /** 供界面在"发现多个 OBS"时让用户选择。 */
    if (obsLaunchedPid !== null && processes.isRunning(obsLaunchedPid)) {
      return { ok: true, pid: obsLaunchedPid, path: exe, found } // 本软件已启动 ⇒ 不启第二个
    }
    // 已在运行（用户手动开的也算）⇒ 不启动第二个实例，直接让界面去连
    const listed = await processes.query('tasklist.exe', [
      '/FI',
      'IMAGENAME eq obs64.exe',
      '/NH'
    ])
    if (listed.ok && isObsProcessListed(listed.stdout)) {
      log.info('obs already running; skip launch')
      return { ok: true, path: exe, found, errors: [] }
    }

    const r = await processes.launch(exe, OBS_LAUNCH_ARGS)
    if (r.ok && r.pid !== undefined) {
      obsLaunchedPid = r.pid
      return { ok: true, pid: r.pid, path: exe, found, errors: [] }
    }
    // ⚠️ EACCES：obs64.exe 的清单要求管理员 ⇒ 普通 spawn 会被拒。
    // 改用 ShellExecute 路径（shell.openPath）⇒ Windows 会正常弹出 UAC 提权确认。
    const eacces = (r.errors ?? []).some((e) => /EACCES|EPERM/i.test(e))
    if (eacces) {
      const opened = await shell.openPath(exe)
      if (opened === '') {
        log.info('obs launched through shell (may prompt for elevation)')
        return { ok: true, path: exe, found, errors: [] }
      }
      return { ok: false, path: exe, found, errors: ['需要管理员权限启动 OBS，且系统未能启动它：' + opened] }
    }
    return { ok: false, path: exe, found, errors: r.errors }
  })

  /** T41 增量 2：手动选择 OBS 可执行文件（找到后记入本会话并尝试启动）。 */
  ipcMain.handle('obs:pick', async (): Promise<{ ok: boolean; path?: string; errors?: string[] }> => {
    const picked = await dialog.showOpenDialog({
      title: '选择 OBS 可执行文件',
      properties: ['openFile'],
      filters: [{ name: 'OBS', extensions: ['exe'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, errors: ['已取消'] }
    obsUserPath = picked.filePaths[0]
    log.info('obs executable chosen by user')
    return { ok: true, path: obsUserPath }
  })

  /** 仅当"由本软件启动"时才终止（用户手动启动的实例永不受影响）。 */
  ipcMain.handle('obs:terminate', (): { ok: boolean; errors?: string[] } => {
    if (obsLaunchedPid === null) return { ok: false, errors: ['OBS 不是由本软件启动，不会关闭它'] }
    const ok = processes.terminate(obsLaunchedPid)
    if (ok) obsLaunchedPid = null
    return { ok, errors: ok ? undefined : ['终止失败'] }
  })

  // T43 增量 2（用户批准新增的公共通道）：内置「迷你中控」悬浮窗。
  // 完全复用既有 overlay 服务（透明 / 置顶 / 穿透 / 多屏），**不自造窗口原语**；
  // 窗口注册在 moduleId='builtin' 下，并且核心以 `isOverlayWindow` 标记识别它
  // ⇒ 与打字机 / VTS 的模块悬浮窗互不影响（用户要求的"隔离"）。
  const MINI_ID = 'mini-control'
  const MINI_MODULE = 'builtin'
  const miniUrl = (): string =>
    process.env.ELECTRON_RENDERER_URL
      ? `${process.env.ELECTRON_RENDERER_URL}#mini`
      : ''
  const miniFind = (): ReturnType<typeof overlays.list>[number] | undefined =>
    overlays.list().find((w) => w.moduleId === MINI_MODULE && w.id === MINI_ID)

  ipcMain.handle('overlay:mini:open', (): { ok: boolean; errors?: string[] } => {
    if (miniFind()) return { ok: true }
    const res = overlays.create(MINI_MODULE, MINI_ID, {
      url: miniUrl(),
      transparent: true,
      alwaysOnTop: true,
      resizable: true
    })
    return res.ok ? { ok: true } : { ok: false, errors: res.errors }
  })
  ipcMain.handle('overlay:mini:close', (): { ok: boolean } => ({
    ok: overlays.destroy(MINI_MODULE, MINI_ID)
  }))
  ipcMain.handle('overlay:mini:state', () => {
    const w = miniFind()
    if (!w) return { open: false, alwaysOnTop: false, clickThrough: false, bounds: null }
    const bounds = overlays.getBounds(MINI_MODULE, MINI_ID)
    return {
      open: true,
      alwaysOnTop: true,
      clickThrough: false,
      bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null
    }
  })
  ipcMain.handle('overlay:mini:set', (_e, opts: { alwaysOnTop?: boolean; clickThrough?: boolean }) => {
    if (!miniFind()) return { ok: false, errors: ['mini overlay not open'] }
    if (typeof opts?.alwaysOnTop === 'boolean') overlays.setAlwaysOnTop(MINI_MODULE, MINI_ID, opts.alwaysOnTop)
    if (typeof opts?.clickThrough === 'boolean') overlays.setClickThrough(MINI_MODULE, MINI_ID, opts.clickThrough)
    return { ok: true }
  })

  ipcMain.handle('obs:reconnect', async () => {
    await obs.reconnect()
    return OK
  })

  // T40（用户批准的新增能力）：把**既有** OBS 桥的 send() 开口给渲染层 —— 只做代理，
  // 语义与 IObsBridge.send 完全一致（传输层失败 reject / OBS 业务失败 resolve ok:false）。
  // 凭据路线 B：串流密钥由渲染层直接下发给 OBS，本软件**不落盘**；
  // 本 handler **不记录**请求内容（避免密钥进日志），失败时只回传 OBS 的 status 文本。
  ipcMain.handle(
    'obs:send',
    async (
      _e,
      arg: { requestType?: unknown; requestData?: unknown }
    ): Promise<{ ok: boolean; status?: unknown; data?: unknown; errors?: string[] }> => {
      const rt = typeof arg?.requestType === 'string' ? arg.requestType : ''
      if (rt === '') return { ok: false, errors: ['requestType required'] }
      try {
        const r = await obs.send(rt, arg?.requestData)
        return { ok: r.ok, status: r.status, data: r.data }
      } catch (e) {
        // 只回传错误类型，不回显请求体（可能含密钥）
        return { ok: false, errors: [String(e).slice(0, 200)] }
      }
    }
  )
  ipcMain.handle('diagnostics:export', async (): Promise<ActionResult> => {
    const picked = await dialog.showSaveDialog({
      title: '导出诊断包',
      defaultPath: `eclipselive-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: '诊断包', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { ok: false, errors: ['已取消'] }
    const bundle = await buildDiagnosticBundle(deps, join(app.getPath('userData'), 'logs'))
    await writeFile(picked.filePath, JSON.stringify(bundle, null, 2), 'utf8')
    log.info('diagnostics bundle exported')
    return OK
  })
  // T14 主题设置：core.ui 是整值替换语义——patch 先合并当前值再 set，
  // 校验失败不落盘（config 保证）且原值保持不变。
  ipcMain.handle('ui:settings:get', () => config.get<UiSettings>('core.ui') ?? uiDefaults)
  ipcMain.handle('ui:settings:set', (_e, patch: Partial<UiSettings>): ActionResult => {
    const next = { ...(config.get<UiSettings>('core.ui') ?? uiDefaults), ...patch }
    return config.set('core.ui', next)
  })
  // T17 全局底图：install 无参走对话框（sourcePath 为测试缝）；成功后壁纸名写入 core.ui。
  ipcMain.handle(
    'wallpaper:install',
    async (_e, sourcePath?: string): Promise<WallpaperInstallResult> => {
      let src = sourcePath
      if (!src) {
        const picked = await dialog.showOpenDialog({
          title: '选择全局底图',
          properties: ['openFile'],
          filters: [{ name: '图片', extensions: [...WALLPAPER_EXTS] }]
        })
        if (picked.canceled || !picked.filePaths[0]) return { ok: false, errors: ['已取消'], name: '' }
        src = picked.filePaths[0]
      }
      const result = await wallpaperStore.install(src)
      if (result.ok) {
        config.set('core.ui', {
          ...(config.get<UiSettings>('core.ui') ?? uiDefaults),
          wallpaperImage: result.name
        })
      }
      return result
    }
  )
  // T17 恢复默认：删图片 + 复位显示方式/透明度/模糊度（规格硬性要求）。
  ipcMain.handle('wallpaper:reset', async (): Promise<ActionResult> => {
    const cur = config.get<UiSettings>('core.ui') ?? uiDefaults
    if (cur.wallpaperImage) await wallpaperStore.remove(cur.wallpaperImage)
    return config.set('core.ui', {
      ...cur,
      wallpaperImage: '',
      wallpaperFit: 'fill',
      wallpaperOpacity: 1,
      wallpaperBlur: 0
    })
  })
  // T21 设置项补全：应用设置（检查更新开关，默认关闭）。
  ipcMain.handle('app-settings:get', (): AppSettings => config.get<AppSettings>('core.app') ?? appDefaults)
  ipcMain.handle('app-settings:set', (_e, patch: Partial<AppSettings>): ActionResult => {
    const next = { ...(config.get<AppSettings>('core.app') ?? appDefaults), ...patch }
    return config.set('core.app', next)
  })
  // T21 生命周期设置：关闭到托盘（与 T12 close handler 同一分区）。
  ipcMain.handle('lifecycle:get', () => config.get<{ closeToTray: boolean }>('lifecycle') ?? { closeToTray: true })
  ipcMain.handle('lifecycle:set', (_e, patch: { closeToTray: boolean }): ActionResult => {
    const cur = config.get<{ closeToTray: boolean }>('lifecycle') ?? { closeToTray: true }
    return config.set('lifecycle', { ...cur, ...patch })
  })
  // T21 OBS 连接设置：端口/自动重连 + 密码（空输入=不修改，写入凭据存储不落明文）。
  ipcMain.handle('obs:config:get', () => {
    const cfg = obs.diagnostics()
    const persisted = config.get<{ port: number; autoReconnect: boolean }>('core.obs')
    return { port: persisted?.port ?? cfg.port, autoReconnect: persisted?.autoReconnect ?? true }
  })
  ipcMain.handle(
    'obs:config:set',
    async (
      _e,
      arg: { port?: number; autoReconnect?: boolean; password?: string }
    ): Promise<ActionResult> => {
      const cur = config.get<{
        port: number
        password: string
        eventSubscriptions: number
        autoReconnect: boolean
        bindings: unknown[]
      }>('core.obs')
      if (!cur) return { ok: false, errors: ['OBS 配置未就绪'] }
      if (arg.port !== undefined && (!Number.isInteger(arg.port) || arg.port < 1 || arg.port > 65535)) {
        return { ok: false, errors: ['端口须为 1-65535 的整数'] }
      }
      if (arg.password) credentials.set('obs:password', arg.password)
      const next = {
        ...cur,
        ...(arg.port !== undefined ? { port: arg.port } : {}),
        ...(arg.autoReconnect !== undefined ? { autoReconnect: arg.autoReconnect } : {})
      }
      const r = config.set('core.obs', next)
      if (r.ok && (arg.port !== undefined || arg.password)) await obs.reconnect()
      return r
    }
  )
  // T21 恢复预设：manifest config.defaults 写回模块同名配置分区。
  ipcMain.handle('module:reset-config', (_e, moduleId: string): ActionResult => {
    const defaults = modules.get(moduleId)?.manifest?.config?.defaults
    if (!defaults) return { ok: false, errors: ['该模块没有可恢复的预设'] }
    return config.set(moduleId, { ...defaults })
  })
  // T21 模块权限开关：grant/revoke 均要求权限已由模块声明。
  ipcMain.handle(
    'module:permission:set',
    (_e, arg: { moduleId: string; permission: string; granted: boolean }): ActionResult => {
      if (!isPermissionType(arg.permission)) return { ok: false, errors: ['未知权限类型'] }
      const ok = arg.granted
        ? permissions.grant(arg.moduleId, arg.permission)
        : permissions.revoke(arg.moduleId, arg.permission)
      // T24: revoking global-shortcut takes effect immediately — drop the
      // module's live registrations on top of the trigger-time gate. Grant
      // does NOT restore them: the handler references are gone; restart the
      // module to re-register (documented in the settings UI copy).
      if (!arg.granted && ok && arg.permission === 'global-shortcut') {
        shortcuts.removeModule(arg.moduleId)
      }
      // T26: revoking window-overlay destroys the module's overlay windows
      // immediately. Grant does NOT restore them — restart the module to
      // re-create (windows carry live state).
      if (!arg.granted && ok && arg.permission === 'window-overlay') {
        overlays.removeModule(arg.moduleId)
      }
      return ok ? OK : { ok: false, errors: ['权限操作失败（须为模块已声明的权限）'] }
    }
  )
  // T21 日志查看：当日日志尾部若干行。
  ipcMain.handle('logs:tail', () => readLogTail(join(app.getPath('userData'), 'logs'), 200))
  // T21 检查更新（默认关闭）：开关关闭零请求；开启时仅直查 GitHub Releases。
  ipcMain.handle('update:check', async (): Promise<UpdateCheckResult> => {
    const enabled = config.get<AppSettings>('core.app')?.checkUpdatesEnabled ?? false
    if (!enabled) {
      return { ok: false, status: 'error', current: app.getVersion(), error: '检查更新已关闭' }
    }
    const checker = createUpdateChecker({ logger, appVersion: app.getVersion() })
    return checker.check()
  })
  log.info('diagnostics ready', {})

  // ★ 建窗必须等到**所有 IPC 处理器注册完毕**。
  // 本块是一个未被 await 的浮动 async IIFE，而 `app.whenReady()` 与它并发——
  // 若在那里建窗，渲染层首帧的 IPC 调用会早于处理器注册，拿到
  // "No handler registered for 'xxx'"。打包态实测到过（T34 冒烟测试：
  // 日志里 `app ready` 早于 `changelog ready`，更新日志因此一次性读取失败、弹窗不出现）。
  // 放在这里即天然有序：IIFE 已跑完 ⇒ 处理器齐全；再等 app ready ⇒ 可建窗。
  await app.whenReady()
  log.info('app ready')
  // T17 壁纸目录 + 协议服务（缺失/非法请求一律 404，渲染层纯色回退）。
  await mkdir(wallpaperDir, { recursive: true })
  protocol.handle('eclipse-wallpaper', (req) => serveWallpaper(wallpaperStore, req.url))
  createWindow()
  createTray()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})()

app.on('second-instance', () => {
  log.info('second instance focused')
  showMainWindow()
})

/* ---------- T12 lifecycle: tray + close-to-tray + explicit quit ---------- */

let quitting = false
let tray: Tray | null = null

function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.show()
    win.focus()
  }
}

function createTray(): void {
  try {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets', 'tray.png'))
    tray = new Tray(icon)
    tray.setToolTip(APP_NAME)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => showMainWindow() },
        {
          // T27 穿透逃生入口（常开项：无穿透窗口时点击无害无感；不做 enabled
          // 动态重建——托盘菜单时序复杂度换不来功能收益，正确性靠本入口常开）。
          label: '悬浮窗：关闭鼠标穿透',
          click: () => {
            const service = trayOverlays
            if (!service) return
            for (const w of service.list()) {
              if (w.clickThrough) service.setClickThrough(w.moduleId, w.id, false)
            }
          }
        },
        { label: '退出', click: () => quitApp() }
      ])
    )
    tray.on('click', () => showMainWindow())
    log.info('tray ready')
  } catch (e) {
    log.warn('tray creation failed', { error: String(e) })
  }
}

function quitApp(): void {
  quitting = true
  app.quit()
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.on('ready-to-show', () => win.show())

  // T12: close-to-tray (lifecycle.closeToTray, default true) — the window
  // hides instead of quitting; explicit quit goes through the tray menu.
  win.on('close', (event) => {
    const closeToTray = config.get<{ closeToTray: boolean }>('lifecycle')?.closeToTray ?? true
    if (!quitting && closeToTray) {
      event.preventDefault()
      win.hide()
      log.info('window hidden to tray')
    }
  })

  // T18 测试缝：EL_TEST_SKIP_TITLE 时加载 URL 带 skip-title=1，渲染层跳过标题页直入主界面。
  const skipTitle = process.env.EL_TEST_SKIP_TITLE ? 'skip-title=1' : ''
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(
      skipTitle
        ? `${process.env.ELECTRON_RENDERER_URL}?${skipTitle}`
        : process.env.ELECTRON_RENDERER_URL
    )
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search: skipTitle })
  }
}

ipcMain.handle('app:info', (): AppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform
}))

app.on('before-quit', () => {
  quitting = true
})

// 说明：建窗与托盘**不在这里**做，而是放在上面那个初始化 IIFE 的末尾 ——
// 必须等所有 IPC 处理器注册完再建窗，否则渲染层首帧的 IPC 调用会落空
// （打包态实测：日志里 `app ready` 早于 `changelog ready`）。详见该处注释。

// T12: with the tray active the app stays alive after the window closes;
// quitting is explicit (tray menu) or closeToTray=false.
app.on('window-all-closed', () => {
  log.info('all windows closed')
  const closeToTray = config.get<{ closeToTray: boolean }>('lifecycle')?.closeToTray ?? true
  if (!quitting && !closeToTray && process.platform !== 'darwin') app.quit()
})
