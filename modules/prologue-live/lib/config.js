'use strict'

/**
 * PrologueType Live 配置 schema（纯函数，无 ctx 依赖，可直接单测）。
 *
 * 结构：OBS 组平铺 + float 组嵌套（同分区嵌套键，REQ 5.5）。
 * 所有颜色/尺寸/透明度只是配置值——渲染侧一律经 CSS 变量注入，零硬编码。
 * 发送历史（showHistory 开关之外的文本）不入配置、不落盘（红线）。
 */

/** 颜色校验：仅 #RRGGBB / #RRGGBBAA。 */
const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** OBS 显示 / 文字组（模块组，平铺于分区顶层）。 */
const OBS_KEYS = [
  'textColor',
  'fontFamily',
  'fontSize',
  'typingSpeed',
  'scrollSpeed',
  'prefixSymbol',
  'suffixSymbol',
  'styleType',
  'bgColor',
  'borderColor',
  'borderWidth',
  'blurStrength',
  'opacity'
]

/** 悬浮窗组（float，嵌套键）。 */
const FLOAT_KEYS = [
  'enabled',
  'screen',
  'x',
  'y',
  'width',
  'height',
  'bgOpacity',
  'textOpacity',
  'clickThrough',
  'toggleThroughHotkey',
  'sendHotkey',
  'bgColor',
  'textColor',
  'borderColor',
  'blurStrength',
  'fontFamily',
  'fontSize',
  'snapEdges',
  'rememberPosition',
  'showHistory'
]

/** 六种样式组合（无底图/高斯模糊/纯色 × 有无外框）。 */
const STYLE_TYPES = ['none', 'none-border', 'blur', 'blur-border', 'solid', 'solid-border']

