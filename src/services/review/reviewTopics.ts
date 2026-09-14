import type { ComparisonBasis } from './topicAnalysis'
import type { ReviewEvidenceSnapshot } from './reviewEvidence'
export type ReviewBusinessView = 'generator' | 'retail' | 'storage'
export type ReviewTopic = 'energy' | 'price' | 'settlement' | 'maintenance'
export type SettlementSelection = { date: string; cadence: 'day' | 'week' | 'month'; referenceStart: string; referenceEnd: string; manual: boolean; plants: string[] }
export function settlementSelectionQuery(value?: SettlementSelection) {
  return value ? { periodDate: value.date, cadence: value.cadence, referenceStart: value.manual ? value.referenceStart : undefined, referenceEnd: value.manual ? value.referenceEnd : undefined, plants: value.plants } : {}
}
export function settlementSelectionFromQuery(query: Record<string, unknown>, date: string): SettlementSelection {
  return { date: typeof query.periodDate === 'string' ? query.periodDate : date, cadence: query.cadence === 'week' || query.cadence === 'month' ? query.cadence : 'day', referenceStart: typeof query.referenceStart === 'string' ? query.referenceStart : '', referenceEnd: typeof query.referenceEnd === 'string' ? query.referenceEnd : '', manual: typeof query.referenceStart === 'string' || typeof query.referenceEnd === 'string', plants: (Array.isArray(query.plants) ? query.plants : query.plants ? [query.plants] : []).filter((value): value is string => typeof value === 'string') }
}
export const reviewBusinessViews: Record<ReviewBusinessView, { title: string; energy: string; price: string; bases: ComparisonBasis[] }> = {
  generator: { title: '发电侧', energy: '先核对留存预测与实际电量，再判断申报调整是否合理。', price: '核对出力集中时段的日前、实时价格差异。', bases: ['forecast_actual', 'declared_actual', 'declared_cleared'] },
  retail: { title: '售电侧', energy: '先核对申报与实际用电，再区分预测误差和采购调整。', price: '核对用电集中时段的价格暴露；市场价差不等于零售利润。', bases: ['declared_actual', 'forecast_actual', 'declared_cleared'] },
  storage: { title: '储能侧', energy: '先核对申报与实际充放电量，确认正负方向和计量口径。', price: '核对充放电时段价差；尚需效率、损耗和费用才能判断套利收益。', bases: ['declared_actual', 'declared_cleared', 'forecast_actual'] },
}
export function reviewView(value: unknown): ReviewBusinessView { return value === 'retail' || value === 'storage' ? value : 'generator' }
export function reviewTopic(value: unknown, hasObject = false): ReviewTopic { return value === 'energy' || value === 'price' || value === 'maintenance' || value === 'settlement' ? value : hasObject ? 'energy' : 'settlement' }
export function prioritizeAvailableBases(snapshot: ReviewEvidenceSnapshot | null, bases: ComparisonBasis[]) {
  const hasPair = (basis: ComparisonBasis) => snapshot?.intervals.some(point => {
    const left = basis === 'forecast_actual' ? point.forecast : point.declared
    const right = basis === 'declared_cleared' ? point.cleared : point.actual
    return typeof left === 'number' && Number.isFinite(left) && typeof right === 'number' && Number.isFinite(right)
  }) ?? false
  return [...bases].sort((a, b) => Number(hasPair(b)) - Number(hasPair(a)))
}

export type PriceSelection = { date: string; cadence: 'day' | 'week' | 'month'; manual: boolean; referenceStart: string; referenceEnd: string; plant: string; node: string; threshold: string; intervals: string[] }
export function priceSelectionQuery(value: PriceSelection) {
  return { priceDate: value.date, priceCadence: value.cadence, priceReferenceStart: value.manual ? value.referenceStart : undefined, priceReferenceEnd: value.manual ? value.referenceEnd : undefined, pricePlant: value.plant || undefined, priceNode: value.node || undefined, priceThreshold: value.threshold || undefined, priceIntervals: value.intervals }
}
export function priceSelectionFromQuery(query: Record<string, unknown>, date: string): PriceSelection {
  const text = (key: string) => typeof query[key] === 'string' ? query[key] as string : ''
  return { date: text('priceDate') || date, cadence: query.priceCadence === 'week' || query.priceCadence === 'month' ? query.priceCadence : 'day', manual: !!(text('priceReferenceStart') || text('priceReferenceEnd')), referenceStart: text('priceReferenceStart'), referenceEnd: text('priceReferenceEnd'), plant: text('pricePlant'), node: text('priceNode'), threshold: text('priceThreshold'), intervals: (Array.isArray(query.priceIntervals) ? query.priceIntervals : query.priceIntervals ? [query.priceIntervals] : []).filter((value): value is string => typeof value === 'string') }
}

export type ReviewAnalysisSource = 'daily' | 'market' | 'settlement' | 'imported' | 'decision'
/** 来源的业务适用性由当前已接通的资料定义，不能将厂站统计换标题冒充售电或储能。 */
export function reviewAnalysisSources(view: ReviewBusinessView, topic: ReviewTopic) {
  if (topic === 'maintenance') return []
  if (topic === 'settlement') return view === 'generator' ? [{ id: 'settlement' as const, label: '公司与厂站结算' }] : []
  return [
    ...(view === 'generator' ? [{ id: topic === 'energy' ? 'daily' as const : 'market' as const, label: topic === 'energy' ? '公司与厂站日报' : '厂站节点价格' }] : []),
    { id: 'imported' as const, label: view === 'retail' ? '客户与组合分时资料' : view === 'storage' ? '充放电分时资料' : '补充分时资料' },
    { id: 'decision' as const, label: '本次决策留存资料' },
  ]
}

export function hasDecisionTopicData(snapshot: ReviewEvidenceSnapshot | null, topic: ReviewTopic) {
  const valid = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  return snapshot?.intervals.some(point => topic === 'price'
    ? valid(point.daPrice) || valid(point.rtPrice)
    : topic === 'energy' && ((valid(point.forecast) && valid(point.actual)) || (valid(point.declared) && (valid(point.actual) || valid(point.cleared))))) ?? false
}
