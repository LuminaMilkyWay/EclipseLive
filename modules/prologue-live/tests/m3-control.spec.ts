import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { ILogger } from '@contracts/logger'
import { createConfig } from '../../../src/main/core/config'
import { createEventBus } from '../../../src/main/core/bus'
import { createPermissions } from '../../../src/main/core/permissions'
import { createGateway } from '../../../src/main/core/gateway'
import { createModules, type ModulesRig } from '../../../src/main/core/modules'
import { MODULE_PAGE_TOKEN_NAMES } from '../../../src/renderer/src/ui-tokens'

const MODULE_DIR = resolve(process.cwd(), 'modules/prologue-live')
const requireModule = createRequire(import.meta.url)
const configLib = requireModule('../lib/config.js')
const fontsLib = requireModule('../lib/fonts.js')

function testLogger(): ILogger {
  const make = (): ILogger => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => make(),
    setLevel: () => {}
  })
  return make()
}

async function makeRig(): Promise<ModulesRig> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-pl-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir })
  await config.ready()
  return { modules, logger, config, bus, permissions, gateway, modulesDir, root }
}

async function copyModule(rig: ModulesRig): Promise<void> {
  await cp(MODULE_DIR, join(rig.modulesDir, 'prologue-live'), { recursive: true })
}

function wsOpen(url: string): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(url)
    ws.onopen = () => resolvePromise(ws)
    ws.onerror = () => reject(new Error('ws connect failed'))
  })
}

interface Envelope {
  channel: string
  payload: Record<string, unknown>
}

/** 收集所有下行消息，供 waitFor 断言。 */
function collector(ws: WebSocket): Envelope[] {
  const msgs: Envelope[] = []
  ws.onmessage = (ev) => {
    try {
      msgs.push(JSON.parse(String(ev.data)) as Envelope)
    } catch {
      /* 非 JSON 忽略 */
    }
  }
  return msgs
}

async function waitFor<T>(arr: T[], pred: (m: T) => boolean, timeout = 2000): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const hit = arr.find(pred)
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('waitFor timeout')
}

const rigs: Array<{ gateway: { stop(): Promise<void> }; modules: { stop(id: string): Promise<void> } }> = []
afterEach(async () => {
  while (rigs.length > 0) {
    const r = rigs.pop()
    if (r) {
      await r.modules.stop('prologue-live').catch(() => {})
      await r.gateway.stop().catch(() => {})
    }
  }
})

async function setup(): Promise<{ rig: ModulesRig; ws: WebSocket; msgs: Envelope[] }> {
  const rig = await makeRig()
  rigs.push(rig as unknown as (typeof rigs)[number])
  await copyModule(rig)
  await rig.modules.discover()
  expect((await rig.modules.load('prologue-live')).ok).toBe(true)
  expect((await rig.modules.start('prologue-live')).ok).toBe(true)
  await rig.gateway.start()
  const ws = await wsOpen(rig.gateway.getWebSocketUrl() as string)
  return { rig, ws, msgs: collector(ws) }
}

function send(ws: WebSocket, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify({ channel: 'prologue-live', payload }))
}

/* ---------- lib/fonts.js ---------- */

describe('字体白名单（lib/fonts.js）', () => {
  it('全部为非空字符串；含中英常用字体；数量合理', () => {
    expect(Array.isArray(fontsLib.FONT_WHITELIST)).toBe(true)
    expect(fontsLib.FONT_WHITELIST.length).toBeGreaterThanOrEqual(10)
    for (const f of fontsLib.FONT_WHITELIST) {
      expect(typeof f).toBe('string')
      expect(f.trim()).not.toBe('')
    }
    expect(fontsLib.FONT_WHITELIST).toContain('Microsoft YaHei')
    expect(fontsLib.FONT_WHITELIST).toContain('SimSun')
  })
})

/* ---------- 发送历史（仅内存，上限 5，不落盘） ---------- */

