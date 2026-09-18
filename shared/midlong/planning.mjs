// 中长期售电 P3：售电目标、交易窗口与交易方案的共享契约（#2972，Epic #2937，openspec tasks 第 8—9 组）。
//
// 单一事实源：后端 server/midlong/midlong-p3-* 与前端（经 sync:web 同步到 dljy-web 只读）共用这里的
// 枚举、中文标签、提示文案与纯函数规则。零依赖（只引用同目录的十进制与日期工具）、前后端同构。
//
// 口径红线（specs midlong-sales-planning MS-01..05、midlong-trade-execution MT-01/MT-02）：
// - 售电目标是人工确认的经营安排，不是物理可发电量，也不是法定额度。
// - 剩余计划待售量 = 确认目标 − 确认已售电量；完成率 = 确认已售电量 / 确认目标。
//   目标为零或未知时不算比例；已售覆盖不完整时不把未分解电量当成零，结果标「未完成核验」。
// - 可安排计划量 = 确认目标 − 确认已售 − 未完成占用。方案占用是内部安排，不是正式义务、不进持仓。
// - 方案对比是「方案测算」，不是实际收入；没有可比的中长期行情时不判断价格优劣。
// - 导出申报材料不等于提交；登记提交只是记录外部操作事实，不宣称平台已受理、不形成持仓。
// - 本期不出现套保率、现货敞口、预计利润等口径，不读取现货、预测数据。

import { decimalAdd, decimalCompare, decimalDiv, decimalIsZero, decimalSub } from './decimal.mjs'
import { isIsoDate, isMonthKey } from './dates.mjs'

// ── 售电目标（计划） ─────────────────────────────────────────────────────────

/** 目标的交割期粒度：年度、月度。首期按「交易主体 + 年/月」管理；场站与分时粒度等 P2 接口合并后再扩展。 */
export const PLAN_PERIOD_TYPES = Object.freeze(['YEAR', 'MONTH'])
export const PLAN_REVISION_STATUSES = Object.freeze(['DRAFT', 'CONFIRMED'])
/** 进度核验状态：已核验 / 已售覆盖不完整（未完成核验）/ 目标未确认。 */
export const PLAN_VERIFICATION_STATUSES = Object.freeze(['VERIFIED', 'UNVERIFIED', 'TARGET_UNKNOWN'])

// ── 交易方案 ─────────────────────────────────────────────────────────────────

/**
 * 本期实现的方案状态：方案草稿、确认可执行、已登记提交、待结果、已撤销、已关闭。
 * 预成交、确认成交、撤单属于 P4（DEFERRED_PROPOSAL_STATUSES），本期不实现流转。
 */
export const PROPOSAL_STATUSES = Object.freeze(['DRAFT', 'EXECUTABLE', 'SUBMITTED', 'AWAITING_RESULT', 'CANCELLED', 'CLOSED'])
/** 占用未释放的状态。 */
export const PROPOSAL_OCCUPYING_STATUSES = Object.freeze(['EXECUTABLE', 'SUBMITTED', 'AWAITING_RESULT'])
export const PROPOSAL_TERMINAL_STATUSES = Object.freeze(['CANCELLED', 'CLOSED'])
export const DEFERRED_PROPOSAL_STATUSES = Object.freeze(['PRE_CLEARED', 'CLEARED', 'WITHDRAWN'])

/** 方案动作 → 允许的起始状态。撤销只能发生在外部提交之前；已登记提交后只能关闭（撤单属于 P4）。 */
export const PROPOSAL_ACTION_FROM = Object.freeze({
  UPDATE_DRAFT: Object.freeze(['DRAFT']),
  CONFIRM: Object.freeze(['DRAFT']),
  CANCEL: Object.freeze(['DRAFT', 'EXECUTABLE']),
  CLOSE: Object.freeze(['EXECUTABLE', 'SUBMITTED', 'AWAITING_RESULT']),
  REGISTER_SUBMISSION: Object.freeze(['EXECUTABLE', 'SUBMITTED', 'AWAITING_RESULT']),
  ADD_RECEIPT: Object.freeze(['SUBMITTED', 'AWAITING_RESULT', 'CLOSED']),
  AWAIT_RESULT: Object.freeze(['SUBMITTED']),
  RECHECK_WINDOW: Object.freeze(['DRAFT', 'EXECUTABLE', 'SUBMITTED', 'AWAITING_RESULT']),
})

