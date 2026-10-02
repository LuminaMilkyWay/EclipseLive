'use strict'

/**
 * 热键归一化与"按钮类型"派生（纯函数，不依赖 socket / Electron，可直接单测）。
 *
 * ★ 任务卡修正（以 vendor 的 `HotkeyType` 枚举为据）
 * 任务卡把 `type` 描述为「触发式、开关式、按住式」，但 VTS 的 `HotkeyType` 是
 * **动作种类**（`TriggerAnimation=0`、`ChangeIdleAnimation=1`、`ToggleExpression=2`、
 * … `ToggleModelSound=22`，共 23 项）。因此：
 * - 按钮类型只有**两类**：`trigger`（触发式）与 `toggle`（开关式）；
 * - 开关式由**动作名以 `Toggle` 开头**派生 —— 不手写清单，上游新增 `Toggle*` 自动跟随；
 * - **「按住式」在 VTS 热键模型里不存在**，故不实现（不预留，见 AI_RULES 第 12 条）。
 * - 未知 / 缺失 / 畸形动作一律**兜底为触发式**，绝不抛。
 */

const { HotkeyType } = require('../vendor/vtubestudio/lib/types')

/** 开关式动作名的前缀。 */
const TOGGLE_PREFIX = 'Toggle'

/**
 * 动作种类 → 按钮类型。
 * @param {unknown} type `HotkeyType` 的名字（string）或数值码（number）
 * @returns {'trigger'|'toggle'}
 */
function hotkeyKind(type) {
  let name = type
  if (typeof type === 'number') name = HotkeyType[type]
  if (typeof name !== 'string' || name.length === 0) return 'trigger'
  return name.startsWith(TOGGLE_PREFIX) ? 'toggle' : 'trigger'
}

/**
 * 归一化 VTS 的 `availableHotkeys`。
 *
 * 容错策略（VTS 返回什么都不能把模块搞崩）：非数组→`[]`；条目非对象跳过；
 * 缺 `hotkeyID` 跳过；按 id 去重（先到先得）；`name` 缺失用 id 兜底；`description` 缺失用空串。
 * 顺序默认为 VTS 返回顺序（即模型里的顺序），再应用用户自定义顺序与隐藏。
 *
 * @param {unknown} raw `availableHotkeys`
 * @param {{hidden?: string[], order?: string[]}} [options]
 * @returns {Array<{id:string,name:string,kind:'trigger'|'toggle',type:string,description:string}>}
 *   用户明确要求：**不做任何快捷键相关的东西**（识别 VTS 的按键绑定、在应用里另绑快捷键都不做），
 *   虚拟按钮只用鼠标点击控制。故这里只保留按钮渲染与状态判断需要的字段。
 */
function normalizeHotkeys(raw, options) {
  if (!Array.isArray(raw)) return []

  const hidden = new Set(
    (options && Array.isArray(options.hidden) ? options.hidden : []).map((v) => String(v))
  )
  const order = options && Array.isArray(options.order) ? options.order.map((v) => String(v)) : []

  /** @type {Array<{id:string,name:string,kind:string,type:string,description:string}>} */
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.hotkeyID === 'string' ? item.hotkeyID.trim() : ''
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    const type = typeof item.type === 'string' ? item.type : ''
    out.push({
      id,
      name: typeof item.name === 'string' && item.name.length > 0 ? item.name : id,
      kind: hotkeyKind(type),
      type,
      description: typeof item.description === 'string' ? item.description : ''
    })
  }

  const visible = out.filter((h) => !hidden.has(h.id))
  if (order.length === 0) return visible

  const rank = new Map(order.map((id, i) => [id, i]))
  const listed = visible
    .filter((h) => rank.has(h.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  const rest = visible.filter((h) => !rank.has(h.id))
  return [...listed, ...rest]
}

module.exports = {
  hotkeyKind,
  normalizeHotkeys
}
