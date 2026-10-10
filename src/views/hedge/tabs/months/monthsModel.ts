// 「当月/后续」页签的纯显示函数（openspec build-midlong-spot-hedging 任务 8.3，HW-03/HW-04/HB-07/HM-02；ChenShi-Tech/dljy#3421）。
//
// 只做文案映射与图表序列组装，不算任何口径（比率、判级、守恒都由服务端给，前端原样呈现）：
// - 数值十进制字符串原样显示，未知 null → 「未知」，绝不用 0 冒充（FORBIDDEN 同理，HW-04）；
// - 套保率 status → 中文文案（不可计算 / 不完整 / 机制参数不完整 / 无权限）；
// - 判级 level/reason/tier → 中文（未评估必须写明原因，HM-04）；
// - 钻取一致性：服务端 consistency 是权威，前端另按十进制求和给出「分类求和」与「合计」双显示（HM-06）；
// - 按日图表序列：实际/预测分段、未覆盖日两侧都为 null（柱缺失）、锁价折线 null 断开不连线（D8 不插值）。
import type { HedgeConsistency, HedgeMonthAssessment, HedgeMonthCapRow, HedgeMonthView, HedgeRatioValue } from '@/services/hedge/hedgeMonthsApi'
import {
  ASSESSMENT_LEVEL_LABELS, ASSESSMENT_REASON_LABELS, CAP_EXCEEDED_LABEL, CAP_MODIFIED_AFTER_AS_OF_LABEL,
  CAP_NOT_REGISTERED_LABEL, MONTH_PERIOD_LABELS, TIER_LABELS, UNCOVERED_REASON_LABELS, decimalCompare, decimalSum,
} from '@/services/hedge/hedgeMonthsApi'
import { ratioToPercent } from '@/services/hedge/hedgeMaintenanceModel'

export type MonthPeriod = HedgeMonthView['period']
export type DaysSource = HedgeMonthView['days'][number]['generation']['source']

/** 十进制字符串是否为负（十进制比较，不看首字符——负零等边角交给同一算法）。 */
export function isNegativeDecimal(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  try {
    return decimalCompare(value, '0') < 0
  } catch {
    return false
  }
}

export type CapRowView = {
  subjectId: number
  capMwh: string
  lockedMwh: string
  remainingMwh: string
  exceeded: boolean
  statusText: string
  tone: 'ok' | 'warn' | 'danger' | 'muted'
  note: string | null
}

/** 核定上限一行 → 展示状态（HB-07）：超出（exceeded 或剩余为负）必须一眼可见；未登记如实说未登记，不算 0。 */
export function capRowView(row: HedgeMonthCapRow): CapRowView {
  const exceeded = row.exceeded === true || isNegativeDecimal(row.remainingMwh)
  if (row.status === 'NOT_REGISTERED') {
    return {
      subjectId: row.subjectId, capMwh: '—', lockedMwh: row.lockedMwh ?? '—', remainingMwh: '—',
      exceeded: false, statusText: CAP_NOT_REGISTERED_LABEL, tone: 'muted', note: row.note,
    }
  }
  if (row.status === 'MODIFIED_AFTER_AS_OF') {
    return {
      subjectId: row.subjectId, capMwh: '—', lockedMwh: row.lockedMwh ?? '—', remainingMwh: '—',
      exceeded: false, statusText: CAP_MODIFIED_AFTER_AS_OF_LABEL, tone: 'warn', note: row.note,
    }
  }
  return {
    subjectId: row.subjectId, capMwh: row.capMwh ?? '未知', lockedMwh: row.lockedMwh ?? '未知',
    remainingMwh: row.remainingMwh ?? '未知',
    exceeded,
    statusText: exceeded ? CAP_EXCEEDED_LABEL : '已登记',
    tone: exceeded ? 'danger' : 'ok',
    note: row.note,
  }
}

/** MWh 数值显示：null → 「未知」（未知不是 0）；有值原样（十进制字符串）。 */
export function mwhText(value: string | null | undefined): string {
  return value === null || value === undefined ? '未知' : value
}

