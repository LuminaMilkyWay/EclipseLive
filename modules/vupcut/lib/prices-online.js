/**
 * prices-online：**在线价目**（用户 Q4=b：优先在线更新，内置兜底；Q2=(b)：每次启动刷新 + 手动刷新）。
 *
 * 关键设计（用户设想"先拉有哪些主流模型，再拉它们的价目"）：
 *   OpenRouter 的模型目录接口**一次就同时给出「有哪些模型」与「它们的价目」**：
 *     GET https://openrouter.ai/api/v1/models
 *     data[].id / data[].name / data[].context_length / data[].pricing.prompt|completion（USD/token）
 *   ⇒ 不需要第二个数据源：清单用于"有哪些主流模型"，pricing 用于价目表。
 *
 * ⚠️ 三条纪律：
 *   ① **外部数据一律不可信** ⇒ 解析写成**防御式**：字段缺失/类型异常/价格为负 ⇒ 跳过并**计数**，
 *      绝不因一条坏数据让整表作废，也绝不抛异常打断启动；
 *   ② **未获用户同意 ⇒ 不发起任何请求**（`enabled:false` 时直接返回内置/缓存）；
 *   ③ **last-good 缓存**：拉到好数据才覆盖缓存；失败时用上次成功的结果，再退内置。
 *
 * ⚠️ 诚实说明：OpenRouter 的价格是**它的参考价（USD）**，不等于各家官方人民币价 ⇒
 * 表里如实标注 `source`，跨币种换算必须显式填 `fxToCny`，否则显示 USD 并标注"未换算"。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PRICE_TABLE_VERSION, mergePriceTables, validatePriceTable } from './cost.js'

/** 默认数据源（可在设置里改；用户也可关闭在线更新）。 */
export const DEFAULT_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** 视为"主流"的家族前缀（Q3=a：可编辑白名单 ⇒ 界面干净；新家族可自行添加）。 */
export const DEFAULT_FAMILIES = [
  'deepseek',
  'qwen',
  'glm',
  'zhipu',
  'moonshot',
  'kimi',
  'minimax',
  'abab',
  'step',
  'gpt',
  'o1',
  'o3',
  'o4',
  'claude',
  'gemini',
  'gemma',
  'llama',
  'mistral',
  'yi',
  'doubao',
  'hunyuan'
]

const CACHE_FILE = 'prices.online.json'
const round6 = (n) => Math.round(n * 1e6) / 1e6

/** USD/token → 每 1M token 的 USD 数（OpenRouter 的 pricing 字段是"每 token"的字符串）。 */
export function toPerMillion(usdPerToken) {
  const n = typeof usdPerToken === 'string' ? Number(usdPerToken) : typeof usdPerToken === 'number' ? usdPerToken : NaN
  if (!Number.isFinite(n) || n < 0) return null
  return round6(n * 1_000_000)
}

/** 模型 id 是否属于"主流家族"（前缀匹配，大小写不敏感）。 */
export function isMainstream(id, families = DEFAULT_FAMILIES) {
  const s = String(id ?? '').toLowerCase()
  if (s === '') return false
  // OpenRouter 的 id 形如 `deepseek/deepseek-chat`、`openai/gpt-4o-mini`
  const tail = s.includes('/') ? s.split('/').slice(1).join('/') : s
  return families.some((f) => tail.startsWith(String(f).toLowerCase()) || s.startsWith(String(f).toLowerCase()))
}

/**
 * 解析 OpenRouter 的模型目录（**防御式**）。
 * @returns {{table:object, stats:{total:number,kept:number,skipped:number,families:string[],names:Array<{id:string,name:string}>}}}
 */
export function parseOpenRouterModels(json, { families = DEFAULT_FAMILIES, asOf = null } = {}) {
  const list = Array.isArray(json?.data) ? json.data : []
  const stats = { total: list.length, kept: 0, skipped: 0, families: [], names: [] }
  const models = []
  const seen = new Set()

  for (const raw of list) {
    try {
      const id = typeof raw?.id === 'string' ? raw.id.trim() : ''
      const input = toPerMillion(raw?.pricing?.prompt)
      const output = toPerMillion(raw?.pricing?.completion)
      if (id === '' || input === null || output === null || (input === 0 && output === 0)) {
        stats.skipped += 1
        continue
      }
      if (!isMainstream(id, families)) {
        stats.skipped += 1
        continue
      }
      // 同一 id 只留一次（目录里可能有重复条目）
      const key = id.toLowerCase()
      if (seen.has(key)) {
        stats.skipped += 1
        continue
      }
      seen.add(key)
      const fam = (id.includes('/') ? id.split('/')[0] : id.split('-')[0]).toLowerCase()
      if (!stats.families.includes(fam)) stats.families.push(fam)
      stats.names.push({ id, name: typeof raw?.name === 'string' ? raw.name : id })
      // match 用**完整 id 的部分**：优先"厂商/模型"全写（更具体），命中时 pickPrice 会取最长模式
      models.push({
        match: id,
        currency: 'USD',
        input,
        output,
        note: `OpenRouter 参考价（${typeof raw?.name === 'string' ? raw.name : id}）`
      })
      // 再补一条"去掉厂商前缀"的短模式，方便用户填的模型名（如 `deepseek-chat`）也能命中
      const tail = id.includes('/') ? id.split('/').slice(1).join('/') : ''
      if (tail !== '' && !seen.has(`~${tail}`)) {
        seen.add(`~${tail}`)
        models.push({ match: tail, currency: 'USD', input, output, note: `OpenRouter 参考价（${tail}）` })
      }
      stats.kept += 1
    } catch {
      stats.skipped += 1
    }
  }

  const table = {
    version: PRICE_TABLE_VERSION,
    currency: 'USD',
    asOf,
    source: 'openrouter',
    note: '来源 OpenRouter 模型目录（参考价，美元/1M token）。它不等于各家官方人民币价；如需换算请填 fxToCny。',
    fxToCny: {},
    models
  }
  return { table, stats }
}

