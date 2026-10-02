'use strict'

/**
 * PrologueType Live 模块入口（无声系主播打字机）。
 *
 * M2：队列引擎接线——WS 上行 send → 引擎入队 → 下行 enqueue 广播（OBS 页
 * 逐字渲染）+ queue-changed bus 事件（仅元数据）；/state 返回真实配置与队列
 * 概要；配置变更实时下行 state 推送。M3/M4/M5 在此之上接控制页/悬浮窗/快捷键。
 *
 * 红线遵守：文本只在内存队列与网关频道内流转——bus 事件 / 日志 / 诊断一律
 * 只元数据；不自拼端口/token；不自行监听；不改核心。
 */

const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { PROLOGUE_DEFAULTS, validateConfig, applyGroup, OBS_KEYS, FLOAT_KEYS } = require('./lib/config')
const { createQueueEngine } = require('./lib/engine')
const { FONT_WHITELIST } = require('./lib/fonts')
const {
  PERSIST_DEBOUNCE,
  snapBounds,
  computeCreateBounds,
  screenForBounds
} = require('./lib/float')

const CHANNEL = 'prologue-live'
const FLOAT_ID = 'float'
const FLOAT_MIN = { width: 240, height: 140 }

/** 页面文件缓存在 init 时读入（随包分发；不新增资源路由）。 */
function loadPage(name, fallback) {
  try {
    return readFileSync(join(__dirname, 'pages', name), 'utf8')
  } catch {
    return fallback
  }
}

function placeholder(title, note) {
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>',
    title,
    '</title><style>body{font:14px/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif;',
    'background:#141a29;color:#e8ecf4;display:grid;place-items:center;height:100vh;margin:0}',
    'main{text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#93a0b4;margin:4px 0}</style></head>',
    '<body><main><h1>',
    title,
    '</h1><p>',
    note,
    '</p></main></body></html>'
  ].join('')
}

/** 模块运行时状态（init 填充；stop 经此释放）。 */
let rt = null

