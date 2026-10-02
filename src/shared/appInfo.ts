/**
 * 跨进程共享的应用常量与小工具。
 * 仅放无依赖的纯数据/纯函数，主进程与渲染层都可直接 import。
 */

export const APP_NAME = 'EclipseLive'

/**
 * **展示版本**（用户 2026-09-30 指定，2026-10-02 升至 0.2.2）：与"代码版本"解耦 ——
 * `package.json.version` 是 `0.2.2-beta1`（构建/更新/守卫都基于它），
 * 而界面与安装包展示的是本常量 `0.2.2-Corona`。
 */
export const APP_DISPLAY_VERSION = '0.2.2-Corona'

export interface AppInfo {
  name: string
  version: string
  platform: string
}

/**
 * 展示用的版本串。**忽略传入的代码版本**，统一返回展示版本（`0.2.2-Corona`）——
 * 这样界面无需知道"代码版本 ≠ 展示版本"，也不会在升版时漏改某处。
 * 参数保留是为了不改调用方签名（跨进程共用的公开函数）。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function formatAppVersion(_version: string): string {
  return APP_DISPLAY_VERSION
}