export function proposalActionAllowed(status, action) {
  return Boolean(PROPOSAL_ACTION_FROM[action]?.includes(status))
}

export const PROPOSAL_CLOSE_KINDS = Object.freeze(['NO_LONGER_NEEDED', 'WINDOW_EXPIRED', 'OTHER'])
export const OCCUPATION_RELEASE_REASONS = Object.freeze(['CANCELLED', 'CLOSED'])

// ── 外部提交登记与回执 ───────────────────────────────────────────────────────

export const RECEIPT_COMPLETENESS = Object.freeze(['NONE', 'PARTIAL', 'COMPLETE'])
/** 回执完整度的三项依据：外部申报/回执编号、平台回执时间、回执文件。 */
export const RECEIPT_ELEMENTS = Object.freeze(['externalReference', 'receiptAt', 'attachment'])

// ── 交易窗口（公告） ─────────────────────────────────────────────────────────

/** 公告登记中「缺失即待核对」的参数。名称必填，其余缺失时显示待核对，不套默认。 */
export const WINDOW_REVIEW_FIELDS = Object.freeze([
  'sourceName', 'publishedDate', 'announcementVersion', 'effectiveFrom', 'effectiveTo', 'applicability',
  'tradeMethod', 'productKind', 'deliveryStartMonth', 'deliveryEndMonth', 'declarationOpensAt', 'declarationClosesAt', 'confirmationAt',
])
export const CALENDAR_EVENT_KINDS = Object.freeze(['DECLARATION_OPENS', 'DECLARATION_CLOSES', 'CONFIRMATION'])
const CALENDAR_FIELD_OF = Object.freeze({ DECLARATION_OPENS: 'declarationOpensAt', DECLARATION_CLOSES: 'declarationClosesAt', CONFIRMATION: 'confirmationAt' })

export const PLANNING_ATTACHMENT_PURPOSES = Object.freeze(['WINDOW_ANNOUNCEMENT', 'SUBMISSION_RECEIPT'])

export const PLANNING_EVENT_TYPES = Object.freeze([
  'PLAN_CREATED', 'PLAN_DRAFT_UPDATED', 'PLAN_REVISION_CREATED', 'PLAN_CONFIRMED',
  'WINDOW_REGISTERED', 'WINDOW_CORRECTED',
  'PROPOSAL_CREATED', 'PROPOSAL_DRAFT_UPDATED', 'PROPOSAL_CONFIRMED', 'PROPOSAL_WINDOW_REVISED', 'PROPOSAL_WINDOW_RECHECKED',
  'PROPOSAL_SUBMISSION_REGISTERED', 'PROPOSAL_RECEIPT_ADDED', 'PROPOSAL_AWAITING_RESULT', 'PROPOSAL_CANCELLED', 'PROPOSAL_CLOSED',
])

// ── 中文标签与固定提示 ───────────────────────────────────────────────────────

