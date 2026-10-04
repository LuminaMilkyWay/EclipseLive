import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'
import type { CredentialRecord, ICredentialStore } from '@contracts/credentials'
import type { ILogger } from '@contracts/logger'
import { createEventBus } from '../../../src/main/core/bus'
import { createConfig } from '../../../src/main/core/config'
import { createGateway } from '../../../src/main/core/gateway'
import { createModules } from '../../../src/main/core/modules'
import { createNetworkClient } from '../../../src/main/core/network'
import { createPackages } from '../../../src/main/core/packages'
import { createPermissions } from '../../../src/main/core/permissions'

/**
 * ⑦-2 打包与安装验证（用户 Q1=a 只打运行所需；Q2=a 打包→安装→加载→卸载全走一遍；Q3=a 对齐版本）。
 *
 * 本文件曾经抓到**本阶段最坏的一类 bug**（已修）：
 *   `nav` 在 manifest 解析阶段**只校验、不赋值** ⇒ 打包描述符里没有 `nav` ⇒
 *   **安装版模块会静默丢掉一级菜单入口**（源码目录能跑、装出来不能用）。
 *   修法见 `src/main/core/modules/index.ts`（解析出 `nav` 变量 + 组装进 manifest）与
 *   `src/main/core/packages/index.ts`（描述符白名单补 `nav`）。
 *
 * 顺带验证两条红线：① 默认不联网；② **卸载后配置保留**（"配置与撤销记忆将保留"）。
 */
const MODULE_DIR = resolve(process.cwd(), 'modules/vupcut')
const APP_VERSION = '0.2.2'
const LICENSE = 'AGPL-3.0-or-later'

function testLogger(): ILogger {
  const make = (): ILogger => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => make(), setLevel: () => {} })
  return make()
}

class MemoryStore implements ICredentialStore {
  raw = new Map<string, string>()
  get(key: string): string | null {
    return this.raw.get(key) ?? null
  }
  set(key: string, secret: string): void {
    this.raw.set(key, secret)
  }
  delete(key: string): boolean {
    return this.raw.delete(key)
  }
  has(key: string): boolean {
    return this.raw.has(key)
  }
  list(): CredentialRecord[] {
    return [...this.raw.keys()].sort().map((key) => ({ key, weak: false, updatedAt: 0 }))
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(fn: () => Promise<boolean>, timeoutMs = 5000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true
    await sleep(50)
  }
  return false
}

async function makeRig() {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-vupcut-pack-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  await gateway.start()
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  const credentials = new MemoryStore()
  // 与装配根同构：**同意来源 = VupCut 自己的配置段**（默认关 ⇒ 一律拒绝）
  const network = createNetworkClient({
    logger,
    isEnabled: () => config.get<{ network?: { enabled?: boolean } }>('vupcut')?.network?.enabled === true,
    fetchImpl: (async () => new Response('{"data":[]}', { status: 200 })) as unknown as typeof fetch
  })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir, credentials, network })
  const packages = createPackages({ logger, modules, modulesDir, appVersion: APP_VERSION })
  await config.ready()
  return { packages, modules, logger, config, bus, permissions, gateway, modulesDir, root, credentials, network }
}

async function packInto(rig: Awaited<ReturnType<typeof makeRig>>, name = 'vupcut.elm') {
  const out = join(rig.root, name)
  const res = await rig.packages.pack({ dir: MODULE_DIR, out, coreVersion: '*', license: LICENSE })
  return { out, res }
}

describe('⑦-2 打包：T65 许可证闸门与包内容', () => {
  it('① 声明 AGPL-3.0-or-later 且随包带 LICENSE ⇒ 打包通过；包内是 module.json', async () => {
    const rig = await makeRig()
    const { out, res } = await packInto(rig)
    expect(res.ok, `打包失败：${res.errors.join('；')}`).toBe(true)
    expect(res.moduleId).toBe('vupcut')

    const info = await rig.packages.inspect(out)
    expect(info.ok).toBe(true)
    expect(info.info?.entry).toBe('index.js')
    expect(info.info?.format).toBe(1)

    const names = new AdmZip(out).getEntries().map((e) => e.entryName)
    expect(names, '包内是 module.json（描述符），不是 manifest.json').toContain('module.json')
    expect(names).not.toContain('manifest.json')
    expect(names, 'AGPL 许可证必须随包（T65 闸门的前提）').toContain('LICENSE')
    expect(names, '价目数据随包（离线兜底）').toContain('prices.json')
    expect(names, '控制页必须随包（否则页面打不开）').toContain('pages/control.html')
    for (const f of [
      'index.js',
      'lib/job.js',
      'lib/pipeline.js',
      'lib/asr.js',
      'lib/llm.js',
      'lib/editor.js',
      'lib/store.js',
      'lib/offset.js',
      'lib/marks.js',
      'lib/cost.js',
      'lib/providers.js',
      'lib/control-routes.js',
      'lib/prices-online.js',
      'lib/ports.js',
      'lib/fakes.js'
    ]) {
      expect(names, `缺少运行必需文件 ${f}`).toContain(f)
    }
    // ⚠️ 实测：核心打包器收整个模块目录（只把 manifest.json 换成 module.json）⇒ `tests/` 也随包。
    // 不影响运行、体积很小，但不理想 ⇒ 记为待办（要排除需改核心打包器）。
    expect(names.some((n) => n.startsWith('tests/')), '当前行为：测试文件随包（已记为待办）').toBe(true)
  })

  it('② 描述符带上 nav/web/routes/权限/许可证（少一个就是"装上了但用不了"）', async () => {
    const rig = await makeRig()
    const { out } = await packInto(rig)
    const desc = JSON.parse(new AdmZip(out).getEntry('module.json')!.getData().toString('utf8')) as Record<string, unknown>
    expect(desc.license).toBe(LICENSE)
    expect(desc.nav, '★ 一级菜单声明必须随包（曾因解析层丢字段而缺失）').toMatchObject({
      level: 1,
      after: 'obs-stream',
      order: 20,
      immersive: true
    })
    expect(desc.web, '页面入口必须随包').toMatchObject({ url: '/vupcut/control' })
    expect((desc.routes as unknown[])?.length ?? 0, '路由必须随包声明').toBeGreaterThanOrEqual(6)
    expect(desc.permissions as string[], '没有 network-access ⇒ 永远拿不到 ctx.network').toContain('network-access')
    expect(desc.permissions as string[]).toContain('subprocess')
    expect(desc.config, '配置默认值必须随包（否则安装后没有默认值）').toBeTruthy()
  })

  it('③ 入口 sha256 与入包文件一致（供应链可校验）', async () => {
    const rig = await makeRig()
    const { out } = await packInto(rig)
    const info = await rig.packages.inspect(out)
    const entry = await readFile(join(MODULE_DIR, 'index.js'))
    expect(info.info?.sha256).toBe(createHash('sha256').update(entry).digest('hex'))
  })
})

