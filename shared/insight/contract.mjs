// 市场洞察共享契约（#2993，Epic #2989）：查询上下文、请求、区块结果与错误的唯一形状。
//
// 设计依据：工作区 OpenSpec 变更 build-yunnan-regional-market-insight 的 design D3/D4/D4.1。
// 前后端同构、零依赖：Node 洞察域与 dljy-web 服务层共用本文件做入参与响应校验。
//
// 三条底线（都在本文件用代码守住，不靠调用方自觉）：
//   1. 影响口径的未知字段一律拒绝，不静默丢弃——多一个没人认识的筛选条件，结果就不是用户以为的口径。
//   2. 只接受已登记的 analysisId；自由 SQL、任意表名或数据路径一律 400，未登记分析 404。
//   3. 无权时区块里不得出现数据、覆盖或来源细节——「有没有这份私有资料」本身就是私有信息。

export const INSIGHT_SCHEMA_VERSION = 'insight/v1'
/** 市场业务日一律按北京时间表达（DE03）。 */
export const INSIGHT_TIME_ZONE = 'Asia/Shanghai'
/** 单次分析的业务窗上限（D10 研究预览初始上限同为 366 天）。 */
export const MAX_WINDOW_DAYS = 366
export const MAX_OBJECT_REFS = 200
export const PAGE_SIZE_DEFAULT = 50
export const PAGE_SIZE_MAX = 200

/** HTTP 状态与错误码：空结果是带原因的成功，下面这些都不能吞成空（D4）。 */
export const INSIGHT_ERRORS = Object.freeze({
  BAD_REQUEST: { status: 400, code: 'BAD_REQUEST' },
  UNKNOWN_FIELD: { status: 400, code: 'UNKNOWN_FIELD' },
  FORBIDDEN_FIELD: { status: 400, code: 'FORBIDDEN_FIELD' },
  LIMIT_EXCEEDED: { status: 400, code: 'LIMIT_EXCEEDED' },
  UNPROCESSABLE: { status: 422, code: 'UNPROCESSABLE' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN' },
  NOT_REGISTERED: { status: 404, code: 'NOT_REGISTERED' },
  VERSION_CONFLICT: { status: 409, code: 'VERSION_CONFLICT' },
  UNAVAILABLE: { status: 503, code: 'UNAVAILABLE' },
})

export class InsightContractError extends Error {
  /**
   * @param {{status:number, code:string}} kind INSIGHT_ERRORS 中的一项
   * @param {string} message 面向用户的中文原因
   * @param {Record<string, unknown>} [details] 可选的结构化细节（字段名、上限等），不含凭据或内部 SQL
   */
  constructor(kind, message, details) {
    super(message)
    this.name = 'InsightContractError'
    this.status = kind.status
    this.code = kind.code
    if (details) this.details = details
  }
}
const fail = (kind, message, details) => { throw new InsightContractError(kind, message, details) }

// ── 运行时六维（与静态能力四值 available/degraded/hidden/not-configured 正交，D3）──────────
export const ACCESS_STATES = Object.freeze(['granted', 'denied'])
export const AVAILABILITY_STATES = Object.freeze(['complete', 'partial', 'empty', 'failed'])
/**
 * 缺数/失败的业务原因（DE02）。无权限不在这里——它是 access 维度，不能表现为「零数据」。
 *   not-enabled     功能未开通          not-applicable  业务不适用（该地区没有这类来源）
 *   not-onboarded   来源未接入          not-published   尚未发布（未到应发布时刻）
 *   beyond-coverage 日期超出已入库覆盖   partial-missing 部分缺测
 *   quality-rejected 质量不合格被剔除    source-disabled 来源已停用
 *   upstream-failure 上游或存储故障（技术故障，不得包装成尚未发布）
 */
export const AVAILABILITY_REASONS = Object.freeze([
  'not-enabled', 'not-applicable', 'not-onboarded', 'not-published', 'beyond-coverage',
  'partial-missing', 'quality-rejected', 'source-disabled', 'upstream-failure',
])
export const FRESHNESS_STATES = Object.freeze(['fresh', 'stale', 'unknown'])
/** 沿用既有 basis 词汇（dljy-web data/types.ts DataSourceBasis 的子集）；洞察正式结果不产出 synthetic。 */
export const RESULT_BASIS = Object.freeze(['captured', 'real', 'provisional', 'empty'])
/** 派生程度：source 原样 / aligned 仅时间对齐 / aggregated 聚合 / derived 由多个输入计算。 */
export const DERIVATIONS = Object.freeze(['source', 'aligned', 'aggregated', 'derived'])
export const COMPARABILITY_STATES = Object.freeze(['compatible', 'incompatible', 'insufficient'])
export const ANALYSIS_MODES = Object.freeze(['ex-post', 'ex-ante'])
export const MARKET_PHASES = Object.freeze(['day-ahead', 'real-time'])
/**
 * 价格对象（PR01）：经济含义或来源不同，不得合并为「云南电价」，也不得互相替补。
 *   user-price 用户侧价格 · public-node 公开历史节点价 · company-node 获权厂侧节点价
 *   plant-node 场站关联节点价 · settlement-price 场站已结算价格引用
 */
export const PRICE_OBJECTS = Object.freeze(['user-price', 'public-node', 'company-node', 'plant-node', 'settlement-price'])

const REGION_RE = /^[a-z][a-z-]{1,39}$/
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-/]{0,199}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/
const ANALYSIS_ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/
/** 请求里出现这些键就说明调用方想绕开白名单直接指定数据来源或计算表达式。 */
const FORBIDDEN_KEYS = Object.freeze(['sql', 'query', 'expression', 'formula', 'table', 'schema', 'path', 'family', 'datasetKey', 'url'])

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const DAY_MS = 86_400_000

