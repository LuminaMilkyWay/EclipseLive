import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IConfig } from '@contracts/config'
import type { IGateway } from '@contracts/gateway'
import type { IModuleManager } from '@contracts/module'
import type { IPermission } from '@contracts/permission'
import type { IObsBridge } from '@contracts/obs'
import type { IWebTools } from '@contracts/webtools'
import type { INetworkClient } from '@contracts/network'
import type { ICredentialStore } from '@contracts/credentials'
import type { IGlobalShortcuts } from '@contracts/shortcuts'
import type { IOverlayWindows } from '@contracts/overlays'
import type {
  DiagnosticBundle,
  DiagnosticsSnapshot
} from '@shared/diagnostics'

/**
 * Core diagnostics aggregation (T12).
 *
 * Read-only snapshots of every service for the diagnostics page and the
 * exportable diagnostic bundle. Red lines: the gateway token appears only
 * as a presence boolean, credentials contribute metadata only (key names /
 * weak flag — never values), and no section data is included in the
 * config summary.
 */

export interface DiagnosticsDeps {
  app: {
    name: string
    version: string
    platform: string
    electron: string
    node: string
  }
  config: IConfig
  gateway: IGateway
  modules: IModuleManager
  permissions: IPermission
  obs: IObsBridge
  webtools: IWebTools
  network: INetworkClient
  credentials: ICredentialStore
  /** T24 global shortcut service (registered count / byModule / conflict ring). */
  shortcuts: IGlobalShortcuts
  /** T27 overlay window service (open count / byModule / click-through count). */
  overlays: IOverlayWindows
}

const BUNDLE_LOG_TAIL_LINES = 200

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function collectDiagnostics(deps: DiagnosticsDeps): DiagnosticsSnapshot {
  const gateway = deps.gateway.diagnostics()
  const obs = deps.obs.diagnostics()
  const web = deps.webtools.diagnostics()
  const shortcuts = deps.shortcuts.diagnostics()
  const overlays = deps.overlays.diagnostics()

  const credentialRecords = deps.credentials.list()

  // Applied styles come from the core.styles section (metadata only).
  const styleShape = deps.config.get<{
    applied?: Record<string, { version: number; appliedAt: number }>
  }>('core.styles')
  const stylesApplied: DiagnosticsSnapshot['styles']['applied'] = []
  if (isPlainObject(styleShape?.applied)) {
    for (const [key, rec] of Object.entries(styleShape.applied)) {
      const sep = key.indexOf(':')
      if (sep <= 0 || typeof rec?.version !== 'number' || typeof rec?.appliedAt !== 'number') {
        continue
      }
      stylesApplied.push({
        moduleId: key.slice(0, sep),
        styleType: key.slice(sep + 1),
        version: rec.version,
        appliedAt: rec.appliedAt
      })
    }
  }

  return {
    generatedAt: Date.now(),
    app: { ...deps.app },
    gateway: {
      started: gateway.started,
      port: gateway.port,
      tokenPresent: gateway.tokenPresent,
      routes: [...gateway.routes],
      channels: [...gateway.channels],
      wsClients: gateway.wsClients,
      recentErrors: gateway.recentErrors.map((e) => ({ ...e }))
    },
    modules: deps.modules.list().map((m) => ({
      id: m.id,
      status: m.status,
      name: m.manifest?.name,
      version: m.manifest?.version,
      // P3/T66：模块协议随快照给界面（缺失 ⇒ 界面标注「未声明」）
      license: m.manifest?.license,
      error: m.error,
      permissions: m.manifest ? [...m.manifest.permissions] : [],
      web: m.manifest?.web !== undefined,
      page: m.manifest?.web !== undefined && m.manifest?.entry !== undefined,
      pinned: m.manifest?.web?.pinned ?? false
    })),
    permissions: deps.permissions.listAll().map((p) => ({
      moduleId: p.moduleId,
      declared: [...p.declared],
      revoked: [...p.revoked],
      granted: [...p.granted]
    })),
    obs: {
      status: obs.status,
      port: obs.port,
      attempts: obs.attempts,
      lastError: obs.lastError,
      lastConnectedAt: obs.lastConnectedAt,
      requestsSent: obs.requestsSent,
      responsesReceived: obs.responsesReceived,
      browserSources: obs.browserSources.map((b) => ({ ...b }))
    },
    webtools: {
      tools: web.tools,
      open: web.open,
      denials: web.denials,
      recent: web.recent.map((d) => ({ ...d })),
      statuses: deps.webtools.list().map((s) => ({
        moduleId: s.moduleId,
        state: s.state,
        url: s.url,
        windowMode: s.windowMode,
        pinned: s.pinned,
        page: s.page,
        denials: s.denials
      }))
    },
    network: { ...deps.network.diagnostics() },
    styles: { applied: stylesApplied },
    credentials: {
      count: credentialRecords.length,
      weak: credentialRecords.filter((r) => r.weak).length,
      keys: credentialRecords.map((r) => r.key)
    },
    shortcuts: {
      registered: shortcuts.registered,
      byModule: shortcuts.byModule.map((m) => ({ moduleId: m.moduleId, ids: [...m.ids] })),
      conflicts: shortcuts.conflicts.map((c) => ({ ...c }))
    },
    overlays: {
      open: overlays.open,
      byModule: overlays.byModule.map((m) => ({ moduleId: m.moduleId, ids: [...m.ids] })),
      clickThroughCount: overlays.clickThroughCount
    },
    config: { sections: deps.config.sections().map((s) => ({ ...s })) }
  }
}

/** 读取当日日志文件尾部若干行（T21 日志查看 + 诊断包共用）。 */
export async function readLogTail(logsDir: string, lines: number): Promise<string[]> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const files = (await readdir(logsDir)).filter((f) => f === `eclipselive-${today}.log`)
    if (files.length > 0) {
      const content = await readFile(join(logsDir, files[files.length - 1]), 'utf8')
      const all = content.split(/\r?\n/).filter((l) => l.length > 0)
      return all.slice(-lines)
    }
  } catch {
    // No readable log file.
  }
  return []
}

/** Snapshot + the tail of today's log file (一键导出诊断包). */
export async function buildDiagnosticBundle(
  deps: DiagnosticsDeps,
  logsDir: string,
  tailLines = BUNDLE_LOG_TAIL_LINES
): Promise<DiagnosticBundle> {
  const logs = await readLogTail(logsDir, tailLines)
  return { ...collectDiagnostics(deps), logs }
}
