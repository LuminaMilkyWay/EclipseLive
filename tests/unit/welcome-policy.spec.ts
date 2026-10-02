import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 首发弹窗的"不越权"守卫。
 *
 * 背景：我们**不**做 EULA 式的"同意/拒绝"弹窗（法律上不必要，且强制点击构成 AGPL 不允许的
 * 附加限制）。首个弹窗只做**引导 + 隐私与许可说明**。这条守卫把该决定钉死：
 *   ① 弹窗**不得**出现限制性表述（不得再分发 / 禁止反编译 / 最终解释权 / 必须购买 …）；
 *   ② 弹窗**不得**出现"同意/拒绝"式措辞（不得要求用户接受协议，也不得因拒绝而退出）；
 *   ③ 必须包含"本机运行/不上传"的隐私说明与"许可与隐私"入口；
 *   ④ 说明文档必须含**优先级条款**（不修改开放源代码许可；冲突时以许可为准）；
 *   ⑤ 说明文档不得出现与 AGPL 冲突的限制性表述。
 */
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

/** 与 AGPL §10 相冲突、且已被否决的表述（出现即红）。 */
const FORBIDDEN = [
  '最终解释权',
  '不得再分发',
  '不得反编译',
  '逆向工程',
  '必须事先联系',
  '保留随时修改本协议',
  '删除本软件的全部副本'
]

describe('首发弹窗不越权（替代 EULA）', () => {
  const welcome = read('src/renderer/src/screens/Welcome.tsx')

  it('① 不得出现限制性表述（AGPL 不允许附加限制）', () => {
    const hits = FORBIDDEN.filter((f) => welcome.includes(f))
    expect(hits, `弹窗出现限制性表述：${hits.join('、')}`).toEqual([])
  })

  it('② 不得是"同意/拒绝"式弹窗（无拒绝、不因拒绝退出）', () => {
    expect(welcome, '不得要求用户"同意"协议').not.toMatch(/我(已)?同意|接受本协议|不同意.*退出/)
    expect(welcome, '不得有"拒绝"按钮').not.toMatch(/>\s*拒绝\s*</)
    expect(welcome, '必须有唯一的开始入口').toContain('开始使用')
  })

  it('③ 必须说明"本机运行/不上传"，并提供许可与隐私入口', () => {
    // 说人话也要钉住**概念**：数据留在本地、不上传
    expect(welcome, '必须说明数据留在本地').toMatch(/留在自己电脑|本机|本地/)
    expect(welcome, '必须说明不上传').toMatch(/不会上传|不上传/)
    expect(welcome, '必须能打开许可与隐私说明').toContain('许可与隐私')
  })

  it('④ 说明文档必须含优先级条款（以开放源代码许可为准）', () => {
    const doc = read('docs/USAGE-AND-PRIVACY.md')
    expect(doc, '必须声明不修改/不限制开放源代码许可').toMatch(/不修改、不替代、不限制/)
    expect(doc, '必须声明冲突时以许可为准').toMatch(/以开放源代码许可为准/)
  })

  it('⑤ 说明文档不得出现与 AGPL 冲突的限制性表述', () => {
    const doc = read('docs/USAGE-AND-PRIVACY.md')
    const hits = FORBIDDEN.filter((f) => doc.includes(f))
    expect(hits, `说明文档出现限制性表述：${hits.join('、')}`).toEqual([])
  })

  it('⑥ 不得为弹窗去改 App.tsx（棘轮约束）', () => {
    const app = read('src/renderer/src/App.tsx')
    expect(app, 'App.tsx 不应包含欢迎卡片逻辑').not.toContain('Welcome')
  })
})
