// 练习公司（练习空间）共享契约（#3402 · Epic #3399）。
//
// 练习公司 = 挂在某家真实公司名下、专供操作导引写测试数据的子公司。中长期等模块的业务表都不可物理删除，
// 测试记录写进正式公司会永久留在持仓、套保、复盘里；落到练习公司则与正式数据隔离。
//
// 标记复用 identity.companies.source（值 PRACTICE），不另加列：source 原本只记录「怎么来的」
// （MANUAL / IMPORT / SEED），服务端没有按它分支的逻辑，扩成「来源 / 用途」不影响既有语义。
// 所有判断一律走 isPracticeCompany()，以后若要让库内 RLS 识别练习公司，再开迁移加独立列并回填，只改这一处。
//
// 纯数据 + 纯函数、零 Node 依赖，经 sync:web 同步给 dljy-web，前后端同一份口径。

export const PRACTICE_COMPANY_SOURCE = 'PRACTICE'
export const PRACTICE_NAME_PREFIX = '【练习】'
export const PRACTICE_SPACE_PATH = '/api/company/practice-space'

// 首次开通时顺带建的练习场站：中长期登记交易主体、合同绑定场站都要求场站属于本公司且登记为试点地区。
export const PRACTICE_STATION_SEEDS = Object.freeze([
  Object.freeze({ name: '【练习】风电场A', type: '风电', capacity: 50 }),
  Object.freeze({ name: '【练习】光伏电站B', type: '光伏', capacity: 30 }),
])

// 能建练习场站的地区 → 省份名（场站档案的 province 字段）。只收录中长期试点地区。
export const PRACTICE_STATION_REGIONS = Object.freeze({ yunnan: '云南' })

// 与 server/auth-store.mjs createCompany 的公司 ID 规则一致。
const COMPANY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/

export function isPracticeCompany(company) {
  return String(company?.source ?? '').trim().toUpperCase() === PRACTICE_COMPANY_SOURCE
}

/**
 * 某家公司对应的练习公司 ID（确定性，同一上级永远得到同一个 ID，开通接口据此幂等）。
 * 默认 `<上级ID>-practice`；超长或不合公司 ID 规则时改用 `practice-<上级ID 的 FNV-1a 32 位摘要>`。
 */
export function practiceCompanyIdFor(parentCompanyId) {
  const parent = String(parentCompanyId ?? '').trim()
  const direct = `${parent}-practice`
  if (parent && COMPANY_ID_PATTERN.test(direct)) return direct
  return `practice-${fnv1a32(parent)}`
}

/** 练习公司名称：上级名称加「【练习】」前缀（已带前缀的不重复加）。 */
export function practiceCompanyName(parentName) {
  const name = String(parentName ?? '').trim()
  return name.startsWith(PRACTICE_NAME_PREFIX) ? name : `${PRACTICE_NAME_PREFIX}${name}`
}

function fnv1a32(text) {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