export const PLAN_PERIOD_TYPE_LABELS = Object.freeze({ YEAR: '年度', MONTH: '月度' })
export const PLAN_REVISION_STATUS_LABELS = Object.freeze({ DRAFT: '待确认', CONFIRMED: '已确认' })
export const PLAN_VERIFICATION_STATUS_LABELS = Object.freeze({
  VERIFIED: '已核验', UNVERIFIED: '结果未完成核验', TARGET_UNKNOWN: '目标未确认',
})
export const PROPOSAL_STATUS_LABELS = Object.freeze({
  DRAFT: '方案草稿', EXECUTABLE: '确认可执行', SUBMITTED: '已登记提交', AWAITING_RESULT: '待结果', CANCELLED: '已撤销', CLOSED: '已关闭',
})
export const PROPOSAL_CLOSE_KIND_LABELS = Object.freeze({ NO_LONGER_NEEDED: '不再执行', WINDOW_EXPIRED: '窗口已过', OTHER: '其他' })
export const OCCUPATION_RELEASE_REASON_LABELS = Object.freeze({ CANCELLED: '方案撤销', CLOSED: '方案关闭' })
export const RECEIPT_COMPLETENESS_LABELS = Object.freeze({
  NONE: '无回执（仅登记提交事实）', PARTIAL: '回执不完整（依据待补）', COMPLETE: '回执资料齐全',
})
export const RECEIPT_ELEMENT_LABELS = Object.freeze({ externalReference: '外部申报/回执编号', receiptAt: '平台回执时间', attachment: '回执文件' })
export const WINDOW_REVIEW_FIELD_LABELS = Object.freeze({
  sourceName: '公告来源', publishedDate: '发布日期', announcementVersion: '公告版本', effectiveFrom: '生效开始', effectiveTo: '生效结束',
  applicability: '适用主体', tradeMethod: '交易方式', productKind: '交易品种周期', deliveryStartMonth: '交割起始月', deliveryEndMonth: '交割结束月',
  declarationOpensAt: '申报开始时间', declarationClosesAt: '申报截止时间', confirmationAt: '确认时间',
})
export const CALENDAR_EVENT_KIND_LABELS = Object.freeze({ DECLARATION_OPENS: '申报开始', DECLARATION_CLOSES: '申报截止', CONFIRMATION: '确认时间' })
export const PLANNING_EVENT_TYPE_LABELS = Object.freeze({
  PLAN_CREATED: '创建目标草稿', PLAN_DRAFT_UPDATED: '修改目标草稿', PLAN_REVISION_CREATED: '发起目标更改', PLAN_CONFIRMED: '确认目标版本',
  WINDOW_REGISTERED: '登记公告', WINDOW_CORRECTED: '登记更正公告',
  PROPOSAL_CREATED: '创建方案草稿', PROPOSAL_DRAFT_UPDATED: '修改方案草稿', PROPOSAL_CONFIRMED: '确认可执行（建立占用）',
  PROPOSAL_WINDOW_REVISED: '引用的公告已更正（待重新核对）', PROPOSAL_WINDOW_RECHECKED: '按新公告版本重新核对', PROPOSAL_SUBMISSION_REGISTERED: '登记外部提交', PROPOSAL_RECEIPT_ADDED: '补充回执',
  PROPOSAL_AWAITING_RESULT: '标记待结果', PROPOSAL_CANCELLED: '撤销方案（释放占用）', PROPOSAL_CLOSED: '关闭方案（释放占用）',
})

/** 页面与导出共用的固定口径提示。 */
export const PLANNING_NOTICES = Object.freeze({
  targetNature: '售电目标为人工确认的经营安排，不是物理可发电量，也不是法定额度。',
  unverified: '已售电量覆盖不完整（有合同电量未分解到本交割期或电量未知），结果未完成核验；未分解电量不按零计算。',
  targetUnknown: '尚无已确认的售电目标，不计算剩余计划待售量与完成率。',
  zeroTarget: '确认目标为零，不计算完成率。',
  overPlan: '确认已售电量已超过确认目标（超计划）：已核验时剩余计划待售量按负数显示、不截断为零；已售未完成核验时按已知已售（下限）判断，剩余仍待核验。',
  overCommitted: '确认已售电量与未完成占用合计已超过确认目标：已核验时可安排计划量为负；已售未完成核验时按已知已售（下限）判断，余额仍待核验。真实成交照常入账、不因超计划丢弃，请调整或关闭方案、或更改目标。',
  occupation: '方案占用是已确认方案尚未完成的内部安排，不是正式义务，不计入合同持仓。',
  simulation: '方案测算：仅模拟交易后视图，不增加正式持仓，名义金额不是实际收入。',
  priceNotAssessed: '没有可比的中长期行情，不判断方案价格优劣。',
  exportNotSubmission: '导出申报材料不等于提交，不改变方案状态，也不会操作外部交易平台。',
  submissionNotAccepted: '登记提交只记录外部操作事实；无回执或回执不完整时不代表平台已受理，也不形成持仓。',
  windowPending: '公告参数缺失或不支持时显示待核对；时间未知不套默认值，不生成正式提醒。',
  windowRevised: '该方案引用的公告已有更正版本，请按新版本重新核对。',
})

/** 本期页面与接口禁止出现的口径（测试用）。 */
export const FORBIDDEN_PLANNING_TERMS = Object.freeze(['套保率', '现货敞口', '预计利润'])

// ── 纯函数规则 ───────────────────────────────────────────────────────────────

/** 年键 YYYY。 */
export function isYearKey(value) {
  return /^\d{4}$/.test(String(value ?? ''))
}

/** 交割期键：YEAR → YYYY，MONTH → YYYY-MM。非法返回 false。 */
export function isPeriodKey(periodType, periodKey) {
  if (periodType === 'YEAR') return isYearKey(periodKey)
  if (periodType === 'MONTH') return isMonthKey(periodKey)
  return false
}

