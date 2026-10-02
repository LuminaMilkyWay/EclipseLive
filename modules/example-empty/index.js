/**
 * EclipseLIVE 示例最小业务模块（T6 预置，T10/T31 扩展）。
 *
 * 入口导出 { init, start, stop }（全部可选）。init 收到的 ctx 是模块
 * 唯一合法的能力面：logger / config / bus / gateway / permissions / styles
 * 都已经过作用域化 —— 只能访问本模块清单（manifest.json）声明过的资源。
 *
 * T31：manifest 的 web.url 相对声明使本模块在应用内"扩展"组拥有页面入口
 * （左侧二级菜单）——页面经下方网关路由以 text/html 提供最小示例。
 */
module.exports = {
  async init(ctx) {
    // T31：应用内页面示例（相对 url /example-empty/page → manifest.web 声明）。
    ctx.gateway.registerHttpRoute('GET', '/example-empty/page', () => ({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: [
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
        '<title>Empty Example</title>',
        '<style>body{font:14px/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif;',
        'background:#141a29;color:#e8ecf4;display:grid;place-items:center;height:100vh;margin:0}',
        'main{text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#93a0b4;margin:4px 0}</style></head>',
        '<body><main><h1>Empty Example</h1>',
        '<p>应用内模块页面示例 · 经网关路由加载（text/html）</p>',
        '<p>复制本模块开始你的模块：manifest.web.url 声明页面入口</p></main></body></html>'
      ].join('')
    }))

    // T10：注册参考样式类型，使 templates/style-pack/default.elstyle 可导入。
    if (ctx.styles) {
      ctx.styles.register('theme', {
        version: 1,
        validate(payload) {
          const errors = []
          for (const name of Object.keys(payload.cssVars ?? {})) {
            if (!name.startsWith('--')) {
              errors.push(`css var must start with "--": ${name}`)
            }
          }
          return errors
        }
      })
    }
  }
}
