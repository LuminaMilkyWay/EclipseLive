/**
 * 端口层（依赖倒置）—— VupCutCode 的**注入测试地基**。
 *
 * 为什么要有这一层：模块的外部世界有四类不确定来源 ——
 *   ① ASR（本地模型或云端）、② FFmpeg（本机可执行文件）、③ 云端 LLM（网络+密钥）、④ 时钟/文件系统。
 * 把它们全部收成"端口"之后，测试可以整体替换为**假实现**，于是：
 *   · 不需要模型、不需要网络、不需要真 FFmpeg、不需要等真实时长；
 *   · 整条链可以在几 MB 的夹具上跑完（这正是用户要求的"实例注入测试"的物质基础）。
 *
 * 注入途径（**不改核心、不加核心测试通道**）：
 *   1. 环境变量（最高优先级，测试专用）：VUPCUT_TEST / VUPCUT_FIXTURES / VUPCUT_FAKE
 *   2. 模块配置 `test.*`（默认关，便于手动在界面里跑夹具）
 */
import { createFakes } from './fakes.js'

/**
 * 假实现清单 → 集合。
 *
 * **优先级语义（刻意如此）**：
 *   · 环境变量 `VUPCUT_FAKE` 存在 ⇒ **只认它**（测试夹具必须可复现：一份陈旧的配置
 *     不得往测试运行里掺入额外假实现，否则断言会随机器状态漂移）；
 *   · 否则才看配置 `test.fake*`（用户手动在界面里跑夹具时用）。
 */
function fakeSet(env, cfg) {
  const fromEnv = typeof env.VUPCUT_FAKE === 'string' ? env.VUPCUT_FAKE.trim() : ''
  if (fromEnv !== '') {
    return new Set(fromEnv.split(',').map((s) => s.trim()).filter(Boolean))
  }
  const set = new Set()
  if (cfg?.fakeAsr) set.add('asr')
  if (cfg?.fakeFfmpeg) set.add('ffmpeg')
  if (cfg?.fakeLlm) set.add('llm')
  return set
}

/** 测试模式是否开启（环境变量优先于配置）。 */
export function resolveTestMode(env, testCfg) {
  const byEnv = env.VUPCUT_TEST === '1' || env.VUPCUT_TEST === 'true'
  const fixtures = (typeof env.VUPCUT_FIXTURES === 'string' && env.VUPCUT_FIXTURES) || testCfg?.fixtures || ''
  const enabled = byEnv || testCfg?.enabled === true
  return { enabled, fixtures, fakes: fakeSet(env, enabled ? testCfg : null) }
}

/**
 * 建立端口集合。生产走真实实现，测试走假实现（按 fakes 集合逐项替换）。
 * @param {{ ctx: object, env?: object, testCfg?: object }} args
 */
export function createPorts({ ctx, env = process.env, testCfg = null }) {
  const mode = resolveTestMode(env, testCfg)
  const fakes = createFakes({ ctx, fixtures: mode.fixtures, logger: ctx.logger })

  const real = {
    /** ASR：本地 Whisper 走受管子进程（C1）；云端在 C2 落地前不可用。 */
    asr: {
      async transcribe(audioPath) {
        throw new Error('本地 ASR 引擎尚未接入（骨架阶段）：' + audioPath)
      }
    },
    /** FFmpeg：必须经 ctx.proc（受管 ⇒ 模块停用/卸载即结束，无孤儿）。 */
    ffmpeg: {
      async run(args, opts = {}) {
        if (!ctx.proc) throw new Error('缺少 subprocess 权限或核心未注入 proc 服务')
        const h = await ctx.proc.spawn({ cmd: opts.bin ?? 'ffmpeg', args, timeoutMs: opts.timeoutMs })
        return h.wait()
      }
    },
    /** 云端 LLM：**默认不可用** —— 核心的网络门面当前被刻意留空（local-first 红线）。 */
    llm: {
      async complete() {
        throw new Error('云端能力未启用：核心网络门面为空（local-first 红线）')
      }
    },
    clock: { now: () => Date.now() }
  }

  return {
    mode,
    ports: {
      asr: mode.fakes.has('asr') ? fakes.asr : real.asr,
      ffmpeg: mode.fakes.has('ffmpeg') ? fakes.ffmpeg : real.ffmpeg,
      llm: mode.fakes.has('llm') ? fakes.llm : real.llm,
      clock: mode.enabled ? fakes.clock : real.clock
    }
  }
}
