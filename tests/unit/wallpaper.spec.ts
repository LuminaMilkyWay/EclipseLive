/**
 * T17 全局底图单测：壁纸存储（install / pathFor / remove）、eclipse-wallpaper:// 服务
 * （serveWallpaper）、core.ui 壁纸字段校验、renderer.css 底图层。
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import {
  isSafeWallpaperName,
  uiDefaults,
  validateUiSettings,
  WALLPAPER_FITS,
  WALLPAPER_MAX_BYTES,
  wallpaperUrl
} from '../../src/shared/theme'
import { createWallpaperStore, serveWallpaper } from '../../src/main/core/wallpaper'

/* ---------- 测试辅助 ---------- */

function testLogger(): ILogger {
  const make = (): ILogger => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => make(),
    setLevel: () => {}
  })
  return make()
}

/** 建一个空壁纸库（含目录）。 */
async function makeStore(): Promise<{ dir: string; store: ReturnType<typeof createWallpaperStore> }> {
  const dir = join(await mkdtemp(join(tmpdir(), 'el-wallpaper-')), 'wallpapers')
  await mkdir(dir, { recursive: true })
  return { dir, store: createWallpaperStore({ dir, logger: testLogger() }) }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

async function loadCss(): Promise<string> {
  return readFile(resolve(__dirname, '../../src/renderer/src/renderer.css'), 'utf8')
}

interface CssBlock {
  selector: string
  body: string
}

function parseBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    blocks.push({ selector: m[1].trim(), body: m[2] })
  }
  return blocks
}

function varsOf(block: CssBlock): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of block.body.split(';')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const name = line.slice(0, idx).trim()
    if (name.startsWith('--')) out.set(name, line.slice(idx + 1).trim())
  }
  return out
}

/* ---------- isSafeWallpaperName / wallpaperUrl ---------- */

describe('isSafeWallpaperName', () => {
  it('接受安全文件名（白名单扩展名 + 安全字符集）', () => {
    for (const name of ['a.png', 'my_photo-1.JPEG', 'x.webp', 'a.jpg', 'wall.2.jpeg']) {
      expect(isSafeWallpaperName(name), name).toBe(true)
    }
  })

  it('拒绝穿越、分隔符、非白名单扩展名与不安全字符', () => {
    for (const name of [
      '',
      '.',
      '..',
      '../a.png',
      '..\\a.png',
      'a/b.png',
      'a\\b.png',
      'x.gif',
      'x.txt',
      'x.png.exe',
      '%2e%2e%2fa.png',
      'a b.png',
      'a:b.png'
    ]) {
      expect(isSafeWallpaperName(name), name).toBe(false)
    }
  })
})

describe('wallpaperUrl', () => {
  it('生成 eclipse-wallpaper://local/<name> 取图地址', () => {
    expect(wallpaperUrl('a.png')).toBe('eclipse-wallpaper://local/a.png')
  })
})

/* ---------- createWallpaperStore ---------- */

describe('createWallpaperStore', () => {
  it('install 拒绝非白名单格式', async () => {
    const { dir, store } = await makeStore()
    const src = join(dir, '..', 'evil.gif')
    await writeFile(src, PNG)
    const r = await store.install(src)
    expect(r.ok).toBe(false)
    expect(r.name).toBe('')
    expect(r.errors.join('\n')).toContain('format')
  })

  it('install 拒绝超过 10MB 的文件', async () => {
    const { dir, store } = await makeStore()
    const src = join(dir, '..', 'big.png')
    await writeFile(src, Buffer.alloc(WALLPAPER_MAX_BYTES + 1))
    const r = await store.install(src)
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toContain('too large')
  })

  it('install 拒绝缺失源文件', async () => {
    const { store } = await makeStore()
    const r = await store.install(join(tmpdir(), 'el-missing-wallpaper.png'))
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toContain('not found')
  })

  it('install 复制入目录并生成安全唯一名', async () => {
    const { dir, store } = await makeStore()
    const src = join(dir, '..', 'bad name!.png')
    await writeFile(src, PNG)
    const r = await store.install(src)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(isSafeWallpaperName(r.name)).toBe(true)
    expect(existsSync(join(dir, r.name))).toBe(true)
    expect(new Uint8Array(await readFile(join(dir, r.name)))).toEqual(new Uint8Array(PNG))
  })

  it('install 同名冲突生成不同唯一名', async () => {
    const { dir, store } = await makeStore()
    const src = join(dir, '..', 'dup.png')
    await writeFile(src, PNG)
    const r1 = await store.install(src)
    const r2 = await store.install(src)
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r1.name).not.toBe(r2.name)
    expect(existsSync(join(dir, r1.name))).toBe(true)
    expect(existsSync(join(dir, r2.name))).toBe(true)
  })

  it('pathFor 白名单解析防穿越', async () => {
    const { dir, store } = await makeStore()
    expect(store.pathFor('a.png')).toBe(join(dir, 'a.png'))
    expect(store.pathFor('../a.png')).toBeNull()
    expect(store.pathFor('..\\a.png')).toBeNull()
    expect(store.pathFor('a/b.png')).toBeNull()
    expect(store.pathFor('')).toBeNull()
    expect(store.pathFor('x.gif')).toBeNull()
  })

  it('remove 幂等且拒绝不安全名', async () => {
    const { dir, store } = await makeStore()
    await writeFile(join(dir, 'a.png'), PNG)
    expect(await store.remove('a.png')).toEqual({ ok: true, errors: [] })
    expect(existsSync(join(dir, 'a.png'))).toBe(false)
    // 幂等：再删不存在的文件不报错
    expect(await store.remove('a.png')).toEqual({ ok: true, errors: [] })
    const bad = await store.remove('../a.png')
    expect(bad.ok).toBe(false)
  })
})

