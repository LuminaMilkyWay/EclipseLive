#!/usr/bin/env node
/**
 * DCO 校验（无第三方依赖）。
 *
 * 规则（见 CONTRIBUTING.md「贡献协议」一节）：
 *   · 落点属于 MIT 区（src/contracts、templates、modules、docs）的提交 ⇒ **必须**带
 *     `Signed-off-by: 姓名 <邮箱>`（DCO）；
 *   · 落点属于核心区（src/main、src/preload、src/renderer、src/shared、tests、scripts）
 *     ⇒ 需要 CLA（人工登记，见 CLA-SIGNATORIES.md），本脚本只提示、不判定；
 *   · 同时触及两区 ⇒ 按核心区处理（提示 CLA），但**仍需** DCO 行。
 *
 * 用法：
 *   node scripts/check-signoff.mjs            # 检查最近 10 个提交
 *   node scripts/check-signoff.mjs 25         # 检查最近 25 个
 *   node scripts/check-signoff.mjs 1          # 只查最后一次（提交前自检）
 *
 * 退出码：0 = 全部合规；1 = 有缺失（列出具体提交与文件）。
 */
import { execFileSync } from 'node:child_process'

const MIT_PREFIXES = ['src/contracts/', 'templates/', 'modules/', 'docs/']
const CORE_PREFIXES = ['src/main/', 'src/preload/', 'src/renderer/', 'src/shared/', 'tests/', 'scripts/']
const SEP = '\u0001'

const count = Number.parseInt(process.argv[2] ?? '10', 10)
const limit = Number.isFinite(count) && count > 0 ? count : 10

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

let raw
try {
  raw = git(['log', `-${limit}`, `--pretty=format:%H${SEP}%s${SEP}%b${SEP}`, '--name-only'])
} catch (e) {
  console.error('无法读取 git 历史：' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}

// 按提交记录边界解析（每条记录以 40 位 sha + SEP 开头）
const records = raw
  .split(/\n(?=[0-9a-f]{40}\u0001)/)
  .map((r) => r.trim())
  .filter(Boolean)

for (const rec of records) {
  const lines = rec.split('\n')
  const head = lines[0].split(SEP)
  const hash = head[0]
  const subject = head[1] ?? ''
  const body = (rec.split(SEP)[2] ?? '').split('\n').slice(1).join('\n')
  const files = lines.slice(1).filter((l) => l.trim().length > 0)
  commits.push({ hash, subject, body, files })
}

const problems = []
for (const c of commits) {
  const touchesMit = c.files.some((f) => MIT_PREFIXES.some((p) => f.startsWith(p)))
  const touchesCore = c.files.some((f) => CORE_PREFIXES.some((p) => f.startsWith(p)))
  const signed = /^Signed-off-by:\s+.+<.+@.+>/m.test(c.body)
  if (touchesMit && !signed) {
    problems.push(`${c.hash.slice(0, 8)}  ${c.subject}\n    → MIT 区提交缺少 DCO 签名行（git commit -s）`)
  } else if (touchesCore && !touchesMit) {
    console.log(`· ${c.hash.slice(0, 8)} 核心区改动 ⇒ 需 CLA（人工登记 CLA-SIGNATORIES.md）：${c.subject}`)
  }
}

console.log(`\n检查范围：最近 ${commits.length} 个提交`)
if (problems.length === 0) {
  console.log('✅ DCO 全部合规')
  process.exit(0)
}
console.log(`❌ 有 ${problems.length} 个提交缺少 DCO 签名：\n`)
for (const p of problems) console.log('  ' + p)
console.log('\n修复：git commit -s（或 git rebase --signoff HEAD~N 后强推你的分支）')
process.exit(1)
