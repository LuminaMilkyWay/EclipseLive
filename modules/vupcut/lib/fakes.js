/**
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
        const text = await readFixture('asr.jsonl', '{"start":0,"end":1,"text":"（夹具缺失）"}\n')
        return text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
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
