'use strict'

/**
 * VTS ControlPad — M1 骨架/连接 + M2 热键读取与网格数据。
 *
 * 架构要点（红线相关）：
 * - **不自行开 WebSocket**：官方 `vtubestudio` 库经 `webSocketFactory` 扩展点改用核心门面
 *   `ctx.externalWs`（见 lib/transport.js）。
 * - **token 不硬编码、不落明文**：走 `ctx.credentials`（核心加密存储的模块命名空间门面）。
 *   库通过 `authTokenGetter/Setter` 回调取存，故 token 始终留在主进程。
 * - **不阻塞启动**：连接失败只改状态、不抛（VTS 未运行是常态）；库自带 5 秒重连。
 * - 只声明 `external-websocket`：悬浮窗/快捷键能力在后续卡落地时才加声明。
 *
 * ★ 认证由**库自己完成**，模块不重复实现（读 vendor `endpoints.js:293-336` 得来）：
 *   库在 socket open 后自动 `apiState()` → 若 `currentSessionAuthenticated` 则跳过；
 *   否则「取 token → authentication」，取 token 失败则回退「请求新 token（VTS 弹窗）
 *   → authentication → 存 token」。全流程结束后回调 `on('connect')`，
 *   出错则回调 `on('error')` **并关连接**（5 秒后重连）。
 *   ⇒ 模块只做两件事：提供 token 存取回调 + 监听 connect/error。
 *   （早期版本手写了一套认证，导致**重复认证**——已删除。）
 */

const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { ApiClient } = require('./vendor/vtubestudio/lib')
const { createFacadeSocket } = require('./lib/transport')
const { STATUS, classifyAuthError } = require('./lib/auth')
const { normalizeHotkeys } = require('./lib/hotkeys')
const { describeTriggerError, nextToggleState, TRIGGER_RESULT } = require('./lib/trigger')
const {
  PERSIST_DEBOUNCE,
  computeCreateBounds,
  snapBounds,
  screenForBounds,
  clampFloatColumns
} = require('./lib/float')

const SOCKET_ID = 'vts'
const TOKEN_KEY = 'auth-token'
/**
 * VTS API 地址。官方固定端口 8001，故**不做用户配置**（AI_RULES 第 12 条）。
 * 测试缝：`EL_VTS_URL` 可覆盖——并行测试文件各自需要独立端口，否则会 EADDRINUSE
 * （与项目既有的 `EL_TEST_*` 测试缝同类）。
 */
const VTS_URL = process.env.EL_VTS_URL || 'ws://localhost:8001'
const PLUGIN_NAME = 'EclipseLIVE VTS ControlPad'
const PLUGIN_DEVELOPER = 'EclipseLIVE'
const EVENT_STATE = 'vts-controlpad:state-changed'
const CHANNEL = 'vts-controlpad'
const ROUTE_STATE = '/vts-controlpad/state'
const ROUTE_CONTROL = '/vts-controlpad/control'
const ROUTE_FLOAT = '/vts-controlpad/float'
const EVENT_FLOAT = 'vts-controlpad:float-changed'

/**
 * 悬浮窗 id 与最小尺寸。归属键由核心服务拼成 `${moduleId}:${id}`，故与
 * prologue-live 的悬浮窗天然不交叉——本模块**无法**创建/销毁/移动对方的窗口，
 * 反之亦然（核心 facade 是模块作用域的）。
 */
const FLOAT_ID = 'pad'
const FLOAT_MIN = { width: 220, height: 120 }

/** @type {import('@contracts/module').ModuleContext | null} */
let ctx = null
/** @type {InstanceType<typeof ApiClient> | null} */
let client = null
let status = STATUS.IDLE
let detail = ''
let authenticated = false
/** @type {Array<{id:string,name:string,kind:string,type:string,description:string}>} */
let hotkeys = []
let model = { loaded: false, name: '' }
/**
 * 开关态：`{ [hotkeyId]: 'on'|'off' }`，缺省 = 未知。
 * **只由 `hotkeyTriggered` 事件驱动**（含用户从 VTS 界面触发的情形），不做乐观猜测。
 */
