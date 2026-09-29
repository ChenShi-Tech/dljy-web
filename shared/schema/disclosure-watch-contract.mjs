// 云南交易日前披露盯盘共享契约（Epic #3478 · A1 #3479）。
// 后端快照导入、取材整理、研判接口与前端弹窗的单一来源；经 sync:web 单向推给 dljy-web。
// 口径（规格 DW-01～DW-14，工作区 OpenSpec add-disclosure-day-ahead-watch）：
// - 业务时间一律为北京时间本地串（YYYY-MM-DD / YYYY-MM-DDTHH:mm:ss，不带时区）；
//   receivedAt / asOf 等系统时刻为 ISO-8601 UTC 串。
// - 快照按「资料类别 + 业务日」不可变；日前可知性只看本系统接收时间，不看源里的任何日期字段。
// - 未知不是零：缺失一律为 null / 'missing'，计数分母各自独立。

export const DISCLOSURE_WATCH_CONTRACT_VERSION = '1.0.0'
export const DISCLOSURE_WATCH_REGION_ID = 'yunnan'
export const DISCLOSURE_WATCH_RULESET_VERSION = 'dw-rules-v1'
export const DISCLOSURE_WATCH_FORMAT_VERSION = 'dw-format-v1'
export const DISCLOSURE_WATCH_DATE_RULE_VERSION = 'dw-date-v1'
export const DISCLOSURE_WATCH_QUESTION_SET_VERSION = 'dw-questions-v1'
export const DISCLOSURE_WATCH_FEATURE_FLAG = 'DLJY_DISCLOSURE_WATCH_ENABLED'
export const DISCLOSURE_WATCH_PATH_PREFIX = '/api/v1/grid/geo-assets/disclosures'

// ── 资料类别 ────────────────────────────────────────────────────────────
export const DISCLOSURE_WATCH_CORE_DATASETS = Object.freeze([
  'forecast_maintenance_plan',
  'actual_unplanned_unit_outage',
  'forecast_must_run_stop_unit_list',
])
export const DISCLOSURE_WATCH_BACKGROUND_DATASETS = Object.freeze(['load_forecast'])
export const DISCLOSURE_WATCH_DATASETS = Object.freeze([
  ...DISCLOSURE_WATCH_CORE_DATASETS,
  ...DISCLOSURE_WATCH_BACKGROUND_DATASETS,
])
export const DISCLOSURE_WATCH_DATASET_LABELS = Object.freeze({
  forecast_maintenance_plan: '检修（含改造）执行计划',
  actual_unplanned_unit_outage: '发电机组计划外停运',
  forecast_must_run_stop_unit_list: '必开必停机组名单',
  load_forecast: '云南统调负荷预测',
})
// dateBasis：四类都是南网按日披露文件，operate_date = 适用业务日（D1）。
export const DISCLOSURE_WATCH_DATE_BASIS = 'operate-date-is-business-date'

// ── 快照 ───────────────────────────────────────────────────────────────
export const DISCLOSURE_WATCH_SOURCE_KINDS = Object.freeze(['tb-csv', 'cgn-api-raw'])
// 来源形态决定 origin 与可见性，命令行不可覆盖（D2）。
export const DISCLOSURE_WATCH_ORIGINS = Object.freeze(['historical-import', 'capture'])
export const DISCLOSURE_WATCH_RESTRICTED_OWNER = 'comp-cgn-yunnan' // 与 capture-families 的 CGN_YUNNAN_COMPANY_ID 一致（#3066）
export const DISCLOSURE_WATCH_SOURCE_KIND_POLICY = Object.freeze({
  'tb-csv': Object.freeze({ origin: 'historical-import', ownerCompanyId: null }),
  'cgn-api-raw': Object.freeze({ origin: 'capture', ownerCompanyId: DISCLOSURE_WATCH_RESTRICTED_OWNER }),
})
export const DISCLOSURE_WATCH_COMPLETENESS = Object.freeze(['complete', 'partial', 'empty', 'invalid'])

// 行级质量标记（导入时写入，取材时再按 cutoff 追加 actual-after-cutoff）。
export const DISCLOSURE_WATCH_ROW_QUALITY = Object.freeze([
  'column-order-ambiguous', // 2025-10-14 前检修方案计划复电与实际停电两列语义对调，区间不解读
  'interval-end-before-start',
  'interval-incomplete',
  'time-unparsed',
  'actual-after-cutoff',
  'identity-missing-plant',
  'identity-unparsed',
  'region-unclear', // 如检修方案区域为「总调」
  'status-unknown',
  'requirement-unknown',
])
// 检修方案列序切换日：早于此业务日的行一律标 column-order-ambiguous。
export const DISCLOSURE_WATCH_MAINTENANCE_COLUMN_ORDER_FROM = '2025-10-14'

