/**
 * UI theme types and pure logic (shared).
 *
 * Lives in shared, not contracts: the web bundle has no @contracts alias
 * and the theme is an app-shell concern, not a module interface (T12
 * precedent — see src/shared/diagnostics.ts).
 *
 * T14: theme mode + accent. T15: material tier (core.ui shape v2 + migrate).
 * T17: wallpaper (core.ui shape v3 + migrate + `eclipse-wallpaper://` URL helper).
 * T22: readability degrade switches (core.ui shape v4 + `effectiveMaterial`).
 * Migrate the `core.ui` config section on every shape change.
 */

/** Wallpaper display fit (root node `data-wallpaper-fit`). */
export type WallpaperFit = 'fill' | 'fit' | 'tile' | 'center' | 'stretch'

/** Allowed wallpaper fits. */
export const WALLPAPER_FITS: readonly WallpaperFit[] = ['fill', 'fit', 'tile', 'center', 'stretch']

/** Allowed wallpaper file extensions. */
export const WALLPAPER_EXTS = ['png', 'jpg', 'jpeg', 'webp'] as const

/** Single wallpaper file size cap (10MB). */
export const WALLPAPER_MAX_BYTES = 10 * 1024 * 1024

/**
 * Whether a wallpaper file name is safe: whitelist charset + allowed
 * extension + no path traversal (`..`, separators).
 */
export function isSafeWallpaperName(name: string): boolean {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..') return false
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return false
  if (name.includes('..')) return false
  return /\.(jpe?g|png|webp)$/i.test(name)
}

/** Build the wallpaper protocol URL (方案 A：自定义协议取图). */
export function wallpaperUrl(name: string): string {
  return `eclipse-wallpaper://local/${name}`
}

/** Theme mode: explicit light/dark, or follow the OS appearance. */
export type ThemeMode = 'light' | 'dark' | 'system'

/** The theme actually applied after resolving `system`. */
export type ResolvedTheme = 'light' | 'dark'

/** Accent color presets (日冕橙 / 青蓝). */
export type AccentId = 'corona-orange' | 'cyan-blue'

/** Material tiers: 1 纯高斯模糊 / 2 半高斯半液态玻璃（默认）/ 3 液态玻璃 / 4 全液态玻璃（T37：烘焙位移图 + 真色散 + 控件配套材质）. */
export type MaterialTier = 1 | 2 | 3 | 4

/** Persisted UI settings (config section `core.ui`). */
export interface UiSettings {
  themeMode: ThemeMode
  accent: AccentId
  material: MaterialTier
  wallpaperImage: string
  wallpaperFit: WallpaperFit
  wallpaperOpacity: number
  wallpaperBlur: number
  reduceTransparency: boolean
  highContrast: boolean
  reduceMotion: boolean
}

/** Validation result shape (structurally compatible with ValidationResult). */
export interface UiValidation {
  ok: boolean
  errors: string[]
}

/** Default UI settings: dark theme, corona-orange accent, material tier 2, no wallpaper, degrade switches off. */
export const uiDefaults: UiSettings = {
  themeMode: 'dark',
  accent: 'corona-orange',
  material: 2,
  wallpaperImage: '',
  wallpaperFit: 'fill',
  wallpaperOpacity: 1,
  wallpaperBlur: 0,
  reduceTransparency: false,
  highContrast: false,
  reduceMotion: false
}

const THEME_MODES: readonly string[] = ['light', 'dark', 'system']
const ACCENTS: readonly string[] = ['corona-orange', 'cyan-blue']
/** 四档：1 纯模糊 / 2 半液态（默认）/ 3 液态 / 4 全液态（T37，烘焙位移+高光+真色散）。 */
const MATERIAL_TIERS: readonly number[] = [1, 2, 3, 4]
const FITS: readonly string[] = WALLPAPER_FITS

