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

const MODULE_DIR = resolve(process.cwd(), 'modules/prologue-live')
const requireModule = createRequire(import.meta.url)
const engineLib = requireModule('../lib/engine.js')

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

/** 等待下一个 {channel,payload} 消息。 */
function wsNext(ws: WebSocket): Promise<{ channel: string; payload: unknown }> {
  return new Promise((resolvePromise) => {
    ws.onmessage = (ev) => {
      resolvePromise(JSON.parse(String(ev.data)) as { channel: string; payload: unknown })
    }
  })
}

/* ---------- 队列引擎（纯函数，无定时器） ---------- */

function record(): { events: string[]; starts: Array<{ id: string; text: string }> } {
  const events: string[] = []
  const starts: Array<{ id: string; text: string }> = []
  return {
    events,
    starts,
    push: (name: string, rec?: { id: string; text: string }) => {
      events.push(name)
      if (rec && name === 'start') starts.push(rec)
    }
  }
}

/** 组装引擎：默认 hooks 记账 + 可覆写。 */
function makeEngine(overrides: Record<string, (rec?: { id: string; text: string }) => void> = {}) {
  const log = record()
  const hooks: Record<string, (rec?: { id: string; text: string }) => void> = {
    onParagraphStart: (r) => log.push('start', r),
    onParagraphDone: (r) => log.push('done', r),
    onParagraphRemoved: (r) => log.push('removed', r),
    onQueueChanged: () => log.push('queue'),
    onAllDone: () => log.push('allDone')
  }
  for (const [k, fn] of Object.entries(overrides)) hooks[k] = fn
  const engine = engineLib.createQueueEngine(hooks)
  return { engine, log }
}

describe('队列引擎：入队与播放', () => {
  it('首段入队立即开始播放；后续入队计为 pending', () => {
    const { engine, log } = makeEngine()
    engine.enqueue('第一段')
    expect(engine.summary()).toEqual({ pending: 0, playing: expect.any(String), paused: false, total: 1 })
    expect(log.events).toContain('start')
    expect(log.starts[0]).toEqual({ id: expect.any(String), text: '第一段' })

    engine.enqueue('第二段')
    expect(engine.summary().pending).toBe(1)
    expect(engine.summary().total).toBe(2)
  })

  it('段落 id 唯一且递增', () => {
    const { engine } = makeEngine()
    const ids = new Set<string>()
    engine.enqueue('a')
    engine.enqueue('b')
    engine.enqueue('c')
    const recs = engine.recs()
    expect(recs).toHaveLength(3)
    for (const r of recs) {
      expect(ids.has(r.id)).toBe(false)
      ids.add(r.id)
    }
  })

  it('逐字 tick：长度次推进后段落 done 并启动下一段；无剩余则 allDone', () => {
    const { engine, log } = makeEngine()
    engine.enqueue('ab')
    engine.enqueue('cd')
    // 'ab' 两字
    expect(engine.tick()).toBe(true)
    expect(engine.tick()).toBe(true)
    // 完成 'ab' → 下一段 'cd' 启动（done 先于 start 触发）
    const i = log.events.indexOf('done')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(log.events.indexOf('start', i)).toBeGreaterThan(i)
    expect(engine.summary().playing).toBe(log.starts[1].id)
    expect(engine.summary().pending).toBe(0)
    // 'cd' 两字
    expect(engine.tick()).toBe(true)
    expect(engine.tick()).toBe(true)
    expect(engine.summary()).toEqual({ pending: 0, playing: null, paused: false, total: 2 })
    expect(log.events).toContain('allDone')
    // 空闲 tick 返回 false，无新事件
    const before = log.events.length
    expect(engine.tick()).toBe(false)
    expect(log.events.length).toBe(before)
  })

  it('tick 逐字推进有界：短段落完成后返回 false（不会越界）', () => {
    const { engine, log } = makeEngine()
    engine.enqueue('x')
    expect(engine.tick()).toBe(true)
    expect(engine.tick()).toBe(false)
    expect(log.events.filter((e) => e === 'done')).toHaveLength(1)
  })
})

