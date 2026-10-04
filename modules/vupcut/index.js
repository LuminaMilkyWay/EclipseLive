/**
 * VupCutCode 模块入口。
 *
 * 做三件事（仍**不碰产品逻辑**）：
 *   ① 装配端口（生产实现 or 假实现 —— 由环境变量/配置决定）⇒ 供后续 store/asr/scorer/editor 使用；
 *   ② **联网的两把钥匙**（用户 Q1=a：开关存在本模块配置里，核心另有一道硬闸门）：
 *        · 第一把：`config.network.enabled`（用户在 VupCut 页面自己开，**默认关**）；
 *        · 第二把：`ctx.network` 是否存在（需 `network-access` 权限且核心已注入）。
 *      两把都到位才联网；**核心侧还有第三道**（用户同意 + 仅 https + 主机白名单，默认全拒）。
 *   ③ **价目刷新**：启动后延迟（默认 10 秒，可配）在后台拉一次；失败**静默**回退内置/缓存；
 *      另暴露 `prices.refresh()` 供界面"立即更新"按钮调用。
 *
 * 便于实例注入测试：装配模式与联网状态都暴露在返回对象上（内存对象，不落盘、不改核心）。
 *
 * 协议：本模块以 **AGPL-3.0-or-later** 发布（见同目录 LICENSE）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPorts } from './lib/ports.js'
import { refreshPrices } from './lib/prices-online.js'
import { registerControlRoutes } from './lib/control-routes.js'
import { createRuntime } from './lib/runtime.js'
import { registerRunRoutes } from './lib/run-routes.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 内置价目表（离线兜底：**没有网络也必须能用**）。 */
function loadBuiltinPrices() {
  try {
    return JSON.parse(readFileSync(join(HERE, 'prices.json'), 'utf8'))
  } catch {
    return { version: 1, currency: 'CNY', models: [] }
  }
}

/**
 * ⚠️ 入口钩子必须是契约里的 **`init` / `start` / `stop`**（见 `IModule`）——
 * 我最初只导出了 `activate`，核心**永远不会调用它** ⇒ 路由没注册、端口没装配，
 * 而 manifest 声明了 `web.url`，所以页面照样被打开（**空白页**）⇒ "测试全绿但真机是死的"。
 * 现同时导出 `init`（核心用）与 `activate`（测试与旧调用方用），二者同一个实现。
 */
export async function init(ctx) {
  return await activate(ctx)
}

export async function activate(ctx) {
  const cfg = (await ctx.config.get()) ?? {}
  const { mode, ports } = createPorts({ ctx, testCfg: cfg.test ?? null })

  const builtin = loadBuiltinPrices()
  const wantNetwork = cfg.network?.enabled === true
  const canNetwork = Boolean(ctx.network)
  const online = wantNetwork && canNetwork
  const startupDelayMs = Number.isFinite(cfg.network?.startupDelayMs) ? Math.max(0, cfg.network.startupDelayMs) : 10_000
  const cacheDir = typeof cfg.paths?.tmp === 'string' && cfg.paths.tmp !== '' ? cfg.paths.tmp : null

  let last = null
  const refresh = async (why = 'manual') => {
    if (!canNetwork) {
      // 没有门面 ⇒ 如实说明原因并用内置表（不报错、不弹窗）。
      last = { ok: true, source: 'builtin', table: builtin, error: '未获核心授权（缺少 network-access 或未注入网络服务）' }
      return last
    }
    last = await refreshPrices({
      enabled: online,
      // 生产取数走核心门面：模块**永不自行 fetch**（契约红线）。
      fetchJson: async (url) => {
        const res = await ctx.network.request(url, { method: 'GET', timeoutMs: 20_000 })
        return res.body
      },
      cacheDir,
      builtin,
      userOverride: cfg.prices?.override ?? null,
      families: Array.isArray(cfg.prices?.families) && cfg.prices.families.length > 0 ? cfg.prices.families : undefined
    })
    ctx.logger.info('vupcut prices refresh', {
      why,
      ok: last.ok,
      source: last.source,
      error: last.error ?? null,
      models: Array.isArray(last.table?.models) ? last.table.models.length : 0
    })
    return last
  }

  // 启动刷新：**两把钥匙都到位**才发起；延迟执行、失败静默（不阻塞启动、不打扰用户）。
  if (online && startupDelayMs >= 0) {
    const timer = setTimeout(() => {
      void refresh('startup').catch(() => {})
    }, startupDelayMs)
    // 不因为这个定时器拖住进程退出（模块停用/卸载时进程要能干净结束）。
    if (typeof timer.unref === 'function') timer.unref()
  }

  ctx.logger.info('vupcut activated', {
    testMode: mode.enabled,
    fixtures: mode.fixtures || '(none)',
    fakes: [...mode.fakes],
    portNames: Object.keys(ports),
    network: { want: wantNetwork, can: canNetwork, online, startupDelayMs }
  })

  const api = { mode, ports, prices: { refresh, builtin, online, wantNetwork, canNetwork, last: () => last } }

  // 控制页（模块自带的静态页 + 模块自己的路由）：页面读状态、写配置、存密钥、触发价目刷新。
  if (ctx.gateway && typeof ctx.gateway.registerHttpRoute === 'function') {
    try {
      registerControlRoutes(ctx, api)
      // "处理"这一条链（选场次 → 跑 → 进度 → 结果 → 导出/手动标记）。
      registerRunRoutes(ctx, api, createRuntime(ctx, cfg))
    } catch (e) {
      // 路由注册失败不应拖垮模块加载（页面会显示降级内容）。
      ctx.logger.warn('vupcut control routes failed', { reason: String(e && e.message ? e.message : e).slice(0, 160) })
    }
  }

  return api
}