export const DISCLOSURE_WATCH_OUTAGE_STATUS = Object.freeze({ '停机': 'stopped', '开停机过程': 'transition', '开机': 'running' })
export const DISCLOSURE_WATCH_REQUIREMENTS = Object.freeze({ '必开': 'must-run', '必停': 'must-stop' })

// ── 运行 ───────────────────────────────────────────────────────────────
export const DISCLOSURE_WATCH_MODES = Object.freeze(['live', 'review'])
export const DISCLOSURE_WATCH_RUN_STATUSES = Object.freeze(['running', 'complete', 'partial', 'failed', 'interrupted'])
export const DISCLOSURE_WATCH_TERMINAL_STATUSES = Object.freeze(['complete', 'partial', 'failed', 'interrupted'])
export const DISCLOSURE_WATCH_DISPOSITIONS = Object.freeze(['eligible', 'review-needed', 'out-of-scope', 'invalid'])
export const DISCLOSURE_WATCH_PROCESSING = Object.freeze(['rule', 'evaluated', 'model-failed', 'budget-unprocessed', 'not-required'])
export const DISCLOSURE_WATCH_ITEM_LEVELS = Object.freeze(['focus', 'general', 'review'])
export const DISCLOSURE_WATCH_ITEM_KINDS = Object.freeze(['maintenance-plan', 'must-run-stop', 'unplanned-outage'])
export const DISCLOSURE_WATCH_ATTENTION = Object.freeze(['focus', 'review', 'none-qualified'])
export const DISCLOSURE_WATCH_COVERAGE_STATUSES = Object.freeze(['complete', 'partial', 'missing', 'invalid'])
export const DISCLOSURE_WATCH_CHANGE_KINDS = Object.freeze(['new', 'changed', 'unchanged', 'removed', 'not-comparable'])
export const DISCLOSURE_WATCH_WINDOW_KINDS = Object.freeze(['interval', 'day', 'point', 'unknown'])
export const DISCLOSURE_WATCH_ITEM_FLAGS = Object.freeze(['recovery', 'high-load-overlap', 'non-target-date-list', 'conflict', 'restricted-source'])
export const DISCLOSURE_WATCH_REVIEW_REASONS = Object.freeze([
  'no-target-date-list',
  'interval-anomaly',
  'column-order-ambiguous',
  'identity-unclear',
  'conflict',
  'persistence-unknown',
  'partial-snapshot',
  'model-failed',
  'budget-unprocessed',
  'excerpt-truncated',
  'consistency-conflict',
])
export const DISCLOSURE_WATCH_CALIBRATION_STATUSES = Object.freeze(['uncalibrated', 'calibrated'])
// 首版固定未校准：模型判断只作试验附注，不参与重点判定（D5/D10，后续 #3485）。
export const DISCLOSURE_WATCH_CALIBRATION_STATUS = 'uncalibrated'

// ── 模型问题集 v1（D5） ─────────────────────────────────────────────────
export const DISCLOSURE_WATCH_MECHANISMS = Object.freeze([
  'equipment-limit',
  'resource-constraint',
  'recovery-or-release',
  'dispatch-arrangement',
  'no-supply-implication',
  'insufficient-evidence',
])
export const DISCLOSURE_WATCH_MECHANISM_LABELS = Object.freeze({
  'equipment-limit': '设备可用性限制',
  'resource-constraint': '燃料或来水等资源约束',
  'recovery-or-release': '明确恢复或限制解除',
  'dispatch-arrangement': '运行安排或调度计划',
  'no-supply-implication': '无直接供给含义',
  'insufficient-evidence': '证据不足',
})
export const DISCLOSURE_WATCH_CONSISTENCY = Object.freeze(['supports-status', 'semantic-conflict', 'not-addressed', 'undeterminable'])
export const DISCLOSURE_WATCH_CONSISTENCY_LABELS = Object.freeze({
  'supports-status': '原因支持所述启停状态',
  'semantic-conflict': '原因与状态存在语义冲突',
  'not-addressed': '原因未涉及状态',
  undeterminable: '无法判断',
})

