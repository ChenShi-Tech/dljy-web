// 中长期售电 P4 页面的展示口径（dljy#3014）：纯函数，页面与单测共用。
//
// 红线（specs MT-02..06、MA-01..05，与 shared 契约的固定文案一致）：
// - 提交/登记只称「登记事实」：platformAcceptance NOT_ASSERTED 不显示「平台已受理」；导出不等于提交。
// - 预成交只保留记录（不入正式持仓、不转占用）；确认成交的原子性、重复处理的幂等、关联不双计均有固定提示。
// - 未知显示「未知/待核对/待补」，不显示 0；超计划与负剩余原样显示。
// - 调整方向不得从「买入/卖出」字样或电量正负推断；无方向 = 待核对并阻止生效。
// - 独立价款（转让/补偿/手续费）单列，不并入售电价、不进持仓均价；不按比例缩小全年。
import { fmtAmount, fmtQuantity } from './midlongFormat'
import {
  ADJUSTMENT_NOTICES, ADJUSTMENT_STATUS_LABELS, ADJUSTMENT_TYPE_LABELS, ADJUSTMENT_PRICE_KIND_LABELS,
  EXECUTION_NOTICES, EXECUTION_RESULT_STATUS_LABELS, OBLIGATION_DIRECTION_LABELS,
  type AdjustmentPrices, type AdjustmentStatus, type AdjustmentType, type ObligationDirection,
  type ExecutionLinkKind, type ExecutionResultStatus, type OccupationConversionMonth, type PlanDeviationRow,
} from './midlongP4Types'

type TagType = 'success' | 'warning' | 'danger' | 'info' | 'primary'

// ── 执行确认 ─────────────────────────────────────────────────────────────────

/** 确认单结果状态：预成交=过程态、确认成交=成功色、外部撤销=警示色（冲正不是草稿撤单）。 */
export function executionResultTag(status: ExecutionResultStatus | null): { label: string; type: TagType } {
  if (!status) return { label: '未知', type: 'info' }
  const type: Record<ExecutionResultStatus, TagType> = { PRE_CLEARED: 'warning', CLEARED: 'success', WITHDRAWN: 'danger' }
  return { label: EXECUTION_RESULT_STATUS_LABELS[status] ?? status, type: type[status] ?? 'info' }
}

/** 待核对（来源产品不支持）：展示原文，提示人工核对补齐品种后修订处理。 */
export function pendingReviewText(raw: string | null | undefined): string {
  return raw ? `待核对（来源产品原文：${raw}）` : '待核对'
}

/** 占用转换逐月原因（MS-04）：区分全部转换、部分转换、修订回退与无开放占用（迟到结果）。 */
const CONVERSION_REASON_LABELS: Record<OccupationConversionMonth['reason'], string> = {
  CONVERTED: '已转换',
  PARTIAL: '部分转换（占用不足）',
  REDUCED: '修订回退',
  OCCUPATION_NOT_OPEN: '无开放占用（照常入账义务）',
}
export function conversionReasonLabel(reason: OccupationConversionMonth['reason']): string {
  return CONVERSION_REASON_LABELS[reason] ?? reason
}

/** 计划偏差行的剩余量：目标未确认显示「目标未确认」、已售不完整显示「待核验（不按零计）」，不显示 0。 */
export function deviationRemainingLabel(row: PlanDeviationRow): string {
  if (row.remainingPlanQuantityAfter === null) {
    return row.verificationStatus === 'TARGET_UNKNOWN' ? '目标未确认' : '待核验（不按零计）'
  }
  return `${fmtQuantity(row.remainingPlanQuantityAfter)} MWh`
}

/** 关联类型文本：确认成交创建的合同义务 / 关联既有合同义务（后者不新增同一义务）。 */
export function linkKindText(kind: ExecutionLinkKind | null | undefined): string {
  if (!kind) return '未关联'
  if (kind === 'OBLIGATION_CREATED') return '由确认单创建的合同义务'
  return '关联既有合同义务（持仓不双计）'
}

/**
 * 执行确认失败的可读原因：保留错误码语义并给下一步动作；
 * 余额/主体/幂等冲突展示服务端事实，不在前端自行判定通过。
 */
export function executionFailureText(errorCode: string, message: string, details: unknown): string {
  const d = (details ?? {}) as {
    reason?: string; missing?: string[]; notice?: string; contractIds?: number[]; confirmationId?: number;
    currentRevisionNo?: number; months?: string[];
  }
  if (d.reason === 'SUBJECT_MISMATCH' || errorCode === 'SUBJECT_MISMATCH') {
    return `${EXECUTION_NOTICES.subjectMismatch}${d.contractIds?.length ? `（候选合同：${d.contractIds.join('、')}）` : ''}`
  }
  if (errorCode === 'DUPLICATE_CONFIRMATION_CONTENT') {
    return `${EXECUTION_NOTICES.contentChangeIsRevision}（确认单 #${d.confirmationId ?? '？'} 当前版本 v${d.currentRevisionNo ?? '？'}）`
  }
  if (errorCode === 'OCCUPATION_ALREADY_RELEASED') return `${EXECUTION_NOTICES.occupationFloor}${d.months?.length ? `（交割月：${d.months.join('、')}）` : ''}`
  if (errorCode === 'INCOMPLETE_BASIS' && d.missing?.length) return `登记前请补齐：${d.missing.join('、')}`
  if (errorCode === 'BUSINESS_KEY_CONFLICT' && d.contractIds?.length) {
    return `同号候选合同不止一份：${d.contractIds.join('、')}，请人工核对后以「关联既有合同」指定`
  }
  return d.notice ?? message
}

