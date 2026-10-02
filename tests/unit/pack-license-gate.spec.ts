import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
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
 * P3 打包闸门（正确设计版）：
 *   · 许可是**打包参数** `PackOptions.license`（文档：默认 'UNLICENSED'），写入包内描述符
 *     `module.json`，**不回写**模块清单（`packages.spec.ts` L234 有断言）；
 *   · 声明真实协议（如 MIT）⇒ 模块目录内**必须**有 `manifest.licenseFile ?? 'LICENSE'` 文件；
 *   · `UNLICENSED` ⇒ 允许且免文件；标识符非法 ⇒ 拒绝。
 * rig 照抄 `module-elm-pack.spec.ts`（**不用 as never**）。
 */
const MODULES_DIR = resolve(process.cwd(), 'modules')

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

async function makeRig(): Promise<ReturnType<typeof createPackages>> {
  const logger = testLogger()
  const root = await mkdtemp(join(tmpdir(), 'el-packgate-'))
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

async function fixture(
  mutate: (dir: string) => Promise<void>
): Promise<{ dir: string; out: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'el-packfix-'))
  const dir = join(root, 'example-empty')
  await cp(join(MODULES_DIR, 'example-empty'), dir, { recursive: true })
  await mutate(dir)
  return { dir, out: join(root, 'out.elm'), cleanup: () => rm(root, { recursive: true, force: true }) }
}

const descriptor = (out: string): Record<string, unknown> => {
  const e = new AdmZip(out).getEntry('module.json')
  if (!e) throw new Error('module.json missing')
  return JSON.parse(e.getData().toString('utf8')) as Record<string, unknown>
}

describe('打包闸门：许可声明与许可证文件（P3）', () => {
  it('① 声明 MIT 但模块目录内无 LICENSE ⇒ 拒绝打包并点名文件', async () => {
    const f = await fixture(async (dir) => {
      await rm(join(dir, 'LICENSE'))
    })
    try {
      const res = await (await makeRig()).pack({ dir: f.dir, out: f.out, license: 'MIT' })
      expect(res.ok, '声明 MIT 却无 LICENSE 时不得打包成功').toBe(false)
      expect((res.errors ?? []).join(' ')).toMatch(/no license file/i)
    } finally {
      await f.cleanup()
    }
  })

  it('② UNLICENSED ⇒ 允许打包、免文件，且描述符记录 UNLICENSED', async () => {
    const f = await fixture(async (dir) => {
      await rm(join(dir, 'LICENSE'))
    })
    try {
      const res = await (await makeRig()).pack({ dir: f.dir, out: f.out, license: 'UNLICENSED' })
      expect(res.ok, 'UNLICENSED 应允许打包：' + (res.errors ?? []).join('；')).toBe(true)
      expect(descriptor(f.out).license).toBe('UNLICENSED')
    } finally {
      await f.cleanup()
    }
  })

  it('③ 非法标识符（含空格）⇒ 拒绝', async () => {
    const f = await fixture(async () => {})
    try {
      const res = await (await makeRig()).pack({ dir: f.dir, out: f.out, license: 'not a license' })
      expect(res.ok).toBe(false)
      expect((res.errors ?? []).join(' ')).toMatch(/invalid license identifier/i)
    } finally {
      await f.cleanup()
    }
  })

  it('④ 声明 MIT 且目录内有 LICENSE ⇒ 打包成功，描述符记录 MIT', async () => {
    const f = await fixture(async () => {})
    try {
      const res = await (await makeRig()).pack({ dir: f.dir, out: f.out, license: 'MIT' })
      expect(res.ok, '合规模块应能打包：' + (res.errors ?? []).join('；')).toBe(true)
      expect(descriptor(f.out).license).toBe('MIT')
    } finally {
      await f.cleanup()
    }
  })
})
