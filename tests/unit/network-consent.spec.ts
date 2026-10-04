import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ③c-2c 守卫：**核心的联网同意来源**必须接对（用户 Q1 的语义：页面只做 UI、核心做闸门）。
 *
 * 为什么用源码断言：这一段是**装配根**（Electron 主进程入口），单测无法直接启动它；
 * 但"同意来源接错"会导致两种危险后果 —— 要么**永远联不上**（功能死掉），
 * 要么**默认放行**（越过 local-first 红线）。两者都必须由守卫钉住。
 *
 * 参考：配置存储 `IConfig` 按 moduleId 索引（`get<T>(moduleId)`）⇒ 核心可直接读该段，
 * 而模块只能写**自己**的段 ⇒ 不需要新增任何契约面。
 */
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('③c-2c 核心装配：联网同意来源', () => {
  const main = read('src/main/index.ts')

  it('① 同意来源必须是 VupCut 配置段的 network.enabled，且**默认拒绝**', () => {
    expect(main, '必须读 vupcut 配置段').toMatch(/config\.get<[^>]*>\('vupcut'\)/)
    expect(main, 'enabled 必须严格等于 true 才算同意').toMatch(/enabled:\s*v\?\.network\?\.enabled === true/)
    expect(main, '必须把同意接到网络服务').toMatch(/isEnabled:\s*\(\)\s*=>\s*netConsent\(\)\.enabled/)
    expect(main, '自建网关的主机也要能加').toMatch(/extraHosts:\s*\(\)\s*=>\s*netConsent\(\)\.hosts/)
  })

  it('② 网络服务必须在 createModules **之前**创建并注入（否则模块拿不到门面）', () => {
    const iNet = main.indexOf('const network = createNetworkClient')
    const iModules = main.indexOf('const modules = createModules(')
    expect(iNet, '应能定位到网络服务创建').toBeGreaterThan(-1)
    expect(iModules).toBeGreaterThan(-1)
    expect(iNet, '网络服务必须先于 createModules（模块加载时要注入 ctx.network）').toBeLessThan(iModules)
    expect(main, '必须把 network 传给 createModules').toMatch(/createModules\(\{[\s\S]{0,400}?\bnetwork,/)
  })

  it('③ 旧的空实现创建必须已移除（不能有第二个 createNetworkClient 覆盖）', () => {
    const count = (main.match(/createNetworkClient\(/g) ?? []).length
    expect(count, '装配根只应创建一次网络客户端').toBe(1)
  })

  it('④ 默认关：配置里没有该段/字段时不得视为同意', () => {
    // 直接跑一遍与装配根同构的读取逻辑（把危险默认值钉在测试里）
    const readConsent = (v: unknown): boolean =>
      (v as { network?: { enabled?: boolean } } | undefined)?.network?.enabled === true
    expect(readConsent(undefined), '没有配置段 ⇒ 不同意').toBe(false)
    expect(readConsent({}), '没有字段 ⇒ 不同意').toBe(false)
    expect(readConsent({ network: {} })).toBe(false)
    expect(readConsent({ network: { enabled: 'true' } as unknown as { enabled: boolean } }), '字符串 true 不算同意').toBe(false)
    expect(readConsent({ network: { enabled: true } }), '只有布尔 true 才算').toBe(true)
  })
})