/** 交割期键 → 库内 period_start（该期第一天）。 */
export function periodStartOf(periodType, periodKey) {
  if (!isPeriodKey(periodType, periodKey)) return null
  return periodType === 'YEAR' ? `${periodKey}-01-01` : `${periodKey}-01`
}

/** 库内 period_start → 交割期键。 */
export function periodKeyOf(periodType, periodStart) {
  const text = String(periodStart ?? '').slice(0, 10)
  if (!isIsoDate(text)) return null
  return periodType === 'YEAR' ? text.slice(0, 4) : text.slice(0, 7)
}

/** 交割期覆盖的月键。 */
export function monthsOfPeriod(periodType, periodKey) {
  if (!isPeriodKey(periodType, periodKey)) return []
  if (periodType === 'MONTH') return [periodKey]
  return Array.from({ length: 12 }, (_, i) => `${periodKey}-${String(i + 1).padStart(2, '0')}`)
}

/** 月份是否落在交割期内。 */
export function periodContainsMonth(periodType, periodKey, month) {
  return monthsOfPeriod(periodType, periodKey).includes(month)
}

const nullish = (v) => v === null || v === undefined

/**
 * 目标完成情况（MS-02/MS-04）。
 * @param {{ targetQuantity: string|null, soldQuantity: string|null, soldComplete: boolean, openOccupationQuantity?: string }} input
 *   soldQuantity 为已知的确认已售电量；soldComplete=false 表示还有未分解或电量未知的合同，已知值只是下限。
 * 规则：
 * - 目标未知 → 剩余、完成率、可安排均为 null，状态 TARGET_UNKNOWN。
 * - 已售不完整 → 剩余、完成率、可安排均为 null（不把未分解电量当零），状态 UNVERIFIED；
 *   已知已售只是下限：下限已超过目标（超计划）、下限加未完成占用已超过目标（占用超过目标）都是确定事实，照样标出。
 * - 目标为零 → 完成率 null；剩余与可安排照常计算（可为负）。
 * - 已售超过目标 → 剩余为负、完成率超过 1，不截断。
 */
export function computePlanProgress({ targetQuantity = null, soldQuantity = null, soldComplete = false, openOccupationQuantity = '0' } = {}) {
  const targetKnown = !nullish(targetQuantity)
  const soldKnown = Boolean(soldComplete) && !nullish(soldQuantity)
  const occupation = nullish(openOccupationQuantity) ? '0' : openOccupationQuantity
  const remaining = targetKnown && soldKnown ? decimalSub(targetQuantity, soldQuantity) : null
  const completionRate = targetKnown && soldKnown && !decimalIsZero(targetQuantity) ? decimalDiv(soldQuantity, targetQuantity, 6) : null
  const arrangeable = remaining === null ? null : decimalSub(remaining, occupation)
  const overPlan = targetKnown && !nullish(soldQuantity) ? decimalCompare(soldQuantity, targetQuantity) > 0 : false
  // 占用建立后又有真实合同确认（合同核验不经过方案占用校验）时，已售 + 占用可能超过目标：如实提示，不回滚真实成交。
  // 不依赖可安排计划量：已售未完成核验时余额为 null，但已知已售（下限）加占用已超过目标同样是确定事实。
  const overCommitted = targetKnown && !nullish(soldQuantity) && decimalCompare(occupation, '0') > 0
    && decimalCompare(decimalAdd(soldQuantity, occupation), targetQuantity) > 0
  const verificationStatus = !targetKnown ? 'TARGET_UNKNOWN' : soldKnown ? 'VERIFIED' : 'UNVERIFIED'
  const notices = []
  if (!targetKnown) notices.push(PLANNING_NOTICES.targetUnknown)
  if (targetKnown && !soldKnown) notices.push(PLANNING_NOTICES.unverified)
  if (targetKnown && decimalIsZero(targetQuantity)) notices.push(PLANNING_NOTICES.zeroTarget)
  if (overPlan) notices.push(PLANNING_NOTICES.overPlan)
  if (overCommitted) notices.push(PLANNING_NOTICES.overCommitted)
  return {
    targetQuantity: targetKnown ? targetQuantity : null,
    knownSoldQuantity: nullish(soldQuantity) ? null : soldQuantity,
    soldComplete: soldKnown,
    remainingPlanQuantity: remaining,
    completionRate,
    openOccupationQuantity: occupation,
    arrangeableQuantity: arrangeable,
    overPlan,
    overCommitted,
    verificationStatus,
    notices,
  }
}

