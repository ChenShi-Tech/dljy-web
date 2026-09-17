// 中长期售电 P2：分时分解与场站分配的前后端共享契约（openspec tasks 第 7 组，#2970）。
//
// 单一事实源：后端 server/midlong/midlong-p2-*.mjs 与前端（经 sync:web 同步到 dljy-web 只读）共用这里的
// 枚举、中文标签、模板声明（守恒容差与尾差规则）和纯函数规则。零依赖、前后端同构，只引用同目录的
// contract / decimal / dates（均已在同步白名单内）。
//
// 口径红线（specs MP-02/MP-04/MP-05，design D2/D3/D4）：
// - 时段一律换算为北京时间（Asia/Shanghai，UTC+8，无夏令时）的 [start, end)；原始时区、单位、粒度作为来源保存，
//   且必须显式声明，不默认。
// - 功率（MW/kW）按区间时长换算电量：1 MW × 15 分钟 = 0.25 MWh；电量单位按固定系数换算。
// - 典型日按实际适用日期逐日展开：天数不同的月份就是不同的月合计，不默认乘 30。
// - 缺段、重复/重叠、越交割期、跨月、月/日不守恒一律阻止确认；超出容差不自动缩放。
// - 守恒容差只由模板声明（本期两个模板均为 0，即规范精度后严格相等），请求方不能自报容差。
// - 缺时段是「未知」，已知零是 0，两者互不替代。
// - 估算（均分或权重工具生成）标内部估算，不计入正式分时持仓，也不覆盖正式资料。
// - 场站份额不得超过对应合同片段量；主体合计与场站份额是同一义务的两种观察维度，不相加。

import { ENERGY_UNIT_FACTORS, MAX_IMPORT_DECIMALS } from './contract.mjs'
import { decimalCompare, decimalDiv, decimalMul, decimalSub, fromScaled, parseDecimal, toScaled } from './decimal.mjs'
import { deliveryMonths, isIsoDate, isMonthKey, monthFirstDay, monthLastDay, monthsBetween, nextDay, normalizeDate, normalizeMonth } from './dates.mjs'

// ── 枚举与标签 ──────────────────────────────────────────────────────────────

export const CURVE_SET_STATUSES = Object.freeze(['DRAFT', 'CONFIRMED', 'DISCARDED'])
export const CURVE_EVIDENCE_BASES = Object.freeze(['FORMAL', 'INTERNAL_ESTIMATE'])
export const CURVE_INPUT_KINDS = Object.freeze(['INTERVAL_SERIES', 'TYPICAL_DAY', 'ESTIMATE_GENERATED'])
export const CURVE_GRANULARITIES = Object.freeze([15, 30, 60, 1440])
/** 功率单位只接受能整除成小时小数的粒度（0.25/0.5/1 小时），避免换算产生无限小数。 */
export const CURVE_POWER_GRANULARITIES = Object.freeze([15, 30, 60])
export const CURVE_ESTIMATE_GRANULARITIES = Object.freeze([15, 30, 60])
export const CURVE_ESTIMATE_METHODS = Object.freeze(['FLAT', 'PROFILE'])
export const CURVE_MEASURES = Object.freeze(['POWER', 'ENERGY'])
export const CURVE_CONVERSION_METHODS = Object.freeze(['POWER_TIMES_DURATION', 'ENERGY_UNIT_FACTOR'])

/** 曲线单位：功率按时长换算，电量沿用合同电量单位的换算系数（contract.mjs 同一张表）。 */
export const CURVE_UNITS = Object.freeze({
  MW: Object.freeze({ measure: 'POWER', factor: '1' }),
  kW: Object.freeze({ measure: 'POWER', factor: '0.001' }),
  ...Object.fromEntries(Object.entries(ENERGY_UNIT_FACTORS).map(([unit, factor]) => [unit, Object.freeze({ measure: 'ENERGY', factor })])),
})

/** 可声明的原始时区：只接受固定偏移（本地区无夏令时）；未声明即报错，不默认。 */
export const CURVE_TIMEZONES = Object.freeze({ 'Asia/Shanghai': 480, UTC: 0 })
export const CANONICAL_CURVE_TIMEZONE = 'Asia/Shanghai'

export const CURVE_STANDARD_TEMPLATE = 'MIDLONG-CURVE-STD-V1'
export const CURVE_ESTIMATE_TEMPLATE = 'MIDLONG-CURVE-ESTIMATE-V1'
export const CURVE_ESTIMATE_DECIMALS = 6

/**
 * 模板声明（页面预览与模板说明页原样展示）。守恒容差与尾差规则只来自这里——
 * 容差是软件舍入容差，不是业务偏差许可；未登记的模板一律不支持。
 */
export const CURVE_TEMPLATES = Object.freeze({
  [CURVE_STANDARD_TEMPLATE]: Object.freeze({
    code: CURVE_STANDARD_TEMPLATE,
    label: '中长期分时曲线标准模板 V1',
    tolerance: '0',
    roundingRule: 'NONE',
    roundingRuleText: '不做任何舍入：功率按区间时长换算（1 MW × 15 分钟 = 0.25 MWh）、电量单位按固定系数换算，'
      + `原始数值最多 ${MAX_IMPORT_DECIMALS} 位小数；月、日合计与合同正式月度分解按严格相等核对（容差 0 MWh），不一致只提示核对，不自动缩放。`,
  }),
  [CURVE_ESTIMATE_TEMPLATE]: Object.freeze({
    code: CURVE_ESTIMATE_TEMPLATE,
    label: '分时估算工具 V1（均分 / 权重）',
    tolerance: '0',
    roundingRule: 'ROUND_6_TAIL_TO_LAST',
    roundingRuleText: `每个时段按权重分摊该月正式月度电量后四舍五入到 ${CURVE_ESTIMATE_DECIMALS} 位小数（半数远离零），`
      + '当月舍入差额（尾差）全部计入该月最后一个权重非零的时段，保证月合计与正式月度分解严格相等；结果一律标为内部估算，不计入正式分时持仓。',
  }),
})

/** 上传曲线文件可以声明的资料类型；只有交易中心系统导出与电子交易确认单能作为正式曲线的依据。 */
export const CURVE_SOURCE_DOCUMENT_TYPES = Object.freeze(['IMPORT_SOURCE_FILE', 'TRADING_CENTER_EXPORT', 'ELECTRONIC_CONFIRMATION'])
export const CURVE_FORMAL_SOURCE_DOCUMENT_TYPES = Object.freeze(['TRADING_CENTER_EXPORT', 'ELECTRONIC_CONFIRMATION'])
/** 正式曲线 / 正式场站分解可引用的合同资料类型。 */
export const P2_BASIS_EVIDENCE_TYPES = Object.freeze(['ELECTRONIC_CONFIRMATION', 'PAPER_CONTRACT', 'TRADING_CENTER_EXPORT', 'SUPPLEMENT_SCAN'])

export const MAX_CURVE_INTERVALS = 40000
export const MAX_CURVE_COVERAGE_MONTHS = 12

/**
 * 曲线文件模板：Excel 为一个工作簿的四张表，CSV 为同名角色的四个文件（role 即键名）。
 * 逐时段曲线与典型日曲线二选一；「日电量」可选，用于日守恒核对。数值列表头可带单位括号，如「数值（MW）」。
 */
export const CURVE_FILE_SHEETS = Object.freeze({
  intervals: '分时曲线',
  typicalDays: '典型日曲线',
  typicalDayRanges: '典型日适用日期',
  dailyTotals: '日电量',
})
export const CURVE_FILE_COLUMNS = Object.freeze({
  intervals: Object.freeze([
    { key: 'date', name: '日期', aliases: ['交割日期'], required: false, hint: 'YYYY-MM-DD；与「时段序号」或当日「开始时间/结束时间」搭配' },
    { key: 'periodIndex', name: '时段序号', aliases: ['时段', '序号'], required: false, hint: '1 表示当日 00:00 起的第一个时段（15 分钟粒度为 1—96）' },
    { key: 'start', name: '开始时间', aliases: ['起始时间'], required: false, hint: 'YYYY-MM-DD HH:mm，或与「日期」搭配的 HH:mm' },
    { key: 'end', name: '结束时间', aliases: ['截止时间'], required: false, hint: '可省略（按粒度推算）；24:00 表示当日结束' },
    { key: 'value', name: '数值', aliases: ['电量', '功率', '值'], required: true, hint: '非负，最多 6 位小数；单位写在声明或表头括号里，空值按缺时段处理' },
  ]),
  typicalDays: Object.freeze([
    { key: 'name', name: '典型日名称', aliases: ['典型日'], required: true, hint: '与「典型日适用日期」表对应' },
    { key: 'periodIndex', name: '时段序号', aliases: ['时段', '序号'], required: false, hint: '1 表示 00:00 起的第一个时段；与「开始时刻/结束时刻」二选一' },
    { key: 'segmentName', name: '时段名称', aliases: ['峰平谷'], required: false, hint: '可选：峰、平、谷等，只用于定位' },
    { key: 'startTime', name: '开始时刻', aliases: [], required: false, hint: '按时刻段填写（如峰段 08:00）；只支持功率，段内每个粒度时段取同一功率' },
    { key: 'endTime', name: '结束时刻', aliases: [], required: false, hint: 'HH:mm，可写 24:00；早于开始时刻表示跨零点（如谷段 22:00—08:00）' },
    { key: 'value', name: '数值', aliases: ['电量', '功率', '值'], required: true, hint: '非负，最多 6 位小数' },
  ]),
  typicalDayRanges: Object.freeze([
    { key: 'name', name: '典型日名称', aliases: ['典型日'], required: true, hint: '' },
    { key: 'from', name: '开始日期', aliases: ['适用开始'], required: true, hint: 'YYYY-MM-DD，含当日' },
    { key: 'to', name: '结束日期', aliases: ['适用结束'], required: true, hint: 'YYYY-MM-DD，含当日；按实际日期逐日展开' },
    { key: 'declaredDailyTotal', name: '日电量', aliases: [], required: false, hint: '可选：资料声明的该典型日日电量，用于核对（电量曲线按曲线单位，功率曲线按 MWh）' },
  ]),
  dailyTotals: Object.freeze([
    { key: 'date', name: '日期', aliases: [], required: true, hint: 'YYYY-MM-DD' },
    { key: 'quantity', name: '日电量', aliases: ['电量'], required: true, hint: '资料声明的日电量，用于日守恒核对（电量曲线按曲线单位，功率曲线按 MWh）' },
  ]),
})

