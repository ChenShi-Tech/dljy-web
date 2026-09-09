// 复盘工作流的业务投影。只整理事实；不在浏览器计算结算、收益归因或决策评分。
import type { DeclarationOrder } from '@/services/declarations'
import type { ReviewResult } from '@/services/quant/quantClient'
import type { ReviewFailure } from '@/services/quant/reviewError'

export type ReviewTask = 'result' | 'decision' | 'improvement'
export function reviewTaskOf(value: unknown): ReviewTask {
  return value === 'decision' || value === 'improvement' ? value : 'result'
}

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
export function formatValue(value: unknown, digits = 2): string {
  return finite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—'
}
export function clockLabel(slot: number): string {
  return `${String(Math.floor(slot / 4)).padStart(2, '0')}:${String(slot % 4 * 15).padStart(2, '0')}`
}
const statusLabels: Record<string, string> = {
  DRAFT: '草稿', RISK_CHECKED: '已检查', PENDING_APPROVAL: '待审批', APPROVED: '已批准',
  SUBMITTED: '已提交', ACKNOWLEDGED: '已回执', CLEARED: '已出清', REJECTED: '已驳回',
  EXPIRED: '已过期', CANCELLED: '已撤销', FAILED: '提交失败'
}
export function declarationLabel(order: DeclarationOrder): string {
  const time = order.createdAt ? new Date(order.createdAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
  return `${time} 日前申报 · ${statusLabels[order.status] ?? '待核实状态'}${order.mode === 'REHEARSAL' || order.receipt?.mock || ['synthetic', 'illustrative'].includes(order.basis) ? ' · 模拟演练' : ''}`
}
export function matchesReviewScope(order: DeclarationOrder, date: string, region: string, company?: string): boolean {
  // 旧单地区为空时不猜归属；由原页面核实，不用于新的跨模块拼接。
  return order.targetDate === date && order.region === region && (company === undefined || (!!company && order.companyId === company))
}
export function validCurve(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 96 && Array.from(value).every(finite)
}
export type IntervalEvidence = {
  slot: number; label: string; declared: number | null; cleared: number | null; actual: number | null
  delta: number | null; daPrice: number | null; rtPrice: number | null
}
export function orderIntervals(order: DeclarationOrder): IntervalEvidence[] {
  const declared = validCurve(order.energyCurveMwh96) ? order.energyCurveMwh96 : null
  const cleared = validCurve(order.clearing?.clearedCurveMwh96) ? order.clearing.clearedCurveMwh96 : null
  if (!declared && !cleared) return []
  return Array.from({ length: 96 }, (_, slot) => ({ slot, label: clockLabel(slot),
    declared: declared?.[slot] ?? null, cleared: cleared?.[slot] ?? null, actual: null,
    delta: declared && cleared ? cleared[slot] - declared[slot] : null,
    daPrice: null, rtPrice: null
  }))
}
export function platformIntervals(result: ReviewResult | null, date: string): IntervalEvidence[] {
  if (!result || result.date !== date) return []
  // 不压缩缺点，不把序号当时点；异常时间或重复点留空，禁止跨日拼接。
  const points = new Map<number, ReviewResult['detail'][number] | null>()
  for (const point of result.detail) {
    const time = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::00)?$/.exec(point.datetime)
    if (!time || time[1] !== date) continue
    const hour = Number(time[2]), minute = Number(time[3])
    if (hour > 23 || ![0, 15, 30, 45].includes(minute)) continue
    const slot = hour * 4 + minute / 15
    points.set(slot, points.has(slot) ? null : point)
  }
  if (!points.size) return []
  return Array.from({ length: 96 }, (_, slot) => {
    const p = points.get(slot)
    const declared = finite(p?.declared) ? p.declared : null
    const actual = finite(p?.actual) ? p.actual : null
    return { slot, label: clockLabel(slot), declared, actual, cleared: null,
      delta: declared !== null && actual !== null ? actual - declared : null,
      daPrice: finite(p?.da_price) ? p.da_price : null, rtPrice: finite(p?.rt_price) ? p.rt_price : null }
  })
}
export function reviewGap(failure: ReviewFailure | null): string {
  const messages: Record<ReviewFailure['kind'], string> = {
    'data-not-onboarded': '当前地区尚未提供这项分时核验所需的数据。已到达的结算资料仍可单独查看。',
    'data-unavailable': '本日分时资料不完整，暂不能核验申报与实际电量。',
    unauthorized: '当前账号无权查看这项资料，请联系管理员核实授权。',
    'service-unreachable': '分时资料暂时无法读取，请稍后重试。',
    'load-failed': '分时资料读取失败，请重试；持续失败时请联系管理员。'
  }
  return failure ? messages[failure.kind] : '尚无可核验的分时资料。'
}

export type DecisionEvidence = { title: string; text: string; recordedAt: string | null }
export function orderDecisionEvidence(order: DeclarationOrder): DecisionEvidence[] {
  const p = order.preflight
  const direction = { add: '增加申报', reduce: '减少申报', hold: '保持申报' }
  return [
    { title: '市场判断', text: p?.dataGate ? `当时记录的价格中枢：${formatValue(p.dataGate.priceCenterLow)} ～ ${formatValue(p.dataGate.priceCenterHigh)} 元/MWh。` : '未留存市场判断。', recordedAt: p?.dataGate?.writtenAt ?? null },
    { title: '申报理由', text: order.quoteRationale || '未留存报价依据。', recordedAt: null },
    { title: '方向与仓位', text: p?.forecast ? `${p.forecast.direction ? direction[p.forecast.direction] : '未记录方向'}。${p.forecast.rationale || '未记录补充理由。'}` : '未留存方向判断。', recordedAt: p?.forecast?.writtenAt ?? null },
    { title: '出清后的处理', text: p?.clearingReview?.summary || '未留存出清分析。', recordedAt: p?.clearingReview?.writtenAt ?? null },
    { title: '中长期调整', text: p?.contract?.reason || '未留存补仓或保持持仓的理由。', recordedAt: p?.contract?.writtenAt ?? null }
  ]
}
