import { describe, expect, it } from 'vitest'
import {
  buildUiTokenScript,
  pickParentWindow,
  type WebToolParentCandidate
} from '../../src/main/core/webtools/electron-host'

/**
 * 嵌入视图父窗口选择（装配层注入规则）。
 *
 * 回归背景：主进程此前用 `BrowserWindow.getAllWindows()[0]` 取父窗。打字机模块
 * （prologue-live）等会在启动期创建 overlay 悬浮窗，与主窗竞态创建——悬浮窗可能
 * 排到列表首位，导致第三方工具（laplacelive-link）的 WebContentsView 误挂到悬浮窗
 * 上（视窗"绑定到悬浮窗" + 无边框大窗遮住底部任务栏一半）。
 *
 * 规则：显式主窗引用优先；退化时从窗口列表里选第一个「非悬浮窗」；全是悬浮窗则空。
 */

const main: WebToolParentCandidate = { isOverlayWindow: false }
const overlay: WebToolParentCandidate = { isOverlayWindow: true }

describe('pickParentWindow（嵌入式视图父窗口选择）', () => {
  it('主窗引用存在且非悬浮窗 → 返回主窗（即使悬浮窗排在列表首位）', () => {
    expect(pickParentWindow([overlay, main], main)).toBe(main)
  })

  it('无主窗引用 → 跳过悬浮窗，选第一个非悬浮窗（不取列表首位）', () => {
    expect(pickParentWindow([overlay, main], null)).toBe(main)
    expect(pickParentWindow([overlay, main], undefined)).toBe(main)
  })

  it('主窗引用缺失且列表全是悬浮窗 → 返回 null（视图不挂任何窗口）', () => {
    expect(pickParentWindow([overlay, overlay], null)).toBeNull()
  })

  it('主窗引用是悬浮窗（异常态）→ 忽略它，退化到列表第一个非悬浮窗', () => {
    expect(pickParentWindow([main, overlay], overlay)).toBe(main)
  })
})

describe('buildUiTokenScript（T33 模块页令牌注入脚本）', () => {
  it('每枚令牌生成一条 setProperty，值经 JSON.stringify 转义（引号/换行安全）', () => {
    const script = buildUiTokenScript({
      '--mat-alpha': '0.65',
      '--r-lg': '16px',
      '--txt-1': '#e9eef9'
    })
    expect(script).toContain(
      `document.documentElement.style.setProperty("--mat-alpha", "0.65");`
    )
    expect(script).toContain(
      `document.documentElement.style.setProperty("--r-lg", "16px");`
    )
    expect(script).toContain(
      `document.documentElement.style.setProperty("--txt-1", "#e9eef9");`
    )
  })

  it('值含双引号/换行时转义，注入内容不逃出字符串字面量', () => {
    const script = buildUiTokenScript({ '--pt-note': 'a"b\\c\nd' })
    expect(script).toContain('"a\\"b\\\\c\\nd"')
    // 不含裸换行、不含额外分号以外的语句——只有 setProperty 调用
    expect(script.match(/setProperty/g)?.length).toBe(1)
    expect(script.trim().split('\n')).toHaveLength(1)
  })
})
