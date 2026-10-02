/**
 * Playwright 全局 setup：为集成测试注入启动期测试缝。
 *
 * 为什么需要：`T34` 起，**升级后首次启动会弹「本次更新」**（遮罩覆盖全界面，
 * 属于正式软件应有的行为）。而集成测试每个 spec 都用**全新隔离 userData** 启动 ⇒
 * 每个都会弹 ⇒ 不关掉它，任何"点界面"的测试都会被遮罩挡住而超时。
 *
 * 33 个 spec 各自 `electron.launch`（无共用启动器，且都 `...process.env`），
 * 所以在这里**集中**注入一次即可全部生效，不必逐个文件改。
 *
 * 需要验证弹窗本身的 spec（`changelog-ui.spec.ts`）在自己的 launch env 里把它显式置空覆盖。
 */
export default function globalSetup(): void {
  process.env.EL_TEST_SKIP_WHATS_NEW = '1'
}