let states = {}
/** 最近一次触发结果（页面据此给出准确反馈）。 */
let lastResult = null
let subscribed = false

/* ---------- 悬浮窗 / 快捷键状态 ---------- */
let configCache = {}
/** 窗口类错误（创建失败/崩溃）与快捷键类错误**分开存**：两者互不覆盖，
 *  否则"创建失败"会被后续一次成功的快捷键注册抹掉（真实踩过）。 */
let floatError = ''
let shortcutError = ''
let floatScreen = ''
let persistTimer = null
let unsubConfig = null
/** 悬浮窗穿透快捷键的注册态（避免重复注册；冲突时显式上报而非静默） */
let shortState = { enabled: false, toggle: null }

/** 页面文件在 init 时读入（随包分发；不新增资源路由）。 */
const pages = { control: '', float: '' }

function loadPages() {
  try {
    pages.control = readFileSync(join(__dirname, 'pages', 'control.html'), 'utf8')
  } catch (e) {
    ctx?.logger.warn('control page missing', { error: String(e) })
    pages.control = placeholderPage('控制页缺失')
  }
  try {
    pages.float = readFileSync(join(__dirname, 'pages', 'float.html'), 'utf8')
  } catch (e) {
    ctx?.logger.warn('float page missing', { error: String(e) })
    pages.float = placeholderPage('悬浮窗页缺失')
  }
}

function placeholderPage(text) {
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>VTS ControlPad</title></head>' +
    '<body style="margin:0;min-height:100vh;background:transparent"><p>' +
    text +
    '</p></body></html>'
  )
}

function readConfig() {
  const raw = (ctx && ctx.config && ctx.config.get && ctx.config.get()) || {}
  const f = raw && typeof raw.float === 'object' && raw.float !== null ? raw.float : {}
  return {
    hiddenHotkeyIds: Array.isArray(raw.hiddenHotkeyIds) ? raw.hiddenHotkeyIds : [],
    hotkeyOrder: Array.isArray(raw.hotkeyOrder) ? raw.hotkeyOrder : [],
    float: {
      enabled: f.enabled === true,
      hotkeyIds: Array.isArray(f.hotkeyIds) ? f.hotkeyIds.map((v) => String(v)) : [],
      columns: clampFloatColumns(f.columns),
      screen: typeof f.screen === 'string' ? f.screen : '',
      x: Number.isFinite(f.x) ? f.x : 100,
      y: Number.isFinite(f.y) ? f.y : 100,
      width: Number.isFinite(f.width) ? f.width : 360,
      height: Number.isFinite(f.height) ? f.height : 240,
      clickThrough: f.clickThrough === true,
      bgOpacity: Number.isFinite(f.bgOpacity) ? f.bgOpacity : 80,
      snapEdges: f.snapEdges !== false,
      rememberPosition: f.rememberPosition !== false,
      toggleThroughHotkey: typeof f.toggleThroughHotkey === 'string' ? f.toggleThroughHotkey : ''
    }
  }
}

/** 悬浮窗上显示的热键：按 `float.hotkeyIds` 的顺序过滤当前列表（未配置 = 空）。 */
function floatHotkeys(cfg) {
  const wanted = cfg.float.hotkeyIds
  if (wanted.length === 0) return []
  const byId = new Map(hotkeys.map((h) => [h.id, h]))
  return wanted.map((id) => byId.get(id)).filter(Boolean)
}

