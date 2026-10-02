'use strict'

/**
 * 认证状态与错误归类（纯函数，可直接单测，不依赖 socket）。
 *
 * 错误码一律取自 **vendor 的 `ErrorCode` 枚举**，不手写数字：上游增删枚举时这里自动跟随，
 * 也避免"猜码"。
 */

const { ErrorCode } = require('../vendor/vtubestudio/lib/types')

/**
 * 模块对外状态（经 `vts-controlpad:state-changed` 广播，也是模块页的渲染依据）。
 *
 * `UNREACHABLE`（VTS 未运行或 API 未开启）与 `DENIED`（用户在 VTS 里拒绝）必须区分：
 * 前者要用户去启动/开 API，后者要用户重新点"允许"。
 */
const STATUS = {
  /** 尚未开始（模块未启动） */
  IDLE: 'idle',
  /** 已发起连接，等握手 */
  CONNECTING: 'connecting',
  /** 已连上，等用户在 VTS 界面点「允许」 */
  AWAITING_APPROVAL: 'awaiting-approval',
  /** 已认证，可用 */
  AUTHENTICATED: 'authenticated',
  /** VTS 未运行 / API 未开启 / 连接被拒 */
  UNREACHABLE: 'unreachable',
  /** 用户拒绝授权 */
  DENIED: 'denied',
  /** 其他失败（含协议错误） */
  FAILED: 'failed'
}

/**
 * 认证类错误归类。
 *
 * @param {unknown} errorID VTS 的 `data.errorID`
 * @returns {'token-invalid'|'denied'|'pending'|'other'}
 *   - `token-invalid`：token 失效/缺失 → 需重新授权
 *   - `denied`：用户在 VTS 界面拒绝
 *   - `pending`：VTS 侧已有一次授权请求在进行中（用户还没点）
 *   - `other`：其余（含不带 errorID 的普通错误）
 *
 * **必须先守卫输入**：普通 `Error`（如库抛的 "Authentication with VTube Studio
 * failed: …"）没有 `data.errorID`。若不做守卫而直接与枚举成员比较，一旦某个成员名
 * 在 vendor 里不存在（值为 `undefined`），`undefined === undefined` 就会**意外命中**，
 * 把"用户拒绝"误判成"token 失效"——这个 bug 真实发生过（成员名抄错），
 * 故除守卫外还有 `tests/m3-auth.spec.ts` 的机械检查：本文件引用的每个
 * `ErrorCode.X` 都必须真实存在于 vendor 枚举。
 */
function classifyAuthError(errorID) {
  if (typeof errorID !== 'number' || !Number.isFinite(errorID)) return 'other'
  if (errorID === ErrorCode.AuthenticationTokenMissing) return 'token-invalid'
  if (errorID === ErrorCode.AuthenticationPluginNameMissing) return 'token-invalid'
  // 上游枚举拼写如此（Authetication），按原样引用，勿"修正"以免取不到值
  if (errorID === ErrorCode.RequestRequiresAuthetication) return 'token-invalid'
  if (errorID === ErrorCode.TokenRequestDenied) return 'denied'
  if (errorID === ErrorCode.TokenRequestCurrentlyOngoing) return 'pending'
  return 'other'
}

module.exports = { STATUS, classifyAuthError }
