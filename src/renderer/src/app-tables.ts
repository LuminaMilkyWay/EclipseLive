/**
 * 应用级类型与常量（自 App.tsx 拆出；纯搬运，逻辑与顺序未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 5 轮（常量表）。
 * 原 App.tsx 行号：46-58。
 */

/**
 * 固定页 + T31 动态模块页（`page:<moduleId>`）+ 第三方工具视图（`tool:<moduleId>`，
 * T37：工具打开不再盖住诊断/设置页——由 tab 显式驱动，保活隐藏切换）。
 */
export type Tab = 'obs' | 'diagnostics' | 'settings' | 'changelog' | `page:${string}` | `tool:${string}`

export const isPageTab = (tab: Tab): tab is `page:${string}` => tab.startsWith('page:')
export const pageTabModuleId = (tab: Tab): string => tab.slice('page:'.length)
export const isToolTab = (tab: Tab): tab is `tool:${string}` => tab.startsWith('tool:')
export const toolTabModuleId = (tab: Tab): string => tab.slice('tool:'.length)

/** T18 测试缝：main 在 EL_TEST_SKIP_TITLE 下加载 URL 带 skip-title=1，直接进主界面。 */
export const SKIP_TITLE = new URLSearchParams(window.location.search).has('skip-title')
