import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import type {
  WebToolHost,
  WebToolUiTokens,
  WebToolView,
  WebToolViewSpec
} from '@contracts/webtools'
import { isNavigationAllowed } from '@contracts/webtools'
import { sanitizeUiTokens } from '../../src/main/core/webtools'
import { createConfig } from '../../src/main/core/config'
import { createEventBus } from '../../src/main/core/bus'
import { createPermissions } from '../../src/main/core/permissions'
import { createGateway } from '../../src/main/core/gateway'
import { createModules } from '../../src/main/core/modules'
import { createWebTools, type WebToolsRig } from '../../src/main/core/webtools'

/** 测试 rig：host 保留 fake 的扩展字段（specs/views）。 */
type FakeHost = ReturnType<typeof makeFakeHost>
type Rig = Omit<WebToolsRig, 'host'> & { host: FakeHost }

/* ---------- 测试辅助 ---------- */

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

interface FakeView {
  spec: WebToolViewSpec
  loaded: boolean
  destroyed: boolean
  /** T29：reload 断言——load/loadUrl 累计次数与 URL 序列。 */
  loadCount: number
  urls: string[]
  /** T30：几何/显隐断言。 */
  bounds: Array<{ x: number; y: number; width: number; height: number }>
  visibility: boolean[]
  /** T33：UI 令牌注入断言。 */
  uiTokenCalls: WebToolUiTokens[]
}

/** 注入式假 host：记录 spec 与视图状态。 */
function makeFakeHost(): WebToolHost & { specs: WebToolViewSpec[]; views: FakeView[] } {
  const specs: WebToolViewSpec[] = []
  const views: FakeView[] = []
  return {
    specs,
    views,
    createView(spec) {
      specs.push(spec)
      const view: FakeView = {
        spec,
        loaded: false,
        destroyed: false,
        loadCount: 0,
        urls: [],
        bounds: [],
        visibility: [],
        uiTokenCalls: []
      }
      views.push(view)
      const handle: WebToolView = {
        load: async () => {
          view.loaded = true
          view.loadCount += 1
          view.urls.push(spec.url)
        },
        loadUrl: async (url: string) => {
          view.loaded = true
          view.loadCount += 1
          view.urls.push(url)
        },
        setBounds: (rect) => {
          view.bounds.push({ ...rect })
        },
        setVisible: (visible) => {
          view.visibility.push(visible)
        },
        setUiTokens: (tokens) => {
          view.uiTokenCalls.push({ ...tokens })
        },
        destroy: () => {
          view.destroyed = true
        }
      }
      return handle
    }
  }
}

async function makeRig(): Promise<Rig> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-wt-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir })
  const host = makeFakeHost()
  const webtools = createWebTools({ logger, modules, gateway, host })
  await config.ready()
  return { webtools, modules, host, logger, config, bus, permissions, gateway, root }
}

/** 写一个声明式网页工具模块目录。 */
async function writeWebTool(
  rig: Rig,
  id: string,
  web: Record<string, unknown> = {}
): Promise<void> {
  const dir = join(rig.root, 'modules', id)
  await mkdir(dir, { recursive: true })
  const manifest = {
    id,
    name: id,
    version: '0.1.0',
    permissions: ['network-access'],
    dependencies: [],
    web: {
      url: 'https://demo.example/',
      allowedDomains: ['https://demo.example'],
      windowMode: 'embedded',
      pinned: false,
      ...web
    }
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

/** 写一个普通模块目录（非网页工具）。 */
async function writeRegularModule(rig: Rig, id: string): Promise<void> {
  const dir = join(rig.root, 'modules', id)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id,
      name: id,
      version: '0.1.0',
      permissions: [],
      dependencies: [],
      entry: 'index.js'
    }),
    'utf8'
  )
  await writeFile(join(dir, 'index.js'), 'module.exports = {}', 'utf8')
}