/** 分时持仓视图的粒度（分钟）与单次最多查询天数。 */
export const INTERVAL_POSITION_GRANULARITIES = Object.freeze({ DAY: 1440, HOUR: 60, QUARTER_HOUR: 15 })
export const INTERVAL_POSITION_MAX_DAYS = Object.freeze({ DAY: 366, HOUR: 31, QUARTER_HOUR: 7 })
/** 合同某月在分时视图里的状态。 */
export const CURVE_TIME_STATUSES = Object.freeze(['CURVE', 'TIME_UNKNOWN', 'GRANULARITY_TOO_COARSE', 'MONTH_UNKNOWN'])
/** 时段桶的覆盖状态：NO_OBLIGATION 是「当天没有任何交割义务」的真实零，UNKNOWN 不是零。 */
export const BUCKET_COVERAGES = Object.freeze(['COMPLETE', 'PARTIAL', 'UNKNOWN', 'NO_OBLIGATION'])

export const STATION_ALLOCATION_KINDS = Object.freeze(['FORMAL_TRADING', 'INTERNAL_OPERATING'])
export const STATION_SEGMENT_MODES = Object.freeze(['CONTRACT_TOTAL', 'MONTHLY'])
export const STATION_DERIVATIONS = Object.freeze(['CONTRACT_STATION', 'ALLOCATION', 'UNALLOCATED', 'ALLOCATION_MONTH_UNKNOWN'])
/** 更正影响：合同更正后受影响片段上旧版本已确认的曲线 / 场站分配失效，需要重新确认（未受影响片段按 inheritableRevisions 沿用）。 */
export const CORRECTION_IMPACT_STATUSES = Object.freeze(['RECONFIRM_REQUIRED', 'QUANTITY_CHANGED'])

export const CURVE_SET_STATUS_LABELS = Object.freeze({ DRAFT: '草稿（未确认）', CONFIRMED: '已确认', DISCARDED: '已废弃' })
export const CURVE_EVIDENCE_BASIS_LABELS = Object.freeze({ FORMAL: '正式资料', INTERNAL_ESTIMATE: '内部估算' })
export const CURVE_INPUT_KIND_LABELS = Object.freeze({ INTERVAL_SERIES: '逐时段曲线', TYPICAL_DAY: '典型日曲线', ESTIMATE_GENERATED: '估算工具生成' })
export const CURVE_GRANULARITY_LABELS = Object.freeze({ 15: '15 分钟', 30: '30 分钟', 60: '1 小时', 1440: '1 天' })
export const CURVE_MEASURE_LABELS = Object.freeze({ POWER: '功率', ENERGY: '电量' })
export const CURVE_CONVERSION_METHOD_LABELS = Object.freeze({
  POWER_TIMES_DURATION: '功率 × 区间时长（小时）', ENERGY_UNIT_FACTOR: '电量单位按固定系数换算',
})
export const CURVE_ESTIMATE_METHOD_LABELS = Object.freeze({ FLAT: '按时段均分', PROFILE: '按典型日权重分摊' })
export const CURVE_TIME_STATUS_LABELS = Object.freeze({
  CURVE: '已有正式分时', TIME_UNKNOWN: '分时未知（只有月量）', GRANULARITY_TOO_COARSE: '分时粒度不足（不拆分）', MONTH_UNKNOWN: '月量未知（未分解）',
})
export const BUCKET_COVERAGE_LABELS = Object.freeze({
  COMPLETE: '完整', PARTIAL: '部分合同分时未知', UNKNOWN: '分时未知', NO_OBLIGATION: '无交割义务',
})
export const STATION_ALLOCATION_KIND_LABELS = Object.freeze({ FORMAL_TRADING: '正式交易分解', INTERNAL_OPERATING: '内部经营分配' })
export const STATION_SEGMENT_MODE_LABELS = Object.freeze({ CONTRACT_TOTAL: '按合同总量', MONTHLY: '按交割月' })
export const STATION_DERIVATION_LABELS = Object.freeze({
  CONTRACT_STATION: '合同绑定场站', ALLOCATION: '场站分配', UNALLOCATED: '未分配', ALLOCATION_MONTH_UNKNOWN: '已按合同总量分配、月份未分到场站',
})
export const CORRECTION_IMPACT_LABELS = Object.freeze({
  RECONFIRM_REQUIRED: '合同已更正，原数据绑定旧版本，需重新确认', QUANTITY_CHANGED: '合同已更正且该片段电量改变，原数据不能沿用',
})

/** 校验问题：blocking 阻止确认，warning 只提示。 */
export const CURVE_ISSUES = Object.freeze({
  DECLARATION_INVALID: { severity: 'blocking', label: '曲线声明不完整或不受支持' },
  COVERAGE_INVALID: { severity: 'blocking', label: '覆盖月份无效或不在交割期内' },
  EMPTY_CURVE: { severity: 'blocking', label: '没有任何时段数据' },
  TOO_MANY_INTERVALS: { severity: 'blocking', label: '时段数超过上限' },
  VALUE_INVALID: { severity: 'blocking', label: '数值无效' },
  TIME_INVALID: { severity: 'blocking', label: '时间无效' },
  PERIOD_INDEX_INVALID: { severity: 'blocking', label: '时段序号无效' },
  INTERVAL_INVALID: { severity: 'blocking', label: '结束时间不晚于开始时间' },
  INTERVAL_DURATION_MISMATCH: { severity: 'blocking', label: '时段长度与声明粒度不一致' },
  INTERVAL_MISALIGNED: { severity: 'blocking', label: '时段未对齐到北京时间粒度边界' },
  CROSSES_MONTH_BOUNDARY: { severity: 'blocking', label: '时段跨月' },
  OUT_OF_DELIVERY_PERIOD: { severity: 'blocking', label: '时段超出合同交割期' },
  OUTSIDE_COVERAGE: { severity: 'blocking', label: '时段不在本次声明的覆盖月份内' },
  DUPLICATE_INTERVAL: { severity: 'blocking', label: '重复时段' },
  OVERLAPPING_INTERVAL: { severity: 'blocking', label: '时段重叠' },
  MISSING_INTERVALS: { severity: 'blocking', label: '缺时段（未知，不按零补齐）' },
  MONTH_QUANTITY_UNKNOWN: { severity: 'blocking', label: '合同该月没有正式月度分解，无法核对守恒' },
  MONTH_NOT_CONSERVED: { severity: 'blocking', label: '月合计与正式月度分解不一致' },
  MONTH_WITHIN_TOLERANCE: { severity: 'warning', label: '月合计与正式月度分解有差异，但在模板容差内' },
  TOTAL_NOT_CONSERVED: { severity: 'blocking', label: '曲线总量与合同电量不一致' },
  DAY_NOT_CONSERVED: { severity: 'blocking', label: '日合计与资料声明的日电量不一致' },
  DECLARED_DAY_INVALID: { severity: 'blocking', label: '声明的日电量无效或不在覆盖范围内' },
  TYPICAL_DAY_INVALID: { severity: 'blocking', label: '典型日定义不完整' },
  TYPICAL_DAY_TOTAL_MISMATCH: { severity: 'blocking', label: '典型日合计与声明的日电量不一致' },
  EMPTY_VALUE_SKIPPED: { severity: 'warning', label: '数值为空的行按缺时段处理（不当作零）' },
})

export const STATION_ALLOCATION_ISSUES = Object.freeze({
  EMPTY_ALLOCATION: { severity: 'blocking', label: '没有任何场站分配行' },
  STATION_REQUIRED: { severity: 'blocking', label: '缺场站' },
  QUANTITY_INVALID: { severity: 'blocking', label: '分配电量无效' },
  SEGMENT_MONTH_REQUIRED: { severity: 'blocking', label: '按交割月分配时必须填写月份' },
  SEGMENT_MONTH_NOT_ALLOWED: { severity: 'blocking', label: '按合同总量分配时不填写月份' },
  SEGMENT_MONTH_OUT_OF_RANGE: { severity: 'blocking', label: '月份不在交割期内' },
  DUPLICATE_STATION_SEGMENT: { severity: 'blocking', label: '同一片段重复分配给同一场站' },
  SEGMENT_QUANTITY_UNKNOWN: { severity: 'blocking', label: '合同片段电量未知，无法校验分配上限' },
  ALLOCATION_EXCEEDS_SEGMENT: { severity: 'blocking', label: '分配合计超过合同片段电量' },
  SUBJECT_STATION_MAPPING_MISSING: { severity: 'warning', label: '交易单元尚未登记所属场站，无法核对场站归属' },
})

