'use strict'

/**
 * PrologueType Live 队列引擎（纯逻辑，无定时器、无 ctx 依赖——可直接单测）。
 *
 * 职责：段落顺序播放的状态机。持有 recs（入队顺序）与每个段落的播放进度；
 * 播放节奏（typingSpeed 驱动的 tick）由调用方（入口）负责调度——本引擎
 * 是速度无关的，tick() 每次推进一个字。
 *
 * 撤销语义（M1 拍板，测试锁定）：撤销"最后入队"的段落——pending 段静默移除、
 * playing 段停止并移除、done 段从显示区移除。不撤销已播完段中间的内容。
 *
 * hooks（全部可选）：
 *  - onParagraphStart(rec)    段落开始播放（rec {id, text}，页面开始逐字）
 *  - onParagraphDone(rec)     段落逐字完成（下一段由引擎衔接启动）
 *  - onParagraphRemoved(rec)  段落被撤销移除（页面移除对应显示块）
 *  - onQueueChanged()         队列概要变化（pending/playing/paused）
 *  - onAllDone()              无可播放段落（playing 与 pending 均为空）
 */

function createQueueEngine(hooks = {}) {
  /** @type {Array<{id: string, text: string, state: 'pending'|'playing'|'done', progress: number}>} */
  const recs = []
  let paused = false
  let nextId = 1

  const emit = (name, rec) => {
    if (typeof hooks[name] === 'function') hooks[name](rec)
  }

  function summary() {
    let playing = null
    let pending = 0
    for (const r of recs) {
      if (r.state === 'playing') playing = r.id
      else if (r.state === 'pending') pending += 1
    }
    return { pending, playing, paused, total: recs.length }
  }

  function startNext() {
    const next = recs.find((r) => r.state === 'pending')
    if (!next) return false
    next.state = 'playing'
    emit('onParagraphStart', { id: next.id, text: next.text })
    emit('onQueueChanged')
    return true
  }

  return {
    /** 入队一段文本。暂停态下不自动开播（恢复后由 resume 衔接）。 */
    enqueue(text) {
      const rec = { id: String(nextId++), text, state: 'pending', progress: 0 }
      recs.push(rec)
      if (!paused && !recs.some((r) => r.state === 'playing')) startNext()
      emit('onQueueChanged')
    },

    /** 推进一个字。空闲/暂停返回 false；完成当前段后自动衔接下一段。 */
    tick() {
      if (paused) return false
      const cur = recs.find((r) => r.state === 'playing')
      if (!cur) return false
      cur.progress += 1
      if (cur.progress < cur.text.length) return true

      // 段落完成
      cur.state = 'done'
      emit('onParagraphDone', { id: cur.id, text: cur.text })
      const hasNext = startNext()
      if (hasNext) return true
      emit('onQueueChanged')
      emit('onAllDone')
      return true
    },

    pause() {
      paused = true
      emit('onQueueChanged')
    },

    resume() {
      paused = false
      if (!recs.some((r) => r.state === 'playing')) startNext()
      emit('onQueueChanged')
    },

    /** 撤销最后入队段落（pending 静默 / playing 停止 / done 移除）。 */
    undo() {
      const tail = recs[recs.length - 1]
      if (!tail) return
      recs.pop()
      if (tail.state !== 'pending') {
        emit('onParagraphRemoved', { id: tail.id, text: tail.text })
      }
      if (tail.state === 'playing' && !recs.some((r) => r.state === 'playing')) {
        const s = summary()
        if (s.pending === 0) emit('onAllDone')
      }
      emit('onQueueChanged')
    },

    /** 清空全部段落；paused 状态保留（清空 ≠ 取消暂停）。 */
    clear() {
      recs.length = 0
      emit('onQueueChanged')
    },

    summary,
    getPlaying() {
      const cur = recs.find((r) => r.state === 'playing')
      return cur ? { id: cur.id, text: cur.text } : null
    },
    /** 入队顺序的段落（仅 id/text，供撤销 id 回溯）。 */
    recs() {
      return recs.map((r) => ({ id: r.id, text: r.text }))
    }
  }
}

module.exports = { createQueueEngine }