/**
 * 回执完整度（MT-02）：三项依据都齐全 COMPLETE，部分具备 PARTIAL，都没有 NONE。
 * 任何一档都只是登记事实；COMPLETE 也不代表成交。
 */
export function receiptCompletenessOf(receipts = []) {
  const present = {
    externalReference: receipts.some((r) => Boolean(String(r?.externalReference ?? '').trim())),
    receiptAt: receipts.some((r) => !nullish(r?.receiptAt) && r.receiptAt !== ''),
    attachment: receipts.some((r) => !nullish(r?.attachmentId) || !nullish(r?.attachment)),
  }
  const missing = RECEIPT_ELEMENTS.filter((k) => !present[k])
  const completeness = missing.length === 0 ? 'COMPLETE' : missing.length === RECEIPT_ELEMENTS.length ? 'NONE' : 'PARTIAL'
  return { completeness, missing, present }
}

/**
 * 公告参数待核对清单（MT-01）：缺失的参数与不支持的原文参数都列出，不补默认值。
 * @param {object} revision 窗口版本（前后端字段名一致）
 */
export function windowPendingFields(revision) {
  const pending = []
  for (const field of WINDOW_REVIEW_FIELDS) {
    const value = field === 'applicability'
      ? (String(revision?.applicableScope ?? '').trim() || (revision?.applicableSubjectIds?.length ? 'subjects' : ''))
      : revision?.[field]
    if (nullish(value) || String(value).trim() === '') pending.push({ field, label: WINDOW_REVIEW_FIELD_LABELS[field], reason: 'MISSING' })
  }
  for (const [field, raw] of Object.entries(revision?.unsupportedParams ?? {})) {
    pending.push({ field, label: WINDOW_REVIEW_FIELD_LABELS[field] ?? field, reason: 'UNSUPPORTED', raw: String(raw) })
  }
  return pending
}

/**
 * 日历事件（MT-01）：只为公告里明确给出的时间生成事件；未知时间进 pendingTimes，显示「待补」，
 * 不借用其他地区、历史窗口或默认时刻生成正式提醒。
 */
export function windowCalendarEvents(revision) {
  const events = []
  const pendingTimes = []
  for (const kind of CALENDAR_EVENT_KINDS) {
    const field = CALENDAR_FIELD_OF[kind]
    const at = revision?.[field]
    if (nullish(at) || at === '') pendingTimes.push({ kind, label: `${CALENDAR_EVENT_KIND_LABELS[kind]}待补` })
    else events.push({ kind, label: CALENDAR_EVENT_KIND_LABELS[kind], at })
  }
  return { events, pendingTimes }
}

const WINDOW_DIFF_FIELDS = Object.freeze([
  'announcementName', 'sourceName', 'sourceReference', 'publishedDate', 'announcementVersion', 'effectiveFrom', 'effectiveTo',
  'applicableScope', 'applicableSubjectIds', 'tradeMethod', 'productKind', 'deliveryStartMonth', 'deliveryEndMonth',
  'declarationOpensAt', 'declarationClosesAt', 'confirmationAt', 'unsupportedParams', 'attachmentId',
])

const WINDOW_DIFF_LABELS = Object.freeze({
  announcementName: '公告名称', sourceReference: '来源文号/链接', applicableScope: '适用主体（原文）', applicableSubjectIds: '适用交易主体',
  unsupportedParams: '不支持的参数', attachmentId: '公告原文件',
})

/** 公告两个版本的差异字段（用于「查看新旧版本」）。 */
export function windowRevisionDiff(previous, next) {
  const norm = (v) => JSON.stringify(Array.isArray(v) ? [...v].sort() : v ?? null)
  return WINDOW_DIFF_FIELDS
    .filter((field) => norm(previous?.[field]) !== norm(next?.[field]))
    .map((field) => ({ field, label: WINDOW_REVIEW_FIELD_LABELS[field] ?? WINDOW_DIFF_LABELS[field] ?? field, previous: previous?.[field] ?? null, next: next?.[field] ?? null }))
}