/** 校验 YYYY-MM-DD 是日历上存在的日期，返回 UTC 零点毫秒。 */
export function calendarDayMs(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) fail(INSIGHT_ERRORS.BAD_REQUEST, '日期格式应为 YYYY-MM-DD')
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) fail(INSIGHT_ERRORS.BAD_REQUEST, `日期不存在：${value}`)
  return ms
}

function assertKnownKeys(value, allowed, where) {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) fail(INSIGHT_ERRORS.FORBIDDEN_FIELD, `${where}不接受「${key}」：只能选择已登记的分析与筛选条件`, { field: key })
    if (!allowed.includes(key)) fail(INSIGHT_ERRORS.UNKNOWN_FIELD, `${where}含未知字段「${key}」，为避免口径被悄悄改变，请求被拒绝`, { field: key })
  }
}

function optionalEnum(value, values, label) {
  if (value === undefined || value === null) return null
  if (!values.includes(value)) fail(INSIGHT_ERRORS.BAD_REQUEST, `${label}不在允许范围：${String(value)}`)
  return value
}

function parseObjectRef(ref, index) {
  if (!isObject(ref)) fail(INSIGHT_ERRORS.BAD_REQUEST, `第 ${index + 1} 个对象引用格式不正确`)
  assertKnownKeys(ref, ['type', 'id', 'effectiveAt'], '对象引用')
  if (typeof ref.type !== 'string' || !/^[a-z][a-z-]{1,39}$/.test(ref.type)) fail(INSIGHT_ERRORS.BAD_REQUEST, '对象类型不正确')
  if (typeof ref.id !== 'string' || !ID_RE.test(ref.id)) fail(INSIGHT_ERRORS.BAD_REQUEST, '对象标识不正确')
  if (ref.effectiveAt !== undefined && (typeof ref.effectiveAt !== 'string' || !DATE_RE.test(ref.effectiveAt))) fail(INSIGHT_ERRORS.BAD_REQUEST, '对象生效日期格式不正确')
  return Object.freeze({ type: ref.type, id: ref.id, ...(ref.effectiveAt ? { effectiveAt: ref.effectiveAt } : {}) })
}