describe('队列引擎：暂停/恢复', () => {
  it('pause 冻结 tick；resume 继续；summary 反映 paused', () => {
    const { engine, log } = makeEngine()
    engine.enqueue('abc')
    engine.pause()
    expect(engine.summary().paused).toBe(true)
    expect(log.events).toContain('queue')
    const before = log.events.length
    expect(engine.tick()).toBe(false)
    expect(log.events.length).toBe(before)

    engine.resume()
    expect(engine.summary().paused).toBe(false)
    expect(engine.tick()).toBe(true)
  })

  it('暂停态下新入队不自动开播；resume 后启动', () => {
    const { engine, log } = makeEngine()
    engine.pause()
    engine.enqueue('A')
    expect(engine.summary()).toEqual({ pending: 1, playing: null, paused: true, total: 1 })
    engine.resume()
    expect(log.events).toContain('start')
    expect(engine.summary().playing).not.toBeNull()
  })

  it('播放中暂停→新段入队 pending→resume 继续当前段，pending 保序', () => {
    const { engine } = makeEngine()
    engine.enqueue('ab')
    engine.pause()
    engine.enqueue('cd')
    expect(engine.summary()).toMatchObject({ pending: 1, paused: true })
    engine.resume()
    expect(engine.tick()).toBe(true) // a
    expect(engine.tick()).toBe(true) // b → 'ab' 完成，启动 'cd'
    expect(engine.summary().playing).not.toBeNull()
    expect(engine.summary().pending).toBe(0)
  })
})

describe('队列引擎：撤销上一条（最后入队）', () => {
  it('撤销 pending 尾段：当前播放不受影响，无 removed 事件', () => {
    const { engine, log } = makeEngine()
    engine.enqueue('A')
    engine.enqueue('B')
    const playing = engine.summary().playing
    engine.undo()
    expect(engine.summary()).toEqual({ pending: 0, playing, paused: false, total: 1 })
    expect(log.events).not.toContain('removed')
  })

  it('撤销 playing 尾段：停止播放并移除（removed），done 段保留', () => {
    const { engine, log } = makeEngine()
    engine.enqueue('ab')
    engine.enqueue('cd')
    engine.tick()
    engine.tick() // 'ab' done，'cd' 播放中
    const cdId = log.starts[1].id
    engine.undo()
    expect(log.events.filter((e) => e === 'removed')).toHaveLength(1)
    expect(log.starts.filter((r) => r.id === cdId)).toHaveLength(1)
    expect(engine.summary()).toEqual({ pending: 0, playing: null, paused: false, total: 1 })
  })

  it('撤销 done 尾段：移除已播完段落', () => {
    const { engine, log } = makeEngine()
    engine.enqueue('ab')
    engine.tick()
    engine.tick() // 播完，playing null
    const aId = log.starts[0].id
    engine.undo()
    expect(log.events).toContain('removed')
    expect(engine.summary()).toEqual({ pending: 0, playing: null, paused: false, total: 0 })
    expect(log.starts.filter((r) => r.id === aId)).toHaveLength(1)
  })

  it('空队列撤销：幂等，无事件', () => {
    const { engine, log } = makeEngine()
    engine.undo()
    expect(log.events).toEqual([])
  })
})

describe('队列引擎：清空', () => {
  it('clear 清空全部，保留 paused 状态', () => {
    const { engine, log } = makeEngine()
    engine.enqueue('A')
    engine.pause()
    engine.clear()
    expect(engine.summary()).toEqual({ pending: 0, playing: null, paused: true, total: 0 })
    expect(log.events).toContain('queue')
  })

  it('clear 后再次入队可正常播放', () => {
    const { engine } = makeEngine()
    engine.enqueue('A')
    engine.clear()
    engine.enqueue('B')
    expect(engine.summary().playing).not.toBeNull()
  })
})