/**
 * 时刻 → 北京时间「YYYY-MM-DD HH:mm」（北京时间全年 UTC+8、无夏令时）；未知或非法返回 null，不补默认值。
 * @param {string|Date|null|undefined} value
 */
export function formatBeijingDateTime(value) {
  if (nullish(value) || value === '') return null
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

/** 完整的北京时间输入「YYYY-MM-DD HH:mm」（日期与时刻都必须给出）。 */
export function isCompleteBeijingDateTimeInput(value) {
  const text = String(value ?? '')
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text) && parseBeijingDateTime(text) !== null
}

/** 时刻输入不合法的原因（日历上不存在的日期、越界的时分都要明确指出，不交给 Date 静默滚动）。 */
export const INSTANT_INPUT_REASONS = Object.freeze(['FORMAT', 'DATE_ONLY', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'OFFSET'])
export const INSTANT_INPUT_REASON_LABELS = Object.freeze({
  FORMAT: '格式应为 YYYY-MM-DD HH:mm', DATE_ONLY: '只有日期、缺少时:分', MONTH: '月份不存在', DAY: '该月没有这一天',
  HOUR: '小时应在 00—23', MINUTE: '分钟应在 00—59', SECOND: '秒应在 00—59', OFFSET: '时区偏移无效',
})

const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,6})?)?(Z|([+-])(\d{2}):?(\d{2}))?$/
const pad2 = (n) => String(n).padStart(2, '0')
const daysInMonthOf = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** 逐项定位不合法的原因（只用于给出原因；是否合法由 inspectBeijingDateTime 的反向核对判定）。 */
function instantReasonOf(parts) {
  const { year, month, day, hour, minute, second, offsetHour, offsetMinute } = parts
  if (month < 1 || month > 12) return 'MONTH'
  if (day < 1 || day > daysInMonthOf(year, month)) return 'DAY'
  if (hour > 23) return 'HOUR'
  if (minute > 59) return 'MINUTE'
  if (second > 59) return 'SECOND'
  if (offsetHour > 23 || offsetMinute > 59) return 'OFFSET'
  return 'FORMAT'
}

/**
 * 业务时刻逐字段核验：带时区按原样、不带时区按北京时间（design D3）。
 * Date 会把 02-30、04-31、非闰年 02-29、24:00 静默滚到后面的日期（2031-02-30 → 3 月 2 日），
 * 所以解析后把结果换回输入所用的时区，反向核对年、月、日、时、分、秒与输入逐项相同；不同即拒绝，并给出原因。
 * 只有日期（YYYY-MM-DD）不接受——申报、确认时间必须是具体时刻，不把日期默认成零点。
 * @returns {{ ok: true, date: Date } | { ok: false, reason: string }}
 */
export function inspectBeijingDateTime(value) {
  if (nullish(value)) return { ok: false, reason: 'FORMAT' }
  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, reason: 'DATE_ONLY' }
  const m = INSTANT_RE.exec(text)
  if (!m) return { ok: false, reason: 'FORMAT' }
  const parts = {
    year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]),
    second: m[6] === undefined ? 0 : Number(m[6]),
    offsetHour: m[10] === undefined ? 0 : Number(m[10]), offsetMinute: m[11] === undefined ? 0 : Number(m[11]),
  }
  const offsetMinutes = m[8] === 'Z' ? 0 : m[8] ? (m[9] === '-' ? -1 : 1) * (parts.offsetHour * 60 + parts.offsetMinute) : 8 * 60
  const zone = offsetMinutes === 0 ? 'Z' : `${offsetMinutes < 0 ? '-' : '+'}${pad2(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad2(Math.abs(offsetMinutes) % 60)}`
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${pad2(parts.second)}${m[7] ?? ''}${zone}`)
  if (Number.isNaN(date.getTime())) return { ok: false, reason: instantReasonOf(parts) }
  // 反向核对：换回输入所用时区后逐项比对，不一致说明 Date 做了滚动。
  const local = new Date(date.getTime() + offsetMinutes * 60 * 1000)
  const back = [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()]
  const input = [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second]
  if (input.some((v, i) => v !== back[i])) return { ok: false, reason: instantReasonOf(parts) }
  return { ok: true, date }
}

/** 业务时刻解析（不合法返回 null；需要原因时用 inspectBeijingDateTime）。 */
export function parseBeijingDateTime(value) {
  const result = inspectBeijingDateTime(value)
  return result.ok ? result.date : null
}
