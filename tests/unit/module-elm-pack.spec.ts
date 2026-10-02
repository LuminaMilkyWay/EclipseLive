import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import { createConfig } from '../../src/main/core/config'
import { createEventBus } from '../../src/main/core/bus'
import { createPermissions } from '../../src/main/core/permissions'
import { createGateway } from '../../src/main/core/gateway'
import { createModules } from '../../src/main/core/modules'
import { createPackages } from '../../src/main/core/packages'

/**
 * 生成**模块分发包 `.elm`**（输出到 `dist/modules/`）。
 *
 * 为什么做成测试：`.elm` 的格式（描述符 `module.json` + 入口 sha256 + 全文件收集）
 * 归核心 `core/packages` 管，**不该在脚本里自行复刻**（会与核心漂移）；
 * 而能让核心 TS 代码跑起来、又零额外依赖的方式就是 vitest。于是把它写成一条
 * "既产出、又校验"的测试：跑完 `npm test` 就有最新的 `.elm`，且必然通过校验。
 *
 * **同时防止历史事故重演**：`dist/` 被整体清理过一次，`dist/modules/*.elm` 随之消失
 * 且不可恢复（不在 git 内）。现在只要跑一次测试就会重新生成并校验。
 *
 * 产出位置：`dist/modules/<模块id>-<版本>.elm`；同一模块的**旧版本文件会被清掉**，
 * 保证该目录只留当前版本，避免"双版本混淆"。
 */

const MODULES_DIR = resolve(process.cwd(), 'modules')
const OUT_DIR = resolve(process.cwd(), 'dist/modules')

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

async function makeRig() {
  const logger = testLogger()
  // rig 用系统临时目录（不要放进 dist/：那是产物目录，不该混入测试残留）
  const root = await mkdtemp(join(tmpdir(), 'el-elm-pack-'))
  const config = createConfig({ dir: join(root, 'config'), logger })
  const bus = createEventBus({ logger })
  const permissions = await createPermissions({ logger, config })
  const gateway = createGateway({ logger, config, bus, preferredPort: 0 })
  const modulesDir = join(root, 'modules')
  await mkdir(modulesDir, { recursive: true })
  const modules = createModules({ logger, config, bus, permissions, gateway, modulesDir })
  const packages = createPackages({
    logger,
    modules,
    modulesDir,
    appVersion: JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')).version
  })
  await config.ready()
  return packages
}

/** 仓库里可打包的模块目录（有 manifest.json 的普通目录）。 */
async function listModuleDirs(): Promise<string[]> {
  const entries = await readdir(MODULES_DIR, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    try {
      await stat(join(MODULES_DIR, entry.name, 'manifest.json'))
      out.push(entry.name)
    } catch {
      // 无清单 → 不是模块
    }
  }
  return out.sort()
}

describe('模块分发包 .elm（产出 + 校验）', () => {
  it('把 modules/ 下每个模块打成 dist/modules/<id>-<版本>.elm，并逐个校验', async () => {
    const packages = await makeRig()
    const dirs = await listModuleDirs()
    expect(dirs.length, '应至少有一个可打包模块').toBeGreaterThan(0)

    await mkdir(OUT_DIR, { recursive: true })
    const built: string[] = []

    for (const dir of dirs) {
      const manifest = JSON.parse(
        await readFile(join(MODULES_DIR, dir, 'manifest.json'), 'utf8')
      ) as { id: string; version: string; entry?: string; license?: string }
      expect(manifest.id, `${dir} 的清单 id 必须等于目录名`).toBe(dir)
      // 声明式模块（如 laplacelive-link）**允许没有 entry**：核心的 pack 会把它打成
      // entry 为空的包（历史上正是这么发布的）。故这里按"可选"处理。
      const entry = typeof manifest.entry === 'string' ? manifest.entry : ''

      // 同一模块的旧版本产物先清掉：该目录只应留当前版本
      for (const stale of await readdir(OUT_DIR)) {
        if (stale === `${manifest.id}-${manifest.version}.elm`) continue
        if (stale.startsWith(`${manifest.id}-`) && stale.endsWith('.elm')) {
          await rm(join(OUT_DIR, stale), { force: true })
        }
      }

      const out = join(OUT_DIR, `${manifest.id}-${manifest.version}.elm`)
      const res = await packages.pack({
        dir: join(MODULES_DIR, dir),
        out,
        coreVersion: '*',
        license: manifest.license ?? 'UNLICENSED'
      })
      expect(res.ok, `${manifest.id} 打包失败：${res.errors.join('; ')}`).toBe(true)

      // 校验 1：inspect 往返 + 入口 sha256 与文件一致（无入口模块跳过 sha256）
      const info = await packages.inspect(out)
      expect(info.ok, `${manifest.id} 自检失败：${info.errors?.join('; ')}`).toBe(true)
      expect(info.info?.format).toBe(1)
      expect(info.info?.entry ?? '').toBe(entry)
      if (entry.length > 0) {
        const entryBytes = await readFile(join(MODULES_DIR, dir, entry))
        expect(info.info?.sha256).toBe(createHash('sha256').update(entryBytes).digest('hex'))
      }

      // 校验 2：包内必须有描述符，且不含 manifest.json（描述符是 module.json）
      const names = new AdmZip(out).getEntries().map((e) => e.entryName)
      expect(names).toContain('module.json')
      if (entry.length > 0) expect(names).toContain(entry)
      expect(names).not.toContain('manifest.json')

      // 校验 3：带 vendor 的模块（第三方库必须随包，否则成品里 require 不到）
      if ((await readdir(join(MODULES_DIR, dir))).includes('vendor')) {
        expect(
          names.some((n) => n.startsWith('vendor/') && n.endsWith('LICENSE')),
          `${manifest.id} 的 vendor 必须含上游 LICENSE（红线 14）`
        ).toBe(true)
      }

      built.push(`${manifest.id}-${manifest.version}.elm`)
    }

    // 全部产出后复核目录内容：与本次构建结果一致（无残留旧版本）
    const present = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.elm')).sort()
    expect(present).toEqual([...built].sort())
  }, 120000)
})
