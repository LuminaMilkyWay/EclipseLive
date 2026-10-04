import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ★ **注入测试地基**（用户要求："最后测试实例需要注入测试"）。
 *
 * 被测对象是 VupCutCode 的**端口层**（`modules/vupcut/lib/ports.js`）—— 模块一切对外部世界的
 * 交互（ASR / FFmpeg / 云端 LLM / 时钟）都经它，因此可以在**不装模型、不联网、不跑真 FFmpeg、
 * 不等真实时长**的前提下，把整条链跑完。
 *
 * 两条不变式：
 *   ① **测试模式 = 假实现被注入**（并且"确实被调用"可断言 —— 假实现会记录调用）；
 *   ② **生产模式 = 云端与真 FFmpeg 不会被静默启用**（该抛错就抛错：网络门面为空、缺 proc 即拒）。
 *
 * 用动态 import 载入模块 JS：模块代码不参与 tsc 的两个项目（tsconfig 不含 modules/**），
 * 因此这里以运行时方式引入，避免类型系统与"模块是纯 JS"的现实冲突。
 */
const PORTS = pathToFileURL(resolve(process.cwd(), 'modules/vupcut/lib/ports.js')).href

type Ports = {
  asr: { transcribe: (p: string) => Promise<unknown[]> }
  ffmpeg: { run: (args: string[], opts?: { bin?: string }) => Promise<{ ok: boolean; code: number | null }> }
  llm: { complete: (p: string) => Promise<unknown> }
  clock: { now: () => number }
}

const load = async (): Promise<{
  createPorts: (a: { ctx: unknown; env: Record<string, string>; testCfg?: unknown }) => {
    mode: { enabled: boolean; fakes: Set<string>; fixtures: string }
    ports: Ports
  }
  resolveTestMode: (env: Record<string, string>, cfg?: unknown) => { enabled: boolean; fakes: Set<string> }
}> => (await import(PORTS)) as never

/** 最小 ctx 桩：只要有 logger 与（可选的）proc。 */
function stubCtx(withProc: boolean): unknown {
  const log = { debug() {}, info() {}, warn() {}, error() {}, child: () => log, setLevel() {} }
  return withProc ? { logger: log, proc: { spawn: async () => ({ pid: 1, kill: async () => {}, wait: async () => ({ ok: true, code: 0, timedOut: false }) }) } } : { logger: log }
}

/** 一个只有夹具的小目录（几 MB 都不到）。 */
function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vupcut-fix-'))
  writeFileSync(join(dir, 'asr.jsonl'), '{"start":0,"end":1.5,"text":"夹具台词"}\n', 'utf8')
  writeFileSync(join(dir, 'llm.json'), '{"clips":[{"start":0,"end":1.5,"score":90}]}', 'utf8')
  return dir
}

describe('VupCutCode 端口层：注入测试地基', () => {
  it('① 环境变量 VUPCUT_TEST + VUPCUT_FAKE ⇒ 假实现被注入', async () => {
    const { resolveTestMode } = await load()
    const mode = resolveTestMode({ VUPCUT_TEST: '1', VUPCUT_FAKE: 'asr,ffmpeg,llm' })
    expect(mode.enabled, 'VUPCUT_TEST=1 应开启测试模式').toBe(true)
    expect([...mode.fakes].sort(), '三个假实现都应被选中').toEqual(['asr', 'ffmpeg', 'llm'])
  })

  it('② 假 ASR / 假 LLM 读夹具、假 FFmpeg 只记录命令（不转码、不耗时）', async () => {
    const { createPorts } = await load()
    const fixtures = fixtureDir()
    const { mode, ports } = createPorts({
      ctx: stubCtx(true),
      env: { VUPCUT_TEST: '1', VUPCUT_FIXTURES: fixtures, VUPCUT_FAKE: 'asr,ffmpeg,llm' }
    })
    expect(mode.enabled).toBe(true)

    const lines = await ports.asr.transcribe('/fake/audio.wav')
    expect(lines, '假 ASR 应回放夹具内容').toEqual([{ start: 0, end: 1.5, text: '夹具台词' }])

    const r = await ports.ffmpeg.run(['-i', 'a.mp4', '-f', 'null', '-'])
    expect(r.ok, '假 FFmpeg 应报告成功').toBe(true)
    expect(r.code).toBe(0)

    const scored = (await ports.llm.complete('prompt')) as { clips: unknown[] }
    expect(scored.clips, '假 LLM 应回放夹具 JSON').toHaveLength(1)

    // 可控时钟：不打桩就"瞬间"推进，测试不必等真实时长
    expect(ports.clock.now(), '可控时钟起点为 0').toBe(0)
  })

  it('③ 生产模式：云端 LLM 与真 FFmpeg **不得被静默启用**', async () => {
    const { createPorts } = await load()
    // 无 proc ⇒ FFmpeg 必须拒绝（权限/注入闸门），而不是悄悄调用系统 ffmpeg
    const noProc = createPorts({ ctx: stubCtx(false), env: {} })
    await expect(noProc.ports.ffmpeg.run(['-version']), '缺少 proc 时必须抛错').rejects.toThrow(/proc|subprocess/)

    // 云端：核心网络门面当前被刻意留空（local-first 红线）⇒ 必须明确失败
    await expect(noProc.ports.llm.complete('x'), '云端能力默认不可用').rejects.toThrow(/云端能力未启用/)
    await expect(noProc.ports.asr.transcribe('/a.wav'), '本地 ASR 未接入前必须明确失败').rejects.toThrow(/尚未接入/)
  })

  it('④ 配置注入（便于在界面里手动跑夹具），且环境变量优先', async () => {
    const { createPorts } = await load()
    const byCfg = createPorts({ ctx: stubCtx(true), env: {}, testCfg: { enabled: true, fakeFfmpeg: true } })
    expect(byCfg.mode.enabled, '配置也可开启测试模式').toBe(true)
    expect([...byCfg.mode.fakes], '配置的 fakeFfmpeg 生效').toEqual(['ffmpeg'])

    const byEnv = createPorts({
      ctx: stubCtx(true),
      env: { VUPCUT_TEST: '1', VUPCUT_FAKE: 'asr' },
      testCfg: { enabled: false, fakeLlm: true }
    })
    expect([...byEnv.mode.fakes], '环境变量说了算（配置在测试模式下不再追加）').toEqual(['asr'])
  })
})
