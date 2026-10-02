import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * P4 守卫：SDK 必须带 **mock-host**（模块作者的离线开发环境）。
 *
 * 为什么值得一条守卫：mock-host 是"生态摩擦力"的关键 —— 没有它，作者必须先装宿主、
 * 装模块、开 OBS 才能看到第一行输出 ⇒ 绝大多数人到这里就放弃了。
 * 因此这里钉住：文件存在、**假 ctx 覆盖 contracts 里的关键面**、且**明确声明它不是宿主**
 * （避免作者误以为 mock 通过就等于验收通过）。
 */
const ROOT = resolve(process.cwd())
const HOST = resolve(ROOT, 'sdk/mock-host/index.mjs')
const readme = () => readFileSync(resolve(ROOT, 'sdk/mock-host/README.md'), 'utf8')

describe('SDK mock-host（P4）', () => {
  it('① 存在 mock-host 与其说明', () => {
    expect(existsSync(HOST), '缺 sdk/mock-host/index.mjs').toBe(true)
    expect(existsSync(resolve(ROOT, 'sdk/mock-host/README.md')), '缺 mock-host README').toBe(true)
  })

  it('② 假 ctx 覆盖契约关键面（logger/config/bus/permissions/gateway/overlays）', () => {
    const src = readFileSync(HOST, 'utf8')
    for (const key of ['logger', 'config', 'bus', 'permissions', 'gateway', 'overlays']) {
      expect(src, `假 ctx 缺 ${key}（应与 sdk/contracts 的形状对齐）`).toContain(`${key}:`)
    }
    expect(src, '应能加载模块入口并调用 activate').toContain('activate')
    expect(src, '应起本地静态服务便于调 UI').toContain('createServer')
  })

  it('③ 必须声明"它不是宿主"（防止把 mock 通过当成验收通过）', () => {
    expect(readFileSync(HOST, 'utf8')).toMatch(/不是.*宿主|not.*host/i)
    expect(readme(), 'README 必须写明它不是宿主、正式验收在宿主内').toMatch(/不是宿主/)
  })

  it('④ SDK README 必须指向 mock-host（否则作者找不到入口）', () => {
    expect(readFileSync(resolve(ROOT, 'sdk/README.md'), 'utf8')).toContain('mock-host')
  })
})