/** Resolve a theme mode against the OS appearance. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return mode
}

/** Strict validator for the `core.ui` section (unknown keys rejected). */
export function validateUiSettings(value: unknown): UiValidation {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['ui settings must be an object'] }
  }
  const v = value as Record<string, unknown>
  const keys = Object.keys(v)
  for (const key of keys) {
    if (
      key !== 'themeMode' &&
      key !== 'accent' &&
      key !== 'material' &&
      key !== 'wallpaperImage' &&
      key !== 'wallpaperFit' &&
      key !== 'wallpaperOpacity' &&
      key !== 'wallpaperBlur' &&
      key !== 'reduceTransparency' &&
      key !== 'highContrast' &&
      key !== 'reduceMotion'
    ) {
      errors.push(`unknown key: ${key}`)
    }
  }
  if (typeof v.themeMode !== 'string' || !THEME_MODES.includes(v.themeMode)) {
    errors.push(`invalid themeMode: ${String(v.themeMode)}`)
  }
  if (typeof v.accent !== 'string' || !ACCENTS.includes(v.accent)) {
    errors.push(`invalid accent: ${String(v.accent)}`)
  }
  if (typeof v.material !== 'number' || !MATERIAL_TIERS.includes(v.material)) {
    errors.push(`invalid material: ${String(v.material)}`)
  }
  if (typeof v.wallpaperImage !== 'string' || (v.wallpaperImage !== '' && !isSafeWallpaperName(v.wallpaperImage))) {
    errors.push(`invalid wallpaperImage: ${String(v.wallpaperImage)}`)
  }
  if (typeof v.wallpaperFit !== 'string' || !FITS.includes(v.wallpaperFit)) {
    errors.push(`invalid wallpaperFit: ${String(v.wallpaperFit)}`)
  }
  if (
    typeof v.wallpaperOpacity !== 'number' ||
    Number.isNaN(v.wallpaperOpacity) ||
    v.wallpaperOpacity < 0 ||
    v.wallpaperOpacity > 1
  ) {
    errors.push(`invalid wallpaperOpacity: ${String(v.wallpaperOpacity)}`)
  }
  if (
    typeof v.wallpaperBlur !== 'number' ||
    Number.isNaN(v.wallpaperBlur) ||
    v.wallpaperBlur < 0 ||
    v.wallpaperBlur > 24
  ) {
    errors.push(`invalid wallpaperBlur: ${String(v.wallpaperBlur)}`)
  }
  for (const key of ['reduceTransparency', 'highContrast', 'reduceMotion'] as const) {
    if (typeof v[key] !== 'boolean') {
      errors.push(`invalid ${key}: ${String(v[key])}`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Migrate a persisted `core.ui` section between shape versions
 * （config 的 load / import / preset 三条迁移路径共用）。
 *
 * v1 → v3（T15/T17）：补默认材质档 2 与壁纸默认，既有字段原样保留。
 * v2 → v3（T17）：补默认壁纸字段。
 * v3 → v4（T22）：补三降级开关默认 false，既有字段原样保留。
 */
export function migrateUiSettings(data: unknown, fromVersion: number): unknown {
  if (fromVersion >= 4) return data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data
  const v = data as Record<string, unknown>
  const material = typeof v.material === 'number' ? v.material : 2
  const boolOr = (x: unknown): boolean => (typeof x === 'boolean' ? x : false)
  return {
    ...v,
    material,
    wallpaperImage: typeof v.wallpaperImage === 'string' ? v.wallpaperImage : '',
    wallpaperFit: typeof v.wallpaperFit === 'string' ? v.wallpaperFit : 'fill',
    wallpaperOpacity: typeof v.wallpaperOpacity === 'number' ? v.wallpaperOpacity : 1,
    wallpaperBlur: typeof v.wallpaperBlur === 'number' ? v.wallpaperBlur : 0,
    reduceTransparency: boolOr(v.reduceTransparency),
    highContrast: boolOr(v.highContrast),
    reduceMotion: boolOr(v.reduceMotion)
  }
}

/**
 * T22 档 3 自动降档（确定性简化）：高对比度下档 3 文字对比度不达标，
 * 渲染降为档 2；持久化值不变（档位选择器仍显示档 3）。
 */
export function effectiveMaterial(s: Pick<UiSettings, 'material' | 'highContrast'>): MaterialTier {
  return s.material === 3 && s.highContrast ? 2 : s.material
}

/* ---------- T28 档 3 帧率自动降档（纯运行态，不持久化） ---------- */

/** 降档判定阈值：平均帧率低于此值时档 3 渲染值降为档 2。 */
export const FPS_DEGRADE_THRESHOLD = 45

/** 最少采样帧数（间隔 ms 样本），不足不判定。 */
export const FPS_DEGRADE_MIN_SAMPLES = 60

/**
 * 由 rAF 帧间隔（ms）样本判定是否应降档：均值换算帧率 < 阈值即降。
 * 非正间隔样本（时钟异常/首次 0）直接不降（防御）。
 */
export function shouldDegradeForFps(
  samples: readonly number[],
  thresholdFps: number = FPS_DEGRADE_THRESHOLD,
  minSamples: number = FPS_DEGRADE_MIN_SAMPLES
): boolean {
  if (samples.length < minSamples) return false
  let sum = 0
  for (const delta of samples) {
    if (delta <= 0) return false
    sum += delta
  }
  const avgFps = 1000 / (sum / samples.length)
  return avgFps < thresholdFps
}

/** 恢复判定阈值：平均帧率高于此值且持续足够样本时，撤销 fps 降档。 */
export const FPS_RECOVER_THRESHOLD = 55

/** 恢复所需的最少样本（与降档一致，保证"持续健康"才恢复）。 */
export const FPS_RECOVER_MIN_SAMPLES = FPS_DEGRADE_MIN_SAMPLES

/**
 * 由 rAF 帧间隔（ms）样本判定是否应**撤销** fps 降档。
 *
 * 事故背景（用户实测）：原实现降档后直接 `return`，**永远不再采样** ⇒ 降档一旦发生就永久生效，
 * 只有用户手动重选材质档位才会复位。表现为：① 刚启动不是第四档；② 进入某些模块后材质明显降级。
 * 现在：降档后继续以更低频率采样，帧率持续健康即恢复。
 */
export function shouldRecoverForFps(
  samples: readonly number[],
  thresholdFps: number = FPS_RECOVER_THRESHOLD,
  minSamples: number = FPS_RECOVER_MIN_SAMPLES
): boolean {
  if (samples.length < minSamples) return false
  let sum = 0
  for (const delta of samples) {
    if (delta <= 0) return false
    sum += delta
  }
  const avgFps = 1000 / (sum / samples.length)
  return avgFps >= thresholdFps
}
