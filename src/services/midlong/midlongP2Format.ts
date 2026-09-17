// 中长期售电 P2 页面的展示口径（dljy#2971）：纯函数，页面与单测共用。
//
// 红线（specs MP-02/MP-04/MP-05）：
// - 分时未知显示「分时未知」，不显示 0；当天没有交割义务才是真实 0。
// - 内部估算一律标「内部估算（不计入正式持仓）」，与正式资料分开。
// - 主体合计与场站份额是同一义务的两种观察维度：展示「主体合计 = 场站份额 + 未分配 + 月份未分到场站」，不给相加的合计。
// - 正式交易分解与内部经营分配区别展示。
import { fmtQuantity } from './midlongFormat'
import {
  BUCKET_COVERAGE_LABELS, CURVE_EVIDENCE_BASIS_LABELS, CURVE_SET_STATUS_LABELS, CURVE_TIME_STATUS_LABELS, STATION_ALLOCATION_KIND_LABELS,
  type BucketCoverage, type CurveSetStatus, type CurveTimeStatus, type IntervalBucket, type StationAllocationKind, type ValidationIssue,
} from './midlongP2Types'
import type { EvidenceBasis } from './midlongTypes'

type TagType = 'success' | 'warning' | 'danger' | 'info' | 'primary'

/** 时段桶电量：整桶未知 → 「分时未知」；部分未知 → 已知部分并注明；无义务 → 0（无交割义务）。 */
export function bucketQuantityLabel(bucket: Pick<IntervalBucket, 'coverage' | 'formalQuantity'>): string {
  if (bucket.coverage === 'UNKNOWN' || bucket.formalQuantity === null) return '分时未知'
  if (bucket.coverage === 'PARTIAL') return `${fmtQuantity(bucket.formalQuantity)}（另有合同分时未知）`
  if (bucket.coverage === 'NO_OBLIGATION') return '0（无交割义务）'
  return fmtQuantity(bucket.formalQuantity)
}

export function coverageTag(coverage: BucketCoverage): { label: string; type: TagType } {
  const type: Record<BucketCoverage, TagType> = { COMPLETE: 'success', PARTIAL: 'warning', UNKNOWN: 'warning', NO_OBLIGATION: 'info' }
  return { label: BUCKET_COVERAGE_LABELS[coverage] ?? coverage, type: type[coverage] ?? 'info' }
}

export function timeStatusTag(status: CurveTimeStatus): { label: string; type: TagType } {
  const type: Record<CurveTimeStatus, TagType> = { CURVE: 'success', TIME_UNKNOWN: 'warning', GRANULARITY_TOO_COARSE: 'warning', MONTH_UNKNOWN: 'danger' }
  return { label: CURVE_TIME_STATUS_LABELS[status] ?? status, type: type[status] ?? 'info' }
}

export function curveSetStatusTag(status: CurveSetStatus): { label: string; type: TagType } {
  const type: Record<CurveSetStatus, TagType> = { DRAFT: 'warning', CONFIRMED: 'success', DISCARDED: 'info' }
  return { label: CURVE_SET_STATUS_LABELS[status] ?? status, type: type[status] ?? 'info' }
}

/** 依据类型：内部估算明确标出不计入正式持仓。 */
export function basisTag(basis: EvidenceBasis): { label: string; type: TagType } {
  return basis === 'INTERNAL_ESTIMATE'
    ? { label: `${CURVE_EVIDENCE_BASIS_LABELS.INTERNAL_ESTIMATE}（不计入正式持仓）`, type: 'warning' }
    : { label: CURVE_EVIDENCE_BASIS_LABELS.FORMAL, type: 'success' }
}

export function allocationKindTag(kind: StationAllocationKind): { label: string; type: TagType } {
  return kind === 'INTERNAL_OPERATING'
    ? { label: `${STATION_ALLOCATION_KIND_LABELS.INTERNAL_OPERATING}（非正式交易分解）`, type: 'warning' }
    : { label: STATION_ALLOCATION_KIND_LABELS.FORMAL_TRADING, type: 'success' }
}

/** 分配片段：TOTAL → 合同总量；YYYY-MM → 该月。 */
export function segmentLabel(segment: string): string {
  return segment === 'TOTAL' ? '合同总量' : `${segment} 月`
}

/** 校验问题的定位文本：优先原始资料行，其次时段 / 月份 / 日期。 */
export function issueLocation(issue: ValidationIssue): string {
  if (issue.sourceRef) return issue.sourceRef
  if (issue.start) return issue.end ? `${issue.start} ~ ${issue.end}` : issue.start
  return issue.date ?? issue.month ?? (typeof issue.rowIndex === 'number' ? `第 ${issue.rowIndex + 1} 行` : '—')
}

/**
 * 典型日权重文本 → 权重数组（逗号、空格或换行分隔）。个数必须等于一天的时段数；
 * 只做形状检查，数值合法性由服务端按共享规则校验。
 */
export function parseProfileWeights(text: string, periodsPerDay: number): { ok: true; weights: string[] } | { ok: false; message: string } {
  const weights = text.split(/[\s,，]+/).map((w) => w.trim()).filter(Boolean)
  if (weights.length !== periodsPerDay) return { ok: false, message: `权重应为 ${periodsPerDay} 个（一天的时段数），当前 ${weights.length} 个` }
  if (weights.some((w) => !/^\d+(\.\d+)?$/.test(w))) return { ok: false, message: '权重只能是非负数' }
  return { ok: true, weights }
}

/** 主体合计的拆分说明（不相加）。 */
export function stationSplitText(month: { subjectTotalQuantity: string; stationAllocatedQuantity: string; unallocatedQuantity: string; stationMonthUnknownQuantity: string }): string {
  const parts = [`场站份额 ${fmtQuantity(month.stationAllocatedQuantity)}`, `未分配 ${fmtQuantity(month.unallocatedQuantity)}`]
  if (month.stationMonthUnknownQuantity !== '0') parts.push(`月份未分到场站 ${fmtQuantity(month.stationMonthUnknownQuantity)}`)
  return `主体合计 ${fmtQuantity(month.subjectTotalQuantity)} = ${parts.join(' + ')}`
}

/** 北京时间 ISO（+08:00）→ 页面短文本「MM-DD HH:mm」或「YYYY-MM-DD」。 */
export function bucketTimeLabel(start: string, granularity: 'DAY' | 'HOUR' | 'QUARTER_HOUR'): string {
  return granularity === 'DAY' ? start.slice(0, 10) : `${start.slice(5, 10)} ${start.slice(11, 16)}`
}
