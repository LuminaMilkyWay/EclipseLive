import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { needsPasswordFromError, OBS_NEEDS_PASSWORD_HINT } from '../../src/renderer/src/obs-error'

/**
 * 方案 C 守卫：**报错处即可修** —— OBS 要求密码时，直播中控就地给出输入框。
 *
 * 背景：密码原本只能在「设置 → 连接」改，而报错出现在直播中控 ⇒ 用户卡在"错在这里、修在那里"。
 * 方案 C 不搬家、只**按需出现**：设置页仍是权威位置，直播中控仅在需要时显示输入，
 * 且写入**同一个凭据库**（`obs:password`，不落明文），保存走既有的 `setObsConfig`。
 */
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('OBS 缺密码时的就地补救（方案 C）', () => {
  it('① 原始错误能识别出"需要密码"，并翻译成不掺内部键名的人话', () => {
    const raw = 'OBS requires a password but none is configured'
    expect(needsPasswordFromError(raw), '应识别为缺密码').toBe(true)
    expect(needsPasswordFromError('not connected'), '普通失败不应误判').toBe(false)
    expect(needsPasswordFromError(undefined), '无错误时不应误判').toBe(false)
    expect(OBS_NEEDS_PASSWORD_HINT, '提示里不得出现内部键名').not.toMatch(/obs:password|core\.obs/)
    // friendlyError 用 window（属渲染层）⇒ 测试项目没有 DOM ⇒ 以源码断言覆盖其行为
    const hook = read('src/renderer/src/hooks/useObsStream.ts')
    expect(hook, 'friendlyError 必须优先处理缺密码').toMatch(/if \(needsPasswordFromError\(raw\)\) return OBS_NEEDS_PASSWORD_HINT/)
    expect(hook, '不得把内部键名暴露给用户').not.toMatch(/obs:password credential/)
    // 血泪教训：上一版代码正确却**永不触发** —— 渲染层拿不到主进程的连接错误。
    // 这里钉住"信号接线"：refresh 必须读诊断快照的 obs.lastError。
    expect(hook, 'refresh 必须读诊断快照才算接通信号').toContain('eclipselive.diagnostics()')
    // 时序陷阱：主进程连接失败是**重试后**才产生的 ⇒ 只在挂载时刷新会永远错过信号。
    expect(hook, '未连接时必须定期复查，否则错过缺密码信号').toContain('setInterval')
    expect(hook, '必须用 obs.lastError 判定缺密码').toMatch(/obs\?\.lastError|obs\.lastError/)
  })

  it('② 直播中控使用 password 类型输入，且**仅在需要时渲染**（不常驻）', () => {
    const page = read('src/renderer/src/screens/ObsStreamPage.tsx')
    expect(page, '必须是 password 类型（不回显明文）').toMatch(/type="password"/)
    expect(page, '必须按条件渲染，不得常驻直播操作页').toContain('obs.needsPassword &&')
    expect(page, '保存后必须清空输入').toMatch(/setObsPw\(''\)/)
    expect(page, '应复用既有的 setObsConfig（不新增通道）').toContain('setObsConfig')
    expect(page, '应告诉用户设置页也能改').toContain('设置 → 连接')
  })

  it('③ 主进程错误文案不得含内部键名', () => {
    expect(read('src/main/core/obs/index.ts'), '主进程错误里不应出现内部键名').not.toContain(
      '(obs:password credential or core.obs.password)'
    )
  })
})
