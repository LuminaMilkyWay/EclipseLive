import { readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * vitest 全局 setup/teardown：回收测试泄漏的 `el-*` 临时目录。
 *
 * 为什么需要：每个测试用的 rig 都会 `mkdtemp('el-…')`（config/modules/credentials 等
 * 都写在里面），而**只有 Playwright 侧有回收钩子**。跑几十次单测后 `%TEMP%` 会累积到数千条，
 * 后果不是"占点磁盘"而是**真实故障**：
 * - Electron/Chromium 起不来（`Process failed to launch!`）
 * - NSIS 安装器报 `Error writing temporary file`
 * 两者都实际发生过（见 docs/BUILD.md §8.3 / §8.6 与 INCIDENT 报告）。
 *
 * 策略：**只在 setup 时**回收"超过 5 分钟"的目录（正在跑的测试目录不会被误删），
 * 与 `tests/integration/global-teardown.ts` 同一阈值。teardown 侧不删——
 * 刚建出来的目录还很新，删不掉，等下一轮 setup 处理即可。
 */

const PREFIX = 'el-'
const MAX_AGE_MS = 5 * 60 * 1000

export async function setup(): Promise<void> {
  const root = tmpdir()
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return // 读不到临时目录就当无事发生：清理是尽力而为，不该影响测试
  }

  const now = Date.now()
  let removed = 0
  let failed = 0
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue
    const full = join(root, name)
    try {
      const info = await stat(full)
      if (!info.isDirectory()) continue
      if (now - info.mtimeMs < MAX_AGE_MS) continue
      await rm(full, { recursive: true, force: true, maxRetries: 2 })
      removed += 1
    } catch {
      // 占用中/权限不足：跳过即可，下一轮再试
      failed += 1
    }
  }

  if (removed > 0 || failed > 0) {
    // eslint-disable-next-line no-console
    console.log(`[vitest setup] 回收测试临时目录：删除 ${removed} 个，跳过 ${failed} 个`)
  }
}