// ── 时刻（北京时间）────────────────────────────────────────────────────────

const MINUTE_MS = 60_000
const DAY_MINUTES = 1440
const BEIJING_OFFSET_MINUTES = CURVE_TIMEZONES[CANONICAL_CURVE_TIMEZONE]

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 声明的时区 → 相对 UTC 的分钟偏移；接受 Asia/Shanghai、UTC 与 ±HH:MM，其他返回 null（不猜测）。 */
export function resolveTimezoneOffset(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (Object.hasOwn(CURVE_TIMEZONES, text)) return CURVE_TIMEZONES[text]
  if (text === '北京时间') return BEIJING_OFFSET_MINUTES
  const m = /^(?:UTC)?([+-])(\d{2}):?(\d{2})$/.exec(text)
  if (!m || Number(m[2]) > 14 || Number(m[3]) > 59) return null
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

/** 某日零点（给定偏移）的 epoch 毫秒。 */
export function dateMidnightMs(isoDate, offsetMinutes = BEIJING_OFFSET_MINUTES) {
  if (!isIsoDate(isoDate)) return null
  const [year, month, day] = isoDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day) - offsetMinutes * MINUTE_MS
}

/** epoch 毫秒 → 北京时间的日期、月键与当日分钟数。 */
export function beijingPartsOf(ms) {
  const shifted = new Date(Number(ms) + BEIJING_OFFSET_MINUTES * MINUTE_MS)
  const date = `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
  return { date, month: date.slice(0, 7), minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(), second: shifted.getUTCSeconds(), millisecond: shifted.getUTCMilliseconds() }
}

/** epoch 毫秒 → 带 +08:00 偏移的北京时间 ISO 文本（接口输出统一用它，读者不必再换算）。 */
export function toBeijingIso(ms) {
  const shifted = new Date(Number(ms) + BEIJING_OFFSET_MINUTES * MINUTE_MS)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}T${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}+08:00`
}

const DATETIME_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?\s*(Z|[+-]\d{2}:?\d{2})?$/
const TIME_OF_DAY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/

/** 当日时刻「HH:mm(:ss)」→ 分钟数；允许 24:00 表示当日结束（只用于结束时间）。无效返回 null。 */
export function parseTimeOfDay(value) {
  const m = TIME_OF_DAY_RE.exec(String(value ?? '').trim())
  if (!m) return null
  const [hours, minutes, seconds] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
  if (seconds !== 0 || minutes > 59) return null
  if (hours === 24 && minutes === 0) return DAY_MINUTES
  if (hours > 23) return null
  return hours * 60 + minutes
}

/**
 * 日期时刻文本 → epoch 毫秒。带 Z 或 ±HH:MM 的按原偏移；不带的按声明时区解释。
 * 允许「24:00」表示次日零点；秒不为 0 的时刻不是曲线时段边界，返回 null。
 */
export function parseCurveDateTime(value, offsetMinutes) {
  const m = DATETIME_RE.exec(String(value ?? '').trim())
  if (!m) return null
  const date = normalizeDate(`${m[1]}-${m[2]}-${m[3]}`)
  const minutes = parseTimeOfDay(`${m[4]}:${m[5]}${m[6] ? `:${m[6]}` : ''}`)
  if (!date || minutes === null) return null
  let offset = offsetMinutes
  if (m[7]) offset = m[7] === 'Z' ? 0 : resolveTimezoneOffset(m[7])
  if (offset === null || offset === undefined) return null
  return dateMidnightMs(date, offset) + minutes * MINUTE_MS
}

// ── 声明与换算 ──────────────────────────────────────────────────────────────

function issue(code, message, extra = {}) {
  return { code, severity: CURVE_ISSUES[code]?.severity ?? 'blocking', message, ...extra }
}

/**
 * 曲线声明（粒度、单位、原始时区、模板）→ 规范化声明。声明本身不成立时不能解析任何行，
 * 调用方应直接拒绝请求而不是保存草稿。
 */
export function resolveCurveDeclaration({ granularityMinutes, unit, sourceTimezone, templateCode = CURVE_STANDARD_TEMPLATE } = {}) {
  const issues = []
  const granularity = Number(granularityMinutes)
  if (!CURVE_GRANULARITIES.includes(granularity)) {
    issues.push(issue('DECLARATION_INVALID', `不支持的曲线粒度「${granularityMinutes ?? '(未填)'}」（可选：15/30/60 分钟或 1440 分钟即 1 天）`, { field: 'granularityMinutes' }))
  }
  const unitText = String(unit ?? '').trim()
  const unitSpec = Object.hasOwn(CURVE_UNITS, unitText) ? CURVE_UNITS[unitText] : null
  if (!unitSpec) {
    issues.push(issue('DECLARATION_INVALID', unitText ? `无法识别的曲线单位「${unitText}」（功率：MW/kW；电量：${Object.keys(ENERGY_UNIT_FACTORS).join('/')}）` : '未声明曲线单位（功率 MW/kW 或电量 MWh 等），请明确后重新提交', { field: 'unit' }))
  } else if (unitSpec.measure === 'POWER' && CURVE_GRANULARITIES.includes(granularity) && !CURVE_POWER_GRANULARITIES.includes(granularity)) {
    issues.push(issue('DECLARATION_INVALID', '功率曲线只支持 15/30/60 分钟粒度；日粒度请提供电量', { field: 'unit' }))
  }
  const offsetMinutes = resolveTimezoneOffset(sourceTimezone)
  if (offsetMinutes === null) {
    issues.push(issue('DECLARATION_INVALID', String(sourceTimezone ?? '').trim()
      ? `无法识别的原始时区「${sourceTimezone}」（可选：Asia/Shanghai、UTC 或 ±HH:MM 固定偏移）`
      : '未声明原始时区，请明确原始曲线的时间口径（如 Asia/Shanghai）', { field: 'sourceTimezone' }))
  }
  const template = CURVE_TEMPLATES[templateCode] ?? null
  if (!template) issues.push(issue('DECLARATION_INVALID', `不支持的曲线模板「${templateCode}」`, { field: 'templateCode' }))
  if (issues.length) return { ok: false, issues }
  return {
    ok: true,
    issues: [],
    value: {
      granularityMinutes: granularity,
      unit: unitText,
      measure: unitSpec.measure,
      factor: unitSpec.factor,
      sourceTimezone: String(sourceTimezone).trim(),
      offsetMinutes,
      conversionMethod: unitSpec.measure === 'POWER' ? 'POWER_TIMES_DURATION' : 'ENERGY_UNIT_FACTOR',
      durationHours: decimalDiv(String(granularity), '60', 6),
      templateCode: template.code,
      tolerance: template.tolerance,
      roundingRule: template.roundingRule,
      roundingRuleText: template.roundingRuleText,
    },
  }
}

/** 原始数值 → 规范电量（MWh）。功率乘区间小时数，电量乘单位系数；两步都是精确十进制乘法。 */
export function convertCurveValue(sourceValue, declaration) {
  const energy = decimalMul(sourceValue, declaration.factor)
  return declaration.measure === 'POWER' ? decimalMul(energy, declaration.durationHours) : energy
}

/** 原始数值文本（去首尾空白，保留尾零与写法，如「1.50」）：只用于溯源展示，计算一律用规范十进制。 */
function sourceTextOf(raw) {
  if (raw === null || raw === undefined) return null
  return String(raw).trim() || null
}

function parseCurveNumber(raw) {
  const parsed = parseDecimal(raw, { maxScale: MAX_IMPORT_DECIMALS })
  if (parsed.ok) return { value: parsed.value }
  const reason = {
    NEGATIVE: '不能为负数',
    PRECISION_EXCEEDED: `小数位超过 ${MAX_IMPORT_DECIMALS} 位（曲线数值不做舍入，请核对原始精度）`,
    OUT_OF_RANGE: '数值超出可处理范围',
  }[parsed.code] ?? '不是有效数字'
  return { empty: parsed.code === 'EMPTY', error: reason }
}

function locationText(location) {
  if (!location) return null
  const parts = []
  if (location.sheet) parts.push(location.sheet)
  if (location.rowNumber) parts.push(`第 ${location.rowNumber} 行`)
  return parts.join(' ') || null
}

/**
 * 逐时段曲线 → 规范时段。行可以用「日期 + 时段序号」「开始时间（+结束时间）」或「日期 + 当日开始/结束时刻」三种写法之一。
 * @param {{ declaration: object, rows: Array<{ date?, periodIndex?, start?, end?, value, location? }> }} input
 * @returns {{ intervals: object[], issues: object[] }}
 */
