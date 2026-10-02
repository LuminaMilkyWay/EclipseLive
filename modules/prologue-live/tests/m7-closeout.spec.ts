import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import { createConfig } from '../../../src/main/core/config'
import { createEventBus } from '../../../src/main/core/bus'
import { createPermissions } from '../../../src/main/core/permissions'
import { createGateway } from '../../../src/main/core/gateway'
import { createModules, type ModulesRig } from '../../../src/main/core/modules'

const MODULE_DIR = resolve(process.cwd(), 'modules/prologue-live')

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
  await cp(MODULE_DIR, join(modulesDir, 'prologue-live'), { recursive: true })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir })
  await config.ready()
  await modules.discover()
  expect((await modules.load('prologue-live')).ok).toBe(true)
  expect((await modules.start('prologue-live')).ok).toBe(true)
  return { modules, logger, config, bus, permissions, gateway, modulesDir, root }
}

const rigs: ModulesRig[] = []
afterEach(async () => {
  while (rigs.length > 0) {
    const r = rigs.pop()
    if (r) {
      await r.modules.stop('prologue-live').catch(() => {})
      await r.gateway.stop().catch(() => {})
    }
  }
})

describe('M7 页面服务收口', () => {
  it('三个页面路由真实提供 HTML（非占位），text/html + 关键元素在位', async () => {
    const rig = await makeRig()
    rigs.push(rig)
    await rig.gateway.start()

    const obs = await fetch(rig.gateway.getRouteUrl('/prologue-live/obs') as string)
    expect(obs.headers.get('content-type')).toContain('text/html')
    const obsHtml = await obs.text()
    expect(obsHtml).toContain('<!doctype html')
    expect(obsHtml).toContain('PrologueType Live · OBS')

    const control = await fetch(rig.gateway.getRouteUrl('/prologue-live/control') as string)
    expect(control.headers.get('content-type')).toContain('text/html')
    const controlHtml = await control.text()
    expect(controlHtml).toContain('获取URL')
    expect(controlHtml).toContain('六组合')

    const overlay = await fetch(rig.gateway.getRouteUrl('/prologue-live/overlay') as string)
    expect(overlay.headers.get('content-type')).toContain('text/html')
    const overlayHtml = await overlay.text()
    expect(overlayHtml).toContain('eclipseliveOverlay')
    expect(overlayHtml).toContain('悬浮输入窗')
  })

  it('/state 为 JSON 信封，含全部首屏字段', async () => {
    const rig = await makeRig()
    rigs.push(rig)
    await rig.gateway.start()
    const res = await fetch(rig.gateway.getRouteUrl('/prologue-live/state') as string)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
    for (const key of ['config', 'queue', 'playing', 'float', 'history', 'fonts', 'screens']) {
      expect(body).toHaveProperty(key)
    }
  })

  it('无发送时队列空态（未发送不显示）', async () => {
    const rig = await makeRig()
    rigs.push(rig)
    await rig.gateway.start()
    const res = await fetch(rig.gateway.getRouteUrl('/prologue-live/state') as string)
    const body = (await res.json()) as { queue: { pending: number; playing: string | null; total: number } }
    expect(body.queue).toEqual({ pending: 0, playing: null, paused: false, total: 0 })
  })
})
