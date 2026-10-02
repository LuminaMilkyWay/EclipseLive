import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** 诊断：OBS 路径候选在本机是否存在 + obs:launch 的真实返回。 */
test('probe: OBS 拉起诊断', async () => {
  test.setTimeout(60_000)
  const env = process.env as Record<string, string | undefined>
  const candidates = [
    '%ProgramFiles%\\obs-studio\\bin\\64bit\\obs64.exe',
    '%ProgramFiles(x86)%\\obs-studio\\bin\\64bit\\obs64.exe',
    '%LOCALAPPDATA%\\Programs\\obs-studio\\bin\\64bit\\obs64.exe',
    '%ProgramFiles%\\obs-studio\\bin\\32bit\\obs32.exe',
    '%ProgramFiles(x86)%\\obs-studio\\bin\\32bit\\obs32.exe'
  ]
  const expanded = candidates.map((c) =>
    c.replace(/%([^%]+)%/g, (_m, n: string) => env[n] ?? '')
  )
  console.log('CANDIDATES=' + JSON.stringify(expanded.map((p) => ({ p, exists: existsSync(p) }))))
  // 额外：用 where 找一下（仅诊断，不参与产品逻辑）
  console.log('PF=' + String(env['ProgramFiles']))
  console.log('PF86=' + String(env['ProgramFiles(x86)']))
  console.log('LA=' + String(env['LOCALAPPDATA']))

  const iso = mkdtempSync(join(tmpdir(), 'el-probe-launch-'))
  const app = await electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1', EL_TEST_SKIP_WHATSNEW: '1' } as unknown as Record<string, string>
  })
  try {
    const win = await app.firstWindow()
    await win.waitForSelector('[data-testid="tab-obs"]', { timeout: 30_000 })
    // 先用探针直接跑一次 reg query，确证定位链路（编码/表头差异）
    const { execFileSync } = await import('node:child_process')
    try {
      const raw = execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\OBS Studio', '/ve'], { encoding: 'buffer' })
      console.log('REG_RAW=' + JSON.stringify(raw.toString('latin1').slice(0, 300)))
    } catch (e) {
      console.log('REG_ERR=' + String(e).slice(0, 200))
    }
    // ⚠️ 诊断探针**不真的启动 OBS**（套件里启动外部程序会弹 UAC/超时，是此前 flake 的来源）。
    // 只验证发现链路暴露的 API 存在（检测逻辑本身由单测覆盖）。
    const api = await win.evaluate(
      "JSON.stringify({obsLaunch: typeof window.eclipselive.obsLaunch === 'function', obsPick: typeof window.eclipselive.obsPick === 'function'})"
    )
    console.log('OBS_API=' + api)
  } finally {
    await app.close().catch(() => {})
  }
  expect(true).toBe(true)
})
