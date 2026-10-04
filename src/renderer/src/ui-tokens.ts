/**
 * T33 模块页 UI 令牌（MODULE_UI_CONTRACT.md 的实现来源）：
 * 模块页运行在零 preload 的 WebContentsView 里，读不到宿主 CSS 变量——
 * 由宿主把「设计令牌当前解析值」单向注入模块页 :root。
 * 本白名单是注入内容的唯一来源：取值走 getComputedStyle 计算值，
 * 已含主题/强调色/材质三档/降级开关的当前生效结果（与设置二级菜单同源）。
 * 模块页一律只消费这些令牌，禁止自建主题令牌、禁止自创外观。
 */

/** 注入白名单：模块页镜像「设置二级菜单」外观所需的最小令牌集。 */
export const MODULE_PAGE_TOKEN_NAMES = [
  // 尺寸层
  '--r-sm', '--r-md', '--r-lg', '--r-xl',
  '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7',
  '--fs-scale',
  // 主题层
  '--txt-1', '--txt-2', '--txt-3', '--txt-link',
  '--bg-0', '--bg-1', '--bg-card', '--bg-card-2', '--bg-overlay',
  '--line', '--line-strong',
  '--ok', '--ok-line', '--bad', '--bad-line', '--warn', '--warn-line',
  // 强调色层
  '--acc', '--acc-soft', '--acc-line', '--acc-fill', '--ink-on-acc',
  // 材质层（档 1/2/3 与「减少透明度」降级的当前生效值；--mat-refract/--mat-scene-op/
  // --mat-disperse 属宿主场景层专用，模块页 .card 配方不消费，不注入。
  // --mat-veil 已退休：整面平面渐变会把卡片糊成灰膜，不再对外暴露）
  '--mat-blur', '--mat-sat', '--mat-alpha', '--mat-alpha-role',
  '--mat-edge-light', '--mat-edge-thick', '--mat-border',
  '--mat-glow',
  '--mat-shadow-1', '--mat-shadow-2',
  // ★ 标准材质（内容层，T36）：模块页属内容层，用这套（无 backdrop-filter）；
  // 玻璃光学只留给宿主 chrome，故模块页不再消费 --card-bg / --mat-blur。
  '--std-bg', '--std-border', '--std-shadow-1', '--std-shadow-2',
  // ★ `--card-bg`：分组卡片的**大面玻璃底**（= --bg-card × --mat-alpha-role）。
  // MODULE_UI_CONTRACT §2/§7 的强制配方就写着 `var(--card-bg)`，
  // 但此前漏在白名单外 ⇒ 按文档写的模块页拿到的是空值、卡片底色丢失。
  '--card-bg'
] as const

/** 读取宿主根节点当前解析值（getComputedStyle），供模块页令牌推送。 */
export function collectUiTokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const name of MODULE_PAGE_TOKEN_NAMES) {
    const value = cs.getPropertyValue(name).trim()
    if (value) out[name] = value
  }
  return out
}
