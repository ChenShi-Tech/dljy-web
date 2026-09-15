import { apiPost } from '@/services/api'
import type { ReportEvidence } from './workpapers'
export type DailyEnergyMetrics = { baselineMwh: number | null; actualMwh: number | null; netDeviationMwh: number | null; absoluteDeviationMwh: number | null; absoluteDeviationPct: number | null; coverage: { records: number; paired: number; baseline: number; actual: number; excluded: number; unknownQuality: number } }
export type DailyEnergyInput = { region: string; period: { date: string; cadence: 'day' | 'week' | 'month'; asOf: string }; referencePeriod?: { start: string; end: string }; plants?: string[]; basis?: 'forecast' | 'declared'; actual?: 'market' | 'generation'; days?: string[] }
export type DailyEnergyAnalysis = { periods: { current: { start: string; end: string }; reference: { start: string; end: string }; incomplete: boolean }; labels: [string,string]; availablePlants: string[]; selectedPlants: string[]; selectedDays: string[] | null; current: DailyEnergyMetrics; reference: DailyEnergyMetrics; expectedPlantDays: number; daily: Array<DailyEnergyMetrics & { date: string }>; plants: Array<DailyEnergyMetrics & { plant: string }>; exceptions: Array<{ date: string; plant: string; baselineMwh: number; actualMwh: number; differenceMwh: number }>; comparison: { matchedPlantDays: number; current: DailyEnergyMetrics; reference: DailyEnergyMetrics }; notice: string }
const options = (company: string, region: string, signal?: AbortSignal) => ({ signal, headers: { 'x-company-id': company, 'x-tenant-id': company, 'x-region-id': region } })
export async function fetchDailyEnergy(company: string, input: DailyEnergyInput, signal?: AbortSignal) {
  const result = await apiPost<DailyEnergyAnalysis>('/api/v1/review/analysis/daily-energy', input, options(company,input.region,signal))
  if (!result.data) throw new Error('电量统计响应不完整')
  return result.data
}
export async function captureDailyEnergy(company: string, input: DailyEnergyInput) {
  const result = await apiPost<ReportEvidence>('/api/v1/review/evidence', { ...input, kind: 'daily_energy' }, options(company,input.region))
  if (!result.data) throw new Error('电量材料响应不完整')
  return result.data
}

export type DailyEnergySelection = { date: string; cadence: 'day'|'week'|'month'; basis: 'forecast'|'declared'; actual: 'market'|'generation'; manual: boolean; referenceStart: string; referenceEnd: string; plants: string[]; days: string[] }
export function dailyEnergySelectionFromQuery(query: Record<string, unknown>, date: string): DailyEnergySelection {
  const text = (name: string) => typeof query[name] === 'string' ? query[name] as string : ''
  const list = (name: string) => (Array.isArray(query[name]) ? query[name] as unknown[] : query[name] ? [query[name]] : []).filter((value): value is string => typeof value === 'string')
  return { date: text('energyDate') || date, cadence: query.energyCadence === 'week' || query.energyCadence === 'month' ? query.energyCadence : 'day', basis: query.energyBasis === 'declared' ? 'declared' : 'forecast', actual: query.energyActual === 'generation' ? 'generation' : 'market', manual: !!(text('energyReferenceStart') || text('energyReferenceEnd')), referenceStart: text('energyReferenceStart'), referenceEnd: text('energyReferenceEnd'), plants: list('energyPlants'), days: list('energyDays') }
}
export function dailyEnergySelectionQuery(value: DailyEnergySelection) {
  return { energyDate:value.date, energyCadence:value.cadence, energyBasis:value.basis, energyActual:value.actual, energyReferenceStart:value.manual?value.referenceStart:undefined, energyReferenceEnd:value.manual?value.referenceEnd:undefined, energyPlants:value.plants, energyDays:value.days }
}