/** 业务窗：闭区间业务日，北京时间，长度不超过 MAX_WINDOW_DAYS。 */
export function parseBusinessWindow(value) {
  if (!isObject(value)) fail(INSIGHT_ERRORS.BAD_REQUEST, '请选择业务日期范围')
  assertKnownKeys(value, ['start', 'end', 'timeZone'], '业务日期范围')
  const start = calendarDayMs(value.start), end = calendarDayMs(value.end)
  if (end < start) fail(INSIGHT_ERRORS.BAD_REQUEST, '结束日期不能早于开始日期')
  const days = (end - start) / DAY_MS + 1
  if (days > MAX_WINDOW_DAYS) fail(INSIGHT_ERRORS.LIMIT_EXCEEDED, `单次分析最多 ${MAX_WINDOW_DAYS} 天，请缩小日期范围`, { maxDays: MAX_WINDOW_DAYS, days })
  if (value.timeZone !== undefined && value.timeZone !== INSIGHT_TIME_ZONE) fail(INSIGHT_ERRORS.BAD_REQUEST, `业务日期按北京时间（${INSIGHT_TIME_ZONE}）表达`)
  return Object.freeze({ start: value.start, end: value.end, timeZone: INSIGHT_TIME_ZONE, days })
}

/**
 * 洞察查询上下文（D3）。地区沿用全局地区；公司、主体只是「请求的业务范围」，
 * 不是授权凭据——服务端按登录身份重新解析，客户端写什么都不能扩权。
 */
export function parseInsightContext(input) {
  if (!isObject(input)) fail(INSIGHT_ERRORS.BAD_REQUEST, '缺少查询上下文')
  assertKnownKeys(input, ['regionId', 'companyId', 'subjectId', 'objectRefs', 'businessWindow', 'marketPhase', 'priceObject', 'sourceIds', 'mode', 'asOf', 'contextVersion'], '查询上下文')
  if (typeof input.regionId !== 'string' || !REGION_RE.test(input.regionId)) fail(INSIGHT_ERRORS.BAD_REQUEST, '请选择地区')
  for (const key of ['companyId', 'subjectId']) {
    if (input[key] !== undefined && input[key] !== null && (typeof input[key] !== 'string' || !ID_RE.test(input[key]))) fail(INSIGHT_ERRORS.BAD_REQUEST, `${key === 'companyId' ? '公司' : '主体'}标识不正确`)
  }
  const refs = input.objectRefs ?? []
  if (!Array.isArray(refs)) fail(INSIGHT_ERRORS.BAD_REQUEST, '对象引用应为列表')
  if (refs.length > MAX_OBJECT_REFS) fail(INSIGHT_ERRORS.LIMIT_EXCEEDED, `一次最多选择 ${MAX_OBJECT_REFS} 个对象`, { maxObjects: MAX_OBJECT_REFS })
  const objectRefs = refs.map(parseObjectRef)
  const sourceIds = input.sourceIds ?? []
  if (!Array.isArray(sourceIds) || sourceIds.some(id => typeof id !== 'string' || !ID_RE.test(id))) fail(INSIGHT_ERRORS.BAD_REQUEST, '来源选择格式不正确')
  if (new Set(sourceIds).size !== sourceIds.length) fail(INSIGHT_ERRORS.BAD_REQUEST, '来源选择有重复')
  const mode = optionalEnum(input.mode ?? 'ex-post', ANALYSIS_MODES, '分析模式')
  let asOf = null
  if (input.asOf !== undefined && input.asOf !== null) {
    if (typeof input.asOf !== 'string' || !INSTANT_RE.test(input.asOf) || !Number.isFinite(Date.parse(input.asOf))) fail(INSIGHT_ERRORS.BAD_REQUEST, '截止时点必须是带时区的完整时间')
    asOf = input.asOf
  }
  // 事前模式没有截止时点就无法判断「当时可得」，只能拒绝，不能默认成现在（RS04）。
  if (mode === 'ex-ante' && !asOf) fail(INSIGHT_ERRORS.BAD_REQUEST, '事前分析必须给出截止时点')
  const contextVersion = input.contextVersion ?? 0
  if (!Number.isSafeInteger(contextVersion) || contextVersion < 0) fail(INSIGHT_ERRORS.BAD_REQUEST, '上下文代次必须是非负整数')
  return Object.freeze({
    regionId: input.regionId,
    companyId: input.companyId ?? null,
    subjectId: input.subjectId ?? null,
    objectRefs: Object.freeze(objectRefs),
    businessWindow: parseBusinessWindow(input.businessWindow),
    marketPhase: optionalEnum(input.marketPhase, MARKET_PHASES, '市场阶段'),
    priceObject: optionalEnum(input.priceObject, PRICE_OBJECTS, '价格对象'),
    sourceIds: Object.freeze([...sourceIds]),
    mode,
    asOf,
    contextVersion,
  })
}