function snapshot() {
  const cfg = readConfig()
  return {
    status,
    detail,
    authenticated,
    model: { loaded: model.loaded, name: model.name },
    hotkeys: hotkeys.map((h) => ({ ...h })),
    /** 开关态：缺省表示"未知"（未收到过事件），页面显示中性指示 */
    states: { ...states },
    lastResult: lastResult ? { ...lastResult } : null,
    /** 悬浮窗：主界面据此显示勾选状态与错误；悬浮窗页面据此渲染紧凑网格 */
    float: {
      enabled: cfg.float.enabled,
      clickThrough: cfg.float.clickThrough,
      columns: cfg.float.columns,
      bgOpacity: cfg.float.bgOpacity,
      snapEdges: cfg.float.snapEdges,
      rememberPosition: cfg.float.rememberPosition,
      toggleThroughHotkey: cfg.float.toggleThroughHotkey,
      error: floatError,
      shortcutError
    },
    /** 悬浮窗上显示的热键（按 float.hotkeyIds 顺序过滤后的子集） */
    floatHotkeys: floatHotkeys(cfg).map((h) => ({ ...h }))
  }
}

/** 同一份快照同时给：bus 事件（其他模块/诊断）与通道广播（模块页）。 */
function emitState() {
  if (!ctx) return
  const snap = snapshot()
  ctx.bus.publish(EVENT_STATE, snap)
  ctx.gateway.broadcast(CHANNEL, { type: 'state', ...snap })
}

function publish(next, nextDetail) {
  status = next
  detail = nextDetail === undefined ? '' : nextDetail
  if (ctx) {
    if (status === STATUS.AUTHENTICATED) ctx.logger.info('vts authenticated')
    else ctx.logger.info('vts state', { status, detail })
  }
  emitState()
}

/** 取/存 token：核心加密存储的模块命名空间（键 `module:vts-controlpad:auth-token`）。 */
function readToken() {
  try {
    return ctx?.credentials?.get(TOKEN_KEY) ?? null
  } catch (e) {
    ctx?.logger.warn('credential read failed', { error: String(e) })
    return null
  }
}

function writeToken(token) {
  try {
    ctx?.credentials?.set(TOKEN_KEY, token)
  } catch (e) {
    ctx?.logger.warn('credential write failed', { error: String(e) })
  }
}

/**
 * 读取当前模型的热键并归一化。
 *
 * 未认证时清空（页面据此显示空状态）——绝不让过期列表残留成"幽灵按钮"。
 */
async function refreshHotkeys() {
  if (!client || !authenticated) {
    hotkeys = []
    model = { loaded: false, name: '' }
    states = {}
    emitState()
    return
  }
  try {
    const res = await client.hotkeysInCurrentModel({})
    model = {
      loaded: res.modelLoaded === true,
      name: typeof res.modelName === 'string' ? res.modelName : ''
    }
    const cfg = readConfig()
    hotkeys = normalizeHotkeys(res.availableHotkeys, {
      hidden: cfg.hiddenHotkeyIds,
      order: cfg.hotkeyOrder
    })
    // 列表可能已换（换模型/切 Live2D 道具）：旧的开/关状态不再可信 → 一律回到"未知"。
    // 诚实优先于"看起来连续"：我们无法查询热键的真实开关态，只能靠事件累计。
    states = {}
    ctx.logger.info('vts hotkeys loaded', { count: hotkeys.length, model: model.name })
    emitState()
  } catch (e) {
    // 模型未加载、切模型中、被限流等：清空列表，不抛
    ctx?.logger.warn('hotkeys read failed', { error: String((e && e.message) || e) })
    hotkeys = []
    model = { loaded: false, name: '' }
    states = {}
    emitState()
  }
}

/* ---------- 悬浮窗（M4） ---------- */

/**
 * 位置/尺寸记忆：debounce 落配置（拖动中避免频繁写盘）。
 * 写入走核心配置服务（整段替换），失败只记日志不抛。
 */
function persistFloatFields(fields) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    applyConfigChange('float', fields)
  }, PERSIST_DEBOUNCE)
}

function setFloatError(message) {
  const next = message || ''
  if (next === floatError) return
  floatError = next
  emitState()
}

function setShortcutError(message) {
  const next = message || ''
  if (next === shortcutError) return
  shortcutError = next
  emitState()
}