export function normalizeIntervalSeries({ declaration, rows }) {
  const intervals = []
  const issues = []
  const g = declaration.granularityMinutes
  const periodsPerDay = DAY_MINUTES / g
  const list = Array.isArray(rows) ? rows : []
  list.forEach((row, index) => {
    const location = row?.location ?? null
    const ref = locationText(location) ?? `第 ${index + 1} 条`
    const at = { location, sourceRef: ref }
    const number = parseCurveNumber(row?.value)
    if (number.empty) { issues.push(issue('EMPTY_VALUE_SKIPPED', `${ref}：数值为空，按缺时段处理`, at)); return }
    if (number.error) { issues.push(issue('VALUE_INVALID', `${ref}：${number.error}（${String(row?.value)}）`, at)); return }
    const dateText = String(row?.date ?? '').trim()
    const startText = String(row?.start ?? '').trim()
    const endText = String(row?.end ?? '').trim()
    const periodText = String(row?.periodIndex ?? '').trim()
    let startMs = null
    let endMs = null
    if (dateText && periodText) {
      const date = normalizeDate(dateText)
      const period = Number(periodText)
      if (!date) { issues.push(issue('TIME_INVALID', `${ref}：日期「${dateText}」无效`, at)); return }
      if (!Number.isInteger(period) || period < 1 || period > periodsPerDay) {
        issues.push(issue('PERIOD_INDEX_INVALID', `${ref}：时段序号「${periodText}」无效（${g} 分钟粒度为 1—${periodsPerDay}，1 表示当日 00:00 起的第一个时段）`, at))
        return
      }
      startMs = dateMidnightMs(date, declaration.offsetMinutes) + (period - 1) * g * MINUTE_MS
      endMs = startMs + g * MINUTE_MS
    } else if (dateText && startText) {
      const date = normalizeDate(dateText)
      const startMinute = parseTimeOfDay(startText)
      const endMinute = endText ? parseTimeOfDay(endText) : null
      if (!date || startMinute === null || startMinute === DAY_MINUTES || (endText && endMinute === null)) {
        issues.push(issue('TIME_INVALID', `${ref}：日期或当日时刻无效（${dateText} ${startText}${endText ? `—${endText}` : ''}）`, at))
        return
      }
      startMs = dateMidnightMs(date, declaration.offsetMinutes) + startMinute * MINUTE_MS
      endMs = endText ? dateMidnightMs(date, declaration.offsetMinutes) + endMinute * MINUTE_MS : startMs + g * MINUTE_MS
      // 「23:45—00:00」按次日零点理解；其他结束早于开始的写法照常判为无效时段，不猜测。
      if (endText && endMinute === 0 && startMinute > 0) endMs += DAY_MINUTES * MINUTE_MS
    } else if (startText) {
      startMs = parseCurveDateTime(startText, declaration.offsetMinutes)
      endMs = endText ? parseCurveDateTime(endText, declaration.offsetMinutes) : startMs === null ? null : startMs + g * MINUTE_MS
      if (startMs === null || endMs === null) {
        issues.push(issue('TIME_INVALID', `${ref}：时间「${startText}${endText ? ` — ${endText}` : ''}」无效（应为 YYYY-MM-DD HH:mm）`, at))
        return
      }
    } else {
      issues.push(issue('TIME_INVALID', `${ref}：缺少时段（日期 + 时段序号，或开始时间）`, at))
      return
    }
    intervals.push({ rowNo: intervals.length + 1, startMs, endMs, sourceValue: number.value, sourceText: sourceTextOf(row?.value), quantity: convertCurveValue(number.value, declaration), sourceRef: ref })
  })
  if (intervals.length > MAX_CURVE_INTERVALS) {
    issues.push(issue('TOO_MANY_INTERVALS', `时段数 ${intervals.length} 超过单次上限 ${MAX_CURVE_INTERVALS}，请按月份拆分后分批导入`))
    return { intervals: [], issues }
  }
  return { intervals, issues }
}

function minuteLabel(minutes) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
}

/**
 * 典型日的一个时刻段（如峰平谷「峰 08:00—12:00 交易电力 100 MW」）→ 该段覆盖的每个粒度时段取同一功率。
 * 只接受功率：段内功率不变时逐时段换算是精确的；电量合计拆到时段就是均摊，拒绝。
 * 结束时刻不晚于开始时刻表示跨零点（如谷段 22:00—08:00，按同一天的 22:00—24:00 与 00:00—08:00 两段计）；
 * 段边界必须落在粒度边界上，段与段重叠、与逐时段序号重复都报错。
 * @returns {boolean} 该段是否有效
 */
function applySegment({ item, ref, declaration, values, issues }) {
  const g = declaration.granularityMinutes
  const segmentName = String(item?.segmentName ?? '').trim()
  const at = { location: item?.location ?? null, sourceRef: ref }
  if (declaration.measure !== 'POWER') {
    issues.push(issue('TYPICAL_DAY_INVALID', `${ref}：按时刻段填写只支持功率（MW/kW）；电量合计拆到各时段就是均摊，请改填功率或逐时段电量`, at))
    return false
  }
  const start = parseTimeOfDay(item?.startTime)
  const end = parseTimeOfDay(item?.endTime)
  if (start === null || start === DAY_MINUTES || end === null || String(item?.endTime ?? '').trim() === '') {
    issues.push(issue('TIME_INVALID', `${ref}：时刻段「${item?.startTime ?? ''}—${item?.endTime ?? ''}」无效（HH:mm，结束可写 24:00）`, at))
    return false
  }
  if (start % g !== 0 || end % g !== 0) {
    issues.push(issue('TYPICAL_DAY_INVALID', `${ref}：时刻段 ${item.startTime}—${item.endTime} 不在 ${g} 分钟粒度边界上，不能拆成整时段`, at))
    return false
  }
  if (start === end) {
    issues.push(issue('TYPICAL_DAY_INVALID', `${ref}：时刻段开始与结束相同，无法判断是空段还是全天，请写 00:00—24:00`, at))
    return false
  }
  const number = parseCurveNumber(item?.value)
  if (number.empty || number.error) {
    issues.push(issue(number.empty ? 'TYPICAL_DAY_INVALID' : 'VALUE_INVALID', `${ref}：${number.empty ? '数值为空' : number.error}`, at))
    return false
  }
  const wraps = end < start
  const spans = wraps ? [[start, DAY_MINUTES], [0, end]] : [[start, end]]
  const segmentRef = `${ref}（${segmentName ? `${segmentName} ` : ''}${item.startTime}—${item.endTime}${wraps ? '，跨零点' : ''}）`
  let valid = true
  for (const [from, to] of spans) {
    for (let minute = from; minute < to; minute += g) {
      const period = minute / g + 1
      if (values.has(period)) {
        issues.push(issue('TYPICAL_DAY_INVALID', `${segmentRef}：与已定义的 ${minuteLabel(minute)} 起时段重叠`, at))
        valid = false
        continue
      }
      values.set(period, { value: number.value, text: sourceTextOf(item?.value), ref: segmentRef })
    }
  }
  return valid
}

/**
 * 典型日曲线 → 按实际适用日期逐日展开的规范时段。每个典型日有自己的时段值与适用日期区间（含首尾两日）。
 * 时段值二选一：逐时段序号（periodIndex），或峰平谷这类时刻段（startTime/endTime，可带 segmentName，只接受功率）。
 * @param {{ declaration: object, typicalDays: Array<{ name, values: Array<{ periodIndex?, startTime?, endTime?, segmentName?, value, location? }>, dateRanges: Array<{ from, to, location? }>, declaredDailyTotal? }> }} input
 */
