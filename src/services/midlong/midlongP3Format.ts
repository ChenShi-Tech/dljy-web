// 中长期售电 P3 页面的展示口径（dljy#2973）：纯函数，页面与单测共用。
//
// 红线（specs MS-01..05、MT-01/MT-02）：
// - 术语固定为「剩余计划待售量」「名义金额」「方案测算」；不出现套保率、现货敞口、预计利润。
// - 目标未确认或已售未完成核验时，剩余与完成率显示「待核验/目标未确认」，不显示 0；目标为零不算完成率。
// - 超计划如实显示负数与超过 100%，不截断。
// - 公告时间未知显示「待补」，不补默认时刻；登记提交不称「已受理」。
import { fmtQuantity, fmtRatio } from './midlongFormat'
import {
  PLAN_PERIOD_TYPE_LABELS, PLAN_VERIFICATION_STATUS_LABELS, PROPOSAL_STATUS_LABELS, RECEIPT_COMPLETENESS_LABELS,
  type PlanPeriodType, type PlanProgress, type ProposalComparison, type ProposalStatus, type ReceiptCompleteness,
} from './midlongP3Types'

type TagType = 'success' | 'warning' | 'danger' | 'info' | 'primary'

export function planPeriodLabel(periodType: PlanPeriodType, periodKey: string): string {
  return `${periodKey}（${PLAN_PERIOD_TYPE_LABELS[periodType] ?? periodType}）`
}

/** 未完成核验、目标未确认时的占位文本（不是 0）。 */
function unknownProgressText(progress: PlanProgress): string {
  return progress.verificationStatus === 'TARGET_UNKNOWN' ? '目标未确认' : '待核验（不按零计）'
}

/** 剩余计划待售量：负数（超计划）原样显示。 */
export function remainingLabel(progress: PlanProgress): string {
  if (progress.remainingPlanQuantity === null) return unknownProgressText(progress)
  return `${fmtQuantity(progress.remainingPlanQuantity)} MWh`
}

/** 完成率：目标为零不算；超过 100% 原样显示。 */
export function completionLabel(progress: PlanProgress): string {
  if (progress.completionRate !== null) return fmtRatio(progress.completionRate)
  if (progress.verificationStatus === 'VERIFIED' && progress.targetQuantity !== null && Number(progress.targetQuantity) === 0) return '目标为零，不计算'
  return unknownProgressText(progress)
}

export function arrangeableLabel(progress: PlanProgress): string {
  if (progress.arrangeableQuantity === null) return unknownProgressText(progress)
  return `${fmtQuantity(progress.arrangeableQuantity)} MWh`
}

export function verificationTag(progress: PlanProgress): { label: string; type: TagType } {
  const type: Record<PlanProgress['verificationStatus'], TagType> = { VERIFIED: 'success', UNVERIFIED: 'warning', TARGET_UNKNOWN: 'info' }
  return { label: PLAN_VERIFICATION_STATUS_LABELS[progress.verificationStatus], type: type[progress.verificationStatus] }
}

export function proposalStatusTag(status: ProposalStatus): { label: string; type: TagType } {
  // P4 起预成交/确认成交/外部撤单进入状态机（#3013）：预成交仍是过程态、确认成交用成功色、外部撤单用警示色。
  const type: Record<ProposalStatus, TagType> = {
    DRAFT: 'info', EXECUTABLE: 'primary', SUBMITTED: 'warning', AWAITING_RESULT: 'warning',
    PRE_CLEARED: 'warning', CLEARED: 'success', WITHDRAWN: 'danger', CANCELLED: 'info', CLOSED: 'info',
  }
  return { label: PROPOSAL_STATUS_LABELS[status] ?? status, type: type[status] ?? 'info' }
}

/** 回执完整度：任何一档都不是「已受理」，齐全也只用中性色。 */
export function receiptTag(completeness: ReceiptCompleteness): { label: string; type: TagType } {
  const type: Record<ReceiptCompleteness, TagType> = { NONE: 'danger', PARTIAL: 'warning', COMPLETE: 'info' }
  return { label: RECEIPT_COMPLETENESS_LABELS[completeness], type: type[completeness] }
}

/** 北京时间「YYYY-MM-DD HH:mm」；未知返回占位（默认「待补」），不补任何默认时刻。 */
export function beijingDateTime(iso: string | null | undefined, placeholder = '待补'): string {
  if (!iso) return placeholder
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return placeholder
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** 日历事件按北京时间日期分组（事件已由服务端按时间排序）。 */
export function groupEventsByBeijingDate<T extends { at: string }>(events: T[]): Array<{ date: string; events: T[] }> {
  const groups = new Map<string, T[]>()
  for (const event of events) {
    const date = beijingDateTime(event.at, '').slice(0, 10)
    groups.set(date, [...(groups.get(date) ?? []), event])
  }
  return [...groups.entries()].map(([date, list]) => ({ date, events: list }))
}

/** 确认方案时带上的「看到的适用目标版本」：取方案测算里当前已确认的版本。 */
export function expectedPlanRevisionsOf(comparison: ProposalComparison): Array<{ planId: number; revisionNo: number }> {
  return comparison.plans
    .filter((p) => p.currentRevisionNo !== null)
    .map((p) => ({ planId: p.planId, revisionNo: p.currentRevisionNo as number }))
}

type Balance = { periodKey: string; arrangeableQuantity: string | null; requestedQuantity: string }

/** 确认失败的可读原因：余额冲突列出最新可安排量；公告已更正、目标换版、已售未核验分别说明。 */
export function confirmFailureText(errorCode: string, message: string, details: unknown): string {
  const d = (details ?? {}) as { reason?: string; conflicts?: Balance[]; balances?: Balance[]; missing?: string[]; months?: string[] }
  if (d.reason === 'ARRANGEABLE_BALANCE_EXCEEDED' && d.conflicts?.length) {
    return `可安排计划量不足（已按最新余额校验）：${d.conflicts.map((c) => `${c.periodKey} 剩余可安排 ${fmtQuantity(c.arrangeableQuantity)} MWh，本方案需要 ${fmtQuantity(c.requestedQuantity)} MWh`).join('；')}。请调整方案电量或目标后重试。`
  }
  if (d.reason === 'PLAN_REVISION_CHANGED') return '适用的售电目标已换版，请刷新方案测算核对最新目标后再确认。'
  if (d.reason === 'WINDOW_REVISED') return '引用的公告已有更正版本，请先按新版本重新核对。'
  if (d.reason === 'SOLD_UNVERIFIED') return '已售电量覆盖不完整，未核验的额度不能确认占用；方案保留为草稿。'
  if (d.reason === 'TARGET_UNKNOWN') return `交割月 ${(d.months ?? []).join('、')} 没有已确认的售电目标；方案保留为草稿。`
  if (errorCode === 'INCOMPLETE_BASIS' && d.missing?.length) return `确认可执行前请补齐：${d.missing.join('、')}`
  return message
}

/** 方案测算里的已售说明：已售不完整时交易后电量不计算。 */
export function afterQuantityLabel(month: ProposalComparison['months'][number]): string {
  if (month.after.quantity === null) return month.before ? '已售不完整，不计算' : '无持仓数据'
  return `${fmtQuantity(month.after.quantity)} MWh`
}
