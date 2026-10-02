import { readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 仅回收本项目集成测试创建的前缀（各 spec 用 mkdtempSync(join(tmpdir(), 'el-…'))）。 */
const PREFIX = 'el-'

/** 只回收"上一个运行周期之前"的目录，避免误删并行运行的另一个测试进程正在使用的目录。 */
const MIN_AGE_MS = 5 * 60 * 1000

/**
 * 集成测试临时目录回收（globalTeardown）。
 *
 * 背景：每个 `_electron.launch()` 都会按 spec 传入的前缀在 tmpdir 下创建隔离 userData，
 * 而历史上**从不清理**——6 天累积 27,184 个目录（约 60GB），把 `%TEMP%` 撑到 29,635 项。
 * 后果不止占盘：**NSIS 安装器需要先把载荷解到 `%TEMP%\nsXXXX.tmp`**，面对被撑爆的临时目录
 * 会直接报 `NSIS Error: Error writing temporary file. Make sure your temp folder is valid`
 * 而无法安装（2026-09-28 实测复现）。
 *
 * 故在整套测试结束后统一回收。失败不抛错：占用中/权限不足的目录跳过即可，不影响测试结论。
 */
export default function globalTeardown(): void {
  const dir = tmpdir()
  const now = Date.now()
  let removed = 0
  let kept = 0

  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }

  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue
    const full = join(dir, name)
    try {
      if (!statSync(full).isDirectory()) continue
      if (now - statSync(full).mtimeMs < MIN_AGE_MS) {
        kept++
        continue
      }
      rmSync(full, { recursive: true, force: true, maxRetries: 2 })
      removed++
    } catch {
      kept++
    }
  }

  if (removed > 0 || kept > 0) {
    console.log(`[teardown] 回收测试隔离 userData：删除 ${removed} 个，保留 ${kept} 个（占用中/过新）`)
  }
}