/* ---------- serveWallpaper ---------- */

describe('serveWallpaper', () => {
  it('200 + 按扩展名给 content-type + 内容一致', async () => {
    const { dir, store } = await makeStore()
    const cases: Array<[string, string]> = [
      ['a.png', 'image/png'],
      ['b.webp', 'image/webp'],
      ['c.jpeg', 'image/jpeg'],
      ['d.jpg', 'image/jpeg']
    ]
    for (const [name, ct] of cases) {
      await writeFile(join(dir, name), PNG)
      const res = await serveWallpaper(store, wallpaperUrl(name))
      expect(res.status, name).toBe(200)
      expect(res.headers.get('content-type'), name).toBe(ct)
      expect(new Uint8Array(await res.arrayBuffer()), name).toEqual(new Uint8Array(PNG))
    }
  })

  it('缺失文件 404', async () => {
    const { store } = await makeStore()
    const res = await serveWallpaper(store, wallpaperUrl('missing.png'))
    expect(res.status).toBe(404)
  })

  it('空文件名 404', async () => {
    const { store } = await makeStore()
    const res = await serveWallpaper(store, 'eclipse-wallpaper://local/')
    expect(res.status).toBe(404)
  })

  it('路径穿越 404（编码穿越与反斜杠）', async () => {
    const { dir, store } = await makeStore()
    await writeFile(join(dir, 'a.png'), PNG)
    for (const url of [
      'eclipse-wallpaper://local/%2e%2e%2fa.png',
      'eclipse-wallpaper://local/..%5ca.png',
      'eclipse-wallpaper://local/%2e%2e%2f%2e%2e%2fa.png'
    ]) {
      const res = await serveWallpaper(store, url)
      expect(res.status, url).toBe(404)
    }
  })

  it('非法 URL 404', async () => {
    const { store } = await makeStore()
    const res = await serveWallpaper(store, 'not-a-url')
    expect(res.status).toBe(404)
  })
})

/* ---------- validateUiSettings 壁纸字段 ---------- */

describe('validateUiSettings 壁纸字段', () => {
  it('五种显示方式全部合法，其余拒绝', () => {
    for (const wallpaperFit of ['fill', 'fit', 'tile', 'center', 'stretch']) {
      expect(validateUiSettings({ ...uiDefaults, wallpaperFit }).ok, wallpaperFit).toBe(true)
    }
    expect(validateUiSettings({ ...uiDefaults, wallpaperFit: 'zoom' }).ok).toBe(false)
    expect(validateUiSettings({ ...uiDefaults, wallpaperFit: 1 }).ok).toBe(false)
  })

  it('wallpaperOpacity 0–1 接受，越界/非数值拒绝', () => {
    for (const wallpaperOpacity of [0, 0.5, 1]) {
      expect(validateUiSettings({ ...uiDefaults, wallpaperOpacity }).ok).toBe(true)
    }
    for (const wallpaperOpacity of [-0.1, 1.1, '0.5', NaN]) {
      expect(validateUiSettings({ ...uiDefaults, wallpaperOpacity }).ok).toBe(false)
    }
  })

  it('wallpaperBlur 0–24 接受，越界/非数值拒绝', () => {
    for (const wallpaperBlur of [0, 12, 24]) {
      expect(validateUiSettings({ ...uiDefaults, wallpaperBlur }).ok).toBe(true)
    }
    for (const wallpaperBlur of [-1, 25, '8', NaN]) {
      expect(validateUiSettings({ ...uiDefaults, wallpaperBlur }).ok).toBe(false)
    }
  })

  it('wallpaperImage 空/安全名接受，穿越与未知键拒绝', () => {
    expect(validateUiSettings({ ...uiDefaults, wallpaperImage: '' }).ok).toBe(true)
    expect(validateUiSettings({ ...uiDefaults, wallpaperImage: 'a.png' }).ok).toBe(true)
    expect(validateUiSettings({ ...uiDefaults, wallpaperImage: '../a.png' }).ok).toBe(false)
    expect(validateUiSettings({ ...uiDefaults, wallpaperImage: 'a\\b.png' }).ok).toBe(false)
    expect(validateUiSettings({ ...uiDefaults, wallpaperImage: 1 }).ok).toBe(false)
    expect(validateUiSettings({ ...uiDefaults, wallpaperExtra: 1 } as Record<string, unknown>).ok).toBe(
      false
    )
  })
})

