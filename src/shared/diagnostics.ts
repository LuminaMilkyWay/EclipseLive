/**
 * 渲染层诊断快照 DTO（T12）。
 *
 * 仅放无依赖的纯类型：主进程 collectDiagnostics 产出、preload 桥透传、
 * 渲染层消费。web 程序没有 @contracts 别名（T1 程序边界），UI 类型归 shared。
 * 红线：token 只出现存在性布尔；凭据只有元数据；不携带任何敏感值。
 */

export interface DiagnosticsAppInfo {
  name: string
  version: string
  platform: string
  electron: string
  node: string
}

export interface DiagnosticsSectionSummary {
  id: string
  version: number
}

export interface DiagnosticsModule {
  id: string
  status: string
  name?: string
  version?: string
  /**
   * 模块协议（P3）：来自 `manifest.json` 的 SPDX 标识符。
   * **缺失 ⇒ 表示"未声明"**（核心不替作者推断或授权）；界面必须给出明确标注。
   */
  license?: string
  /** C3：导航声明（界面据此把它放到一级菜单、并允许专注布局）。 */
  nav?: { level?: 1 | 2; after?: string; order?: number; immersive?: boolean }
  error?: string
  permissions: string[]
  /** T11 声明式网页工具。 */
  web: boolean
  /** T31：应用内页面模块（web 相对 url 业务模块）——左侧二级菜单数据源。 */
  page: boolean
  /** 声明式工具 pinned 标记（manifest.web?.pinned ?? false）——进扩展组二级菜单。 */
  pinned: boolean
}

export interface DiagnosticsPermissions {
  moduleId: string
  declared: string[]
  revoked: string[]
  granted: string[]
}

export interface DiagnosticsGateway {
  started: boolean
  port: number | null
  /** token 只显示存在性——值绝不跨 IPC（红线）。 */
  tokenPresent: boolean
  routes: string[]
  channels: string[]
  wsClients: number
  recentErrors: Array<{ time: number; message: string }>
}

export interface DiagnosticsObs {
  status: string
  port: number
  attempts: number
  lastError?: string
  lastConnectedAt?: number
  requestsSent: number
  responsesReceived: number
  browserSources: Array<{ sourceName: string; path: string; synced: boolean; lastError?: string }>
}

export interface DiagnosticsWebTools {
  tools: number
  open: number
  denials: number
  recent: Array<{ moduleId: string; kind: string; detail: string; time: number }>
  statuses: Array<{
    moduleId: string
    state: string
    /** 第三方工具声明 URL；模块页面为 null（token 红线）。 */
    url: string | null
    windowMode: string
    pinned: boolean
    /** T29：模块页面（web 相对 url 业务模块）标记。 */
    page: boolean
    denials: number
  }>
}

export interface DiagnosticsNetwork {
  mode: string
  rejected: number
  lastRejection?: string
}

export interface DiagnosticsStyles {
  applied: Array<{ moduleId: string; styleType: string; version: number; appliedAt: number }>
}

export interface DiagnosticsCredentials {
  count: number
  weak: number
  keys: string[]
}

/** T24 全局快捷键（含最近冲突环，accelerator 与 id 为模块自声明元数据，非用户文本）。 */
export interface DiagnosticsShortcuts {
  registered: number
  byModule: Array<{ moduleId: string; ids: string[] }>
  conflicts: Array<{ moduleId: string; id: string; accelerator: string; heldBy: string; time: number }>
}

/** T27 悬浮窗（URL 含 token，红线：只出计数与分组，绝不出窗口 URL）。 */
export interface DiagnosticsOverlays {
  open: number
  byModule: Array<{ moduleId: string; ids: string[] }>
  clickThroughCount: number
}

/** 全服务只读快照（诊断页 + 自动刷新数据源）。 */
export interface DiagnosticsSnapshot {
  generatedAt: number
  app: DiagnosticsAppInfo
  gateway: DiagnosticsGateway
  modules: DiagnosticsModule[]
  permissions: DiagnosticsPermissions[]
  obs: DiagnosticsObs
  webtools: DiagnosticsWebTools
  network: DiagnosticsNetwork
  styles: DiagnosticsStyles
  credentials: DiagnosticsCredentials
  shortcuts: DiagnosticsShortcuts
  overlays: DiagnosticsOverlays
  config: { sections: DiagnosticsSectionSummary[] }
}

/** 一键导出的诊断包 = 快照 + 当日日志尾部（本地文件，用户经保存对话框选择路径）。 */
export interface DiagnosticBundle extends DiagnosticsSnapshot {
  logs: string[]
}

/** UI 动作的统一结果形状。 */
export interface ActionResult {
  ok: boolean
  errors: string[]
}
