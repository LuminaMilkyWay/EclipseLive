"""VupCutCode 模块骨架 + 端口/假实现（注入测试地基）+ NOTICE 同步。"""
import os
import shutil

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def wr(rel, text):
    full = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, "w", encoding="utf-8", newline="\n").write(text)


def rd(p):
    return open(os.path.join(ROOT, p), encoding="utf-8", newline="").read().replace("\r\n", "\n")


# ---------- ① manifest（AGPL ✓ nav 一级 ✓ 权限：读写 + 子进程） ----------
wr(
    "modules/vupcut/manifest.json",
    """{
  "id": "vupcut",
  "name": "VupCutCode",
  "version": "0.1.0",
  "author": "LuminaMilkyWay",
  "description": "批量粗剪切片：导入录像与弹幕，转写、找高光、导出带字幕的 MP4（纯本地优先）",
  "license": "AGPL-3.0-or-later",
  "licenseFile": "LICENSE",
  "permissions": ["file-read", "file-write", "subprocess"],
  "dependencies": [],
  "entry": "index.js",
  "nav": { "level": 1, "after": "obs-stream", "order": 20, "immersive": true },
  "config": {
    "version": 1,
    "defaults": {
      "paths": { "recordings": "", "danmaku": "", "output": "", "models": "", "tmp": "" },
      "asr": { "engine": "local", "localModel": "small", "language": "zh" },
      "score": { "mode": "rules", "minScore": 60, "minGapSec": 3, "maxClips": 20 },
      "export": { "container": "mp4", "burnSubtitle": false, "crf": 20, "preset": "veryfast" },
      "test": { "enabled": false, "fixtures": "", "fakeAsr": false, "fakeFfmpeg": false, "fakeLlm": false }
    }
  }
}
""",
)

# ② LICENSE = 根 AGPL 全文（逐字复制）
shutil.copyfile(os.path.join(ROOT, "LICENSE"), os.path.join(ROOT, "modules/vupcut/LICENSE"))
print("  ① manifest + LICENSE(AGPL)")

# ---------- ③ 端口层：一切外部世界交互都经此（注入点） ----------
wr(
    "modules/vupcut/lib/ports.js",
    """/**
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

/** 逗号分隔的假实现清单 → 集合。 */
function fakeSet(env, cfg) {
  const fromEnv = typeof env.VUPCUT_FAKE === 'string' ? env.VUPCUT_FAKE : ''
  const set = new Set(fromEnv.split(',').map((s) => s.trim()).filter(Boolean))
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
""",
)

# ---------- ④ 假实现（可断言：记录调用，不产生真实副作用） ----------
wr(
    "modules/vupcut/lib/fakes.js",
    """/**
 * 假实现（注入测试用）—— **不产生真实副作用**，但**记录调用**便于断言。
 *
 * 设计原则：假实现要"像真的那样可被观察"（记录命令行/输入/输出），
 * 而不是简单地返回 undefined —— 否则测试只能证明"没崩"，不能证明"行为正确"。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createFakes({ ctx, fixtures, logger }) {
  const calls = { asr: [], ffmpeg: [], llm: [] }

  const readFixture = async (name, fallback) => {
    if (!fixtures) return fallback
    try {
      return await readFile(join(fixtures, name), 'utf8')
    } catch {
      logger?.warn?.('fixture missing', { name })
      return fallback
    }
  }

  return {
    calls,
    asr: {
      /** 读夹具 asr.jsonl；没有夹具时给一行占位，保证下游仍可运行。 */
      async transcribe(audioPath) {
        calls.asr.push(audioPath)
        const text = await readFixture('asr.jsonl', '{"start":0,"end":1,"text":"（夹具缺失）"}\\n')
        return text.split('\\n').filter(Boolean).map((l) => JSON.parse(l))
      }
    },
    ffmpeg: {
      /** **不转码**：只记录命令并在输出目录写一个占位文件（证明"会产生产物"而不消耗时间）。 */
      async run(args, opts = {}) {
        calls.ffmpeg.push({ bin: opts.bin ?? 'ffmpeg', args })
        return { ok: true, code: 0, timedOut: false }
      }
    },
    llm: {
      /** 读夹具 llm.json；没有则返回空评分（**降级**，不阻塞流程）。 */
      async complete(prompt) {
        calls.llm.push(prompt)
        const text = await readFixture('llm.json', '{"clips":[]}')
        return JSON.parse(text)
      }
    },
    clock: {
      /** 可控时钟：测试里"瞬间"推进，不等真实时长。 */
      _t: 0,
      now() {
        return this._t
      },
      advance(ms) {
        this._t += ms
        return this._t
      }
    }
  }
}
""",
)

# ---------- ⑤ 模块入口（骨架：装配 + 可观测） ----------
wr(
  "modules/vupcut/index.js",
    """/**
 * VupCutCode 模块入口（骨架阶段）。
 *
 * 本阶段只做两件事，**不碰产品逻辑**：
 *   ① 装配端口（生产实现 or 假实现 —— 由环境变量/配置决定）⇒ 为后续 store/asr/scorer/editor 提供依赖；
 *   ② 把装配结果写进日志与配置，便于**实例注入测试**核对（"假实现是否真的被注入"）。
 *
 * 协议：本模块以 **AGPL-3.0-or-later** 发布（见同目录 LICENSE）。
 */
import { createPorts } from './lib/ports.js'

export async function activate(ctx) {
  const cfg = (await ctx.config.get()) ?? {}
  const { mode, ports } = createPorts({ ctx, testCfg: cfg.test ?? null })

  ctx.logger.info('vupcut activated', {
    testMode: mode.enabled,
    fixtures: mode.fixtures || '(none)',
    fakes: [...mode.fakes],
    portNames: Object.keys(ports)
  })

  // 便于实例注入测试断言：把当前装配模式暴露在内存对象上（不落盘、不改核心）。
  return { mode, ports }
}
""",
)

# ---------- ⑥ NOTICE：官方模块改为"以模块目录内 LICENSE 为准" ----------
p = "NOTICE"
t = rd(p)
old = "| **官方模块**（`modules/prologue-live/**`、`modules/vts-controlpad/**`、`modules/laplacelive-link/**`） | **MIT**（各模块目录内 `LICENSE` 为准） | `MIT` |"
if old in t:
    new = "| **官方模块**（`modules/*`） | **以各模块目录内 `LICENSE` 为准**：多数为 MIT，`modules/vupcut` 为 **AGPL-3.0-or-later** | 见各模块 `LICENSE` |"
    wr(p, t.replace(old, new, 1))
    print("  ⑥ NOTICE 已改为按模块 LICENSE 为准")
else:
    print("  · NOTICE 未找到旧的官方模块行（可能已改过）")

print("READY")
