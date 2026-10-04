/**
 * providers：**厂商注册表**（API 选择器的数据源）。
 *
 * 为什么需要它（用户指出的真实问题）：**"plan 用户的 API 无法识别"** ——
 *   ① 有些厂商的**套餐**真能抵扣 API 调用（额度制）⇒ 预算口径应是"额度百分比"，不是人民币；
 *   ② 有些厂商的**订阅**（ChatGPT Plus / Claude Pro / Google AI Pro）**完全不含 API 额度** ✗
 *      ⇒ 用户以为"我买了 Plus 就能免费用"是一个**高频误解** ⇒ 必须在选择器里**明说**。
 * 因此每一项都带 `billing`：
 *   · `payg`         按量计费 ⇒ 人民币上限；
 *   · `plan`         **API 套餐**（额度制）⇒ 额度百分比上限；
 *   · `subscription` **工具订阅，不含 API 额度** ⇒ 选中时**必须确认**，之后按 `payg` 计费。
 *
 * ⚠️ 数据纪律：`baseUrl` 只写**官方文档里有的**；抄不到就留 `null`（由用户粘贴）。
 * 本文件是"厂商与计费模式"的**结构性数据**，价格数字一律放 `prices.json`（价格易变 ✗）。
 * 数据截至 2026-10-03，来源见各项 `sourceUrl`。
 */

/** MiMo Token Plan 个人版档位（官方页 2026-09-21 更新）。 */
export const MIMO_PLAN_TIERS = [
  { id: 'lite', label: 'Lite', cnyPerMonth: 39, creditsPerMonth: 4_100_000_000 },
  { id: 'standard', label: 'Standard', cnyPerMonth: 99, creditsPerMonth: 11_000_000_000 },
  { id: 'pro', label: 'Pro', cnyPerMonth: 329, creditsPerMonth: 38_000_000_000 },
  { id: 'max', label: 'Max', cnyPerMonth: 659, creditsPerMonth: 82_000_000_000 }
]

/**
 * 注册表。字段：
 *   id / label       选择器显示用
 *   billing          见文件头
 *   family           对应的模型家族（用于价目匹配与"是否主流"）
 *   baseUrl          官方 base（null ⇒ 让用户粘贴）
 *   plans            仅 `plan` 项：可选套餐档（含额度）
 *   warning          仅 `subscription` 项：给用户看的警告（Q3=a 要求确认）
 */
export const PROVIDERS = [
  {
    id: 'mimo',
    label: '小米 MiMo',
    billing: 'plan',
    family: ['mimo'],
    baseUrl: null,
    plans: MIMO_PLAN_TIERS,
    creditRules: {
      // 官方额度折算（Token Plan 页）：未命中缓存输入/输出 token 各扣多少 Credits
      'mimo-v2.6-pro': { input: 300, output: 600, cachedInput: 2.5 },
      'mimo-v2.6-flash': { input: 100, output: 200, cachedInput: 2 },
      'mimo-v2.5-pro': { input: 300, output: 600, cachedInput: 2.5 },
      'mimo-v2.5': { input: 100, output: 200, cachedInput: 2 },
      // ASR 按**音频小时**扣额度（官方：30M Credits/小时）
      'mimo-v2.5-asr': { perHourAudio: 30_000_000 }
    },
    sourceUrl: 'https://mimo.mi.com/docs/zh-CN/price/token-plan'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    billing: 'subscription',
    family: ['gpt', 'o1', 'o3', 'o4'],
    baseUrl: 'https://api.openai.com',
    warning: 'ChatGPT Plus/Pro 等订阅**不含 API 额度**：使用 API 会按量另计费。',
    sourceUrl: null
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    billing: 'subscription',
    family: ['claude'],
    baseUrl: 'https://api.anthropic.com',
    warning: 'Claude Pro/Max 等订阅**不含 API 额度**：使用 API 会按量另计费。',
    sourceUrl: null
  },
  {
    id: 'google',
    label: 'Google Gemini',
    billing: 'subscription',
    family: ['gemini', 'gemma'],
    baseUrl: 'https://generativelanguage.googleapis.com',
    warning: 'Google AI Pro 等订阅**不含 API 额度**：使用 API 会按量另计费。',
    sourceUrl: null
  },
  {
    id: 'zhipu',
    label: '智谱 GLM（含 Coding Plan）',
    billing: 'plan',
    family: ['glm', 'zhipu'],
    baseUrl: null, // Coding Plan 常用独立接入点 ⇒ 由用户粘贴（不猜）
    sourceUrl: 'https://docs.bigmodel.cn/cn/coding-plan/notice/usage-revision'
  },
  {
    id: 'zai',
    label: 'Z.AI DevPack（智谱国际）',
    billing: 'plan',
    family: ['glm'],
    baseUrl: null,
    sourceUrl: 'https://docs.z.ai/devpack/overview'
  },
  {
    id: 'kimi',
    label: 'Kimi 月之暗面（Kimi Code）',
    billing: 'plan',
    family: ['kimi', 'moonshot'],
    baseUrl: null,
    sourceUrl: 'https://www.kimi.com/code'
  },
  {
    id: 'qwen',
    label: '阿里云百炼 千问（Coding Plan）',
    billing: 'plan',
    family: ['qwen'],
    baseUrl: null,
    sourceUrl: 'https://www.alibabacloud.com/help/zh/model-studio/coding-plan'
  },
  {
    id: 'volcengine',
    label: '火山方舟（Agent/Coding Plan）',
    billing: 'plan',
    reseller: true,
    family: ['doubao', 'deepseek', 'kimi', 'glm'],
    baseUrl: null,
    sourceUrl: 'https://www.volcengine.com/product/ark'
  },
  {
    id: 'deepseek',
    label: '深度求索 DeepSeek',
    billing: 'payg',
    family: ['deepseek'],
    baseUrl: 'https://api.deepseek.com',
    sourceUrl: null
  },
  { id: 'minimax', label: 'MiniMax', billing: 'payg', family: ['minimax', 'abab'], baseUrl: null, sourceUrl: null },
  { id: 'stepfun', label: '阶跃星辰 Step', billing: 'payg', family: ['step'], baseUrl: null, sourceUrl: null },
  {
    id: 'openrouter',
    label: 'OpenRouter（聚合，参考价）',
    billing: 'payg',
    reseller: true,
    family: ['deepseek', 'qwen', 'glm', 'moonshot', 'kimi', 'minimax', 'step', 'gpt', 'claude', 'gemini', 'llama', 'mistral'],
    baseUrl: 'https://openrouter.ai/api',
    sourceUrl: 'https://openrouter.ai/docs'
  },
  { id: 'custom', label: '自建网关 / 其它兼容服务', billing: 'payg', family: [], baseUrl: null, sourceUrl: null }
]