async function setupTool(rig: Rig, id = 'web-demo'): Promise<void> {
  await writeWebTool(rig, id)
  await rig.modules.discover()
  await rig.modules.load(id)
  await rig.modules.start(id)
}

/* ---------- 用例 ---------- */

describe('打开与关闭', () => {
  it('open 全链路：spec 字段正确（partition/isolation）、load 被调、状态 open', async () => {
    const rig = await makeRig()
    await setupTool(rig)

    const result = await rig.webtools.open('web-demo')
    expect(result.ok).toBe(true)
    expect(rig.host.specs.length).toBe(1)
    expect(rig.host.specs[0]).toMatchObject({
      moduleId: 'web-demo',
      url: 'https://demo.example/',
      partition: 'persist:webtool-web-demo',
      windowMode: 'embedded'
    })
    expect(rig.host.views[0].loaded).toBe(true)
    expect(rig.webtools.status('web-demo')).toMatchObject({
      moduleId: 'web-demo',
      url: 'https://demo.example/',
      partition: 'persist:webtool-web-demo',
      windowMode: 'embedded',
      pinned: false,
      state: 'open',
      denials: 0
    })
  })

  it('open 拒绝非 web 模块与未知模块；close 销毁且幂等；重开新建视图', async () => {
    const rig = await makeRig()
    await writeRegularModule(rig, 'plain-mod')
    await setupTool(rig)
    await rig.modules.discover()
    await rig.modules.load('plain-mod')

    const notWeb = await rig.webtools.open('plain-mod')
    expect(notWeb.ok).toBe(false)
    expect(notWeb.errors[0]).toContain('not a web tool')
    const ghost = await rig.webtools.open('ghost')
    expect(ghost.ok).toBe(false)

    expect((await rig.webtools.open('web-demo')).ok).toBe(true)
    rig.webtools.close('web-demo')
    expect(rig.host.views[0].destroyed).toBe(true)
    expect(rig.webtools.status('web-demo')?.state).toBe('closed')
    // 幂等
    expect(() => rig.webtools.close('web-demo')).not.toThrow()
    // 重开 → 新视图（登录态由 persist partition 保持）
    expect((await rig.webtools.open('web-demo')).ok).toBe(true)
    expect(rig.host.specs.length).toBe(2)
    expect(rig.webtools.status('web-demo')?.state).toBe('open')
  })

  it('partition 覆写与 windowMode:window 透传', async () => {
    const rig = await makeRig()
    await writeWebTool(rig, 'web-custom', { partition: 'custom-part', windowMode: 'window' })
    await rig.modules.discover()
    await rig.modules.load('web-custom')
    await rig.modules.start('web-custom')

    expect((await rig.webtools.open('web-custom')).ok).toBe(true)
    expect(rig.host.specs[0]).toMatchObject({
      partition: 'persist:webtool-custom-part',
      windowMode: 'window'
    })
  })
})

describe('默认拒绝策略', () => {
  it('导航仅放行 allowedDomains origin，其余拒绝并计数', async () => {
    const rig = await makeRig()
    await setupTool(rig)
    await rig.webtools.open('web-demo')

    const spec = rig.host.specs[0]
    expect(spec.allowNavigation('https://demo.example/page?q=1')).toBe(true)
    expect(spec.allowNavigation('https://evil.example/')).toBe(false)
    expect(spec.allowNavigation('file:///C:/Windows/evil.js')).toBe(false)
    expect(spec.allowNavigation('not-a-url')).toBe(false)
    // 三次被拒 → 计数 3
    expect(rig.webtools.diagnostics().denials).toBe(3)

    // new-window / permission / download 经 onDenied 计数并进最近环
    spec.onDenied('new-window', 'https://evil.example/')
    spec.onDenied('permission', 'media')
    spec.onDenied('download', 'setup.exe')
    const diag = rig.webtools.diagnostics()
    expect(diag.denials).toBe(6)
    const kinds = diag.recent.map((d) => d.kind)
    expect(kinds.slice(-3)).toEqual(['new-window', 'permission', 'download'])
    expect(diag.recent.find((d) => d.kind === 'new-window')).toMatchObject({
      moduleId: 'web-demo',
      detail: 'https://evil.example/'
    })
  })

  it('isNavigationAllowed 纯策略：origin 精确匹配（含端口）、非 http(s)、垃圾 URL', () => {
    const domains = ['https://a.example', 'https://b.example:8443']
    expect(isNavigationAllowed('https://a.example/x', domains)).toBe(true)
    // URL origin 省略默认端口：https://a.example:443 与 https://a.example 同源
    expect(isNavigationAllowed('https://a.example:443/x', domains)).toBe(true)
    expect(isNavigationAllowed('https://b.example:8443/y', domains)).toBe(true)
    expect(isNavigationAllowed('https://b.example/y', domains)).toBe(false)
    expect(isNavigationAllowed('http://a.example/x', domains)).toBe(false)
    expect(isNavigationAllowed('javascript:alert(1)', domains)).toBe(false)
    expect(isNavigationAllowed('::::', domains)).toBe(false)
  })
})