// ── 合同调整 ─────────────────────────────────────────────────────────────────

/** 调整状态：待生效=过程态、待核对（方向未确认）=警示、已生效=成功（终态）。 */
export function adjustmentStatusTag(status: AdjustmentStatus | null): { label: string; type: TagType } {
  if (!status) return { label: '未知', type: 'info' }
  const type: Record<AdjustmentStatus, TagType> = { DRAFT: 'warning', PENDING_VERIFICATION: 'danger', EFFECTIVE: 'success' }
  return { label: ADJUSTMENT_STATUS_LABELS[status] ?? status, type: type[status] ?? 'info' }
}

export function adjustmentTypeLabel(kind: AdjustmentType | null | undefined): string {
  return kind ? ADJUSTMENT_TYPE_LABELS[kind] ?? kind : '未知'
}

/** 方向文本：null = 待核对（无从判定我方义务增减方向）。 */
export function directionLabel(direction: ObligationDirection | null | undefined): string {
  return direction ? OBLIGATION_DIRECTION_LABELS[direction] : '待核对（方向未确认）'
}

/** 带符号差量（MWh）：负数原样显示（减少就是减少），不括号、不取绝对值。 */
export function signedDeltaLabel(delta: string | null | undefined): string {
  if (delta === null || delta === undefined || delta === '') return '未知'
  return `${Number(delta) > 0 ? '+' : ''}${fmtQuantity(delta)} MWh`
}

/** 独立价款单列（MA-02）：转让价款/补偿/手续费各自「金额 币种（含税口径）」，与售电价分开。 */
export function priceLines(prices: AdjustmentPrices | null | undefined): string[] {
  if (!prices) return []
  const lines: string[] = []
  for (const [kind, item] of Object.entries(prices)) {
    if (!item) continue
    const label = ADJUSTMENT_PRICE_KIND_LABELS[kind as keyof typeof ADJUSTMENT_PRICE_KIND_LABELS] ?? kind
    const tax = item.taxBasis === 'TAX_INCLUDED' ? '含税' : item.taxBasis === 'TAX_EXCLUDED' ? '不含税' : '含税口径未知'
    lines.push(`${label}：${fmtAmount(item.amount)} ${item.currency || 'CNY'}（${tax}${item.note ? ` · ${item.note}` : ''}）`)
  }
  return lines
}

/** 逐月 before/after/delta 一行文本（影响对比与确认结果共用）。 */
export function impactMonthLine(month: { deliveryMonth: string; before: string | null; after: string | null; delta: string | null }): string {
  const after = month.after === null ? '待核对（方向未确认）' : fmtQuantity(month.after)
  return `${month.deliveryMonth}：${fmtQuantity(month.before)} → ${after}（${signedDeltaLabel(month.delta)}）`
}

/**
 * 调整失败的可读原因（MA-02..04）：
 * - ADJUSTABLE_BALANCE_EXCEEDED：逐月「请求 X / 可调 Y」，原版本与持仓不变；
 * - 并发同基线 BASE_REVISION_MOVED：引导基于最新版本重新核对（修订重报）；
 * - 方向未核验 INCOMPLETE_BASIS：待核对态阻止生效；
 * - ADJUSTMENT_CHANNEL_REQUIRED：更正入口收到业务变更时引导到调整登记。
 */
export function adjustmentFailureText(errorCode: string, message: string, details: unknown): string {
  const d = (details ?? {}) as {
    reason?: string; months?: Array<{ deliveryMonth: string; requested: string; adjustable: string }>;
    missing?: string[]; pendingReason?: string; notice?: string; adjustmentId?: number; currentRevisionNo?: number;
  }
  if (errorCode === 'ADJUSTABLE_BALANCE_EXCEEDED') {
    const rows = (d.months ?? []).map((m) => `${m.deliveryMonth} 请求 ${fmtQuantity(m.requested)} / 可调 ${fmtQuantity(m.adjustable)}`)
    return `减少量超过片段可调整余额：${rows.join('；')}${rows.length ? '。' : ''}${ADJUSTMENT_NOTICES.adjustableBalance}`
  }
  if (d.reason === 'BASE_REVISION_MOVED') {
    const current = d.currentRevisionNo ? `当前合同版本 v${d.currentRevisionNo}` : '当前合同版本未知'
    return `${ADJUSTMENT_NOTICES.baseMoved}（${current}）请打开修订，按原内容重新对准最新基线后提交。`
  }
  if (errorCode === 'INCOMPLETE_BASIS' && (d.pendingReason || d.missing?.length)) {
    if (d.pendingReason) return `${ADJUSTMENT_NOTICES.directionPending}（待核对原因：无法确认我方义务增减方向）`
    return `生效前请补齐：${d.missing!.join('、')}`
  }
  if (errorCode === 'ADJUSTMENT_CHANNEL_REQUIRED') {
    return '录入更正只用于纠正录入错误；外部调整、转让与部分终止请在「合同调整」登记（不能混用更正通道）'
  }
  if (errorCode === 'BUSINESS_KEY_CONFLICT') {
    return '同一外部调整编号与修订号已登记不同内容：内容变化请以修订版本提交（旧版本保留），不能按新调整重复入账'
  }
  return d.notice ?? message
}