export function expandTypicalDays({ declaration, typicalDays }) {
  const intervals = []
  const issues = []
  const g = declaration.granularityMinutes
  const periodsPerDay = DAY_MINUTES / g
  const profiles = Array.isArray(typicalDays) ? typicalDays : []
  // 典型日按「日期」整日套用，日期只有在北京时间下才与交割期逐日对应：源时区不是 +08:00 时，
  // 整日展开必然月初缺段、月末越界，永远无法确认。明确拒绝，改用带日期时刻的逐时段明细（按原偏移换算）。
  if (declaration.offsetMinutes !== BEIJING_OFFSET_MINUTES) {
    issues.push(issue('DECLARATION_INVALID', `典型日曲线按北京时间日期套用，原始时区须为 Asia/Shanghai（+08:00）；「${declaration.sourceTimezone}」口径的曲线请改用逐时段明细（带日期时刻）导入，系统按原偏移换算为北京时间`, { field: 'sourceTimezone' }))
    return { intervals, issues }
  }
  if (!profiles.length) issues.push(issue('TYPICAL_DAY_INVALID', '没有典型日定义'))
  let expandedCount = 0
  const claimedDates = new Map()
  for (const profile of profiles) {
    const name = String(profile?.name ?? '').trim() || '(未命名)'
    const values = new Map()
    let profileValid = true
    for (const [index, item] of (Array.isArray(profile?.values) ? profile.values : []).entries()) {
      const ref = `典型日「${name}」${locationText(item?.location) ?? `第 ${index + 1} 个时段值`}`
      if (String(item?.periodIndex ?? '').trim() === '' && String(item?.startTime ?? '').trim() !== '') {
        if (!applySegment({ item, ref, declaration, values, issues })) profileValid = false
        continue
      }
      const period = Number(String(item?.periodIndex ?? '').trim())
      if (!Number.isInteger(period) || period < 1 || period > periodsPerDay) {
        issues.push(issue('PERIOD_INDEX_INVALID', `${ref}：时段序号「${item?.periodIndex ?? ''}」无效（1—${periodsPerDay}），或改填开始 / 结束时刻`, { location: item?.location ?? null, sourceRef: ref }))
        profileValid = false
        continue
      }
      const number = parseCurveNumber(item?.value)
      if (number.empty || number.error) {
        issues.push(issue(number.empty ? 'TYPICAL_DAY_INVALID' : 'VALUE_INVALID', `${ref}：${number.empty ? '数值为空' : number.error}`, { location: item?.location ?? null, sourceRef: ref }))
        profileValid = false
        continue
      }
      if (values.has(period)) {
        issues.push(issue('TYPICAL_DAY_INVALID', `${ref}：时段 ${period} 重复定义`, { location: item?.location ?? null, sourceRef: ref }))
        profileValid = false
        continue
      }
      values.set(period, { value: number.value, text: sourceTextOf(item?.value), ref })
    }
    const missingPeriods = []
    for (let p = 1; p <= periodsPerDay; p += 1) if (!values.has(p)) missingPeriods.push(p)
    if (missingPeriods.length) {
      const sample = missingPeriods.slice(0, 5).map((p) => `第 ${p} 时段（${minuteLabel((p - 1) * g)} 起）`).join('、')
      issues.push(issue('TYPICAL_DAY_INVALID', `典型日「${name}」缺 ${missingPeriods.length} 个时段（如${sample}），不按零补齐`, { typicalDay: name, missingPeriods: missingPeriods.slice(0, 96) }))
      profileValid = false
    }
    if (profile?.declaredDailyTotal !== undefined && profile?.declaredDailyTotal !== null && String(profile.declaredDailyTotal).trim() !== '') {
      const declared = parseCurveNumber(profile.declaredDailyTotal)
      if (declared.error || declared.empty) {
        issues.push(issue('TYPICAL_DAY_INVALID', `典型日「${name}」声明的日电量无效`, { typicalDay: name }))
      } else if (!missingPeriods.length) {
        // 声明的日电量：电量曲线按曲线单位换算；功率曲线的日电量只能是 MWh。
        let sum = 0n
        for (const { value } of values.values()) sum += toScaled(convertCurveValue(value, declaration))
        const declaredMWh = declaration.measure === 'ENERGY' ? decimalMul(declared.value, declaration.factor) : declared.value
        const diff = sum - toScaled(declaredMWh)
        if ((diff < 0n ? -diff : diff) > toScaled(declaration.tolerance ?? '0')) {
          issues.push(issue('TYPICAL_DAY_TOTAL_MISMATCH', `典型日「${name}」各时段合计 ${fromScaled(sum)} MWh，与声明的日电量 ${declaredMWh} MWh 不一致`, { typicalDay: name, curveQuantity: fromScaled(sum), declaredQuantity: declaredMWh }))
        }
      }
    }
    const ranges = Array.isArray(profile?.dateRanges) ? profile.dateRanges : []
    if (!ranges.length) {
      issues.push(issue('TYPICAL_DAY_INVALID', `典型日「${name}」没有适用日期`, { typicalDay: name }))
      continue
    }
    for (const range of ranges) {
      const from = normalizeDate(range?.from)
      const to = normalizeDate(range?.to)
      const ref = `典型日「${name}」适用日期${locationText(range?.location) ? `（${locationText(range.location)}）` : ''}`
      if (!from || !to || to < from) {
        issues.push(issue('TYPICAL_DAY_INVALID', `${ref}「${range?.from ?? ''} — ${range?.to ?? ''}」无效`, { location: range?.location ?? null, sourceRef: ref }))
        continue
      }
      // 同一天只能套用一个典型日：多个典型日（或同一典型日的多段）适用日期重叠时明确拒绝，不让重复时段悄悄相加。
      let overlap = null
      for (let date = from; date <= to && !overlap; date = nextDay(date)) {
        if (claimedDates.has(date)) overlap = { date, by: claimedDates.get(date) }
      }
      if (overlap) {
        issues.push(issue('TYPICAL_DAY_INVALID', `${ref}「${from} — ${to}」与典型日「${overlap.by}」的适用日期重叠（如 ${overlap.date}），同一天只能套用一个典型日`, { location: range?.location ?? null, sourceRef: ref, date: overlap.date }))
        continue
      }
      for (let date = from; date <= to; date = nextDay(date)) claimedDates.set(date, name)
      if (!profileValid) continue
      for (let date = from; date <= to; date = nextDay(date)) {
        expandedCount += periodsPerDay
        if (expandedCount > MAX_CURVE_INTERVALS) {
          issues.push(issue('TOO_MANY_INTERVALS', `展开后的时段数超过单次上限 ${MAX_CURVE_INTERVALS}，请按月份拆分后分批导入`))
          return { intervals: [], issues }
        }
        const midnight = dateMidnightMs(date, declaration.offsetMinutes)
        for (let p = 1; p <= periodsPerDay; p += 1) {
          const { value, text, ref: valueRef } = values.get(p)
          const startMs = midnight + (p - 1) * g * MINUTE_MS
          intervals.push({ rowNo: intervals.length + 1, startMs, endMs: startMs + g * MINUTE_MS, sourceValue: value, sourceText: text, quantity: convertCurveValue(value, declaration), sourceRef: `${valueRef} · ${date}` })
        }
      }
    }
  }
  return { intervals, issues }
}

// ── 校验与守恒 ──────────────────────────────────────────────────────────────

const ISSUE_LIST_CAP = 300
const ISSUE_PER_CODE_CAP = 50

/** 合同版本的正式月度分解（只取正式资料行），月键 → 电量。 */
export function formalMonthlyQuantities(revision) {
  const map = new Map()
  for (const a of revision?.allocations ?? []) {
    if (a.evidenceBasis !== 'FORMAL') continue
    map.set(a.deliveryMonth, map.has(a.deliveryMonth) ? fromScaled(toScaled(map.get(a.deliveryMonth)) + toScaled(a.quantity)) : String(a.quantity))
  }
  return map
}

function absScaled(v) {
  return v < 0n ? -v : v
}

function compressSlots(slots, g) {
  const ranges = []
  for (const start of slots) {
    const last = ranges[ranges.length - 1]
    if (last && last.endMs === start) { last.endMs = start + g * MINUTE_MS; last.count += 1 } else ranges.push({ startMs: start, endMs: start + g * MINUTE_MS, count: 1 })
  }
  return ranges
}

/** 覆盖月份的合法性与交割期内的有效窗口 [windowStart, windowEnd)。 */
export function resolveCoverage({ coverageFromMonth, coverageToMonth, deliveryStart, deliveryEnd }) {
  const from = normalizeMonth(coverageFromMonth)
  const to = normalizeMonth(coverageToMonth)
  if (!isIsoDate(deliveryStart) || !isIsoDate(deliveryEnd)) return { ok: false, message: '合同交割期未知，无法登记分时分解' }
  if (!from || !to || to < from) return { ok: false, message: `覆盖月份「${coverageFromMonth ?? ''} — ${coverageToMonth ?? ''}」无效（YYYY-MM）` }
  const months = monthsBetween(from, to)
  const delivery = new Set(deliveryMonths(deliveryStart, deliveryEnd))
  const outside = months.filter((m) => !delivery.has(m))
  if (outside.length) return { ok: false, message: `覆盖月份 ${outside.join('、')} 不在合同交割期 ${deliveryStart} — ${deliveryEnd} 内` }
  if (months.length > MAX_CURVE_COVERAGE_MONTHS) return { ok: false, message: `一次最多登记 ${MAX_CURVE_COVERAGE_MONTHS} 个月的分时分解，请分批导入` }
  const deliveryStartMs = dateMidnightMs(deliveryStart)
  const deliveryEndMs = dateMidnightMs(nextDay(deliveryEnd))
  return {
    ok: true,
    fromMonth: from,
    toMonth: to,
    months,
    deliveryStartMs,
    deliveryEndMs,
    windowStartMs: Math.max(dateMidnightMs(monthFirstDay(from)), deliveryStartMs),
    windowEndMs: Math.min(dateMidnightMs(nextDay(monthLastDay(to))), deliveryEndMs),
  }
}

/**
 * 分时分解校验（MP-04）：缺段、重复/重叠、越交割期、跨月、覆盖范围与月/日/总量守恒。
 * 只报告，不修改、不缩放任何数值。
 *
 * @param {{ intervals: object[], declaration: object, coverageFromMonth: string, coverageToMonth: string,
 *           revision: { deliveryStart, deliveryEnd, totalQuantity, allocations }, declaredDailyTotals?: Array<{ date, quantity, location? }>,
 *           priorIssues?: object[] }} input
 */
