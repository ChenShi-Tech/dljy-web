import { apiPost } from '@/services/api'
export type SettlementMetrics = {
  energyMwh: number | null; feeYuan: number | null; averagePrice: number | null
  longTermMwh: number | null; dayAheadIncrementMwh: number | null; realTimeIncrementMwh: number | null
  coverage: { records: number; energy: number; fee: number; paired: number; longTerm: number; dayAhead: number; realTime: number }
}
export type SettlementPeriod = { start: string; end: string }
export type SettlementSummary = SettlementMetrics & { expectedPlantDays: number; daily: Array<SettlementMetrics & { date: string }>; plants: Array<SettlementMetrics & { plant: string }> }
export type SettlementAnalysis = {
  periods: { current: SettlementPeriod; reference: SettlementPeriod; incomplete: boolean }
  availablePlants: string[]; selectedPlants: string[]; current: SettlementSummary; reference: SettlementSummary
  comparison: { matchedPlantDays: number; currentEnergyMwh: number | null; referenceEnergyMwh: number | null; currentFeeYuan: number | null; referenceFeeYuan: number | null }
  source: { type: string; version: string; mock: boolean; productionWrite: false }; notice: string
}
export type SettlementAnalysisInput = { region: string; period: { date: string; cadence: 'day' | 'week' | 'month'; asOf: string }; referencePeriod?: SettlementPeriod; plants?: string[] }
export async function fetchSettlementAnalysis(company: string, input: SettlementAnalysisInput, signal?: AbortSignal): Promise<SettlementAnalysis> {
  const response = await apiPost<SettlementAnalysis>('/api/v1/review/analysis/settlement', input, { signal, headers: { 'x-company-id': company, 'x-tenant-id': company, 'x-region-id': input.region } })
  if (!response.data) throw new Error('结算统计响应不完整')
  return response.data
}