module.exports = {
  init(ctx) {
    const { logger, gateway, bus, config, overlays, shortcuts } = ctx

    const pages = {
      obs: loadPage('obs.html', placeholder('PrologueType Live · OBS', 'OBS 显示页缺失（M2）')),
      overlay: loadPage('overlay.html', placeholder('PrologueType Live · 悬浮输入窗', '悬浮窗页缺失（M4 实现）')),
      control: loadPage('control.html', placeholder('PrologueType Live', '控制页缺失（M3 实现）'))
    }

    /* ---- 队列引擎 + 下行广播 + 事件（仅元数据） ---- */
    const engine = createQueueEngine({
      onParagraphStart: (rec) => {
        gateway.broadcast(CHANNEL, { type: 'enqueue', id: rec.id, text: rec.text })
        syncQueue()
      },
      onParagraphDone: () => syncQueue(),
      onParagraphRemoved: (rec) => {
        gateway.broadcast(CHANNEL, { type: 'action', op: 'undo', id: rec.id })
        syncQueue()
      },
      onQueueChanged: () => syncQueue(),
      onAllDone: () => syncQueue()
    })

    function syncQueue() {
      const s = engine.summary()
      gateway.broadcast(CHANNEL, { type: 'queue', ...s })
      bus.publish('prologue-live:queue-changed', {
        pending: s.pending,
        playing: s.playing,
        paused: s.paused
      })
    }

    /* ---- 发送历史：仅内存会话级，上限 5，不落盘、不进事件 ---- */
    const HISTORY_MAX = 5
    const history = []
    function historyPush(text) {
      history.unshift(text)
      if (history.length > HISTORY_MAX) history.pop()
      gateway.broadcast(CHANNEL, { type: 'history', history: [...history] })
    }

    /* ---- 悬浮窗生命周期（M4）：随 float 组配置实时创建/销毁/穿透/切屏 ---- */
    const floatErrors = []
    let lastFloatScreen = null
    let persistTimer = null
    function noteFloatError(msg) {
      floatErrors.push(msg)
      if (floatErrors.length > 8) floatErrors.splice(0, floatErrors.length - 8)
    }
    function publishFloatChanged() {
      const f = lastConfig.float
      bus.publish('prologue-live:float-changed', { enabled: f.enabled, clickThrough: f.clickThrough })
    }
    /** 位置/尺寸记忆：debounce 落配置（拖动中避免频繁写盘）。 */
    function persistFloatFields(fields) {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        persistTimer = null
        applyConfigChange('float', fields)
      }, PERSIST_DEBOUNCE)
    }
    function createFloat(url) {
      if (!url || !overlays) return
      const f = lastConfig.float
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
        noteFloatError(res.errors.join('; '))
        logger.warn(`overlay create failed: ${res.errors.join('; ')}`)
      }
    }
    function onFloatMoved(b) {
      const f = lastConfig.float
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
      if (lastConfig.float.rememberPosition) persistFloatFields({ width: b.width, height: b.height })
    }
    function onFloatClosed() {
      applyConfigChange('float', { enabled: false })
    }
    function onFloatCrashed(detail) {
      logger.warn(`overlay crashed: ${detail}`)
      noteFloatError('悬浮窗已崩溃，请重新启用')
      applyConfigChange('float', { enabled: false })
    }
    /** 同步窗口与 float 组配置：启用/禁用/穿透/切屏。 */
    function syncFloatWindow() {
      if (!overlays) return
      const f = lastConfig.float
      const existing = overlays.list().find((w) => w.id === FLOAT_ID)
      if (f.enabled) {
        const url = gateway.getRouteUrl('/prologue-live/overlay')
        if (!existing) {
          createFloat(url)
        } else if (lastFloatScreen !== f.screen) {
          overlays.destroy(FLOAT_ID)
          createFloat(url)
        } else {
          overlays.setClickThrough(FLOAT_ID, f.clickThrough)
        }
        lastFloatScreen = f.screen
      } else {
        if (existing) overlays.destroy(FLOAT_ID)
        lastFloatScreen = f.screen
      }
      publishFloatChanged()
    }

    /* ---- 全局快捷键（M5）：穿透切换 + 发送 flush；冲突显式上报 ---- */
    function toggleThrough() {
      applyConfigChange('float', { clickThrough: !lastConfig.float.clickThrough })
    }
    function sendHotkeyPress() {
      gateway.broadcast(CHANNEL, { type: 'request-send' })
    }
    let shortState = { enabled: false, toggle: null, send: null }
    function syncShortcuts() {
      if (!shortcuts) return
      const f = lastConfig.float
      const want = f.enabled
      const toggle = f.toggleThroughHotkey || null
      const send = f.sendHotkey || null
      if (shortState.enabled === want && shortState.toggle === toggle && shortState.send === send) return
      if (shortState.enabled) {
        shortcuts.unregister('toggle-through')
        shortcuts.unregister('send')
      }
      if (want) {
        if (toggle) {
          const r = shortcuts.register('toggle-through', toggle, toggleThrough)
          if (!r.ok) {
            noteFloatError(`穿透快捷键冲突（${toggle}）：${r.errors.join('; ')}`)
            logger.warn(`shortcut toggle-through failed: ${r.errors.join('; ')}`)
          }
        }
        if (send) {
          const r = shortcuts.register('send', send, sendHotkeyPress)
          if (!r.ok) {
            noteFloatError(`发送快捷键冲突（${send}）：${r.errors.join('; ')}`)
            logger.warn(`shortcut send failed: ${r.errors.join('; ')}`)
          }
        }
      }
      shortState = { enabled: want, toggle, send }
    }

    /* ---- 样式包（M6）：obs / float 两 styleType，apply 只并入本组、export 抽本组 ---- */
    function makeStyleHandler(group) {
      const allowed = group === 'obs' ? OBS_KEYS : FLOAT_KEYS
      return {
        version: 1,
        validate(payload) {
          const errors = []
          const cfg = payload.config
          if (cfg !== undefined) {
            if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
              errors.push(`${group} style: config must be an object`)
            } else {
              for (const k of Object.keys(cfg)) {
                if (!allowed.includes(k)) errors.push(`${group} style: unknown config key: ${k}`)
              }
            }
          }
          for (const name of Object.keys(payload.cssVars ?? {})) {
            if (!name.startsWith('--')) errors.push(`css var must start with "--": ${name}`)
          }
          return errors
        },
        apply(payload) {
          const current = config.get() || PROLOGUE_DEFAULTS
          const res = applyGroup(current, group, payload.config ?? {})
          if (!res.ok) {
            logger.warn(`style apply rejected (${group}): ${res.errors.join('; ')}`)
            return
          }
          const setRes = config.set(res.next)
          if (!setRes.ok) logger.warn(`style config set rejected: ${setRes.errors.join('; ')}`)
        },
        export() {
          const current = config.get() || PROLOGUE_DEFAULTS
          if (group === 'obs') {
            const { float: _float, ...obs } = current
            return { config: obs }
          }
          return { config: current.float }
        }
      }
    }
    if (ctx.styles) {
      ctx.styles.register('obs', makeStyleHandler('obs'))
      ctx.styles.register('float', makeStyleHandler('float'))
    }

    /* ---- 播放节奏调度：typingSpeed 驱动 tick（速度可调，实时生效） ---- */
    let typingSpeed = PROLOGUE_DEFAULTS.typingSpeed
    let timer = null
    const clearTimer = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    const startTimer = () => {
      clearTimer()
      const s = engine.summary()
      if (!s.playing || s.paused) return
      timer = setInterval(() => {
        engine.tick()
        const after = engine.summary()
        if (!after.playing || after.paused) clearTimer()
      }, typingSpeed)
    }

    /* ---- 配置实时生效：热更速度 + 下行 state 推送 ---- */
    let lastConfig = config.get() || PROLOGUE_DEFAULTS
    config.onChange((value) => {
      const v = value && typeof value === 'object' ? value : PROLOGUE_DEFAULTS
      const res = validateConfig(v)
      if (!res.ok) {
        logger.warn(`config rejected: ${res.errors.join('; ')}`)
        return
      }
      typingSpeed = v.typingSpeed
      startTimer()
      const scope = floatScopeChanged(lastConfig, v)
      lastConfig = v
      if (scope === 'float') {
        syncFloatWindow()
        syncShortcuts()
      }
      gateway.broadcast(CHANNEL, { type: 'state', config: v, floatErrors: [...floatErrors] })
      bus.publish('prologue-live:style-changed', { scope })
    })

    /* ---- 路由 ---- */
    gateway.registerHttpRoute('GET', '/prologue-live/obs', () => ({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: pages.obs
    }))
    gateway.registerHttpRoute('GET', '/prologue-live/overlay', () => ({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: pages.overlay
    }))
    gateway.registerHttpRoute('GET', '/prologue-live/control', () => ({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: pages.control
    }))
    gateway.registerHttpRoute('GET', '/prologue-live/state', () => ({
      status: 200,
      body: {
        ok: true,
        config: config.get(),
        queue: engine.summary(),
        playing: engine.getPlaying(),
        float: {
          enabled: lastConfig.float.enabled,
          clickThrough: lastConfig.float.clickThrough,
          errors: [...floatErrors]
        },
        history: [...history],
        fonts: FONT_WHITELIST,
        screens: overlays ? overlays.screens().map((s) => ({ id: s.id, primary: s.primary, bounds: s.bounds })) : []
      }
    }))

    /* ---- WS 频道：上行 send / action / config ---- */
    gateway.registerWebSocketChannel(CHANNEL, {
      onMessage: (payload) => {
        if (!payload || typeof payload !== 'object') return
        if (payload.type === 'send') {
          if (typeof payload.text !== 'string' || payload.text.trim() === '') return
          historyPush(payload.text)
          engine.enqueue(payload.text)
          startTimer()
        } else if (payload.type === 'action') {
          const op = payload.op
          if (op === 'undo') {
            engine.undo()
          } else if (op === 'pause') {
            engine.pause()
            clearTimer()
            gateway.broadcast(CHANNEL, { type: 'action', op: 'pause' })
          } else if (op === 'resume') {
            engine.resume()
            startTimer()
            gateway.broadcast(CHANNEL, { type: 'action', op: 'resume' })
          } else if (op === 'clear') {
            engine.clear()
            gateway.broadcast(CHANNEL, { type: 'action', op: 'clear' })
          }
        } else if (payload.type === 'config') {
          applyConfigChange(payload.group, payload.changes)
        }
      }
    })

    /** 配置组级变更：applyGroup 校验合并 → ctx.config.set（全量替换，onChange 下行推送）。 */
    function applyConfigChange(group, changes) {
      if (typeof group !== 'string') return
      const current = config.get() || PROLOGUE_DEFAULTS
      const res = applyGroup(current, group, changes)
      if (!res.ok) {
        logger.warn(`config change rejected (${group}): ${res.errors.join('; ')}`)
        return
      }
      const setRes = config.set(res.next)
      if (!setRes.ok) {
        logger.warn(`config set rejected: ${setRes.errors.join('; ')}`)
      }
    }

    /* ---- 端口漂移：悬浮窗用新 URL 重建（OBS/控制页由核心 webtools/obs 桥处理） ---- */
    bus.subscribe('gateway:port-changed', () => {
      if (overlays && lastConfig.float.enabled) {
        const existing = overlays.list().find((w) => w.id === FLOAT_ID)
        if (existing) {
          overlays.destroy(FLOAT_ID)
          createFloat(gateway.getRouteUrl('/prologue-live/overlay'))
        }
      }
    })

    // 启动即同步（模块重启后 float.enabled 已持久化 → 重建悬浮窗 + 注册快捷键）
    syncFloatWindow()
    syncShortcuts()

    rt = { clearTimer, engine, clearPersist: () => { if (persistTimer) clearTimeout(persistTimer) } }
  },

  /** stop：释放播放定时器与位置记忆 debounce（引擎状态保留，属内存级；卸载由管理器清理）。 */
  stop() {
    if (rt) {
      rt.clearTimer()
      rt.clearPersist()
    }
  }
}

/** 判定配置变更落在哪个组（style-changed 事件 scope 用）。 */
function floatScopeChanged(before, after) {
  const b = before && typeof before === 'object' ? before : PROLOGUE_DEFAULTS
  const a = after && typeof after === 'object' ? after : PROLOGUE_DEFAULTS
  if (JSON.stringify(a.float) !== JSON.stringify(b.float)) return 'float'
  return 'obs'
}
