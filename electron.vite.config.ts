import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * electron-vite 三通道构建：
 * - main    Electron 主进程（核心 12 服务所在，T1 起逐卡填充）
 * - preload contextIsolation 受限桥（主窗 index 富桥 + T26 overlay 悬浮窗最小 resize 桥——
 *          悬浮窗载入模块网关页面，绝不能复用富桥）
 * - renderer React 管理界面（本软件的第一个"接口消费者"）
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared'), '@contracts': resolve('src/contracts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared'), '@contracts': resolve('src/contracts') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          overlay: resolve('src/preload/overlay.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  }
})