describe('列表与诊断', () => {
  it('list/status：仅网页工具、状态合并、未知 undefined', async () => {
    const rig = await makeRig()
    await writeRegularModule(rig, 'plain-mod')
    await setupTool(rig)
    await rig.modules.discover()
    await rig.modules.load('plain-mod')

    const list = rig.webtools.list()
    expect(list.length).toBe(1)
    expect(list[0].moduleId).toBe('web-demo')
    expect(rig.webtools.status('plain-mod')).toBeUndefined()
    expect(rig.webtools.status('ghost')).toBeUndefined()

    await rig.webtools.open('web-demo')
    expect(rig.webtools.status('web-demo')?.state).toBe('open')

    const diag = rig.webtools.diagnostics()
    expect(diag).toMatchObject({ tools: 1, open: 1, denials: 0 })
    expect(diag.recent).toEqual([])
  })
})

/* ---------- 页面模块（T29）：web.url 相对引用全链路 ---------- */

/** 写一个业务页面模块（web 相对 url + entry 业务）。 */
async function writePageModule(rig: Rig, id = 'page-mod'): Promise<void> {
  const dir = join(rig.root, 'modules', id)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id,
      name: id,
      version: '0.1.0',
      permissions: [],
      dependencies: [],
      entry: 'index.js',
      web: { url: '/page-mod/panel', windowMode: 'embedded', pinned: true }
    }),
    'utf8'
  )
  await writeFile(join(dir, 'index.js'), 'module.exports = {}', 'utf8')
}

async function setupPage(rig: Rig, id = 'page-mod'): Promise<void> {
  // 相对 url 解析依赖真实网关 URL（token/port 就绪）。
  await rig.gateway.start()
  await writePageModule(rig, id)
  await rig.modules.discover()
  await rig.modules.load(id)
  await rig.modules.start(id)
}