function createFloat(url) {
  const overlays = ctx?.overlays
  if (!url || !overlays) return
  const cfg = readConfig()
  const f = cfg.float
  const screens = overlays.screens()
  const target = screens.find((s) => s.id === f.screen) || screens.find((s) => s.primary) || screens[0]
  const res = overlays.create(FLOAT_ID, {
    url,
    bounds: target ? computeCreateBounds(f, target) : undefined,
    minSize: FLOAT_MIN,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: true,
    clickThrough: f.clickThrough,
    onMoved: (b) => onFloatMoved(b),
    onResized: (b) => onFloatResized(b),
    onClosed: () => onFloatClosed(),
    onCrashed: (detail) => onFloatCrashed(detail)
  })
  if (!res.ok) {
    setFloatError(`悬浮窗创建失败：${res.errors.join('; ')}`)
    ctx.logger.warn('overlay create failed', { errors: res.errors })
  } else {
    setFloatError('')
  }
}

function onFloatMoved(b) {
  const overlays = ctx?.overlays
  const f = readConfig().float
  let final = b
  if (f.snapEdges && overlays) {
    const scr = screenForBounds(overlays.screens(), b)
    if (scr) {
      const snapped = snapBounds(b, scr)
      if (snapped.changed) {
        final = snapped.bounds
        overlays.setBounds(FLOAT_ID, final)
      }
    }
  }
  if (f.rememberPosition) persistFloatFields({ x: final.x, y: final.y })
}

function onFloatResized(b) {
  if (readConfig().float.rememberPosition) persistFloatFields({ width: b.width, height: b.height })
}

/** 用户关掉了悬浮窗 → 配置同步置灰（否则重启后又会冒出来）。 */
function onFloatClosed() {
  applyConfigChange('float', { enabled: false })
}

function onFloatCrashed(detail) {
  ctx?.logger.warn('overlay crashed', { detail })
  setFloatError('悬浮窗已崩溃，请重新启用')
  applyConfigChange('float', { enabled: false })
}

/** 同步窗口与 `float` 组配置：启用/禁用/穿透/切屏。 */
function syncFloatWindow() {
  const overlays = ctx?.overlays
  if (!overlays) return
  const cfg = readConfig()
  const f = cfg.float
  const existing = overlays.list().find((w) => w.id === FLOAT_ID)
  if (f.enabled) {
    const url = ctx.gateway.getRouteUrl(ROUTE_FLOAT)
    if (!existing) createFloat(url)
    else if (floatScreen !== f.screen) {
      // 切屏：核心的 bounds 钳制把窗口拉到目标屏，但"记住的屏 id"变了要重建
      overlays.destroy(FLOAT_ID)
      createFloat(url)
    } else {
      overlays.setClickThrough(FLOAT_ID, f.clickThrough)
    }
  } else if (existing) {
    overlays.destroy(FLOAT_ID)
  }
  floatScreen = f.screen
  publishFloatChanged()
}

function publishFloatChanged() {
  const cfg = readConfig()
  ctx?.bus.publish(EVENT_FLOAT, {
    enabled: cfg.float.enabled,
    clickThrough: cfg.float.clickThrough,
    floatHotkeys: floatHotkeys(cfg).map((h) => h.id)
  })
  emitState()
}

/** 穿透切换（全局快捷键）：走配置写入，再由 onChange 统一同步窗口。 */
function toggleFloatThrough() {
  applyConfigChange('float', { clickThrough: !readConfig().float.clickThrough })
}

/**
 * 悬浮窗穿透快捷键。
 *
 * 冲突由核心的跨模块检测显式返回（`ShortcutConflict.heldBy` 指明持有者）——
 * 这里把失败**上报到界面**而不静默（任务卡要求"快捷键冲突时给出明确提示"）。
 */