describe('队列引擎：状态概要', () => {
  it('getPlaying 返回当前播放段落（/state 用），无播放时返回 null', () => {
    const { engine } = makeEngine()
    expect(engine.getPlaying()).toBeNull()
    engine.enqueue('你好')
    const p = engine.getPlaying()
    expect(p).toEqual({ id: expect.any(String), text: '你好' })
    expect(engine.getPlaying()).toEqual(p)
  })

  it('onQueueChanged 在 入队/完成/暂停/恢复/撤销/清空 均有触发', () => {
    const { engine, log } = makeEngine()
    engine.enqueue('A')
    engine.pause()
    engine.resume()
    engine.enqueue('B')
    engine.undo()
    engine.clear()
    expect(log.events.filter((e) => e === 'queue').length).toBeGreaterThanOrEqual(6)
  })
})

/* ---------- 入口接线（真实网关 WS 端到端） ---------- */

const rigs: Array<{ gateway: { stop(): Promise<void> } }> = []
afterEach(async () => {
  while (rigs.length > 0) {
    const r = rigs.pop()
    if (r) await r.gateway.stop()
  }
})

describe('M2 入口接线：发送 → 引擎 → 下行广播 + bus 事件', () => {
  it('WS 上行 send → enqueue 下行广播（含文本，频道内流转）+ queue-changed 事件（仅元数据）', async () => {
    const rig = await makeRig()
    rigs.push(rig)
    await copyModule(rig)
    await rig.modules.discover()
    expect((await rig.modules.load('prologue-live')).ok).toBe(true)
    expect((await rig.modules.start('prologue-live')).ok).toBe(true)

    const events: unknown[] = []
    rig.bus.subscribe('prologue-live:queue-changed', (e) => events.push(e.payload))
    await rig.gateway.start()

    const ws = await wsOpen(rig.gateway.getWebSocketUrl() as string)
    // M3 起 send 会先广播 history 再广播 enqueue：收集并等待 enqueue 消息
    const msgs: Array<{ channel: string; payload: Record<string, unknown> }> = []
    ws.onmessage = (ev) => {
      try {
        msgs.push(JSON.parse(String(ev.data)) as { channel: string; payload: Record<string, unknown> })
      } catch {
        /* 非 JSON 忽略 */
      }
    }
    ws.send(JSON.stringify({ channel: 'prologue-live', payload: { type: 'send', text: '你好世界' } }))

    // 下行：enqueue 携带文本（同频道内存流转，不进日志/bus）
    const deadline = Date.now() + 2000
    let msg: { channel: string; payload: { type: string; id: string; text: string } } | undefined
    while (Date.now() < deadline && !msg) {
      msg = msgs.find((m) => m.payload.type === 'enqueue') as
        | { channel: string; payload: { type: string; id: string; text: string } }
        | undefined
      if (!msg) await new Promise((r) => setTimeout(r, 20))
    }
    expect(msg).toBeDefined()
    expect((msg as { channel: string }).channel).toBe('prologue-live')
    expect(msg?.payload).toMatchObject({ type: 'enqueue', text: '你好世界' })
    expect(typeof msg?.payload.id).toBe('string')

    // bus 事件仅元数据：无 text 键
    await new Promise((r) => setTimeout(r, 50))
    expect(events.length).toBeGreaterThanOrEqual(1)
    const meta = events[events.length - 1] as Record<string, unknown>
    expect(Object.keys(meta).sort()).toEqual(['paused', 'pending', 'playing'])
    expect(meta.pending).toBe(0)
    expect(meta.paused).toBe(false)
    expect(typeof meta.playing).toBe('string')

    ws.close()
  })

  it('/state 返回配置 + 队列概要 + 当前播放段落（内存文本仅此处与频道流转）', async () => {
    const rig = await makeRig()
    rigs.push(rig)
    await copyModule(rig)
    await rig.modules.discover()
    await rig.modules.load('prologue-live')
    await rig.gateway.start()

    const ws = await wsOpen(rig.gateway.getWebSocketUrl() as string)
    const p1 = wsNext(ws)
    ws.send(JSON.stringify({ channel: 'prologue-live', payload: { type: 'send', text: '状态测试' } }))
    await p1 // 消费 enqueue 广播，避免干扰
    await new Promise((r) => setTimeout(r, 50))

    const url = rig.gateway.getRouteUrl('/prologue-live/state') as string
    const res = (await (await fetch(url)).json()) as {
      config: Record<string, unknown>
      queue: { pending: number; playing: string | null; paused: boolean }
      playing: { id: string; text: string } | null
      float: Record<string, unknown>
    }
    expect(res.config.textColor).toBe('#ffffff')
    expect(res.config.float.enabled).toBe(false)
    expect(res.queue).toEqual({ pending: 0, playing: expect.any(String), paused: false, total: 1 })
    expect(res.playing).toEqual({ id: expect.any(String), text: '状态测试' })
    expect(res.float).toEqual({ enabled: false, clickThrough: false, errors: [] })

    ws.close()
  })
})