describe('⑦-2 安装 → 加载 → 卸载', () => {
  it('④ 真实安装 ⇒ 扫描并加载成功，nav/web/权限在安装版里都还在', async () => {
    const rig = await makeRig()
    const { out } = await packInto(rig)
    const inst = await rig.packages.install(out)
    expect(inst.ok, `安装失败：${inst.errors.join('；')}`).toBe(true)

    const installed = join(rig.modulesDir, 'vupcut')
    await expect(stat(join(installed, 'manifest.json'))).resolves.toBeTruthy()
    await expect(stat(join(installed, 'LICENSE'))).resolves.toBeTruthy()
    await expect(stat(join(installed, 'pages/control.html'))).resolves.toBeTruthy()

    // 安装发生在 createModules 之后 ⇒ 必须**扫描一次**管理器才会认识这个模块
    //（此前直接 load 会得到 `unknown module: vupcut` —— 这是正常行为，不是 bug）。
    const summary = await rig.modules.startAll()
    expect(summary.failed, `启动失败：${summary.failed.join(', ')}`).toEqual([])

    const installedManifest = JSON.parse(await readFile(join(installed, 'manifest.json'), 'utf8')) as Record<string, unknown>
    expect(installedManifest.nav, '安装版的 nav 必须在').toMatchObject({ level: 1, immersive: true })
    expect(installedManifest.web).toMatchObject({ url: '/vupcut/control' })
    expect(installedManifest.permissions as string[]).toContain('network-access')
  })

  it('⑤ 红线：默认不联网；把模块配置打开后才放行，且白名单仍然生效', async () => {
    const rig = await makeRig()
    const { out } = await packInto(rig)
    await rig.packages.install(out)
    await rig.modules.startAll()

    await expect(rig.network.request('https://api.openai.com/v1/x'), '默认关 ⇒ 必须拒绝').rejects.toThrow(/local-first/)

    // 用户在自己模块配置里开启（核心读的就是这一段）。⚠️ `config.set` 是整段替换 ⇒ 必须合并后再写。
    const cur = rig.config.get<Record<string, unknown>>('vupcut') ?? {}
    const res = rig.config.set('vupcut', { ...cur, network: { ...(cur.network as object), enabled: true } })
    expect(res.ok, `配置写入应成功：${(res.errors ?? []).join('；')}`).toBe(true)
    await expect(rig.network.request('https://api.openai.com/v1/x'), '开启后放行').resolves.toBeTruthy()
    await expect(rig.network.request('https://evil.example.com/x'), '白名单仍生效').rejects.toThrow(/主机不在白名单/)
  })

  /**
   * 卸载语义（已查证核心实现，**不是猜**）：
   *   · `packages.uninstall(moduleId)` 是**显式动作**（只由 `src/main/index.ts` 的
   *     "资源管理里点卸载"这条路径调用）⇒ 它**清理模块目录**并保留配置（日志原文 "config kept"）；
   *   · **删掉 `.elm` 文件不等于卸载**（观察者只是重新扫描已存在的包）⇒ 这是**设计如此**，不是遗漏。
   * ⇒ 因此本条的卸载走 `uninstall()`；"删文件"的行为已在上面的时序注释里记录，不再当成失败。
   */
  it('⑥ 卸载：`packages.uninstall()` 清理模块目录，但**配置保留**（撤销记忆）', async () => {
    const rig = await makeRig()
    const { out } = await packInto(rig)
    await rig.packages.install(out)
    await rig.modules.startAll()
    const installed = join(rig.modulesDir, 'vupcut')
    await expect(stat(installed), '安装后目录应在').resolves.toBeTruthy()

    // 用户设置一项配置：卸载后必须还在（"配置与撤销记忆将保留"）
    const cur = rig.config.get<Record<string, unknown>>('vupcut') ?? {}
    const res = rig.config.set('vupcut', { ...cur, network: { ...(cur.network as object), enabled: true } })
    expect(res.ok, `配置写入应成功：${(res.errors ?? []).join('；')}`).toBe(true)

    await rig.packages.uninstall('vupcut')
    const gone = await until(async () => {
      try {
        await stat(installed)
        return false
      } catch {
        return true
      }
    })
    expect(gone, '卸载后模块目录应被清理').toBe(true)
    const cfgAfter = rig.config.get<{ network?: { enabled?: boolean } }>('vupcut')
    expect(cfgAfter?.network?.enabled, '配置与撤销记忆必须保留').toBe(true)
  })
})