/** 期望结果版本：下钻、翻页、导出、保存时带上，服务端据此核验或返回冲突（D4.1）。 */
export function parseExpectedResult(value) {
  if (value === undefined || value === null) return null
  if (!isObject(value)) fail(INSIGHT_ERRORS.BAD_REQUEST, '期望结果版本格式不正确')
  assertKnownKeys(value, ['resultVersion', 'readSetRef'], '期望结果版本')
  if (!isResultVersion(value.resultVersion) || !isReadSetRef(value.readSetRef)) fail(INSIGHT_ERRORS.BAD_REQUEST, '期望结果版本格式不正确')
  return Object.freeze({ resultVersion: value.resultVersion, readSetRef: value.readSetRef })
}

const RESULT_VERSION_RE = /^rv1:[0-9a-f]{64}$/
const READ_SET_REF_RE = /^rs1:[0-9a-f]{64}$/
export const isResultVersion = value => typeof value === 'string' && RESULT_VERSION_RE.test(value)
export const isReadSetRef = value => typeof value === 'string' && READ_SET_REF_RE.test(value)

/**
 * 分析查询请求（POST /api/v1/market-insight/query）。
 * @param {unknown} body
 * @param {{ getAnalysis: (id: string) => ({ filters?: Record<string, (v: unknown) => unknown> } | null) }} catalog
 */
export function parseQueryRequest(body, catalog) {
  if (!isObject(body)) fail(INSIGHT_ERRORS.BAD_REQUEST, '请求体应为对象')
  assertKnownKeys(body, ['analysisId', 'context', 'filters', 'page', 'expected'], '分析请求')
  if (typeof body.analysisId !== 'string' || !ANALYSIS_ID_RE.test(body.analysisId)) fail(INSIGHT_ERRORS.BAD_REQUEST, '分析标识格式不正确')
  const analysis = catalog.getAnalysis(body.analysisId)
  if (!analysis) fail(INSIGHT_ERRORS.NOT_REGISTERED, `未登记的分析：${body.analysisId}`)
  const context = parseInsightContext(body.context)
  const rawFilters = body.filters ?? {}
  if (!isObject(rawFilters)) fail(INSIGHT_ERRORS.BAD_REQUEST, '筛选条件应为对象')
  const validators = analysis.filters ?? {}
  assertKnownKeys(rawFilters, Object.keys(validators), '筛选条件')
  const filters = Object.freeze(Object.fromEntries(Object.entries(rawFilters).map(([key, value]) => [key, validators[key](value)])))
  return Object.freeze({ analysisId: body.analysisId, analysis, context, filters, page: parsePage(body.page), expected: parseExpectedResult(body.expected) })
}

export function parsePage(value) {
  if (value === undefined || value === null) return Object.freeze({ size: PAGE_SIZE_DEFAULT, cursor: null })
  if (!isObject(value)) fail(INSIGHT_ERRORS.BAD_REQUEST, '分页参数格式不正确')
  assertKnownKeys(value, ['size', 'cursor'], '分页参数')
  const size = value.size ?? PAGE_SIZE_DEFAULT
  if (!Number.isSafeInteger(size) || size < 1) fail(INSIGHT_ERRORS.BAD_REQUEST, '每页条数必须是正整数')
  if (size > PAGE_SIZE_MAX) fail(INSIGHT_ERRORS.LIMIT_EXCEEDED, `每页最多 ${PAGE_SIZE_MAX} 条`, { maxPageSize: PAGE_SIZE_MAX })
  if (value.cursor !== undefined && value.cursor !== null && (typeof value.cursor !== 'string' || value.cursor.length > 512)) fail(INSIGHT_ERRORS.BAD_REQUEST, '分页游标格式不正确')
  return Object.freeze({ size, cursor: value.cursor ?? null })
}

// ── 区块结果 ─────────────────────────────────────────────────────────────────────────────

