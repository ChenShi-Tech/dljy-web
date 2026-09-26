import { apiPost } from '@/services/api'
export type SettlementMetrics = {
  energyMwh: number | null; feeYuan: number | null; averagePrice: number | null
  longTermMwh: number | null; dayAheadIncrementMwh: number | null; realTimeIncrementMwh: number | null
  coverage: { records: number; energy: number; fee: number; paired: number; longTerm: number; dayAhead: number; realTime: number }
}
export type SettlementPeriod = { start: string; end: string }
// #2992：granularity='week'|'month' 时 buckets 按桶给出量费加权口径（averagePrice=Σ电费/Σ电量），
// 桶内无成对记录时 averagePrice/energyMwh 为 null（不是 0），前端不得二次平均。
export type SettlementBucket = SettlementMetrics & { key: string; start: string; end: string; days: number; expectedPlantDays: number }
export type SettlementSummary = SettlementMetrics & {
  expectedPlantDays: number
  daily: Array<SettlementMetrics & { date: string }>
  plants: Array<SettlementMetrics & { plant: string }>
  granularity?: 'week' | 'month'
  buckets?: SettlementBucket[]
}
export type SettlementAnalysis = {
  periods: { current: SettlementPeriod; reference: SettlementPeriod; incomplete: boolean }
  availablePlants: string[]; selectedPlants: string[]; current: SettlementSummary; reference: SettlementSummary
  comparison: { matchedPlantDays: number; currentEnergyMwh: number | null; referenceEnergyMwh: number | null; currentFeeYuan: number | null; referenceFeeYuan: number | null }
  source: { type: string; version: string; mock: boolean; productionWrite: false }; notice: string
}
// #2992：period 与 range 二选一（二者都传或都不传服务端 400）；range 为显式起止区间，
// 参考期由服务端自动取紧邻等长区间。granularity 省略时按日看 current.daily。
export type SettlementAnalysisInput = {
  region: string
  period?: { date: string; cadence: 'day' | 'week' | 'month'; asOf: string }
  range?: SettlementPeriod
  granularity?: 'week' | 'month'
  referencePeriod?: SettlementPeriod
  plants?: string[]
}
export async function fetchSettlementAnalysis(company: string, input: SettlementAnalysisInput, signal?: AbortSignal): Promise<SettlementAnalysis> {
  const response = await apiPost<SettlementAnalysis>('/api/v1/review/analysis/settlement', input, { signal, headers: { 'x-company-id': company, 'x-tenant-id': company, 'x-region-id': input.region } })
  if (!response.data) throw new Error('结算统计响应不完整')
  return response.data
}