describe('页面模块（T29）', () => {
  it('open 相对 url：运行时解析网关 URL（含路由段）、导航闭集含网关 origin', async () => {
    const rig = await makeRig()
    await setupPage(rig)

    const result = await rig.webtools.open('page-mod')
    expect(result.ok).toBe(true)
    const spec = rig.host.specs[0]
    expect(spec.url.startsWith('http')).toBe(true)
    expect(spec.url).toContain('/page-mod/panel')
    // 解析后真实 URL 含 token——绝不外泄（status 层断言见下一例）
    expect(spec.url).toContain('token')
    expect(spec.selfOrigin).toBe(new URL(spec.url).origin)
    // 导航闭集：自家网关 origin 放行，外部拒绝
    expect(spec.allowNavigation(`${new URL(spec.url).origin}/page-mod/x`)).toBe(true)
    expect(spec.allowNavigation('https://evil.example/')).toBe(false)
    expect(rig.host.views[0].loaded).toBe(true)
  })

  it('status 红线与 page 标记：相对声明 url 返回 null（token 不出快照）', async () => {
    const rig = await makeRig()
    await setupPage(rig)
    await setupTool(rig)

    await rig.webtools.open('page-mod')
    const pageStatus = rig.webtools.status('page-mod')
    expect(pageStatus?.url).toBeNull()
    expect(pageStatus?.page).toBe(true)

    const toolStatus = rig.webtools.status('web-demo')
    expect(toolStatus?.url).toBe('https://demo.example/')
    expect(toolStatus?.page).toBe(false)
  })

  it('reload：页面视图重取网关 URL 重新加载；第三方工具跳过', async () => {
    const rig = await makeRig()
    await setupPage(rig)
    await setupTool(rig)
    await rig.webtools.open('page-mod')
    await rig.webtools.open('web-demo')

    // reload = 重新解析（端口漂移后取到新 URL）+ loadUrl；fake gateway 幂等，
    // 断言重载次数与路由段，不断言 URL 必变（真机端口漂移归 T32 清单）。
    rig.webtools.reload('page-mod')
    expect(rig.host.views[0].loadCount).toBe(2)
    expect(rig.host.views[0].urls[1]).toContain('/page-mod/panel')

    const before = rig.host.views[1].loadCount
    rig.webtools.reload('web-demo')
    expect(rig.host.views[1].loadCount).toBe(before)
  })

  it('网关未就绪：open 相对 url 显式失败（不静默）', async () => {
    const rig = await makeRig()
    // 不 start gateway → getRouteUrl 返回 null
    await writePageModule(rig)
    await rig.modules.discover()
    await rig.modules.load('page-mod')

    const result = await rig.webtools.open('page-mod')
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('gateway')
  })
})

/* ---------- 几何与显隐（T30） ---------- */

describe('几何与显隐（T30）', () => {
  it('setRect：路由到视图 setBounds；非法矩形忽略；closed 工具无操作', async () => {
    const rig = await makeRig()
    await setupTool(rig)
    await rig.webtools.open('web-demo')

    rig.webtools.setRect('web-demo', { x: 280, y: 24, width: 800, height: 600 })
    expect(rig.host.views[0].bounds).toEqual([{ x: 280, y: 24, width: 800, height: 600 }])

    // 非法矩形：负宽 / 零高 / 非数字 → 忽略
    rig.webtools.setRect('web-demo', { x: 0, y: 0, width: -5, height: 100 })
    rig.webtools.setRect('web-demo', { x: 0, y: 0, width: 100, height: 0 })
    rig.webtools.setRect('web-demo', { x: 'x' as unknown as number, y: 0, width: 10, height: 10 })
    expect(rig.host.views[0].bounds).toHaveLength(1)

    // closed 工具 → 无操作
    expect(() => rig.webtools.setRect('ghost', { x: 0, y: 0, width: 10, height: 10 })).not.toThrow()
  })

  it('show/hide：路由到视图 setVisible；closed 工具无操作', async () => {
    const rig = await makeRig()
    await setupTool(rig)
    await rig.webtools.open('web-demo')

    rig.webtools.show('web-demo')
    rig.webtools.hide('web-demo')
    expect(rig.host.views[0].visibility).toEqual([true, false])

    expect(() => rig.webtools.show('ghost')).not.toThrow()
    expect(() => rig.webtools.hide('ghost')).not.toThrow()
  })

  it('reload 与 setRect 组合：互不干扰（几何在重载后保持可设置）', async () => {
    const rig = await makeRig()
    await setupPage(rig)
    await setupTool(rig)
    await rig.webtools.open('page-mod')

    rig.webtools.setRect('page-mod', { x: 280, y: 24, width: 800, height: 600 })
    rig.webtools.reload('page-mod')
    rig.webtools.setRect('page-mod', { x: 280, y: 32, width: 780, height: 580 })
    expect(rig.host.views[0].loadCount).toBe(2)
    expect(rig.host.views[0].bounds).toEqual([
      { x: 280, y: 24, width: 800, height: 600 },
      { x: 280, y: 32, width: 780, height: 580 }
    ])
  })
})