export function validateCurve({ intervals, declaration, coverageFromMonth, coverageToMonth, revision, declaredDailyTotals = [], priorIssues = [] }) {
  const issues = [...priorIssues]
  const g = declaration.granularityMinutes
  const gMs = g * MINUTE_MS
  const tolerance = toScaled(declaration.tolerance ?? '0')
  const coverage = resolveCoverage({ coverageFromMonth, coverageToMonth, deliveryStart: revision?.deliveryStart, deliveryEnd: revision?.deliveryEnd })
  const sorted = [...(intervals ?? [])].sort((a, b) => a.startMs - b.startMs || a.rowNo - b.rowNo)
  const monthAgg = new Map()
  const dayAgg = new Map()
  const starts = new Set()
  let total = 0n
  let zeroCount = 0
  if (!coverage.ok) issues.push(issue('COVERAGE_INVALID', coverage.message))
  if (!sorted.length) issues.push(issue('EMPTY_CURVE', '没有任何可用的时段数据'))
  const coverageMonths = new Set(coverage.ok ? coverage.months : [])
  let prevStart = null
  let prevEnd = null
  for (const iv of sorted) {
    const at = { rowNo: iv.rowNo, sourceRef: iv.sourceRef, start: toBeijingIso(iv.startMs), end: toBeijingIso(iv.endMs) }
    if (!(iv.endMs > iv.startMs)) { issues.push(issue('INTERVAL_INVALID', `${iv.sourceRef}：结束时间不晚于开始时间`, at)); continue }
    const startParts = beijingPartsOf(iv.startMs)
    if (iv.endMs - iv.startMs !== gMs) issues.push(issue('INTERVAL_DURATION_MISMATCH', `${iv.sourceRef}：时段长 ${(iv.endMs - iv.startMs) / MINUTE_MS} 分钟，与声明粒度 ${g} 分钟不一致`, at))
    if (startParts.minuteOfDay % g !== 0 || startParts.second !== 0 || startParts.millisecond !== 0) {
      issues.push(issue('INTERVAL_MISALIGNED', `${iv.sourceRef}：开始时刻 ${toBeijingIso(iv.startMs)} 未对齐到北京时间 ${g} 分钟边界`, at))
    }
    if (beijingPartsOf(iv.endMs - 1).month !== startParts.month) issues.push(issue('CROSSES_MONTH_BOUNDARY', `${iv.sourceRef}：时段跨越 ${startParts.month} 月末`, at))
    if (coverage.ok && (iv.startMs < coverage.deliveryStartMs || iv.endMs > coverage.deliveryEndMs)) {
      issues.push(issue('OUT_OF_DELIVERY_PERIOD', `${iv.sourceRef}：时段超出合同交割期 ${revision.deliveryStart} — ${revision.deliveryEnd}`, at))
    } else if (coverage.ok && !coverageMonths.has(startParts.month)) {
      issues.push(issue('OUTSIDE_COVERAGE', `${iv.sourceRef}：时段属于 ${startParts.month}，不在本次覆盖月份 ${coverage.fromMonth} — ${coverage.toMonth} 内`, at))
    }
    if (prevStart === iv.startMs) issues.push(issue('DUPLICATE_INTERVAL', `${iv.sourceRef}：与前一行时段 ${toBeijingIso(iv.startMs)} 重复`, at))
    else if (prevEnd !== null && iv.startMs < prevEnd) issues.push(issue('OVERLAPPING_INTERVAL', `${iv.sourceRef}：与前一时段重叠（前一时段结束于 ${toBeijingIso(prevEnd)}）`, at))
    prevStart = iv.startMs
    prevEnd = prevEnd === null ? iv.endMs : Math.max(prevEnd, iv.endMs)
    starts.add(iv.startMs)
    const q = toScaled(iv.quantity)
    if (q === 0n) zeroCount += 1
    total += q
    const m = monthAgg.get(startParts.month) ?? { quantity: 0n, count: 0, zero: 0 }
    m.quantity += q
    m.count += 1
    if (q === 0n) m.zero += 1
    monthAgg.set(startParts.month, m)
    const d = dayAgg.get(startParts.date) ?? { quantity: 0n, count: 0 }
    d.quantity += q
    d.count += 1
    dayAgg.set(startParts.date, d)
  }

  const monthRows = []
  let missingTotal = 0
  let expectedTotal = 0
  if (coverage.ok) {
    const formal = formalMonthlyQuantities(revision)
    for (const month of coverage.months) {
      const monthStart = Math.max(dateMidnightMs(monthFirstDay(month)), coverage.deliveryStartMs)
      const monthEnd = Math.min(dateMidnightMs(nextDay(monthLastDay(month))), coverage.deliveryEndMs)
      const missing = []
      let expected = 0
      for (let t = monthStart; t < monthEnd; t += gMs) {
        expected += 1
        if (!starts.has(t)) missing.push(t)
      }
      expectedTotal += expected
      missingTotal += missing.length
      if (missing.length) {
        const ranges = compressSlots(missing, g)
        issues.push(issue('MISSING_INTERVALS', `${month} 缺 ${missing.length} 个时段（${ranges.slice(0, 3).map((r) => `${toBeijingIso(r.startMs)} 起 ${r.count} 个`).join('；')}${ranges.length > 3 ? ' 等' : ''}），缺时段按未知处理，不按零补齐`, {
          month, missingIntervalCount: missing.length, ranges: ranges.slice(0, 20).map((r) => ({ start: toBeijingIso(r.startMs), end: toBeijingIso(r.endMs), count: r.count })),
        }))
      }
      const agg = monthAgg.get(month) ?? { quantity: 0n, count: 0, zero: 0 }
      const formalQuantity = formal.has(month) ? formal.get(month) : null
      let status = 'MONTH_UNKNOWN'
      let difference = null
      if (formalQuantity === null) {
        issues.push(issue('MONTH_QUANTITY_UNKNOWN', `${month} 合同没有正式月度分解，无法核对分时守恒；请先经合同更正补充月度分解`, { month }))
      } else {
        const diff = agg.quantity - toScaled(formalQuantity)
        difference = fromScaled(diff)
        if (diff === 0n) status = 'CONSERVED'
        else if (absScaled(diff) <= tolerance) {
          status = 'WITHIN_TOLERANCE'
          issues.push(issue('MONTH_WITHIN_TOLERANCE', `${month} 曲线合计 ${fromScaled(agg.quantity)} MWh 与正式月度分解 ${formalQuantity} MWh 相差 ${difference} MWh，在模板容差 ${declaration.tolerance} MWh 内`, { month, difference }))
        } else {
          status = 'NOT_CONSERVED'
          issues.push(issue('MONTH_NOT_CONSERVED', `${month} 曲线合计 ${fromScaled(agg.quantity)} MWh 与正式月度分解 ${formalQuantity} MWh 相差 ${difference} MWh，超出模板容差 ${declaration.tolerance} MWh；不自动缩放，请核对原始资料`, {
            month, curveQuantity: fromScaled(agg.quantity), formalQuantity, difference,
          }))
        }
      }
      monthRows.push({
        month, curveQuantity: fromScaled(agg.quantity), formalQuantity, difference, status,
        intervalCount: agg.count, expectedIntervalCount: expected, missingIntervalCount: missing.length, zeroIntervalCount: agg.zero,
      })
    }
    const deliveryAll = deliveryMonths(revision.deliveryStart, revision.deliveryEnd)
    if (deliveryAll.length === coverage.months.length && revision.totalQuantity !== null && revision.totalQuantity !== undefined) {
      const diff = total - toScaled(revision.totalQuantity)
      if (absScaled(diff) > tolerance) {
        issues.push(issue('TOTAL_NOT_CONSERVED', `曲线覆盖整个交割期，总量 ${fromScaled(total)} MWh 与合同电量 ${revision.totalQuantity} MWh 相差 ${fromScaled(diff)} MWh`, {
          curveQuantity: fromScaled(total), contractQuantity: String(revision.totalQuantity), difference: fromScaled(diff),
        }))
      }
    }
    const seenDeclared = new Set()
    for (const declared of declaredDailyTotals ?? []) {
      const ref = locationText(declared?.location) ?? '声明的日电量'
      const date = normalizeDate(declared?.date)
      const number = parseCurveNumber(declared?.quantity)
      if (!date || number.empty || number.error || seenDeclared.has(date)) {
        issues.push(issue('DECLARED_DAY_INVALID', `${ref}：日期或日电量无效${date && seenDeclared.has(date) ? `（${date} 重复）` : ''}`, { location: declared?.location ?? null }))
        continue
      }
      seenDeclared.add(date)
      const dayStart = dateMidnightMs(date)
      if (dayStart < coverage.windowStartMs || dayStart >= coverage.windowEndMs) {
        issues.push(issue('DECLARED_DAY_INVALID', `${ref}：${date} 不在本次覆盖范围内`, { location: declared?.location ?? null, date }))
        continue
      }
      const declaredMWh = declaration.measure === 'ENERGY' ? decimalMul(number.value, declaration.factor) : number.value
      const sum = dayAgg.get(date)?.quantity ?? 0n
      const diff = sum - toScaled(declaredMWh)
      if (absScaled(diff) > tolerance) {
        issues.push(issue('DAY_NOT_CONSERVED', `${date} 时段合计 ${fromScaled(sum)} MWh 与声明的日电量 ${declaredMWh} MWh 相差 ${fromScaled(diff)} MWh`, {
          date, curveQuantity: fromScaled(sum), declaredQuantity: declaredMWh, difference: fromScaled(diff), location: declared?.location ?? null,
        }))
      }
    }
  }
  return summarizeIssues(issues, {
    totalQuantity: fromScaled(total),
    intervalCount: sorted.length,
    expectedIntervalCount: expectedTotal,
    missingIntervalCount: missingTotal,
    zeroIntervalCount: zeroCount,
    completeness: coverage.ok && missingTotal === 0 && sorted.length > 0 ? 'COMPLETE' : 'PARTIAL',
    months: monthRows,
    coverage: coverage.ok ? { fromMonth: coverage.fromMonth, toMonth: coverage.toMonth, start: toBeijingIso(coverage.windowStartMs), end: toBeijingIso(coverage.windowEndMs) } : null,
    tolerance: declaration.tolerance,
    templateCode: declaration.templateCode,
    roundingRule: declaration.roundingRule,
    roundingRuleText: declaration.roundingRuleText,
  })
}