/** 运行时状态六维；denied 时其余维度只能是「未知」，不透露私有资料是否存在。 */
export function assertRuntimeStatus(runtime) {
  if (!isObject(runtime)) fail(INSIGHT_ERRORS.UNPROCESSABLE, '区块缺少运行时状态')
  if (!ACCESS_STATES.includes(runtime.access)) fail(INSIGHT_ERRORS.UNPROCESSABLE, '区块授权状态不正确')
  const availability = runtime.availability
  if (!isObject(availability) || !AVAILABILITY_STATES.includes(availability.state)) fail(INSIGHT_ERRORS.UNPROCESSABLE, '区块可用性状态不正确')
  if (availability.reason !== undefined && availability.reason !== null && !AVAILABILITY_REASONS.includes(availability.reason)) fail(INSIGHT_ERRORS.UNPROCESSABLE, `未登记的缺数原因：${availability.reason}`)
  if (['empty', 'failed', 'partial'].includes(availability.state) && !availability.reason) fail(INSIGHT_ERRORS.UNPROCESSABLE, '缺数或失败的区块必须给出原因')
  if (availability.state === 'failed' && availability.reason !== 'upstream-failure' && availability.reason !== 'source-disabled') fail(INSIGHT_ERRORS.UNPROCESSABLE, '失败区块的原因只能是上游故障或来源停用')
  if (!isObject(runtime.freshness) || !FRESHNESS_STATES.includes(runtime.freshness.state)) fail(INSIGHT_ERRORS.UNPROCESSABLE, '区块新鲜度状态不正确')
  if (!isObject(runtime.comparability) || !COMPARABILITY_STATES.includes(runtime.comparability.status)) fail(INSIGHT_ERRORS.UNPROCESSABLE, '区块可比性状态不正确')
  if (runtime.comparability.status !== 'compatible' && !(Array.isArray(runtime.comparability.reasons) && runtime.comparability.reasons.length)) fail(INSIGHT_ERRORS.UNPROCESSABLE, '不可比或样本不足必须列出具体原因')
  return runtime
}

const REQUIRED_RESULT_FIELDS = ['schemaVersion', 'queryId', 'contextVersion', 'analysisId', 'analysisVersion', 'resolvedScope', 'businessWindow', 'mode', 'runtime', 'generatedAt', 'mock', 'productionWrite']

/**
 * 校验一份区块结果是否满足契约（服务端出参自检 + 前端入参校验共用）。
 * 无权区块不得带 data/coverage/sourceRefs/quality 细节；有数区块必须带结果版本与读取版本集合。
 */
export function assertInsightResult(result) {
  if (!isObject(result)) fail(INSIGHT_ERRORS.UNPROCESSABLE, '区块结果应为对象')
  for (const key of REQUIRED_RESULT_FIELDS) if (!(key in result)) fail(INSIGHT_ERRORS.UNPROCESSABLE, `区块结果缺少 ${key}`)
  if (result.schemaVersion !== INSIGHT_SCHEMA_VERSION) {
    const major = String(result.schemaVersion ?? '').split('/')[1]?.split('.')[0]
    if (major !== 'v1') fail(INSIGHT_ERRORS.UNPROCESSABLE, `不支持的结果版本：${String(result.schemaVersion)}`)
  }
  if (result.mock !== false || result.productionWrite !== false) fail(INSIGHT_ERRORS.UNPROCESSABLE, '洞察正式结果必须声明 mock:false 与 productionWrite:false')
  assertRuntimeStatus(result.runtime)
  if (result.runtime.access === 'denied') {
    for (const key of ['data', 'coverage', 'sourceRefs', 'quality', 'drilldowns', 'resultVersion', 'readSetRef']) {
      if (result[key] !== undefined && result[key] !== null) fail(INSIGHT_ERRORS.UNPROCESSABLE, `无权区块不得包含 ${key}`)
    }
    return result
  }
  if (!RESULT_BASIS.includes(result.basis)) fail(INSIGHT_ERRORS.UNPROCESSABLE, `区块数据依据不正确：${String(result.basis)}`)
  if (!DERIVATIONS.includes(result.derivation)) fail(INSIGHT_ERRORS.UNPROCESSABLE, '区块派生程度不正确')
  if (!Array.isArray(result.sourceRefs)) fail(INSIGHT_ERRORS.UNPROCESSABLE, '区块缺少来源引用')
  if (result.runtime.availability.state !== 'failed') {
    if (!isResultVersion(result.resultVersion) || !isReadSetRef(result.readSetRef)) fail(INSIGHT_ERRORS.UNPROCESSABLE, '区块缺少结果版本或读取版本集合')
  }
  return result
}