/* ---------- renderer.css 全局底图层 ---------- */

describe('renderer.css 全局底图层', () => {
  it(':root 底图三变量默认值（none / 1 / 0px）', async () => {
    const blocks = parseBlocks(await loadCss())
    const root = blocks.find((b) => b.selector.includes(':root'))
    expect(root).toBeTruthy()
    const vars = varsOf(root!)
    expect(vars.get('--wallpaper-url')).toBe('none')
    expect(vars.get('--wallpaper-opacity')).toBe('1')
    expect(vars.get('--wallpaper-blur')).toBe('0px')
  })

  it('.wallpaper 层：只负责图片（纯色兜底已上移 body）+ 消费三变量', async () => {
    const blocks = parseBlocks(await loadCss())
    // 精确匹配基础块：低配模式下也有 `[…][…] .wallpaper` 规则，子串匹配会误捕
    const block = blocks.find(
      (b) => b.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim() === '.wallpaper'
    )
    expect(block, '缺少 .wallpaper 底图层块').toBeTruthy()
    const body = block!.body
    // v0.1.8-beta1.1：原先 .wallpaper 自带 background-color: var(--bg-0)（不透明），
    // 会把 body 的强调色辉光整层盖住——面板背后因此永远是纯色，玻璃与三档材质都无从表现。
    // 现改为「body 负责纯色兜底 + 辉光，.wallpaper 只负责图片」。
    expect(body, '.wallpaper 不得再带不透明纯色底（会遮挡 body 辉光）').not.toContain(
      'background-color: var(--bg-0)'
    )
    expect(body).toContain('background-image: var(--wallpaper-url)')
    expect(body).toContain('var(--wallpaper-opacity)')
    expect(body).toContain('var(--wallpaper-blur)')
  })

  it('body 承担底图兜底与强调色辉光（无图时纯色 + 辉光仍可见）', async () => {
    const blocks = parseBlocks(await loadCss())
    const body = blocks.find((b) => /(^|\s)body$/.test(b.selector))
    expect(body, '缺少 body 块').toBeTruthy()
    expect(body!.body, 'body 应提供纯色兜底起点').toContain('var(--bg-0)')
    expect(body!.body, 'body 应绘制强调色辉光（面板背后唯一的可模糊纹理）').toContain('var(--bg-glow-a)')
    expect(body!.body, 'body 应绘制第二层辉光').toContain('var(--bg-glow-b)')
  })

  it('五种显示方式块齐全（fill/fit/tile/center/stretch）', async () => {
    const blocks = parseBlocks(await loadCss())
    for (const fit of WALLPAPER_FITS) {
      const block = blocks.find((b) => b.selector.includes(`data-wallpaper-fit='${fit}'`))
      expect(block, `缺少显示方式块: ${fit}`).toBeTruthy()
    }
    const bodyOf = (fit: string): string =>
      blocks.find((b) => b.selector.includes(`data-wallpaper-fit='${fit}'`))!.body
    expect(bodyOf('fill')).toContain('background-size: cover')
    expect(bodyOf('fit')).toContain('background-size: contain')
    expect(bodyOf('stretch')).toContain('background-size: 100% 100%')
    expect(bodyOf('tile')).toContain('background-repeat: repeat')
    expect(bodyOf('center')).toContain('background-repeat: no-repeat')
  })
})
