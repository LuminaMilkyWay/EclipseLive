'use strict'

/**
 * 悬浮窗几何数学（纯函数，无 Electron/ctx 依赖——可直接单测）。
 *
 * 吸附边缘阈值 12px 与位置记忆 debounce 500ms 为模块内行为常量（非样式值）；
 * 窗口原语（置顶/透明/穿透/多屏）由核心 overlays 服务提供，本模块只消费。
 */

/** 吸附阈值（px）：窗口边缘距屏幕边缘在此范围内自动对齐。 */
const SNAP_THRESHOLD = 12

/** 位置记忆落盘 debounce（ms）：拖动/缩放过程中避免频繁写配置。 */
const PERSIST_DEBOUNCE = 500

function centerOnScreen(screen, width, height) {
  return {
    x: Math.round(screen.bounds.x + (screen.bounds.width - width) / 2),
    y: Math.round(screen.bounds.y + (screen.bounds.height - height) / 2)
  }
}

/** 窗口中心点。 */
function windowCenter(bounds) {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

/** 以窗口中心判定窗口是否位于屏幕内。 */
function containedIn(screen, bounds) {
  const c = windowCenter(bounds)
  return (
    c.x >= screen.bounds.x &&
    c.x < screen.bounds.x + screen.bounds.width &&
    c.y >= screen.bounds.y &&
    c.y < screen.bounds.y + screen.bounds.height
  )
}

/**
 * 吸附：四边 12px 内对齐到屏幕边缘。返回 { bounds, changed }——
 * 无吸附时返回原 bounds 引用与 changed:false（调用方据此跳过 setBounds）。
 */
function snapBounds(bounds, screen, threshold = SNAP_THRESHOLD) {
  const b = { ...bounds }
  const s = screen.bounds
  let changed = false
  if (Math.abs(b.x - s.x) <= threshold) {
    b.x = s.x
    changed = true
  } else if (Math.abs(b.x + b.width - (s.x + s.width)) <= threshold) {
    b.x = s.x + s.width - b.width
    changed = true
  }
  if (Math.abs(b.y - s.y) <= threshold) {
    b.y = s.y
    changed = true
  } else if (Math.abs(b.y + b.height - (s.y + s.height)) <= threshold) {
    b.y = s.y + s.height - b.height
    changed = true
  }
  return { bounds: changed ? b : bounds, changed }
}

/**
 * 创建时的初始位置：rememberPosition 且记忆位置落在目标屏内 → 用记忆位置；
 * 否则（不记忆 / 切屏后位置不在新屏）→ 目标屏居中。
 */
function computeCreateBounds(floatCfg, screen) {
  const { x, y, width, height } = floatCfg
  const stored = { x, y, width, height }
  if (floatCfg.rememberPosition && containedIn(screen, stored)) return stored
  return { ...centerOnScreen(screen, width, height), width, height }
}

/** 找到包含窗口中心的屏幕；无则返回 primary。 */
function screenForBounds(screens, bounds) {
  const c = windowCenter(bounds)
  const hit = screens.find(
    (s) =>
      c.x >= s.bounds.x &&
      c.x < s.bounds.x + s.bounds.width &&
      c.y >= s.bounds.y &&
      c.y < s.bounds.y + s.bounds.height
  )
  return hit || screens.find((s) => s.primary) || screens[0] || null
}

module.exports = {
  SNAP_THRESHOLD,
  PERSIST_DEBOUNCE,
  centerOnScreen,
  windowCenter,
  containedIn,
  snapBounds,
  computeCreateBounds,
  screenForBounds
}