describe('M3 发送历史', () => {
  it('每次发送广播 history；/state 返回最近 5 条（新在前）；6 次发送只留 5', async () => {
    const { rig, ws, msgs } = await setup()
    for (const t of ['甲', '乙', '丙', '丁', '戊', '己']) {
      send(ws, { type: 'send', text: t })
    }
    await waitFor(msgs, (m) => m.payload.type === 'history' && (m.payload.history as unknown[]).length === 5)

    // 6 次发送 → history 广播含 5 条，最新在前
    const historyMsgs = msgs.filter((m) => m.payload.type === 'history')
    const last = historyMsgs[historyMsgs.length - 1].payload.history as string[]
    expect(last).toEqual(['己', '戊', '丁', '丙', '乙'])

    // /state 同源返回
    const url = rig.gateway.getRouteUrl('/prologue-live/state') as string
    const res = (await (await fetch(url)).json()) as { history: string[]; config: Record<string, unknown> }
    expect(res.history).toEqual(['己', '戊', '丁', '丙', '乙'])

    // 红线：历史不入配置（配置无任何文本/历史键）
    const cfg = res.config
    expect(Object.keys(cfg).sort()).not.toContain('history')
    expect(Object.keys(cfg).sort()).not.toContain('text')
    ws.close()
  })

  it('发送历史不进入 bus 事件（脱敏红线）', async () => {
    const { rig, ws, msgs } = await setup()
    const busEvents: unknown[] = []
    rig.bus.subscribe('prologue-live:queue-changed', (e) => busEvents.push(e.payload))
    send(ws, { type: 'send', text: '敏感文本AAA' })
    await waitFor(msgs, (m) => m.payload.type === 'enqueue')
    await new Promise((r) => setTimeout(r, 60))
    for (const p of busEvents as Array<Record<string, unknown>>) {
      expect(Object.keys(p).sort()).toEqual(['paused', 'pending', 'playing'])
      expect(JSON.stringify(p)).not.toContain('敏感文本AAA')
    }
    ws.close()
  })
})

/* ---------- 配置上行 ---------- */

describe('M3 配置上行', () => {
  it('obs 组部分变更 → 配置分区更新 + style-changed(obs) + 下行 state 广播', async () => {
    const { rig, ws, msgs } = await setup()
    const styleEvents: Array<Record<string, unknown>> = []
    rig.bus.subscribe('prologue-live:style-changed', (e) => styleEvents.push(e.payload as Record<string, unknown>))

    send(ws, { type: 'config', group: 'obs', changes: { textColor: '#112233', typingSpeed: 80 } })
    const stateMsg = await waitFor(msgs, (m) => m.payload.type === 'state' && (m.payload.config as { textColor?: string })?.textColor === '#112233')

    expect(rig.config.get('prologue-live')).toMatchObject({ textColor: '#112233', typingSpeed: 80 })
    const cfg = stateMsg.payload.config as Record<string, unknown>
    expect(cfg.textColor).toBe('#112233')
    expect(cfg.typingSpeed).toBe(80)
    // float 组不受影响
    expect(cfg.float).toEqual(configLib.PROLOGUE_DEFAULTS.float)
    expect(styleEvents[styleEvents.length - 1]).toEqual({ scope: 'obs' })
    ws.close()
  })

  it('float 组部分变更 → 只改嵌套键 + style-changed(float)', async () => {
    const { rig, ws, msgs } = await setup()
    const styleEvents: Array<Record<string, unknown>> = []
    rig.bus.subscribe('prologue-live:style-changed', (e) => styleEvents.push(e.payload as Record<string, unknown>))

    send(ws, { type: 'config', group: 'float', changes: { enabled: true, textOpacity: 60 } })
    await waitFor(msgs, (m) => m.payload.type === 'state' && (m.payload.config as { float?: { enabled?: boolean } })?.float?.enabled === true)

    const cfg = rig.config.get('prologue-live')
    expect(cfg.float).toMatchObject({ enabled: true, textOpacity: 60 })
    expect(cfg.textColor).toBe(configLib.PROLOGUE_DEFAULTS.textColor)
    expect(styleEvents[styleEvents.length - 1]).toEqual({ scope: 'float' })
    ws.close()
  })

  it('非法变更 → 配置原样、无广播、无 style-changed', async () => {
    const { rig, ws, msgs } = await setup()
    const styleEvents: unknown[] = []
    rig.bus.subscribe('prologue-live:style-changed', (e) => styleEvents.push(e.payload))
    const before = JSON.stringify(rig.config.get('prologue-live'))

    send(ws, { type: 'config', group: 'obs', changes: { textColor: 'nope' } })
    await new Promise((r) => setTimeout(r, 120))

    expect(JSON.stringify(rig.config.get('prologue-live'))).toBe(before)
    expect(styleEvents).toEqual([])
    expect(msgs.some((m) => m.payload.type === 'state' && (m.payload.config as { textColor?: string })?.textColor === 'nope')).toBe(false)
    ws.close()
  })

  it('未知分组 → 忽略', async () => {
    const { rig, ws } = await setup()
    const before = JSON.stringify(rig.config.get('prologue-live'))
    send(ws, { type: 'config', group: 'theme', changes: { x: 1 } })
    await new Promise((r) => setTimeout(r, 80))
    expect(JSON.stringify(rig.config.get('prologue-live'))).toBe(before)
    ws.close()
  })
})

