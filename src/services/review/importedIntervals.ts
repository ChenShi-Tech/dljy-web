import { apiPost } from '@/services/api'
import type { TopicAnalysisResult } from './topicAnalysis'
import type { ReportEvidence } from './workpapers'
export type ImportedChoice = { seriesKey: string; objectId: string; basisLabel: string; actualLabel: string }
export type ImportedInput = { region: string; view: 'generator' | 'retail' | 'storage'; simulated: boolean; period: { date: string; cadence: 'day' | 'week' | 'month'; asOf: string }; referencePeriod?: { start: string; end: string }; seriesKey?: string; objectId?: string; selections?: string[]; topic?: 'energy' | 'price' }
export type ImportedResult = { choices: ImportedChoice[]; labels?: [string,string]; objectLabel?: string; notice: string; source: { mock: boolean; version: string }; periods: { current: { start: string; end: string }; reference: { start: string; end: string } }; analysis: (TopicAnalysisResult & { periods: ImportedResult['periods'] }) | null; input?: { scope: { objectId: string }; period: { date: string } } }
const options = (company: string, region: string) => ({ headers: { 'x-company-id': company, 'x-tenant-id': company, 'x-region-id': region } })
export async function analyzeImportedIntervals(company: string, input: ImportedInput) {
  const response = await apiPost<ImportedResult>('/api/v1/review/analysis/imported-intervals', input, options(company, input.region))
  if (!response.data) throw new Error('分析响应不完整')
  return response.data
}
export async function captureImportedIntervals(company: string, input: ImportedInput) {
  const response = await apiPost<ReportEvidence>('/api/v1/review/evidence', { ...input, kind: 'imported_intervals' }, options(company, input.region))
  if (!response.data) throw new Error('材料尚未确认保存')
  return response.data
}
