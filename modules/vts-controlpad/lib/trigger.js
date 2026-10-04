'use strict'

/**
 * 触发结果归类与开关态推进（纯函数，可直接单测）。
 *
 * 错误码一律取自 **vendor 的 `ErrorCode` 枚举**（不手写数字），且**逐处写全
 * `ErrorCode.X`**（不引入 `const E = ErrorCode` 之类的别名）——`tests/m5-trigger.spec.ts`
 * 里有一条机械检查会扫描本文件的 `ErrorCode.X` 引用并与 vendor 枚举比对，
 * 用别名会让该检查失效（曾经真的因此漏过拼写漂移）。
 *
 * 需求里的"5 帧冷却"与"队列上限 32"在 API 层有**精确对应**：
 * - `HotkeyCooldownNotOver` —— 冷却未结束
 * - `HotkeyQueueFull`       —— 触发队列已满
 * 两者都**不是失败**，而是节流：UI 应提示"稍候"，既不谎报成功也不当作错误吓用户。
 *
 * 与 `lib/auth.js` 同样的输入守卫：不带 `errorID` 的普通错误绝不能落入枚举比较
 * （否则成员名拼写漂移时 `undefined === undefined` 会静默命中）。
 */

const { ErrorCode } = require('../vendor/vtubestudio/lib/types')

/** 触发结果分类（页面据此选择提示样式）。 */
const TRIGGER_RESULT = {
  /** 已送达 VTS */
  OK: 'ok',
  /** 冷却中（5 帧），稍候即可 */
  COOLDOWN: 'cooldown',
  /** 队列满（32 深），稍候即可 */
  QUEUE_FULL: 'queue-full',
  /** 该热键在当前模型中已不存在（多半是换了模型）→ 需刷新列表 */
  STALE: 'stale',
  /** VTS 尚未加载模型 */
  NO_MODEL: 'no-model',
  /** 其他执行失败 */
  FAILED: 'failed'
}

/**
 * VTS 错误码 → 用户能照做的提示。
 * @param {unknown} errorID `VTubeStudioError.data.errorID`
 * @returns {{result: string, message: string, refresh?: boolean}}
 */
function describeTriggerError(errorID) {
  if (typeof errorID !== 'number' || !Number.isFinite(errorID)) {
    return { result: TRIGGER_RESULT.FAILED, message: '' }
  }
  if (errorID === ErrorCode.HotkeyCooldownNotOver) {
    return {
      result: TRIGGER_RESULT.COOLDOWN,
      message: 'VTube Studio 冷却中（约 5 帧内只接受一次），请稍候再点'
    }
  }
  if (errorID === ErrorCode.HotkeyQueueFull) {
    return {
      result: TRIGGER_RESULT.QUEUE_FULL,
      message: '触发过快，VTube Studio 的触发队列已满，请稍候'
    }
  }
  if (errorID === ErrorCode.HotkeyIDNotFoundInModel) {
    return {
      result: TRIGGER_RESULT.STALE,
      message: '该热键在当前模型中已不存在（可能换了模型），已尝试刷新列表',
      refresh: true
    }
  }
  if (errorID === ErrorCode.HotkeyExecutionFailedBecauseNoModelLoaded) {
    return { result: TRIGGER_RESULT.NO_MODEL, message: 'VTube Studio 尚未加载模型' }
  }
  if (errorID === ErrorCode.HotkeyExecutionFailedBecauseBadState) {
    return { result: TRIGGER_RESULT.FAILED, message: '当前状态下该热键无法执行' }
  }
  if (errorID === ErrorCode.HotkeyExecutionFailedBecauseLive2DItemNotFound) {
    return { result: TRIGGER_RESULT.FAILED, message: '该热键依赖的道具当前不存在' }
  }
  if (errorID === ErrorCode.HotkeyExecutionFailedBecauseLive2DItemsDoNotSupportThisHotkeyType) {
    return { result: TRIGGER_RESULT.FAILED, message: '道具类热键不支持这种动作' }
  }
  if (errorID === ErrorCode.HotkeyIDFoundButHotkeyDataInvalid) {
    return { result: TRIGGER_RESULT.FAILED, message: '该热键的数据无效，请在 VTube Studio 中检查' }
  }
  if (errorID === ErrorCode.HotkeyUnknownExecutionFailure) {
    return { result: TRIGGER_RESULT.FAILED, message: 'VTube Studio 报告未知的执行失败' }
  }
  return { result: TRIGGER_RESULT.FAILED, message: '' }
}

/**
 * 开关态推进：**只由事件驱动**，不做乐观猜测。
 *
 * 未收到任何事件前状态是"未知"（缺省），首次事件即视为"开"——
 * VTS 只在热键真正执行时推事件，而事件不携带"执行后是开还是关"，
 * 故以"切换"语义推进：每次执行翻转一次。
 *
 * @param {string|undefined} prev 当前状态（`'on'` / `'off'` / 缺省=未知）
 * @returns {'on'|'off'}
 */
function nextToggleState(prev) {
  return prev === 'on' ? 'off' : 'on'
}

module.exports = { describeTriggerError, nextToggleState, TRIGGER_RESULT }