/* ---------- 队列操作上行 ---------- */

describe('M3 队列操作上行', () => {
  it('pause/resume/undo/clear → 引擎状态 + action 下行广播', async () => {
    const { ws, msgs } = await setup()

    send(ws, { type: 'send', text: 'A段' })
    await waitFor(msgs, (m) => m.payload.type === 'enqueue')

    // pause
    send(ws, { type: 'action', op: 'pause' })
    await waitFor(msgs, (m) => m.payload.type === 'action' && m.payload.op === 'pause')
    await waitFor(msgs, (m) => m.payload.type === 'queue' && m.payload.paused === true)

    // resume
    send(ws, { type: 'action', op: 'resume' })
    await waitFor(msgs, (m) => m.payload.type === 'action' && m.payload.op === 'resume')
    await waitFor(msgs, (m) => m.payload.type === 'queue' && m.payload.paused === false)

    // 第二段入队（pending）后 undo
    send(ws, { type: 'send', text: 'B段' })
    await waitFor(msgs, (m) => m.payload.type === 'queue' && m.payload.pending === 1)
    send(ws, { type: 'action', op: 'undo' })
    await waitFor(msgs, (m) => m.payload.type === 'queue' && m.payload.total === 1 && m.payload.pending === 0)

    // clear
    send(ws, { type: 'action', op: 'clear' })
    await waitFor(msgs, (m) => m.payload.type === 'action' && m.payload.op === 'clear')
    await waitFor(msgs, (m) => m.payload.type === 'queue' && m.payload.total === 0)

    ws.close()
  })

  it('/state 的 fonts 白名单供控制页 datalist 使用', async () => {
    const { rig } = await setup()
    const url = rig.gateway.getRouteUrl('/prologue-live/state') as string
    const res = (await (await fetch(url)).json()) as { fonts: string[] }
    expect(res.fonts).toEqual(fontsLib.FONT_WHITELIST)
  })
})

/* ---------- 页面内联脚本健全性 ---------- */

describe('M3 页面内联脚本可解析（纯 JS，禁 TS 语法泄漏）', () => {
  // 回归：control.html 曾混入 `p.floatErrors as string[]`（TS 语法）→ 整块脚本
  // SyntaxError 不执行 → 发送/获取URL 全部无响应。页面脚本必须能被 JS 引擎编译。
  for (const page of ['control.html', 'obs.html', 'overlay.html']) {
    it(`${page} 的内联 <script> 是合法 JS`, async () => {
      const html = await readFile(join(MODULE_DIR, 'pages', page), 'utf8')
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
      expect(scripts.length).toBeGreaterThan(0)
      for (const code of scripts) {
        let err: unknown = null
        try {
          new Function(code)
        } catch (e) {
          err = e
        }
        expect(err, `${page} 内联脚本存在语法错误：${String(err)}`).toBe(null)
      }
    })
  }
})

/* ---------- UI 渲染规范合规（MODULE_UI_CONTRACT.md + PRODUCT.md「模块 UI 规范」+ AI_RULES UI 红线 18-20） ---------- */