/** 分区默认值（= manifest.config.defaults，单一来源；manifest 一致性由测试锁定）。 */
const PROLOGUE_DEFAULTS = {
  textColor: '#ffffff',
  fontFamily: 'Microsoft YaHei',
  fontSize: 28,
  typingSpeed: 120, // ms/字，10–500
  scrollSpeed: 400, // ms，行滚动过渡时长，50–2000
  prefixSymbol: '[',
  suffixSymbol: ']',
  styleType: 'blur-border',
  bgColor: '#000000',
  borderColor: '#ffffff',
  borderWidth: 2,
  blurStrength: 16,
  opacity: 60,
  float: {
    enabled: false,
    screen: '',
    x: 100,
    y: 100,
    width: 320,
    height: 200,
    bgOpacity: 80,
    textOpacity: 100, // 保底 30，文字必须始终可读
    clickThrough: false,
    toggleThroughHotkey: 'CommandOrControl+Shift+T',
    sendHotkey: 'CommandOrControl+Shift+S',
    bgColor: '#14141a',
    textColor: '#ffffff',
    borderColor: '#888888',
    blurStrength: 12,
    fontFamily: 'Microsoft YaHei',
    fontSize: 16,
    snapEdges: true,
    rememberPosition: true,
    showHistory: true
  }
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isString = (v) => typeof v === 'string'
const isBool = (v) => typeof v === 'boolean'

/** 校验一个完整分区值（set / applyGroup / 样式包 apply 前统一入口）。 */
function validateConfig(value) {
  const errors = []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['config must be an object'] }
  }
  for (const key of Object.keys(value)) {
    if (key === 'float') continue
    if (!OBS_KEYS.includes(key)) {
      errors.push(`unknown key: ${key}`)
    }
  }
  const v = value

  if (!isString(v.textColor) || !HEX_COLOR.test(v.textColor)) errors.push('textColor: expected hex color')
  if (!isString(v.fontFamily) || v.fontFamily.trim() === '') errors.push('fontFamily: must be non-empty string')
  if (!isNumber(v.fontSize) || v.fontSize < 12 || v.fontSize > 96) errors.push('fontSize: expected 12–96')
  if (!isNumber(v.typingSpeed) || v.typingSpeed < 10 || v.typingSpeed > 500) errors.push('typingSpeed: expected 10–500')
  if (!isNumber(v.scrollSpeed) || v.scrollSpeed < 50 || v.scrollSpeed > 2000) errors.push('scrollSpeed: expected 50–2000')
  if (!isString(v.prefixSymbol)) errors.push('prefixSymbol: expected string')
  if (!isString(v.suffixSymbol)) errors.push('suffixSymbol: expected string')
  if (!STYLE_TYPES.includes(v.styleType)) errors.push(`styleType: expected one of ${STYLE_TYPES.join('/')}`)
  if (!isString(v.bgColor) || !HEX_COLOR.test(v.bgColor)) errors.push('bgColor: expected hex color')
  if (!isString(v.borderColor) || !HEX_COLOR.test(v.borderColor)) errors.push('borderColor: expected hex color')
  if (!isNumber(v.borderWidth) || v.borderWidth < 0 || v.borderWidth > 24) errors.push('borderWidth: expected 0–24')
  if (!isNumber(v.blurStrength) || v.blurStrength < 0 || v.blurStrength > 64) errors.push('blurStrength: expected 0–64')
  if (!isNumber(v.opacity) || v.opacity < 0 || v.opacity > 100) errors.push('opacity: expected 0–100')

  const f = v.float
  if (f === null || typeof f !== 'object' || Array.isArray(f)) {
    errors.push('float: expected object')
  } else {
    for (const key of Object.keys(f)) {
      if (!FLOAT_KEYS.includes(key)) errors.push(`float.unknown key: ${key}`)
    }
    if (!isBool(f.enabled)) errors.push('float.enabled: expected boolean')
    if (!isString(f.screen)) errors.push('float.screen: expected string')
    if (!isNumber(f.x) || !isNumber(f.y)) errors.push('float.x/y: expected number')
    if (!isNumber(f.width) || f.width < 50 || f.width > 10000) errors.push('float.width: expected 50–10000')
    if (!isNumber(f.height) || f.height < 50 || f.height > 10000) errors.push('float.height: expected 50–10000')
    if (!isNumber(f.bgOpacity) || f.bgOpacity < 0 || f.bgOpacity > 100) errors.push('float.bgOpacity: expected 0–100')
    if (!isNumber(f.textOpacity) || f.textOpacity < 30 || f.textOpacity > 100) {
      errors.push('float.textOpacity: expected 30–100 (readability floor)')
    }
    if (!isBool(f.clickThrough)) errors.push('float.clickThrough: expected boolean')
    if (!isString(f.toggleThroughHotkey)) errors.push('float.toggleThroughHotkey: expected string')
    if (!isString(f.sendHotkey)) errors.push('float.sendHotkey: expected string')
    if (!isString(f.bgColor) || !HEX_COLOR.test(f.bgColor)) errors.push('float.bgColor: expected hex color')
    if (!isString(f.textColor) || !HEX_COLOR.test(f.textColor)) errors.push('float.textColor: expected hex color')
    if (!isString(f.borderColor) || !HEX_COLOR.test(f.borderColor)) errors.push('float.borderColor: expected hex color')
    if (!isNumber(f.blurStrength) || f.blurStrength < 0 || f.blurStrength > 64) errors.push('float.blurStrength: expected 0–64')
    if (!isString(f.fontFamily) || f.fontFamily.trim() === '') errors.push('float.fontFamily: must be non-empty string')
    if (!isNumber(f.fontSize) || f.fontSize < 12 || f.fontSize > 96) errors.push('float.fontSize: expected 12–96')
    if (!isBool(f.snapEdges)) errors.push('float.snapEdges: expected boolean')
    if (!isBool(f.rememberPosition)) errors.push('float.rememberPosition: expected boolean')
    if (!isBool(f.showHistory)) errors.push('float.showHistory: expected boolean')
  }

  return { ok: errors.length === 0, errors }
}

/**
 * 组级部分合并：obs（平铺键）或 float（嵌套键）。
 * 返回 { ok, errors, next }——ok=false 时 next 为 undefined，调用方不得落盘。
 */
function applyGroup(section, group, changes) {
  if (group !== 'obs' && group !== 'float') {
    return { ok: false, errors: [`unknown group: ${group}`] }
  }
  if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) {
    return { ok: false, errors: ['changes must be an object'] }
  }
  let next
  if (group === 'obs') {
    for (const key of Object.keys(changes)) {
      if (!OBS_KEYS.includes(key)) {
        return { ok: false, errors: [`obs changes must only contain OBS keys, got: ${key}`] }
      }
    }
    next = { ...section, ...changes }
  } else {
    for (const key of Object.keys(changes)) {
      if (!FLOAT_KEYS.includes(key)) {
        return { ok: false, errors: [`float changes must only contain float keys, got: ${key}`] }
      }
    }
    const current = (section && typeof section === 'object' && section.float) || PROLOGUE_DEFAULTS.float
    next = { ...section, float: { ...current, ...changes } }
  }
  const res = validateConfig(next)
  return res.ok ? { ok: true, errors: [], next } : { ok: false, errors: res.errors }
}

module.exports = {
  PROLOGUE_DEFAULTS,
  OBS_KEYS,
  FLOAT_KEYS,
  STYLE_TYPES,
  validateConfig,
  applyGroup
}
