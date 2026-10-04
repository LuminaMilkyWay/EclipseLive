/**
 * T21 应用级设置（core.app 分区 shape）。
 *
 * 与 theme.ts 同规约：纯类型 + 常量 + 校验，被 tsconfig.node 与 tsconfig.web
 * 同时编译——禁 import @contracts、禁 Node/DOM API（校验结果本地定义）。
 * 检查更新默认关闭：显式开启 + 显式点击前，update:check 零外发请求。
 */

export interface AppSettings {
  checkUpdatesEnabled: boolean
}

export interface AppValidation {
  ok: boolean
  errors: string[]
}

export const APP_SETTINGS_VERSION = 1

export const appDefaults: AppSettings = {
  checkUpdatesEnabled: false
}

/** 严格校验：布尔合法；缺键 / 未知键 / 类型错 / 非对象一律拒。 */
export function validateAppSettings(value: unknown): AppValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['must be an object'] }
  }
  const o = value as Record<string, unknown>
  const errors: string[] = []
  if (typeof o.checkUpdatesEnabled !== 'boolean') {
    errors.push('checkUpdatesEnabled must be a boolean')
  }
  for (const key of Object.keys(o)) {
    if (key !== 'checkUpdatesEnabled') errors.push(`unknown key: ${key}`)
  }
  return { ok: errors.length === 0, errors }
}