describe('UI 规范合规：control.html（模块内设置面板，无例外）', () => {
  // T33 范式：模块页零 preload，读不到宿主 CSS 变量——设计令牌由宿主单向注入 :root
  // （白名单 src/renderer/src/ui-tokens.ts 的 MODULE_PAGE_TOKEN_NAMES）。
  // 页面一律只消费注入令牌：不自建主题令牌、整页零颜色字面量、区域圆角走 --r-*、
  // body 透明铺满槽位、section 玻璃面对齐 .card 范本。
  const THEME_TOKEN_RE = /--(?:mat|bg|txt|acc|r-|sp-|line|ok|bad|warn)[\w-]*\s*:/g

  async function loadCss(): Promise<{ css: string; outside: string }> {
    const html = await readFile(join(MODULE_DIR, 'pages', 'control.html'), 'utf8')
    const m = html.match(/<style>([\s\S]*?)<\/style>/)
    expect(m, 'control.html 缺少 <style>').toBeTruthy()
    const css = (m as RegExpMatchArray)[1].replace(/\/\*[\s\S]*?\*\//g, '')
    const outside = css.replace(/:root\s*\{[\s\S]*?\}/, '')
    return { css, outside }
  }

  it('不自建主题令牌（:root 不定义任何 --mat-*/--bg-*/--txt-*/--r-*/--sp-* 值，全部来自宿主注入）', async () => {
    const html = await readFile(join(MODULE_DIR, 'pages', 'control.html'), 'utf8')
    const root = html.match(/:root\s*\{([\s\S]*?)\}/)
    if (root) {
      const found = [...root[1].matchAll(THEME_TOKEN_RE)].map((m) => m[1])
      expect(found, `:root 自建主题令牌 = 违规：${found.join(', ')}`).toEqual([])
    }
  })

  it('整页零颜色字面量（hex / rgb / rgba / hsl —— 颜色只来自宿主注入令牌）', async () => {
    const { outside } = await loadCss()
    const literals = [
      ...outside.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])|\b(?:rgb|rgba|hsl|hsla)\(/g)
    ].map((m) => m[0])
    expect(literals, `页面存在硬编码颜色：${literals.join(', ')}`).toEqual([])
  })

  it('区域圆角全部走 --r-* 令牌（含 obs / overlay 全模块）', async () => {
    for (const page of ['control.html', 'obs.html', 'overlay.html']) {
      const html = await readFile(join(MODULE_DIR, 'pages', page), 'utf8')
      const css = html.replace(/<style>[\s\S]*?<\/style>/g, (s) => s.replace(/\/\*[\s\S]*?\*\//g, ''))
      for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
        expect(m[1].trim(), `${page} 存在非令牌圆角：${m[1].trim()}`).toMatch(/^var\(--r-(sm|md|lg|xl)\)$/)
      }
    }
  })

  it('分组卡片与宿主 .card 同配方（MODULE_UI_CONTRACT §2/§7）', async () => {
    const { css } = await loadCss()
    const sec = css.match(/(?:^|\n)\s*section\s*\{([\s\S]*?)\}/)
    expect(sec, 'control.html 缺少 section 面定义').toBeTruthy()
    const block = (sec as RegExpMatchArray)[1]
    // 用户 2026-10-02 拍板 A：分组卡片与宿主 `.card` **同配方（玻璃材质）**，
    // 推翻 T36"内容层不用玻璃"的约定（否则档 4 下本页明显比周围更平）。
    // 仍保留一条禁令：不得用 `--mat-veil`（3 档下是 24% 灰面，会糊出灰色底图，AI_RULES §24）。
    expect(block).toMatch(/background:\s*var\(--card-bg\)/)
    expect(block).toMatch(/backdrop-filter:\s*blur\(var\(--mat-blur\)\)\s*saturate\(var\(--mat-sat\)\)/)
    expect(block).toMatch(/border:\s*1px\s+solid\s+var\(--mat-border\)/)
    expect(block).toMatch(/box-shadow:\s*var\(--mat-edge-light\)/)
    expect(block).toMatch(/border-radius:\s*var\(--r-lg\)/)
    expect(block).not.toMatch(/var\(--mat-veil\)/)
  })

  it('显示面积铺满槽位矩形（页面视口不外扩不内缩）', async () => {
    const { css } = await loadCss()
    const base = css.match(/html,\s*body\s*\{([\s\S]*?)\}/)
    expect(base, 'control.html 缺少 html, body 基底规则').toBeTruthy()
    const block = (base as RegExpMatchArray)[1]
    expect(block).toMatch(/margin:\s*0/)
    expect(block).toMatch(/min-height:\s*100vh|height:\s*100%/)
  })

  it('body 透明（材质底由宿主槽位提供，不自绘画布底）', async () => {
    const html = await readFile(join(MODULE_DIR, 'pages', 'control.html'), 'utf8')
    // 锚定行首的独立 body 规则（避免命中 html, body 联合块）
    const body = html.match(/^\s*body\s*\{([\s\S]*?)\}/m)
    expect(body, 'control.html 缺少 body 规则').toBeTruthy()
    expect((body as RegExpMatchArray)[1]).toMatch(/background:\s*transparent/)
  })

  it('所有 var() 引用命中宿主注入白名单（MODULE_PAGE_TOKEN_NAMES，运行时有值）', async () => {
    const { css } = await loadCss()
    const refs = [...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThan(0)
    const whitelist = new Set(MODULE_PAGE_TOKEN_NAMES)
    for (const r of refs) {
      expect(whitelist.has(r), `引用了宿主未注入令牌 ${r}`).toBe(true)
    }
  })
})
