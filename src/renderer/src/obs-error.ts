/**
 * OBS 错误文案的**纯逻辑**（不依赖 DOM / React）。
 *
 * 为什么单独成文件：`tests/**` 属于 **tsconfig.node** 项目（`lib: ES2023`，**没有 DOM**），
 * 而 `useObsStream.ts` 用了 `window` ⇒ 测试若直接 import 它会连带类型检查 `window` 而报错。
 * 把纯函数放在这里 ⇒ 测试可以**真跑单测**（而不是只做源码文本断言），两全其美。
 */

/** OBS 要求密码、但软件里还没填 —— 界面据此**就地**给出输入框（方案 C）。 */
export const OBS_NEEDS_PASSWORD_HINT = 'OBS 要求密码，但软件里还没填。'

/**
 * 是否属于"缺密码/认证失败"这一类原始错误。
 * 只匹配认证相关字样，避免把普通连接失败误判成缺密码。
 */
export function needsPasswordFromError(raw: string | undefined): boolean {
  return typeof raw === 'string' && /password|authentication|identify/i.test(raw)
}
