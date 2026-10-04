/**
 * T17 全局底图：壁纸存储 + eclipse-wallpaper:// 协议服务（方案 A）。
 *
 * 图片复制进 `userData/wallpapers/`，通过自定义协议取图（不走 file:// 直读）。
 * 白名单文件名防路径穿越；缺失/非法请求一律 404，由渲染层纯色回退兜底。
 */
import { randomBytes } from 'node:crypto'
import { copyFile, readFile, stat, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { ILogger } from '@contracts/logger'
import type { ActionResult } from '@shared/diagnostics'
import {
  isSafeWallpaperName,
  WALLPAPER_EXTS,
  WALLPAPER_MAX_BYTES,
  wallpaperUrl
} from '@shared/theme'

/** install 结果：失败时 name 为空串，成功时为安全唯一名。 */
export interface WallpaperInstallResult extends ActionResult {
  name: string
}

export interface WallpaperStore {
  /** 复制源图片入壁纸库，生成安全唯一名。 */
  install(sourcePath: string): Promise<WallpaperInstallResult>
  /** 白名单解析文件名 → 绝对路径；不安全名返回 null。 */
  pathFor(name: string): string | null
  /** 删除壁纸文件（幂等）。 */
  remove(name: string): Promise<ActionResult>
}

export interface WallpaperStoreOptions {
  /** 壁纸目录（`userData/wallpapers/`，由调用方确保存在）。 */
  dir: string
  logger: ILogger
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

/** 生成词干：清洗为白名单字符集（空则回退 wallpaper）。 */
function safeStem(sourcePath: string): string {
  const stem = basename(sourcePath, extname(sourcePath))
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return stem === '' ? 'wallpaper' : stem
}

/**
 * 创建壁纸存储。目录由调用方预先创建（`mkdir -p` 语义）。
 */
export function createWallpaperStore(options: WallpaperStoreOptions): WallpaperStore {
  const { dir, logger } = options
  const log = logger.child('wallpaper')

  const pathFor = (name: string): string | null => {
    if (!isSafeWallpaperName(name)) return null
    return join(dir, name)
  }

  const install = async (sourcePath: string): Promise<WallpaperInstallResult> => {
    const ext = extname(sourcePath).slice(1).toLowerCase()
    if (!(WALLPAPER_EXTS as readonly string[]).includes(ext)) {
      return { ok: false, errors: [`unsupported format: ${ext || '(none)'}`], name: '' }
    }
    let size: number
    try {
      size = (await stat(sourcePath)).size
    } catch {
      return { ok: false, errors: ['source not found'], name: '' }
    }
    if (size > WALLPAPER_MAX_BYTES) {
      return { ok: false, errors: [`file too large: ${size} > ${WALLPAPER_MAX_BYTES}`], name: '' }
    }

    const stem = safeStem(sourcePath)
    // 冲突换名重试（随机后缀），极端撞名循环兜底
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const name =
        attempt === 0 ? `${stem}.${ext}` : `${stem}-${randomBytes(4).toString('hex')}.${ext}`
      const target = join(dir, name)
      if (!isSafeWallpaperName(name)) continue
      try {
        await stat(target)
        continue // 已存在 → 换名重试
      } catch {
        // 不存在 → 可用
      }
      try {
        await copyFile(sourcePath, target)
      } catch (err) {
        log.error('install failed', { err: String(err) })
        return { ok: false, errors: [`install failed: ${String(err)}`], name: '' }
      }
      log.info('wallpaper installed', { name })
      return { ok: true, errors: [], name }
    }
    return { ok: false, errors: ['install failed: name collision'], name: '' }
  }

  const remove = async (name: string): Promise<ActionResult> => {
    const target = pathFor(name)
    if (target === null) return { ok: false, errors: [`unsafe wallpaper name: ${name}`] }
    try {
      await unlink(target)
    } catch {
      // 幂等：文件不存在视为成功
    }
    return { ok: true, errors: [] }
  }

  return { install, pathFor, remove }
}

/**
 * 服务 eclipse-wallpaper:// 取图请求。
 * 缺失文件 / 空名 / 编码穿越 / 非法 URL 一律 404（渲染层纯色回退）。
 */
export async function serveWallpaper(store: WallpaperStore, requestUrl: string): Promise<Response> {
  // 渲染层为 file:// 源（构建态 loadFile），fetch 取图属跨源请求：
  // 200 与 404 一律携带 CORS 头，否则 fetch 以 TypeError 代答、拿不到状态码。
  const cors = { 'Access-Control-Allow-Origin': '*' }
  const notFound = (): Response => new Response(null, { status: 404, headers: cors })
  let name: string
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== 'eclipse-wallpaper:') return notFound()
    name = decodeURIComponent(url.pathname.replace(/^\//, ''))
  } catch {
    return notFound()
  }
  const target = store.pathFor(name)
  if (target === null) return notFound()
  const contentType = CONTENT_TYPES[extname(name).slice(1).toLowerCase()]
  try {
    const data = await readFile(target)
    return new Response(data, {
      status: 200,
      headers: { ...cors, 'content-type': contentType }
    })
  } catch {
    return notFound()
  }
}

export { wallpaperUrl }