/** 全部厂商（供选择器渲染）。 */
export function listProviders() {
  return PROVIDERS.map((p) => ({ ...p }))
}

/** 按 id 取一家（找不到 ⇒ null，不猜）。 */
export function getProvider(id) {
  const key = String(id ?? '').trim().toLowerCase()
  return PROVIDERS.find((p) => p.id === key) ?? null
}

/** 该厂商的计费模式（未知 ⇒ null）。 */
export function billingOf(id) {
  return getProvider(id)?.billing ?? null
}

/**
 * 选中该厂商时**是否必须先确认**（Q3=a：`subscription` 类必须确认一次）。
 * 返回 null 表示无需确认；返回字符串表示要显示的警告。
 */
export function confirmWarningFor(id) {
  const p = getProvider(id)
  if (!p) return null
  if (p.billing === 'subscription') return p.warning ?? '该订阅不含 API 额度，将按量计费。'
  return null
}

/** 该厂商是否需要"额度百分比"口径（plan 类 ✓）。 */
export function usesPlanQuota(id) {
  return billingOf(id) === 'plan'
}

/** 模型 id → 归属厂商（按 family 前缀匹配；用于把"检测到的 provider"对回注册表）。
 *  ⚠️ 优先**直接厂商**，其次才是转售/聚合商（`reseller: true`）：否则 `deepseek-chat`
 *  会被火山方舟或 OpenRouter 抢先认领（实测踩过）⇒ 计费模式与套餐档都会选错。
 */
export function providerForModel(modelId) {
  const s = String(modelId ?? '').toLowerCase()
  if (s === '') return null
  const tail = s.includes('/') ? s.split('/').slice(1).join('/') : s
  const hit = (p) => p.family.some((f) => tail.startsWith(f.toLowerCase()) || s.startsWith(f.toLowerCase()))
  const matches = PROVIDERS.filter(hit)
  if (matches.length === 0) return null
  const direct = matches.find((p) => p.reseller !== true)
  return (direct ?? matches[0]).id
}

/** 取得某模型的额度折算规则（plan 模式用；找不到 ⇒ null）。 */
export function creditRuleFor(providerId, modelId) {
  const p = getProvider(providerId)
  const rules = p?.creditRules
  if (!rules) return null
  const id = String(modelId ?? '').toLowerCase()
  for (const [k, v] of Object.entries(rules)) {
    if (k.toLowerCase() === id) return v
  }
  return null
}

/** 套餐档（按 id；找不到 ⇒ null）。 */
export function planTier(providerId, tierId) {
  const p = getProvider(providerId)
  const t = (p?.plans ?? []).find((x) => x.id === String(tierId ?? '').toLowerCase())
  return t ?? null
}
