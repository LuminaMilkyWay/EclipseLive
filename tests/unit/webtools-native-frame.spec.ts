import { describe, expect, it } from 'vitest'
import {
  NATIVE_FRAME_CSS,
  NATIVE_FRAME_HOSTS,
  shouldInjectNativeFrame
} from '../../src/main/core/webtools/electron-host'

/**
 * 外链工具「原生外观框架」守卫。
 *
 * 背景（用户口径 ①，站点级白名单）：`WebContentsView` 是原生视图，
 * DOM 遮罩盖不住它、Electron 也没有视图圆角 API ⇒ 唯一**不折损显示面积**的做法是
 * 让 guest 的**根元素**自己圆角 + 透明，由宿主槽位的玻璃透出。
 *
 * 本守卫钉三件事：
 * ① 白名单**只含**已批准的站点（不得被悄悄扩大）；
 * ② 判定只做**主机名精确匹配**（子域、其他站、非法 URL 一律不注入）；
 * ③ 注入的 CSS **只作用根元素**、**不含任何颜色/灰层**（`AI_RULES` 第 24 条红线）。
 */
describe('外链工具原生外观框架', () => {
  it('① 白名单只含已批准的站点（扩大白名单必须同步改本断言并说明理由）', () => {
    expect([...NATIVE_FRAME_HOSTS]).toEqual(['chat.laplace.live'])
  })

  it('② 判定：仅主机名精确匹配才注入（无子域通配、非法 URL 不注入）', () => {
    expect(shouldInjectNativeFrame('https://chat.laplace.live/')).toBe(true)
    expect(shouldInjectNativeFrame('https://chat.laplace.live/room/1?x=2')).toBe(true)
    // 子域/父域/相似域名一律不注入
    expect(shouldInjectNativeFrame('https://evil.chat.laplace.live/')).toBe(false)
    expect(shouldInjectNativeFrame('https://laplace.live/')).toBe(false)
    expect(shouldInjectNativeFrame('https://chat.laplace.live.evil.com/')).toBe(false)
    expect(shouldInjectNativeFrame('https://chat.laplace.live@evil.com/')).toBe(false)
    // 其他工具站
    expect(shouldInjectNativeFrame('https://example.com/')).toBe(false)
    // 非法/空 URL
    expect(shouldInjectNativeFrame('')).toBe(false)
    expect(shouldInjectNativeFrame('not a url')).toBe(false)
  })

  it('③ CSS 只作用根元素（html/body），不碰站内任何结构', () => {
    // 逐条声明拆分后，选择器只允许 html / body
    const selectors = NATIVE_FRAME_CSS.split('}')
      .map((chunk) => chunk.split('{')[0]?.trim())
      .filter((s): s is string => Boolean(s))
    expect(selectors.length).toBeGreaterThan(0)
    for (const sel of selectors) {
      expect(['html', 'body'], `注入的选择器只允许 html/body，实际出现：${sel}`).toContain(sel)
    }
    // 不得出现通配/后代/类/id 选择器
    expect(NATIVE_FRAME_CSS).not.toMatch(/[.*#\[]/)
    // 只做两件事：圆角裁切 + 背景透明
    expect(NATIVE_FRAME_CSS).toContain('border-radius')
    expect(NATIVE_FRAME_CSS).toContain('overflow:hidden')
    // 用户口径：**只裁一个圆角** —— 不得再改背景/颜色（曾试过 background: transparent，已删除）
    expect(NATIVE_FRAME_CSS, '只允许裁剪圆角，不得改背景').not.toContain('background')
  })

  it('③b CSS 不含任何颜色字面量/灰层（AI_RULES 24 红线）', () => {
    expect(NATIVE_FRAME_CSS, '不得出现十六进制颜色').not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(NATIVE_FRAME_CSS, '不得出现 rgb()/rgba()').not.toMatch(/rgba?\(/)
    expect(NATIVE_FRAME_CSS, '不得出现 hsl()').not.toMatch(/hsla?\(/)
    expect(NATIVE_FRAME_CSS, '不得出现渐变').not.toMatch(/gradient\(/)
    expect(NATIVE_FRAME_CSS, '不得出现模糊/滤镜').not.toMatch(/blur\(|filter:/)
  })
})
