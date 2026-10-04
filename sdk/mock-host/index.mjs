#!/usr/bin/env node
/**
 * EclipseLIVE **mock host**（SDK 的一部分，MIT）—— 让模块作者**不装 Electron** 就能跑模块。
 *
 * 它做的事（足够开发与自测，但不假装是完整宿主）：
 *   1. 读取模块目录的 `manifest.json`（校验 `id`/`version`/`license` 是否声明）；
 *   2. 构造一个**假的 `ctx`**：logger / config / bus / permissions / gateway 桩件，
 *      接口形状与 `sdk/contracts/` 中的契约一致；
 *   3. 把模块的 `web` 页面（`manifest.web.url` 对应的静态文件）用本地 HTTP 服务起来，
 *      方便你在浏览器里调 UI（宿主真实环境是嵌入视图，这里用普通网页代替）；
 *   4. 打印模块声明的权限、事件、路由，便于对照 `sdk/contracts/` 检查。
 *
 * ⚠️ 它**不是**宿主：不提供真实权限管控、不加载原生能力、不做沙箱。正式验收请在 EclipseLIVE 内进行。
 *
 * 用法：
 *   node sdk/mock-host/index.mjs ../modules/example-empty
 *   node sdk/mock-host/index.mjs ../modules/example-empty --port 7788
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const moduleDir = args.find((a) => !a.startsWith('--'))
const portArg = args.indexOf('--port')
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 7788

if (!moduleDir) {
  console.error('用法: node sdk/mock-host/index.mjs <模块目录> [--port 7788]')
  process.exit(1)
}

const dir = resolve(process.cwd(), moduleDir)
const manifestPath = join(dir, 'manifest.json')
let manifest
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
} catch (e) {
  console.error(`✗ 读不到 manifest.json（${manifestPath}）：${String(e)}`)
  process.exit(1)
}

// ---- 1) 清单自查（与宿主打包闸门同一口径的最小版） ----
const problems = []
if (!manifest.id) problems.push('缺 id')
if (!manifest.version) problems.push('缺 version')
if (!manifest.license) problems.push('缺 license（未声明协议；宿主不会替你授权）')
try {
  await stat(join(dir, manifest.licenseFile ?? 'LICENSE'))
} catch {
  if ((manifest.license ?? '').toUpperCase() !== 'UNLICENSED') {
    problems.push(`声明了 ${manifest.license} 但没有 ${manifest.licenseFile ?? 'LICENSE'} 文件（宿主打包会被拒）`)
  }
}
console.log(`
=== ${manifest.id ?? '(无 id)'} v${manifest.version ?? '?'} · ${manifest.license ?? '未声明协议'} ===`)
if (problems.length) {
  console.log('⚠️ 清单问题：')
  for (const p of problems) console.log('   - ' + p)
} else {
  console.log('✓ 清单自查通过')
}
console.log('  权限:', (manifest.permissions ?? []).join(', ') || '(无)')
console.log('  事件:', (manifest.events ?? []).join(', ') || '(无)')
console.log('  路由:', (manifest.routes ?? []).map((r) => `${r.method} ${r.path}`).join(', ') || '(无)')

// ---- 2) 假 ctx（形状对齐 sdk/contracts） ----
const log = (...a) => console.log('  [module]', ...a)
const ctx = {
  moduleId: manifest.id,
  logger: { debug: log, info: log, warn: log, error: log, child: () => ctx.logger },
  config: {
    get: async () => structuredClone(manifest.config?.defaults ?? {}),
    set: async () => ({ ok: true }),
    onChange: () => () => {}
  },
  bus: {
    emit: (name, payload) => console.log('  [bus →]', name, payload ?? ''),
    on: (name, fn) => {
      console.log('  [bus ←] 已订阅', name)
      return () => {}
    }
  },
  permissions: { has: () => true, granted: () => [...(manifest.permissions ?? [])] },
  gateway: { port: PORT, url: `http://127.0.0.1:${PORT}` },
  overlays: {
    screens: () => [{ id: 'mock', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
    create: (id, spec) => (console.log('  [overlay] create', id, spec?.url ?? ''), { ok: true }),
    destroy: () => true,
    setBounds: () => true,
    list: () => []
  }
}

// ---- 3) 尝试加载模块入口（有 entry 才加载） ----
if (manifest.entry) {
  try {
    const mod = await import(new URL('file://' + join(dir, manifest.entry)))
    const activate = mod.activate ?? mod.default
    if (typeof activate === 'function') {
      await activate(ctx)
      console.log('✓ 模块已激活（mock ctx）')
    } else {
      console.log('· 模块未导出 activate()，跳过激活')
    }
  } catch (e) {
    console.log('⚠️ 加载模块入口失败（开发中常见，先继续跑 UI）：' + String(e).slice(0, 160))
  }
} else {
  console.log('· 该模块声明为网页工具（无 entry），只跑静态页面')
}

// ---- 4) 静态服务（把 web.url 指到的页面端起来） ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const webUrl = manifest.web?.url ?? '/'
createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0])
  const candidates = [join(dir, rel), join(dir, 'pages', rel.replace(/^\/+/, '')), join(dir, rel.replace(/^\/+/, '') + '.html')]
  for (const f of candidates) {
    try {
      const s = await stat(f)
      if (!s.isFile()) continue
      const body = await readFile(f)
      res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' })
      res.end(body)
      return
    } catch {
      /* 继续试下一个 */
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('mock-host: 404 ' + rel + '\n提示：静态页应在模块目录内（如 pages/ 下）')
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n▶ mock-host 已启动： http://127.0.0.1:${PORT}${webUrl}`)
  console.log('  （这是普通网页；宿主里的真实形态是嵌入视图 / 悬浮窗）')
  console.log('  Ctrl+C 结束\n')
})
