import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 打包配置守卫。
 *
 * 锁定 2026-09-28 排障后的关键设置——这些项一旦被改回去，会出现"安装包在部分机器上装不上"
 * 这类**只在用户侧暴露**的问题（详见 docs/BUILD.md §8）。
 */
interface BuildConfig {
  artifactName?: string
  extraResources?: Array<{ from: string; to: string }>
  win?: { target?: Array<string | { target: string; arch?: string[] }> }
  nsis?: {
    oneClick?: boolean
    perMachine?: boolean
    allowElevation?: boolean
    allowToChangeInstallationDirectory?: boolean
    artifactName?: string
  }
}

async function loadBuild(): Promise<{ version: string; build: BuildConfig }> {
  const raw = await readFile(resolve(__dirname, '../../package.json'), 'utf8')
  return JSON.parse(raw) as { version: string; build: BuildConfig }
}

/** 目标可以是字符串，也可以是 { target, arch } 对象。 */
function targetNames(build: BuildConfig): string[] {
  return (build.win?.target ?? []).map((t) => (typeof t === 'string' ? t : t.target))
}

describe('打包配置（package.json → build）', () => {
  it('NSIS 必须是纯 per-user 且不请求提权（避免提权后身份/TEMP 不一致导致装不上）', async () => {
    const { build } = await loadBuild()
    expect(build.nsis, '缺少 nsis 配置').toBeTruthy()
    // perMachine: false → 装到 %LOCALAPPDATA%\Programs，不需要管理员
    expect(build.nsis!.perMachine, 'perMachine 必须显式为 false').toBe(false)
    // allowElevation: false → 永不弹 UAC；提权进程的 %TEMP% 可能对当前用户不可写，
    // 会直接表现为 NSIS "Error writing temporary file"
    expect(build.nsis!.allowElevation, 'allowElevation 必须显式为 false').toBe(false)
  })

  it('必须同时产出安装包与 zip 免安装包（zip 不依赖临时目录，是排障保底路径）', async () => {
    const { build } = await loadBuild()
    const names = targetNames(build)
    expect(names, '缺少 nsis 目标').toContain('nsis')
    expect(names, '缺少 zip 目标：安装器依赖 %TEMP% 解包，必须保留免安装路径').toContain('zip')
    for (const t of build.win?.target ?? []) {
      if (typeof t !== 'string') {
        expect(t.arch, `${t.target} 应为 x64`).toEqual(['x64'])
      }
    }
  })

  it('模块必须以 extraResources 复制到 resources/modules（供主进程直接读取）', async () => {
    const { build } = await loadBuild()
    const entry = (build.extraResources ?? []).find((e) => e.from === 'modules')
    expect(entry, '缺少 modules 的 extraResources 条目').toBeTruthy()
    expect(entry!.to, '模块必须落在 resources/modules').toBe('modules')
  })

  it('T34：CHANGELOG.md 必须随包分发（否则应用内更新日志永远为空）', async () => {
    const { build } = await loadBuild()
    const entry = (build.extraResources ?? []).find((e) => e.from === 'CHANGELOG.md', 'RELEASE_NOTES.md')
    expect(entry, '缺少 CHANGELOG.md 的 extraResources 条目：应用内更新日志会读不到内容').toBeTruthy()
    expect(entry!.to, 'CHANGELOG.md 必须落在 resources 根（与主进程读取路径一致）').toBe(
      'CHANGELOG.md'
    )
  })

  it('产物名必须含版本标记（多版本共存时可区分）', async () => {
    const { build } = await loadBuild()
    // 用户要求：产物名改为「EclipseLive 0.2.2-Corona」⇒ 版本是**字面量**而不是 ${version}；
    // 因此判据放宽为"含版本标记"：要么用 ${version} 模板，要么写出与代码版本同源的版本号前缀。
    const codeVersion = (
      JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }
    ).version
    const prefix = codeVersion.split('-')[0] // 0.2.2-beta1 -> 0.2.2
    for (const [label, name] of [
      ['nsis', build.nsis?.artifactName ?? ''],
      ['顶层（zip 用）', build.artifactName ?? '']
    ] as const) {
      const ok = name.includes('${version}') || name.includes(prefix)
      expect(ok, `${label} 产物名应含版本标记（\${version} 或 ${prefix}）：${name}`).toBe(true)
      expect(name, `${label} 产物名应含产品名 EclipseLive`).toContain('EclipseLive')
    }
  })
})