function syncShortcuts() {
  const shortcuts = ctx?.shortcuts
  if (!shortcuts) return
  const cfg = readConfig()
  const want = cfg.float.enabled
  const toggle = cfg.float.toggleThroughHotkey || null
  if (shortState.enabled === want && shortState.toggle === toggle) return
  if (shortState.enabled) shortcuts.unregister('toggle-through')
  if (want && toggle) {
    const r = shortcuts.register('toggle-through', toggle, toggleFloatThrough)
    if (!r.ok) {
      setShortcutError(`穿透快捷键冲突（${toggle}）：${r.errors.join('; ')}`)
      ctx.logger.warn('shortcut register failed', { accelerator: toggle, errors: r.errors })
    } else {
      setShortcutError('')
    }
  }
  shortState = { enabled: want, toggle }
}

/** 配置整段替换（核心 config.set 是 full replacement，故先并再写）。 */
function applyConfigChange(group, changes) {
  if (typeof group !== 'string') return
  const current = (ctx?.config?.get && ctx.config.get()) || {}
  const base = current && typeof current === 'object' ? current : {}
  const prevGroup = base[group] && typeof base[group] === 'object' ? base[group] : {}
  const next = { ...base, [group]: { ...prevGroup, ...changes } }
  const res = ctx.config.set(next)
  if (!res.ok) {
    ctx?.logger.warn('config change rejected', { group, errors: res.errors })
    return
  }
  // onChange 会驱动同步；此处再兜一次以覆盖"设置了相同值因而不触发变更"的情形。
  syncFloatWindow()
  syncShortcuts()
}

function onConfigChanged() {
  syncFloatWindow()
  syncShortcuts()
  emitState()
}

/**
 * 订阅事件（只在首次连接时订阅一次）。
 *
 * 库在每次连接建立后会自动为已登记的 `_eventHandlers` 重发订阅请求，故断开重连
 * 无需重复调用 `subscribe`（重复调用还会在库内部把旧 handler 标记为待移除）。
 */
async function subscribeEvents() {
  if (!client || subscribed) return
  // 注意：事件订阅器挂在 `client.events` 下（vendor: `this.events = Object.seal({...})`），
  // 不在 client 顶层。取错路径会得到 undefined 而不是报错，故这里显式守卫。
  const events = client.events
  if (!events || !events.hotkeyTriggered || !events.modelLoaded) {
    ctx?.logger.warn('event subscription api not available on client')
    return
  }
  subscribed = true
  try {
    await events.hotkeyTriggered.subscribe(onHotkeyTriggered)
    await events.modelLoaded.subscribe(onModelLoaded)
    ctx.logger.info('vts events subscribed')
  } catch (e) {
    subscribed = false
    ctx?.logger.warn('event subscribe failed', { error: String((e && e.message) || e) })
  }
}

/** 热键被执行的时机（**含用户从 VTS 界面或热键组合触发**）。 */
function onHotkeyTriggered(data) {
  const id = data && typeof data.hotkeyID === 'string' ? data.hotkeyID : ''
  if (id.length === 0) return
  const hk = hotkeys.find((h) => h.id === id)
  // 只有开关式有持久状态；触发式"执行即结束"，不参与状态显示
  if (!hk || hk.kind !== 'toggle') return
  states[id] = nextToggleState(states[id])
  emitState()
}

/** VTS 加载了新模型（用户在 VTS 里换模型）→ 自动刷新热键列表。 */
function onModelLoaded() {
  void refreshHotkeys()
}

function setResult(result) {
  lastResult = { at: Date.now(), ...result }
  emitState()
}

/**
 * 触发一个热键。
 *
 * `id` 来自模块页（不可信输入）：**必须**在已读取的热键列表里存在才发送，
 * 否则只回一条提示——避免页面能触发任意字符串。
 */
async function triggerHotkey(id) {
  if (id.length === 0) return
  if (!client || !authenticated) {
    setResult({ id, result: TRIGGER_RESULT.FAILED, message: '尚未连接 VTube Studio' })
    return
  }
  if (!hotkeys.some((h) => h.id === id)) {
    setResult({ id, result: TRIGGER_RESULT.STALE, message: '该热键已不在当前列表中，请刷新' })
    return
  }
  try {
    await client.hotkeyTrigger({ hotkeyID: id })
    setResult({ id, result: TRIGGER_RESULT.OK, message: '' })
  } catch (e) {
    const errorID = e && e.data ? e.data.errorID : undefined
    const info = describeTriggerError(errorID)
    setResult({
      id,
      result: info.result,
      message: info.message || String((e && e.message) || e)
    })
    if (info.refresh) void refreshHotkeys()
  }
}