/** 问题列表 → 阻断计数、按代码汇总与截断后的明细（明细最多 300 条、每类最多 50 条，计数不截断）。 */
export function summarizeIssues(issues, extra = {}) {
  const byCode = new Map()
  const kept = []
  let truncated = false
  for (const it of issues) {
    const entry = byCode.get(it.code) ?? { code: it.code, severity: it.severity, label: CURVE_ISSUES[it.code]?.label ?? STATION_ALLOCATION_ISSUES[it.code]?.label ?? it.code, count: 0 }
    entry.count += 1
    byCode.set(it.code, entry)
    if (entry.count <= ISSUE_PER_CODE_CAP && kept.length < ISSUE_LIST_CAP) kept.push(it)
    else truncated = true
  }
  const summary = [...byCode.values()]
  const blockingCount = summary.filter((s) => s.severity === 'blocking').reduce((n, s) => n + s.count, 0)
  return {
    ...extra,
    blocking: blockingCount > 0,
    blockingCount,
    warningCount: summary.filter((s) => s.severity !== 'blocking').reduce((n, s) => n + s.count, 0),
    summary,
    issues: kept,
    truncated,
  }
}

// ── 估算工具 ────────────────────────────────────────────────────────────────

/**
 * 按正式月度分解生成内部估算分时（MP-04「用户生成的分配草案必须标估算且不覆盖原资料」）。
 * FLAT：当月每个时段均分；PROFILE：按一天各时段的非负权重分摊。舍入与尾差规则见 CURVE_TEMPLATES[CURVE_ESTIMATE_TEMPLATE]。
 * 月量未知的月份不生成（不均摊合同总量），直接报错。
 * @returns {{ ok: boolean, intervals: object[], issues: object[], declaration: object|null }}
 */
export function generateEstimateCurve({ revision, coverageFromMonth, coverageToMonth, granularityMinutes, method, profile }) {
  const issues = []
  const g = Number(granularityMinutes)
  if (!CURVE_ESTIMATE_GRANULARITIES.includes(g)) issues.push(issue('DECLARATION_INVALID', `估算只支持 15/30/60 分钟粒度（收到「${granularityMinutes ?? ''}」）`, { field: 'granularityMinutes' }))
  if (!CURVE_ESTIMATE_METHODS.includes(method)) issues.push(issue('DECLARATION_INVALID', `不支持的估算方法「${method ?? ''}」（可选：FLAT 均分、PROFILE 权重）`, { field: 'method' }))
  const coverage = resolveCoverage({ coverageFromMonth, coverageToMonth, deliveryStart: revision?.deliveryStart, deliveryEnd: revision?.deliveryEnd })
  if (!coverage.ok) issues.push(issue('COVERAGE_INVALID', coverage.message))
  if (issues.length) return { ok: false, intervals: [], issues, declaration: null }
  const periodsPerDay = DAY_MINUTES / g
  let weights
  if (method === 'FLAT') {
    weights = Array.from({ length: periodsPerDay }, () => '1')
  } else {
    const list = Array.isArray(profile) ? profile : []
    if (list.length !== periodsPerDay) {
      return { ok: false, intervals: [], declaration: null, issues: [issue('DECLARATION_INVALID', `权重应为 ${periodsPerDay} 个（${g} 分钟粒度的一天），收到 ${list.length} 个`, { field: 'profile' })] }
    }
    weights = []
    for (const [index, w] of list.entries()) {
      const parsed = parseDecimal(w, { maxScale: MAX_IMPORT_DECIMALS })
      if (!parsed.ok) return { ok: false, intervals: [], declaration: null, issues: [issue('DECLARATION_INVALID', `第 ${index + 1} 个权重「${w ?? ''}」无效（非负数、最多 ${MAX_IMPORT_DECIMALS} 位小数）`, { field: 'profile' })] }
      weights.push(parsed.value)
    }
    if (weights.every((w) => toScaled(w) === 0n)) return { ok: false, intervals: [], declaration: null, issues: [issue('DECLARATION_INVALID', '权重全为 0，无法分摊', { field: 'profile' })] }
  }
  const formal = formalMonthlyQuantities(revision)
  const unknownMonths = coverage.months.filter((m) => !formal.has(m))
  if (unknownMonths.length) {
    return { ok: false, intervals: [], declaration: null, issues: [issue('MONTH_QUANTITY_UNKNOWN', `${unknownMonths.join('、')} 没有正式月度分解，估算工具不均摊合同总量；请先补充月度分解`, { months: unknownMonths })] }
  }
  const declaration = resolveCurveDeclaration({ granularityMinutes: g, unit: 'MWh', sourceTimezone: CANONICAL_CURVE_TIMEZONE, templateCode: CURVE_ESTIMATE_TEMPLATE }).value
  const intervals = []
  for (const month of coverage.months) {
    const monthStart = Math.max(dateMidnightMs(monthFirstDay(month)), coverage.deliveryStartMs)
    const monthEnd = Math.min(dateMidnightMs(nextDay(monthLastDay(month))), coverage.deliveryEndMs)
    const slots = []
    let weightSum = 0n
    for (let t = monthStart; t < monthEnd; t += g * MINUTE_MS) {
      const w = weights[beijingPartsOf(t).minuteOfDay / g]
      slots.push({ startMs: t, weight: w })
      weightSum += toScaled(w)
    }
    const monthQuantity = formal.get(month)
    if (weightSum === 0n) {
      return { ok: false, intervals: [], declaration: null, issues: [issue('DECLARATION_INVALID', `${month} 的适用时段权重合计为 0，无法分摊`, { month })] }
    }
    const weightTotal = fromScaled(weightSum)
    let lastWeighted = slots.length - 1
    while (lastWeighted > 0 && toScaled(slots[lastWeighted].weight) === 0n) lastWeighted -= 1
    let allocated = 0n
    const monthIntervals = slots.map((s, index) => {
      const quantity = index === lastWeighted ? null : toScaled(s.weight) === 0n ? '0' : decimalDiv(decimalMul(monthQuantity, s.weight), weightTotal, CURVE_ESTIMATE_DECIMALS)
      if (quantity !== null) allocated += toScaled(quantity)
      return { startMs: s.startMs, endMs: s.startMs + g * MINUTE_MS, quantity }
    })
    const tail = toScaled(monthQuantity) - allocated
    if (tail < 0n) {
      return { ok: false, intervals: [], declaration: null, issues: [issue('DECLARATION_INVALID', `${month} 舍入后尾差为负（${fromScaled(tail)} MWh），请调整权重`, { month })] }
    }
    monthIntervals[lastWeighted].quantity = fromScaled(tail)
    for (const iv of monthIntervals) {
      intervals.push({ rowNo: intervals.length + 1, startMs: iv.startMs, endMs: iv.endMs, sourceValue: iv.quantity, sourceText: null, quantity: iv.quantity, sourceRef: `估算：${CURVE_ESTIMATE_METHOD_LABELS[method]} · ${month}` })
    }
  }
  if (intervals.length > MAX_CURVE_INTERVALS) {
    return { ok: false, intervals: [], declaration: null, issues: [issue('TOO_MANY_INTERVALS', `估算时段数 ${intervals.length} 超过单次上限 ${MAX_CURVE_INTERVALS}，请缩短覆盖月份`)] }
  }
  return { ok: true, intervals, issues: [], declaration }
}

// ── 场站分配 ────────────────────────────────────────────────────────────────

function allocationIssue(code, message, extra = {}) {
  return { code, severity: STATION_ALLOCATION_ISSUES[code]?.severity ?? 'blocking', message, ...extra }
}

/**
 * 交易单元 → 场站分配校验（MP-05）。片段 = 合同总量（CONTRACT_TOTAL）或某个交割月的正式月度电量（MONTHLY）；
 * 每个片段的分配合计不得超过片段电量，剩余为未分配余额（可见，不隐藏、不摊给任何场站）。
 *
 * @param {{ segmentMode: string, rows: Array<{ stationId, segmentMonth?, quantity }>, revision: { deliveryStart, deliveryEnd, totalQuantity, allocations } }} input
 * @returns {{ rows: object[], segments: object[], blocking: boolean, blockingCount: number, warningCount: number, summary: object[], issues: object[], truncated: boolean }}
 */
