#!/usr/bin/env node
/**
 * 主仓 → SDK 单向镜像（P4）。零依赖。
 *
 * 为什么需要它：`sdk/` 采用 **MIT**，是模块作者的唯一入口；它必须是主仓
 * `src/contracts/` 与 `templates/` 的**逐字节镜像**。手工复制必然漂移 ⇒
 * 用脚本同步 + `tests/unit/sdk-mirror.spec.ts` 守卫（不一致即红）。
 *
 * 用法：node scripts/sync-sdk.mjs
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const PAIRS = [
  ['src/contracts', 'sdk/contracts'],
  ['templates', 'sdk/templates']
]

for (const [from, to] of PAIRS) {
  const src = join(ROOT, from)
  const dst = join(ROOT, to)
  await rm(dst, { recursive: true, force: true })
  await mkdir(dst, { recursive: true })
  await cp(src, dst, { recursive: true })
  const n = (await readdir(dst, { recursive: true })).length
  console.log(`  ${from} -> ${to}  (${n} 项)`)
}
console.log('✓ SDK 镜像已同步。请运行 npx vitest run tests/unit/sdk-mirror.spec.ts 复核。')