/**
 * 把库的错误对象映射成用户能照做的状态。
 *
 * 库的错误文案（vendor `endpoints.js`）：
 * - `VTube Studio Plugin API is not enabled.` —— 用户需去 VTS 里开 API
 * - `Missing authentication token` —— 正常路径不该出现
 * - `Authentication with VTube Studio failed: <reason>` —— 含用户拒绝
 * 另有 `VTubeStudioError`（`data.errorID`），用 `classifyAuthError` 精确归类。
 */
function handleClientError(e) {
  authenticated = false
  hotkeys = []
  model = { loaded: false, name: '' }
  const message = String((e && e.message) || e)
  const errorID = e && e.data ? e.data.errorID : undefined
  const kind = classifyAuthError(errorID)
  // 原始错误一律留痕：分类是有损的，排查时必须能看到库里真正抛了什么
  ctx?.logger.warn('vts client error', { message, errorID, kind })
  if (message.indexOf('Plugin API is not enabled') >= 0) {
    publish(STATUS.UNREACHABLE, 'VTube Studio 的 API 未开启')
  } else if (kind === 'denied') {
    publish(STATUS.DENIED, '你在 VTube Studio 中拒绝了授权')
  } else if (kind === 'pending') {
    publish(STATUS.AWAITING_APPROVAL, 'VTube Studio 中已有一次授权请求，请在界面点击「允许」')
  } else if (kind === 'token-invalid') {
    publish(STATUS.FAILED, '授权已失效，正在重新授权')
  } else {
    publish(STATUS.FAILED, message)
  }
  emitState()
}

function buildClient() {
  client = new ApiClient({
    pluginName: PLUGIN_NAME,
    pluginDeveloper: PLUGIN_DEVELOPER,
    url: VTS_URL,
    // 库通过这两个回调取存 token —— token 因此从不经过渲染层
    authTokenGetter: () => readToken(),
    authTokenSetter: async (token) => {
      writeToken(token)
    },
    // 关键：不用库自带的 `new WebSocket`，改用核心门面（AI_RULES 第 3 条）
    webSocketFactory: (url) => {
      const socket = createFacadeSocket({
        externalWs: ctx.externalWs,
        url,
        id: SOCKET_ID,
        logger: ctx.logger
      })
      socket.addEventListener('open', () => {
        // 库在 open 后自动认证。无 token 时它会请求新 token —— 那一步要用户在 VTS
        // 界面点「允许」，故此时的准确提示是"等待授权"而非"认证中"。
        if (readToken()) publish(STATUS.CONNECTING, '已连接，正在用已保存的授权认证')
        else publish(STATUS.AWAITING_APPROVAL, '请在 VTube Studio 界面点击「允许」')
      })
      socket.addEventListener('error', (ev) => {
        if (!authenticated) {
          publish(STATUS.UNREACHABLE, ev && ev.message ? String(ev.message) : '连接失败')
        }
      })
      socket.addEventListener('close', () => {
        authenticated = false
        hotkeys = []
        model = { loaded: false, name: '' }
        states = {}
        if (status !== STATUS.UNREACHABLE) publish(STATUS.CONNECTING, '连接已断开，等待重连')
      })
      return socket
    }
  })

  // 认证完成 = 库的 connect 回调（此时 token 已存、事件订阅已就绪）
  client.on('connect', () => {
    authenticated = true
    publish(STATUS.AUTHENTICATED, '已授权')
    void subscribeEvents()
    void refreshHotkeys()
  })
  // 库的内部错误：收到后它会关连接并在 5 秒后重连
  client.on('error', handleClientError)

  return client
}