/* ---------- 模块页 UI 令牌（T33）：宿主令牌单向注入 ---------- */

describe('模块页 UI 令牌（T33）', () => {
  const VALID_TOKENS = { '--mat-alpha': '0.78', '--r-lg': '16px', '--txt-1': '#e9eef9' }

  it('sanitizeUiTokens：合法扁平 -- 前缀键 + 无 ;{} 值放行；其余整包拒绝', () => {
    expect(sanitizeUiTokens(VALID_TOKENS)).toEqual(VALID_TOKENS)
    // 空对象合法（无注入点也不出错）
    expect(sanitizeUiTokens({})).toEqual({})
    // 非对象 / 数组 / null
    expect(sanitizeUiTokens('x')).toBeNull()
    expect(sanitizeUiTokens([1, 2])).toBeNull()
    expect(sanitizeUiTokens(null)).toBeNull()
    // 非 -- 前缀键 → 整包拒绝（防 CSS 逃逸）
    expect(sanitizeUiTokens({ '--a': '1', color: 'red' })).toBeNull()
    expect(sanitizeUiTokens({ '--a': '1', 'x-y': '2' })).toBeNull()
    // 值含 ;{} → 整包拒绝（注入内容永不逃出令牌块）
    expect(sanitizeUiTokens({ '--a': '1; background:red' })).toBeNull()
    expect(sanitizeUiTokens({ '--a': '}{background:red' })).toBeNull()
    // 值非字符串 → 整包拒绝
    expect(sanitizeUiTokens({ '--a': 1 })).toBeNull()
  })

  it('setUiTokens：打开时即时转发；重开后新建视图也重注入（存储生效）', async () => {
    const rig = await makeRig()
    await setupTool(rig)

    await rig.webtools.open('web-demo')
    rig.webtools.setUiTokens('web-demo', VALID_TOKENS)
    expect(rig.host.views[0].uiTokenCalls).toEqual([VALID_TOKENS])

    // 关闭再重开 → 新视图，先前接受的令牌自动重注入
    rig.webtools.close('web-demo')
    await rig.webtools.open('web-demo')
    expect(rig.host.specs.length).toBe(2)
    expect(rig.host.views[1].uiTokenCalls).toEqual([VALID_TOKENS])
  })

  it('setUiTokens：非法载荷整包忽略（不注入、不存储）；closed 模块仅存储不抛错', async () => {
    const rig = await makeRig()
    await setupTool(rig)

    await rig.webtools.open('web-demo')
    rig.webtools.setUiTokens('web-demo', { '--a': '1; color:red' })
    expect(rig.host.views[0].uiTokenCalls).toHaveLength(0)

    // closed 模块：合法载荷只存储，无视图可注入 → 不抛错；重开后重注入
    rig.webtools.close('web-demo')
    rig.webtools.setUiTokens('web-demo', VALID_TOKENS)
    expect(() => rig.webtools.setUiTokens('web-demo', { bad: '1' })).not.toThrow()
    await rig.webtools.open('web-demo')
    expect(rig.host.views[1].uiTokenCalls).toEqual([VALID_TOKENS])
  })

  it('reload：文档重建后重注入存储的令牌（页面模块）', async () => {
    const rig = await makeRig()
    await setupPage(rig)

    await rig.webtools.open('page-mod')
    rig.webtools.setUiTokens('page-mod', VALID_TOKENS)
    expect(rig.host.views[0].uiTokenCalls).toEqual([VALID_TOKENS])

    rig.webtools.reload('page-mod')
    expect(rig.host.views[0].loadCount).toBe(2)
    // reload 的重注入在 loadUrl 的 .then 微任务里（fire-and-forget），等一拍再断言
    await new Promise((r) => setTimeout(r, 0))
    expect(rig.host.views[0].uiTokenCalls).toEqual([VALID_TOKENS, VALID_TOKENS])
  })
})