// ── 预算（有版本的工程默认值，D7） ───────────────────────────────────────
export const DISCLOSURE_WATCH_BUDGET = Object.freeze({
  version: 'dw-budget-v1',
  totalMs: 45_000,
  concurrency: 4,
  maxModelChains: 200,
  maxExcerptsPerChain: 16,
  maxExcerptChars: 200,
  lookbackDays: 7,
})

// ── 评价 ───────────────────────────────────────────────────────────────
export const DISCLOSURE_WATCH_FEEDBACK_VERDICTS = Object.freeze(['useful', 'not-useful', 'needs-correction'])
export const DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX = 200

// ── 错误码（响应 errors[].code 与 HTTP 错误体 code） ──────────────────────
export const DISCLOSURE_WATCH_ERROR_CODES = Object.freeze([
  'feature-disabled',
  'region-unsupported',
  'invalid-request',
  'idempotency-key-required',
  'idempotency-conflict',
  'run-not-found',
  'item-not-found',
  'model-not-configured',
  'provider-auth-failed',
  'provider-rate-limited',
  'provider-timeout',
  'provider-error',
  'provider-invalid-response',
  'model-all-failed',
  'budget-exhausted',
  'no-core-input',
  'interrupted',
  'internal-error',
])

export const DISCLOSURE_WATCH_DATA_META = Object.freeze({ sourceType: 'IMPORT', mock: false, productionWrite: false })

// ── 日期工具（北京时间） ─────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/
const TIME_POINT_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const BEIJING_OFFSET_MS = 8 * 3600_000

export function isBusinessDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const t = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value
}

export function isLocalDateTime(value) {
  return typeof value === 'string' && LOCAL_TIME_RE.test(value) && isBusinessDate(value.slice(0, 10))
    && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60
}

export function isTimePoint(value) {
  return typeof value === 'string' && TIME_POINT_RE.test(value)
}