/** 允许由页面写入的 `float` 字段白名单（页面输入不可信，只认这些键并逐个钳制）。 */
const FLOAT_WRITABLE = [
  'enabled',
  'clickThrough',
  'hotkeyIds',
  'columns',
  'bgOpacity',
  'snapEdges',
  'rememberPosition',
  'toggleThroughHotkey'
]

function applyFloatConfig(changes) {
  if (!changes || typeof changes !== 'object') return
  const patch = {}
  for (const key of FLOAT_WRITABLE) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue
    const v = changes[key]
    if (key === 'enabled' || key === 'clickThrough' || key === 'snapEdges' || key === 'rememberPosition') {
      patch[key] = v === true
    } else if (key === 'hotkeyIds') {
      // 最多 100 个（热键上限），非字符串一律丢弃；不存在的 id 由 floatHotkeys 过滤掉
      patch[key] = Array.isArray(v) ? v.slice(0, 100).map((x) => String(x)) : []
    } else if (key === 'columns') {
      patch[key] = clampFloatColumns(v)
    } else if (key === 'bgOpacity') {
      const n = Number(v)
      patch[key] = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 80
    } else if (key === 'toggleThroughHotkey') {
      patch[key] = String(v).slice(0, 64)
    }
  }
  if (Object.keys(patch).length === 0) return
  applyConfigChange('float', patch)
}

function registerGateway() {
  ctx.gateway.registerHttpRoute('GET', ROUTE_CONTROL, () => ({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: pages.control
  }))
  // 悬浮窗页面：只允许本模块网关 origin（核心 facade 会校验，见 ModuleOverlays）
  ctx.gateway.registerHttpRoute('GET', ROUTE_FLOAT, () => ({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: pages.float
  }))
  ctx.gateway.registerHttpRoute('GET', ROUTE_STATE, () => ({
    status: 200,
    body: snapshot()
  }))
  // 页面命令：刷新热键 / 触发热键
  ctx.gateway.registerWebSocketChannel(CHANNEL, {
    onMessage(payload) {
      const msg = payload && typeof payload === 'object' ? payload : {}
      if (msg.type === 'refresh') void refreshHotkeys()
      else if (msg.type === 'trigger') void triggerHotkey(String(msg.id || ''))
      else if (msg.type === 'float-config') applyFloatConfig(msg.changes)
    }
  })
}

module.exports = {
  init(context) {
    ctx = context
    loadPages()
    registerGateway()
    // 配置变更 → 同步悬浮窗与快捷键（设置页改动即时生效）。
    // 注意：核心的 config.onChange 不会在 unload 时自动退订（门面只转发），
    // 故在 stop() 里显式退订。
    unsubConfig = ctx.config.onChange(onConfigChanged)
    syncFloatWindow()
    syncShortcuts()
    publish(STATUS.IDLE, '未连接')
  },

  async start() {
    if (!ctx.externalWs) {
      publish(STATUS.FAILED, '核心未提供 externalWs 能力')
      return
    }
    publish(STATUS.CONNECTING, '正在连接 VTube Studio')
    // ApiClient 构造即发起连接；失败由事件与重连反映，不抛（不阻塞软件启动）
    buildClient()
  },

  /**
   * `stop` 保留悬浮窗与快捷键（与核心约定一致：这两者随 **unload** 清理，
   * 见 core/modules 的 teardown），但清掉定时器与配置订阅。
   */
  stop() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    if (unsubConfig) {
      try {
        unsubConfig()
      } catch (e) {
        ctx?.logger.warn('config unsubscribe failed', { error: String(e) })
      }
      unsubConfig = null
    }
    try {
      if (client) client.disconnect()
    } catch (e) {
      ctx?.logger.warn('client disconnect failed', { error: String(e) })
    }
    try {
      ctx?.externalWs?.close(SOCKET_ID)
    } catch (e) {
      ctx?.logger.warn('close failed', { error: String(e) })
    }
    client = null
    authenticated = false
    hotkeys = []
    model = { loaded: false, name: '' }
    states = {}
    lastResult = null
    subscribed = false
    publish(STATUS.IDLE, '已停止')
  }
}
