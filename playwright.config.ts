import { defineConfig } from '@playwright/test'

/**
 * Electron 集成测试：无需浏览器二进制，_electron 直接使用本地 electron 包。
 * 运行方式：npm run test:integration（先 build 再测试）。
 */
export default defineConfig({
  testDir: 'tests/integration',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // 注入启动期测试缝（EL_TEST_SKIP_WHATS_NEW）：否则"首次启动弹本次更新"的遮罩
  // 会挡住所有点界面的测试。集中一处注入，不必改 33 个 spec。
  globalSetup: './tests/integration/global-setup.ts',
  // 回收各 spec 在 tmpdir 下创建的隔离 userData（前缀 el-）。不清理会把 %TEMP% 撑爆，
  // 进而导致 NSIS 安装器报 "Error writing temporary file" 无法安装（详见该文件注释）。
  globalTeardown: './tests/integration/global-teardown.ts'
})