/** 北京时间当前业务日（YYYY-MM-DD）。 */
export function beijingDate(nowMs = Date.now()) {
  return new Date(nowMs + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

export function addBusinessDays(date, days) {
  if (!isBusinessDate(date) || !Number.isInteger(days)) throw new TypeError('addBusinessDays 需要合法日期与整数天数')
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** live 模式的目标日 = 北京时间当前日期 +1（D3）。 */
export function liveTradeDate(nowMs = Date.now()) {
  return addBusinessDays(beijingDate(nowMs), 1)
}

/** 北京本地时刻串 → UTC 毫秒（用于与 asOf 比较）。 */
export function localDateTimeToEpochMs(value) {
  if (!isLocalDateTime(value)) return null
  return Date.parse(`${value}Z`) - BEIJING_OFFSET_MS
}

// ── 请求校验 ───────────────────────────────────────────────────────────
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function extraKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.includes(key))
}

/**
 * POST /watch-runs 请求体。只接受 {tradeDate, mode}；asOf、模型名、URL、源文本、公司/用户/地区等
 * 一律按多余字段拒绝——这些只能来自服务端（DW-03/DW-11）。
 * live 模式的 tradeDate 必须等于服务端计算的次日。
 */
export function validateRunRequest(body, { nowMs = Date.now() } = {}) {
  const errors = []
  if (!isPlainObject(body)) return { ok: false, errors: ['请求体必须是 JSON 对象'] }
  for (const key of extraKeys(body, ['tradeDate', 'mode'])) errors.push(`不接受字段 ${key}`)
  if (!DISCLOSURE_WATCH_MODES.includes(body.mode)) errors.push('mode 只能是 live 或 review')
  if (!isBusinessDate(body.tradeDate)) errors.push('tradeDate 必须是合法的 YYYY-MM-DD')
  else if (body.mode === 'live' && body.tradeDate !== liveTradeDate(nowMs)) {
    errors.push(`live 模式只能研判次日 ${liveTradeDate(nowMs)}；其他日期请用 review`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { tradeDate: body.tradeDate, mode: body.mode } }
}

export function validateFeedbackRequest(body) {
  const errors = []
  if (!isPlainObject(body)) return { ok: false, errors: ['请求体必须是 JSON 对象'] }
  for (const key of extraKeys(body, ['itemId', 'verdict', 'note'])) errors.push(`不接受字段 ${key}`)
  if (typeof body.itemId !== 'string' || !/^[A-Za-z0-9:_-]{1,120}$/.test(body.itemId)) errors.push('itemId 非法')
  if (!DISCLOSURE_WATCH_FEEDBACK_VERDICTS.includes(body.verdict)) errors.push('verdict 只能是 useful / not-useful / needs-correction')
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') errors.push('note 必须是字符串')
    else if ([...body.note].length > DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX) errors.push(`note 不超过 ${DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX} 字`)
  }
  if (errors.length) return { ok: false, errors }
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  return { ok: true, value: { itemId: body.itemId, verdict: body.verdict, note: note || null } }
}

// ── 规范化行 ───────────────────────────────────────────────────────────
// A2 导入产出、A3 取材消费。字段只放白名单：人员字段（干预人）、操作时间戳（干预时间）不入库。

const NULLABLE_LOCAL_TIME_FIELDS = Object.freeze({
  forecast_maintenance_plan: ['plannedStart', 'plannedEnd', 'actualStart', 'actualEnd'],
  actual_unplanned_unit_outage: ['statusAt'],
  forecast_must_run_stop_unit_list: [],
  load_forecast: [],
})

export const DISCLOSURE_WATCH_ROW_FIELDS = Object.freeze({
  forecast_maintenance_plan: Object.freeze(['sourceRecordId', 'region', 'voltageLevel', 'deviceName', 'deviceType', 'plannedStart', 'plannedEnd', 'actualStart', 'actualEnd', 'raw', 'quality']),
  actual_unplanned_unit_outage: Object.freeze(['sourceRecordId', 'region', 'dispatchOrg', 'plantName', 'unitName', 'dataType', 'status', 'statusText', 'statusAt', 'reason', 'raw', 'quality']),
  forecast_must_run_stop_unit_list: Object.freeze(['sourceRecordId', 'region', 'plantName', 'unitName', 'requirement', 'requirementText', 'raw', 'quality']),
  load_forecast: Object.freeze(['timePoint', 'valueMw', 'quality']),
})

function isNullableString(value) {
  return value === null || typeof value === 'string'
}

/** 校验一行规范化记录；返回错误数组（空 = 合法）。 */
export function validateNormalizedRow(dataset, row) {
  const fields = DISCLOSURE_WATCH_ROW_FIELDS[dataset]
  if (!fields) return [`未知 dataset ${dataset}`]
  if (!isPlainObject(row)) return ['行必须是对象']
  const errors = []
  for (const key of extraKeys(row, fields)) errors.push(`多余字段 ${key}`)
  for (const key of fields) if (!Object.hasOwn(row, key)) errors.push(`缺少字段 ${key}`)
  if (!Array.isArray(row.quality) || row.quality.some((flag) => !DISCLOSURE_WATCH_ROW_QUALITY.includes(flag))) errors.push('quality 含未知标记')
  for (const key of NULLABLE_LOCAL_TIME_FIELDS[dataset]) {
    if (row[key] !== null && !isLocalDateTime(row[key])) errors.push(`${key} 必须为 null 或北京本地时刻串`)
  }
  if (dataset === 'load_forecast') {
    if (!isTimePoint(row.timePoint)) errors.push('timePoint 非法')
    if (row.valueMw !== null && !Number.isFinite(row.valueMw)) errors.push('valueMw 必须为有限数或 null（缺测不补零）')
    return errors
  }
  for (const key of fields) {
    if (['raw', 'quality'].includes(key) || NULLABLE_LOCAL_TIME_FIELDS[dataset].includes(key)) continue
    if (!isNullableString(row[key])) errors.push(`${key} 必须为字符串或 null`)
  }
  if (!isPlainObject(row.raw) || Object.values(row.raw).some((v) => !isNullableString(v))) errors.push('raw 必须是字符串字段对象')
  if (dataset === 'actual_unplanned_unit_outage' && row.status !== null && !Object.values(DISCLOSURE_WATCH_OUTAGE_STATUS).includes(row.status)) errors.push('status 非法')
  if (dataset === 'forecast_must_run_stop_unit_list' && row.requirement !== null && !Object.values(DISCLOSURE_WATCH_REQUIREMENTS).includes(row.requirement)) errors.push('requirement 非法')
  return errors
}

/**
 * 快照（导入前的待写形态；snapshotId / receivedAt 由数据库赋值）。
 * sourceRef 是可读的来源描述（相对路径或 API 查询摘要），不含凭据。
 */
export function validateSnapshotDraft(draft) {
  if (!isPlainObject(draft)) return ['快照必须是对象']
  const errors = []
  const allowed = ['dataset', 'coverageDate', 'sourceKind', 'origin', 'ownerCompanyId', 'contentSha256', 'formatVersion', 'dateRuleVersion', 'completeness', 'rows', 'sourceRef', 'issues']
  for (const key of extraKeys(draft, allowed)) errors.push(`多余字段 ${key}`)
  if (!DISCLOSURE_WATCH_DATASETS.includes(draft.dataset)) errors.push('dataset 非法')
  if (!isBusinessDate(draft.coverageDate)) errors.push('coverageDate 非法')
  if (!DISCLOSURE_WATCH_SOURCE_KINDS.includes(draft.sourceKind)) errors.push('sourceKind 非法')
  const policy = DISCLOSURE_WATCH_SOURCE_KIND_POLICY[draft.sourceKind]
  if (policy && (draft.origin !== policy.origin || draft.ownerCompanyId !== policy.ownerCompanyId)) errors.push('origin / ownerCompanyId 必须由 sourceKind 决定')
  if (typeof draft.contentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(draft.contentSha256)) errors.push('contentSha256 必须是 64 位小写十六进制')
  if (draft.formatVersion !== DISCLOSURE_WATCH_FORMAT_VERSION) errors.push('formatVersion 不匹配')
  if (draft.dateRuleVersion !== DISCLOSURE_WATCH_DATE_RULE_VERSION) errors.push('dateRuleVersion 不匹配')
  if (!DISCLOSURE_WATCH_COMPLETENESS.includes(draft.completeness)) errors.push('completeness 非法')
  if (!Array.isArray(draft.rows)) errors.push('rows 必须是数组')
  else {
    if (draft.completeness === 'empty' && draft.rows.length) errors.push('empty 快照不能有行')
    if (draft.completeness === 'complete' && !draft.rows.length) errors.push('complete 快照至少一行；显式空表记 empty')
    draft.rows.forEach((row, index) => {
      for (const message of validateNormalizedRow(draft.dataset, row)) errors.push(`rows[${index}] ${message}`)
    })
  }
  if (typeof draft.sourceRef !== 'string' || !draft.sourceRef.trim() || draft.sourceRef.length > 500) errors.push('sourceRef 必须是 1–500 字符')
  if (draft.issues !== undefined && (!Array.isArray(draft.issues) || draft.issues.some((issue) => typeof issue !== 'string'))) errors.push('issues 必须是字符串数组')
  return errors
}

/** 运行结果的最小形状校验（服务端写终态前与前端适配器共用）。 */
export function validateRunResultShape(result) {
  if (!isPlainObject(result)) return ['结果必须是对象']
  const errors = []
  if (!DISCLOSURE_WATCH_ATTENTION.includes(result.attention)) errors.push('attention 非法')
  if (!Array.isArray(result.items)) errors.push('items 必须是数组')
  else result.items.forEach((item, index) => {
    if (!DISCLOSURE_WATCH_ITEM_LEVELS.includes(item?.level)) errors.push(`items[${index}].level 非法`)
    if (!DISCLOSURE_WATCH_ITEM_KINDS.includes(item?.kind)) errors.push(`items[${index}].kind 非法`)
    if (!DISCLOSURE_WATCH_PROCESSING.includes(item?.processing)) errors.push(`items[${index}].processing 非法`)
    if (!Array.isArray(item?.evidence) || !item.evidence.length) errors.push(`items[${index}].evidence 不能为空`)
    if (item?.level === 'focus' && item?.mechanism) errors.push(`items[${index}] 重点项不能依赖模型判断`)
  })
  for (const dataset of DISCLOSURE_WATCH_CORE_DATASETS) {
    if (!DISCLOSURE_WATCH_COVERAGE_STATUSES.includes(result.inputCoverage?.[dataset]?.status)) errors.push(`inputCoverage.${dataset} 非法`)
  }
  const processing = result.processingCoverage
  for (const key of ['chains', 'modelRequired', 'evaluated', 'modelFailed', 'unprocessed']) {
    if (!Number.isInteger(processing?.[key]) || processing[key] < 0) errors.push(`processingCoverage.${key} 必须是非负整数`)
  }
  if (result.attention === 'none-qualified') {
    const incomplete = DISCLOSURE_WATCH_CORE_DATASETS.some((d) => result.inputCoverage?.[d]?.status !== 'complete')
    if (incomplete || processing?.modelFailed > 0 || processing?.unprocessed > 0 || result.items?.some((item) => item.level === 'review')) {
      errors.push('存在缺项、失败、未处理或待核时 attention 不能是 none-qualified')
    }
  }
  return errors
}