/** 套保率显示：有值换算百分数；无值按 status 给中文原因，不显示 0（HM-02/HW-04）。 */
export function ratioText(ratio: HedgeRatioValue): string {
  if (ratio.value !== null) return percentOf(ratio.value)
  switch (ratio.status) {
    case 'FORBIDDEN': return '无法计算（无权限查看中长期持仓）'
    case 'MECHANISM_INCOMPLETE': return '不完整（机制电量未知）'
    case 'INCOMPLETE_COVERAGE': return '不完整（部分场站缺基准）'
    default: return '不可计算'
  }
}

/** 小数（'0.85'）→ 百分数文本（'85%'）；非数字原样。换算复用 hedgeMaintenanceModel.ratioToPercent（同一套字符串算法）。 */
export function percentOf(value: string): string {
  const percent = ratioToPercent(value)
  return percent ? `${percent}%` : value
}

/** 判级显示：未评估必须带原因（HM-04）；其余按 level 标签。 */
export function assessmentText(assessment: HedgeMonthAssessment): string {
  if (assessment.level === 'NOT_ASSESSED') {
    const reason = assessment.reason ? ASSESSMENT_REASON_LABELS[assessment.reason as keyof typeof ASSESSMENT_REASON_LABELS] ?? assessment.reason : null
    return reason ? `未评估：${reason}` : '未评估'
  }
  return ASSESSMENT_LEVEL_LABELS[assessment.level as keyof typeof ASSESSMENT_LEVEL_LABELS] ?? assessment.level
}

/** 判级期限档：当月 = 月内档、后续月份 = 远期档（HB-02）；非标准窗口为 null。 */
export function assessmentTierText(assessment: HedgeMonthAssessment): string | null {
  return assessment.tier ? TIER_LABELS[assessment.tier] : null
}

export function periodLabel(period: MonthPeriod): string {
  return MONTH_PERIOD_LABELS[period]
}

export function uncoveredReasonText(reason: string | null): string {
  if (!reason) return '未知'
  return UNCOVERED_REASON_LABELS[reason as keyof typeof UNCOVERED_REASON_LABELS] ?? reason
}

export interface ConsistencyView { text: string; tone: 'ok' | 'partial' | 'danger' }

/** 守恒一致性显示（HM-06）：全部已知 ok=true 一致；含未知 partial 只校验已知部分；ok=false 不一致必须可见。 */
export function consistencyView(consistency: HedgeConsistency | null): ConsistencyView | null {
  if (!consistency) return null
  if (consistency.ok === true) return { text: '明细之和与合计一致', tone: 'ok' }
  if (consistency.ok === false) {
    return { text: `明细之和与合计不一致（差 ${consistency.diff ?? '?'} MWh）`, tone: 'danger' }
  }
  return { text: consistency.note ?? '下层含未知，只校验已知部分不超过上层', tone: 'partial' }
}

/** 钻取 rows 的十进制求和（与 totalMwh 同口径对照显示；空为 '0'）。 */
export function sumRowMwh(rows: Array<{ quantityMwh: string }>): string {
  return decimalSum(rows.map((row) => row.quantityMwh))
}

/** 按日图表序列（MonthDaysChart 消费）：实际/预测分段着色，未覆盖日两侧都为 null（柱缺失，不冒充 0）；锁价 null 断开。 */
export interface DaysChartSeries {
  dates: string[]
  actualGen: Array<number | null>
  forecastGen: Array<number | null>
  locked: Array<number | null>
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export function daysChartSeries(days: HedgeMonthView['days']): DaysChartSeries {
  return {
    dates: days.map((day) => day.date.slice(8)),
    actualGen: days.map((day) => (day.generation.source === 'ACTUAL' ? numOrNull(day.generation.value) : null)),
    forecastGen: days.map((day) => (day.generation.source === 'FORECAST' ? numOrNull(day.generation.value) : null)),
    locked: days.map((day) => numOrNull(day.lockedDecomposedMwh)),
  }
}
