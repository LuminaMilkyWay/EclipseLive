import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_DISPLAY_VERSION, APP_NAME, formatAppVersion } from '@shared/appInfo'

/**
 * 品牌与版本展示守卫（用户 2026-09-30 指定，2026-10-02 升版 0.2.2）。
 *
 * 用户要求：安装包名字与软件内显示的产品名和版本号改为「EclipseLive 0.2.2-Corona」，
 * 代码版本与展示版本**同步升版**（`package.json.version` = `0.2.2-beta1`）。
 * 因此这里同时钉住两件事：① 展示值符合要求；② **两者前缀一致（防漂移）**。
 */
describe('shared/appInfo', () => {
  it('① 展示产品名为 EclipseLive', () => {
    expect(APP_NAME).toBe('EclipseLive')
  })

  it('② 展示版本为 0.2.2-Corona，且忽略传入的代码版本', () => {
    expect(APP_DISPLAY_VERSION).toBe('0.2.2-Corona')
    // 无论传什么代码版本，展示串都不变（避免升版时漏改某处）
    expect(formatAppVersion('0.2.2-beta1')).toBe('0.2.2-Corona')
    expect(formatAppVersion('9.9.9')).toBe('0.2.2-Corona')
  })

  it('③ 代码版本与展示版本同步升版（package.json.version = 0.2.2-beta1）', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      version: string
      build?: { artifactName?: string; nsis?: { artifactName?: string } }
    }
    expect(pkg.version, '代码版本应与展示版本同步（0.2.2 系列）').toBe('0.2.2-beta1')
    // 产物名按用户要求改为 EclipseLive 0.2.2-Corona（含版本前缀，便于多版本共存时区分）
    const artifacts = [pkg.build?.artifactName ?? '', pkg.build?.nsis?.artifactName ?? '']
    for (const a of artifacts) {
      expect(a, `产物名应含 EclipseLive 与 0.2.2：${a}`).toContain('EclipseLive')
      expect(a, `产物名应含版本前缀 0.2.2：${a}`).toContain('0.2.2')
    }
  })
})
  it('④ 窗口标题（index.html 的 <title>）必须等于展示名 + 展示版本（防漂移）', () => {
    const html = readFileSync(resolve(process.cwd(), 'src/renderer/index.html'), 'utf8')
    const m = /<title>([^<]*)<\/title>/.exec(html)
    expect(m, 'index.html 缺少 <title>').toBeTruthy()
    expect(m![1]).toBe(`${APP_NAME} ${APP_DISPLAY_VERSION}`)
  })