/** 缓存路径（放在模块的数据目录下，由调用方给出）。 */
export function cachePath(dir) {
  return join(dir, CACHE_FILE)
}

/** 读 last-good 缓存（不存在/损坏 ⇒ 返回 null，不抛）。 */
export async function loadCachedTable(dir) {
  if (!dir) return null
  try {
    const text = await readFile(cachePath(dir), 'utf8')
    const t = JSON.parse(text)
    return validatePriceTable(t).ok ? t : null
  } catch {
    return null
  }
}

/** 写 last-good 缓存（只有校验通过的表才写；失败静默 —— 缓存不是关键路径）。 */
export async function saveCachedTable(dir, table) {
  if (!dir || !validatePriceTable(table).ok) return false
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(cachePath(dir), JSON.stringify(table, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 刷新在线价目（**永不抛异常**；未获同意 ⇒ 不发请求）。
 *
 * @param {object} a
 * @param {boolean} a.enabled 用户是否已同意联网
 * @param {(url:string)=>Promise<unknown>} a.fetchJson 注入的取数函数（生产走 C2 门面；测试用假实现）
 * @param {string} [a.url] 数据源（默认 OpenRouter）
 * @param {string} [a.cacheDir] last-good 缓存目录
 * @param {object} a.builtin 内置价目表
 * @param {object} [a.userOverride] 用户覆盖（优先级最高）
 * @param {string[]} [a.families] 主流家族白名单
 * @param {() => number} [a.now] 取时间（便于测试）
 * @returns {Promise<{ok:boolean, source:'user'|'online'|'cache'|'builtin', table:object,
 *                    stats?:object, error?:string}>}
 */
export async function refreshPrices({
  enabled,
  fetchJson,
  url = DEFAULT_MODELS_URL,
  cacheDir = null,
  builtin,
  userOverride = null,
  families = DEFAULT_FAMILIES,
  now = () => Date.now()
}) {
  const finish = (base) => ({
    ...base,
    table: userOverride ? mergePriceTables(base.table, userOverride) : base.table
  })

  // 未获同意 ⇒ 不发请求（红线：local-first，默认关）
  if (!enabled) {
    const cached = await loadCachedTable(cacheDir)
    return finish(cached ? { ok: true, source: 'cache', table: cached } : { ok: true, source: 'builtin', table: builtin })
  }

  try {
    const json = await fetchJson(url)
    const { table, stats } = parseOpenRouterModels(json, { families, asOf: new Date(now()).toISOString().slice(0, 10) })
    const checked = validatePriceTable(table)
    if (!checked.ok) {
      // 校验不过 ⇒ 丢弃，继续用缓存/内置（绝不让坏数据进预算判断）
      const cached = await loadCachedTable(cacheDir)
      return finish(
        cached
          ? { ok: false, source: 'cache', table: cached, error: `在线价目不合格：${checked.errors.join('；')}` }
          : { ok: false, source: 'builtin', table: builtin, error: `在线价目不合格：${checked.errors.join('；')}` }
      )
    }
    if (table.models.length === 0) {
      const cached = await loadCachedTable(cacheDir)
      return finish(
        cached
          ? { ok: false, source: 'cache', table: cached, error: '在线价目里没有可用条目（可能接口结构变了）' }
          : { ok: false, source: 'builtin', table: builtin, error: '在线价目里没有可用条目（可能接口结构变了）' }
      )
    }
    await saveCachedTable(cacheDir, table)
    return finish({ ok: true, source: 'online', table, stats })
  } catch (e) {
    const cached = await loadCachedTable(cacheDir)
    const msg = e !== null && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
    const error = `在线更新失败：${msg.slice(0, 120)}`
    return finish(cached ? { ok: false, source: 'cache', table: cached, error } : { ok: false, source: 'builtin', table: builtin, error })
  }
}