export function validateStationAllocations({ segmentMode, rows, revision }) {
  const issues = []
  const normalized = []
  const list = Array.isArray(rows) ? rows : []
  const months = new Set(deliveryMonths(revision?.deliveryStart, revision?.deliveryEnd))
  const formal = formalMonthlyQuantities(revision)
  if (!list.length) issues.push(allocationIssue('EMPTY_ALLOCATION', '没有任何场站分配行'))
  const seen = new Set()
  list.forEach((row, index) => {
    const ref = `第 ${index + 1} 行`
    const at = { rowIndex: index }
    const stationId = Number(row?.stationId)
    if (!Number.isInteger(stationId) || stationId < 1) { issues.push(allocationIssue('STATION_REQUIRED', `${ref}：缺场站`, at)); return }
    const parsed = parseDecimal(row?.quantity, { maxScale: MAX_IMPORT_DECIMALS })
    if (!parsed.ok) {
      issues.push(allocationIssue('QUANTITY_INVALID', `${ref}：分配电量${parsed.code === 'EMPTY' ? '必填' : `「${row?.quantity}」无效（非负、最多 ${MAX_IMPORT_DECIMALS} 位小数，单位 MWh）`}`, at))
      return
    }
    const rawMonth = String(row?.segmentMonth ?? '').trim()
    let segmentMonth = null
    if (segmentMode === 'MONTHLY') {
      segmentMonth = normalizeMonth(rawMonth)
      if (!segmentMonth) { issues.push(allocationIssue('SEGMENT_MONTH_REQUIRED', `${ref}：按交割月分配时必须填写月份（YYYY-MM）`, at)); return }
      if (!months.has(segmentMonth)) { issues.push(allocationIssue('SEGMENT_MONTH_OUT_OF_RANGE', `${ref}：${segmentMonth} 不在合同交割期内`, at)); return }
    } else if (rawMonth) {
      issues.push(allocationIssue('SEGMENT_MONTH_NOT_ALLOWED', `${ref}：按合同总量分配时不填写月份`, at))
      return
    }
    const key = `${segmentMonth ?? 'TOTAL'}|${stationId}`
    if (seen.has(key)) { issues.push(allocationIssue('DUPLICATE_STATION_SEGMENT', `${ref}：场站 ${stationId} 在${segmentMonth ?? '合同总量'}片段重复出现`, at)); return }
    seen.add(key)
    normalized.push({ stationId, segmentMonth, quantity: parsed.value, rowIndex: index })
  })
  const segments = summarizeStationSegments({ segmentMode, rows: normalized, revision, formal })
  for (const seg of segments) {
    const label = seg.segment === 'TOTAL' ? '合同总量' : `${seg.segment} 月`
    if (seg.status === 'SEGMENT_UNKNOWN') {
      issues.push(allocationIssue('SEGMENT_QUANTITY_UNKNOWN', `${label}片段电量未知（${seg.segment === 'TOTAL' ? '合同电量缺失' : '该月没有正式月度分解'}），不能确认分配`, { segment: seg.segment }))
    } else if (seg.status === 'EXCEEDS') {
      issues.push(allocationIssue('ALLOCATION_EXCEEDS_SEGMENT', `${label}片段电量 ${seg.segmentQuantity} MWh，分配合计 ${seg.allocatedQuantity} MWh，超出 ${seg.excessQuantity} MWh；原分配保持不变`, {
        segment: seg.segment, segmentQuantity: seg.segmentQuantity, allocatedQuantity: seg.allocatedQuantity, excessQuantity: seg.excessQuantity,
      }))
    }
  }
  return { rows: normalized, segments, ...summarizeIssues(issues) }
}

/**
 * 按片段汇总分配合计与未分配余额（校验与展示共用）。
 * 按交割月分配时，片段 = 交割期内全部有正式月度电量的月份 ∪ 分配行出现的月份：没有分配行的月份照样列出，
 * 未分配余额就是该月正式电量——否则「只给六月分配」时七月整月未分配会从预览与校验结果里消失。
 * 交割期内没有正式月度电量、也没有分配行的月份不列出（它不是可分配片段，列出会变成阻断）。
 */
export function summarizeStationSegments({ segmentMode, rows, revision, formal = formalMonthlyQuantities(revision) }) {
  const bySegment = new Map()
  for (const row of rows ?? []) {
    const key = segmentMode === 'MONTHLY' ? row.segmentMonth : 'TOTAL'
    const entry = bySegment.get(key) ?? { allocated: 0n, stationCount: 0 }
    entry.allocated += toScaled(row.quantity)
    entry.stationCount += 1
    bySegment.set(key, entry)
  }
  const formalMonths = deliveryMonths(revision?.deliveryStart, revision?.deliveryEnd).filter((m) => formal.has(m))
  const keys = segmentMode === 'MONTHLY' ? [...new Set([...formalMonths, ...bySegment.keys()])].sort() : ['TOTAL']
  return keys.map((segment) => {
    const entry = bySegment.get(segment) ?? { allocated: 0n, stationCount: 0 }
    const segmentQuantity = segment === 'TOTAL'
      ? (revision?.totalQuantity === null || revision?.totalQuantity === undefined ? null : String(revision.totalQuantity))
      : (formal.get(segment) ?? null)
    if (segmentQuantity === null) {
      return { segment, segmentQuantity: null, allocatedQuantity: fromScaled(entry.allocated), unallocatedQuantity: null, excessQuantity: null, stationCount: entry.stationCount, status: 'SEGMENT_UNKNOWN' }
    }
    const remaining = toScaled(segmentQuantity) - entry.allocated
    return {
      segment,
      segmentQuantity,
      allocatedQuantity: fromScaled(entry.allocated),
      unallocatedQuantity: remaining >= 0n ? fromScaled(remaining) : '0',
      excessQuantity: remaining < 0n ? fromScaled(-remaining) : '0',
      stationCount: entry.stationCount,
      status: remaining < 0n ? 'EXCEEDS' : 'WITHIN',
    }
  })
}

/**
 * 更正后沿用（design D4 / MA-03）：已确认的分时分解集与场站分配挂在某个经济版本上；合同更正生成新版本后，
 * 未受影响片段沿用旧版本上已确认的分解，受影响片段失效、需重新确认。从最新版本往前逐版比较，遇到下列情况即停止：
 * - 月份片段：该版本的受影响月份（affectedMonths）含该月，或该月正式月度分解电量与前一版本不同（任一方未知也算不同）；
 * - 合同总量片段：该版本有任何受影响月份，或合同电量、交割起止与前一版本不同。
 * @param {Array<{ id, revisionNo, affectedMonths, totalQuantity, deliveryStart, deliveryEnd, allocations }>} chain
 *   同一合同已确认的版本，按版本号升序，末尾是当前（或认知时点下有效的）版本。
 * @param {{ month?: string|null, segment?: 'TOTAL'|null }} target
 * @returns {Array<{ revisionId: number, revisionNo: number }>} 可取用分解的版本，新到旧，首个是末尾版本本身。
 */
export function inheritableRevisions(chain, { month = null, segment = null } = {}) {
  const list = Array.isArray(chain) ? chain : []
  if (!list.length) return []
  const out = [{ revisionId: list[list.length - 1].id, revisionNo: list[list.length - 1].revisionNo }]
  for (let i = list.length - 1; i > 0; i -= 1) {
    const cur = list[i]
    const prev = list[i - 1]
    const affected = cur.affectedMonths ?? []
    if (segment === 'TOTAL') {
      if (affected.length || !quantitiesEqual(cur.totalQuantity, prev.totalQuantity) || cur.deliveryStart !== prev.deliveryStart || cur.deliveryEnd !== prev.deliveryEnd) break
    } else {
      if (affected.includes(month) || !quantitiesEqual(formalMonthlyQuantities(cur).get(month) ?? null, formalMonthlyQuantities(prev).get(month) ?? null)) break
    }
    out.push({ revisionId: prev.id, revisionNo: prev.revisionNo })
  }
  return out
}

/** 月份是否由合同条款确定为单月交割（单月合同的「按合同总量分配」就是该月分配，不是均摊）。 */
export function isSingleMonthDelivery(revision) {
  return deliveryMonths(revision?.deliveryStart, revision?.deliveryEnd).length === 1
}

/** 分时持仓视图的查询区间校验：日期、粒度、天数上限。 */
export function resolveIntervalRange({ fromDate, toDate, granularity }) {
  const from = normalizeDate(fromDate)
  const to = normalizeDate(toDate)
  const g = INTERVAL_POSITION_GRANULARITIES[granularity]
  if (!g) return { ok: false, message: `不支持的分时粒度「${granularity ?? ''}」（可选：DAY、HOUR、QUARTER_HOUR）` }
  if (!from || !to) return { ok: false, message: '起止日期无效（YYYY-MM-DD）' }
  if (to < from) return { ok: false, message: '结束日期不能早于起始日期' }
  const days = (dateMidnightMs(to) - dateMidnightMs(from)) / (DAY_MINUTES * MINUTE_MS) + 1
  if (days > INTERVAL_POSITION_MAX_DAYS[granularity]) return { ok: false, message: `${granularity} 粒度一次最多查询 ${INTERVAL_POSITION_MAX_DAYS[granularity]} 天` }
  return { ok: true, fromDate: from, toDate: to, granularity, granularityMinutes: g, days, fromMonth: from.slice(0, 7), toMonth: to.slice(0, 7), startMs: dateMidnightMs(from), endMs: dateMidnightMs(nextDay(to)) }
}

/** 规范电量字符串比较（导出给前端做「是否等于月量」一类展示判断，避免浮点）。 */
export function quantitiesEqual(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && decimalCompare(a, b) === 0
}

/** 两个电量之差（a − b），任一未知返回 null。 */
export function quantityDifference(a, b) {
  return a === null || a === undefined || b === null || b === undefined ? null : decimalSub(a, b)
}

/** 月键合法性（给前端表单用）。 */
export function isCurveMonth(value) {
  return isMonthKey(value)
}
