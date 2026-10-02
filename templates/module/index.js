/**
 * EclipseLIVE 模块模板（T6）。使用方法：复制整个目录到 modules/<你的-id>
 * 并把目录名与 manifest.json 的 id 改成一致（kebab-case）。
 *
 * 生命周期语义与所有权规则见 src/contracts/module.ts 与
 * src/main/core/modules/README.md：
 * - 权限/事件/路由/频道均为清单闭集，未声明的一律被拒绝；
 * - 事件发布 source 强制为模块 id；
 * - init/start 抛错只标记本模块 failed，不影响核心与其它模块。
 */
module.exports = {
  /**
   * @param {import('../../src/contracts/module').ModuleContext} ctx
   */
  async init(ctx) {
    // ctx.logger.info('ready')
    // ctx.config.get() / ctx.config.set({...})
    // ctx.bus.publish('my-module:some-event', { ... })
    // ctx.gateway.registerHttpRoute('GET', '/my-module/x', () => ({ status: 200 }))
    // ctx.permissions.check('file-read')
  },
  async start() {},
  async stop() {}
}
