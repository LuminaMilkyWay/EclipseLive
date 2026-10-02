import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    // 模块自带的测试按 `modules/<id>/tests/**` 约定自动纳入（不要按模块名硬编码——
    // 新增模块时漏改 include 会让它的测试静默不跑）。
    include: ['tests/unit/**/*.spec.ts', 'modules/*/tests/**/*.spec.ts'],
    // 回收测试泄漏的 el-* 临时目录：累积到数千条会让 Electron 起不来、NSIS 报
    // "Error writing temporary file"（都实际发生过，见 docs/BUILD.md §8.3/§8.6）。
    globalSetup: ['tests/unit/global-setup.ts']
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@contracts': resolve(__dirname, 'src/contracts')
    }
  }
})
