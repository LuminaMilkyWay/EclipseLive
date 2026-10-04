import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULE_ID_PATTERN, MODULE_VERSION_PATTERN } from '@contracts/module'
import { PERMISSION_TYPES, isPermissionType } from '@contracts/permission'
import type { ModuleManifest } from '@contracts/module'

/**
 * M1 清单与自包含性检查。
 *
 * 重点：模块必须**自包含** —— 成品里模块在 `resources/modules/`（asar 之外），而
 * `node_modules` 在 `app.asar` 之内，Node 解析永远进不去，所以**任何 npm 依赖都会在
 * 成品中解析失败**。第三方库必须 vendor 进模块目录（本模块已 vendor `vtubestudio`）。
 */

const MODULE_DIR = resolve(process.cwd(), 'modules/vts-controlpad')

async function readManifest(): Promise<ModuleManifest> {
  return JSON.parse(await readFile(join(MODULE_DIR, 'manifest.json'), 'utf8')) as ModuleManifest
}

describe('M1 清单', () => {
  it('id 为 kebab-case 且等于目录名；版本为 x.y.z；entry 指向存在的文件', async () => {
    const m = await readManifest()
    expect(m.id).toBe('vts-controlpad')
    expect(MODULE_ID_PATTERN.test(m.id)).toBe(true)
    expect(MODULE_VERSION_PATTERN.test(m.version)).toBe(true)
    expect(m.entry).toBe('index.js')
    await expect(stat(join(MODULE_DIR, m.entry))).resolves.toBeTruthy()
  })

  it('权限闭集内且声明了 external-websocket（对外连接必需）', async () => {
    const m = await readManifest()
    expect(m.permissions).toContain('external-websocket')
    for (const p of m.permissions) {
      expect(isPermissionType(p), `${p} 必须在权限闭集内`).toBe(true)
      expect(PERMISSION_TYPES).toContain(p)
    }
  })

  it('权限随能力落地逐卡增加：M1 只加 external-websocket，M4 加 window-overlay + global-shortcut', async () => {
    const m = await readManifest()
    // M1 只声明对外连接；M4（悬浮窗 + 穿透全局快捷键）才追加后两项
    expect(m.permissions).toEqual(['external-websocket', 'window-overlay', 'global-shortcut'])
  })

  it('声明配置默认值（版本号 + 悬浮窗相关键）', async () => {
    const m = await readManifest()
    expect(m.config?.version).toBe(1)
    const d = m.config?.defaults ?? {}
    expect(d).toHaveProperty('float')
    // 已按用户要求移除：应用内另绑快捷键（M5）、每行固定列数（M8，改由宽度决定）
    expect(d).not.toHaveProperty('shortcuts')
    expect(d).not.toHaveProperty('gridColumns')
  })

  it('事件与通道均为本模块命名空间（不侵占其他模块）', async () => {
    const m = await readManifest()
    for (const e of m.events ?? []) expect(e.startsWith('vts-controlpad:')).toBe(true)
    for (const c of m.channels ?? []) expect(c).toBe('vts-controlpad')
  })

  it('自包含：vendor 的第三方库在位，且不含任何 npm 依赖声明', async () => {
    const m = await readManifest()
    expect(m.dependencies, '模块间依赖为空').toEqual([])
    // vendor 必须自带 LICENSE 与上游 package.json（红线 14：来源与许可可追溯）
    const vendored = join(MODULE_DIR, 'vendor/vtubestudio')
    await expect(stat(join(vendored, 'LICENSE'))).resolves.toBeTruthy()
    await expect(stat(join(vendored, 'package.json'))).resolves.toBeTruthy()
    await expect(stat(join(vendored, 'lib/index.js'))).resolves.toBeTruthy()
    const upstream = JSON.parse(await readFile(join(vendored, 'package.json'), 'utf8')) as {
      name: string
      version: string
      license: string
    }
    expect(upstream.name).toBe('vtubestudio')
    expect(upstream.license, '红线 14：许可必须明确且为宽松许可').toBe('MIT')
    expect(upstream.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('实现文件用 CJS 且只 require 相对路径或 node: 内置（成品中 npm 不可解析）', async () => {
    const files = ['index.js', 'lib/transport.js', 'lib/auth.js']
    for (const f of files) {
      const src = await readFile(join(MODULE_DIR, f), 'utf8')
      const requires = [...src.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((mm) => mm[2])
      for (const r of requires) {
        expect(
          r.startsWith('.') || r.startsWith('node:'),
          `${f} 里的 require('${r}') 必须是相对路径或 node: 内置`
        ).toBe(true)
      }
    }
  })
})