/* ---------- obs 页滚动几何（假 DOM 真实执行内联脚本；行为回归） ---------- */

// 回归：scroll() 曾在 stage 底部锚定之上再叠 translateY(wrapH - contentH) 负位移——双重补偿，
// 超长文本下字幕被越推越高直至偏出显示区上缘；且 done 段落常驻画布、contentH 只增不减 → 永不自愈。
// 用假 DOM 真实执行 obs.html 内联脚本，锁两条几何不变量：
//   ① 静止位移恒为 translateY(0)——任何内容高度下不得出现负位移（字幕不出画、可自恢复）；
//   ② 内容增长 Δ 时先瞬时 +Δ 预偏再过渡归零（"新行从下方进入、整体上滑"，scrollSpeed 过渡）。

interface FakeEl {
  tag: string
  children: FakeEl[]
  parent: FakeEl | null
  className: string
  hidden: boolean
  dataset: Record<string, string>
  scrollHeight: number
  clientHeight: number
  offsetHeight: number
  style: { transition: string; transform: string; setProperty: (k: string, v: string) => void }
  textContent: string
  appendChild: (c: FakeEl) => FakeEl
  remove: () => void
}

async function runObsPage(): Promise<{
  wrap: FakeEl
  stage: FakeEl
  transformHistory: string[]
  push: (payload: unknown) => void
  tick: () => void
  resize: () => void
}> {
  const transformHistory: string[] = []
  const timers = new Map<number, () => void>()
  let timerSeq = 1
  let roCallback: (() => void) | null = null
  let fakeWs: { onmessage: ((ev: { data: string }) => void) | null } | null = null

  const makeEl = (tag: string): FakeEl => {
    let transform = 'translateY(0)'
    let text = ''
    const el: FakeEl = {
      tag,
      children: [],
      parent: null,
      className: '',
      hidden: false,
      dataset: {},
      scrollHeight: 0,
      clientHeight: 0,
      offsetHeight: 0,
      style: { transition: '', transform, setProperty: () => {} },
      textContent: '',
      appendChild(c) {
        el.children.push(c)
        c.parent = el
        return c
      },
      remove() {
        if (el.parent) el.parent.children = el.parent.children.filter((x) => x !== el)
      }
    }
    Object.defineProperty(el.style, 'transform', {
      get: () => transform,
      set: (v: string) => {
        transform = v
        transformHistory.push(v)
      }
    })
    Object.defineProperty(el, 'textContent', {
      get: () => text,
      set: (v: string) => {
        text = v
        if (v === '') el.children = []
      }
    })
    return el
  }

  const wrap = makeEl('div')
  const stage = makeEl('div')
  wrap.appendChild(stage)
  const documentStub = {
    getElementById: (id: string) => (id === 'wrap' ? wrap : id === 'stage' ? stage : null),
    createElement: makeEl,
    documentElement: makeEl('html'),
    body: makeEl('body')
  }
  class FakeWebSocket {
    onmessage: ((ev: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    constructor(_url: string) {
      fakeWs = this
    }
  }
  class FakeResizeObserver {
    constructor(cb: () => void) {
      roCallback = cb
    }
    observe(): void {}
  }
  const setIntervalStub = (fn: () => void, _ms: number): number => {
    const id = timerSeq++
    timers.set(id, fn)
    return id
  }
  const clearIntervalStub = (id: number): void => {
    timers.delete(id)
  }

  const html = await readFile(join(MODULE_DIR, 'pages', 'obs.html'), 'utf8')
  const code = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] as string
  const run = new Function(
    'document',
    'location',
    'WebSocket',
    'fetch',
    'ResizeObserver',
    'setInterval',
    'clearInterval',
    'setTimeout',
    code
  )
  run(
    documentStub,
    { search: '?token=t', protocol: 'http:', host: '127.0.0.1:1' },
    FakeWebSocket,
    () => Promise.resolve({ json: () => Promise.resolve({}) }),
    FakeResizeObserver,
    setIntervalStub,
    clearIntervalStub,
    () => 0
  )

  return {
    wrap,
    stage,
    transformHistory,
    push(payload: unknown) {
      fakeWs?.onmessage?.({ data: JSON.stringify({ channel: 'prologue-live', payload }) })
    },
    tick() {
      for (const fn of [...timers.values()]) fn()
    },
    resize() {
      roCallback?.()
    }
  }
}

describe('M2 obs 页滚动几何：字幕不出画、可自恢复', () => {
  it('超长文本持续长高：静止位移恒为 0，全程不得出现负位移', async () => {
    const dom = await runObsPage()
    dom.wrap.clientHeight = 400
    const configLib = requireModule('../lib/config.js') as { PROLOGUE_DEFAULTS: Record<string, unknown> }
    dom.push({ type: 'state', config: configLib.PROLOGUE_DEFAULTS })
    dom.push({ type: 'enqueue', id: '1', text: '超长文本。'.repeat(300) })

    // 逐字推进 + 模拟内容高度持续增长（远超显示区），复现"越打越高"
    for (let i = 0; i < 500; i++) {
      dom.stage.scrollHeight = 200 + i * 30
      dom.tick()
    }
    const negatives = dom.transformHistory.filter((t) => /translateY\(-/.test(t))
    expect(negatives, `出现负位移（字幕被推出显示区上缘）：${dom.transformHistory.join(' → ')}`).toEqual([])
    expect(dom.stage.style.transform).toBe('translateY(0)')

    // 清空后归零且后续再发送仍正常（自恢复，无需重建浏览器源）
    dom.stage.scrollHeight = 0
    dom.push({ type: 'action', op: 'clear' })
    expect(dom.stage.style.transform).toBe('translateY(0)')
  })

  it('内容增长 Δ：先 +Δ 预偏再过渡归零（新行从下方进入、整体上滑）', async () => {
    const dom = await runObsPage()
    dom.wrap.clientHeight = 400
    const configLib = requireModule('../lib/config.js') as { PROLOGUE_DEFAULTS: Record<string, unknown> }
    dom.push({ type: 'state', config: configLib.PROLOGUE_DEFAULTS })
    dom.push({ type: 'enqueue', id: '1', text: '短句。'.repeat(20) })

    dom.stage.scrollHeight = 100
    dom.resize()
    dom.transformHistory.length = 0

    dom.stage.scrollHeight = 500 // 内容增长 400
    dom.resize()
    expect(dom.transformHistory).toEqual(['translateY(400px)', 'translateY(0)'])
    expect(dom.stage.style.transform).toBe('translateY(0)')
  })
})
