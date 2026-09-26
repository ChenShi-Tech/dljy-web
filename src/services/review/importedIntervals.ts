import { apiPost } from '@/services/api'
import type { AnalysisThresholds, TopicAnalysisResult } from './topicAnalysis'
import type { ReportEvidence } from './workpapers'
export type ImportedChoice = { seriesKey: string; objectId: string; basisLabel: string; actualLabel: string }
/** 单期的逐对象覆盖：合计少了哪些时段、少在谁身上，本期与参考期各一份。 */
export type RollupCoverage = { matchedIntervals: number; observedIntervals: number; objects: Array<{ objectId: string; intervals: number; baselineIntervals: number; actualIntervals: number }> }
export type ImportedRollup = { objectIds: string[]; current: RollupCoverage; reference: RollupCoverage }
export type ImportedInput = { region: string; view: 'generator' | 'retail' | 'storage'; simulated: boolean; period: { date: string; cadence: 'day' | 'week' | 'month'; asOf: string }; referencePeriod?: { start: string; end: string }; seriesKey?: string; objectId?: string; objectIds?: string[]; selections?: string[]; thresholds?: AnalysisThresholds; topic?: 'energy' | 'price' }
/**
 * 补充分时资料面板的筛选、对象与勾选，关掉专题窗口后由上层保留，重新打开时恢复。
 * `context` 记下保存时的公司、地区、视角与复盘日期，任一不同就不套用，避免把别处的对象带进来。
 */
export type ImportedSelection = { context: string; topic: 'energy' | 'price'; simulated: boolean; cadence: 'day' | 'week' | 'month'; date: string; manual: boolean; referenceStart: string; referenceEnd: string; deviationThreshold: number | ''; priceThreshold: number | ''; seriesKey: string; objectId: string; rollupIds: string[]; selected: string[] }
export type ImportedResult = { choices: ImportedChoice[]; labels?: [string,string]; objectLabel?: string; rollup?: ImportedRollup | null; notice: string; source: { mock: boolean; version: string }; periods: { current: { start: string; end: string }; reference: { start: string; end: string } }; analysis: (TopicAnalysisResult & { periods: ImportedResult['periods'] }) | null; input?: { scope: { objectId: string }; period: { date: string } } }
const options = (company: string, region: string) => ({ headers: { 'x-company-id': company, 'x-tenant-id': company, 'x-region-id': region } })
export async function analyzeImportedIntervals(company: string, input: ImportedInput) {
  const response = await apiPost<ImportedResult>('/api/v1/review/analysis/imported-intervals', input, options(company, input.region))
  if (!response.data) throw new Error('分析响应不完整')
  return response.data
}
export async function captureImportedIntervals(company: string, input: ImportedInput & { expectedVersion?: string }) {
  const response = await apiPost<ReportEvidence>('/api/v1/review/evidence', { ...input, kind: 'imported_intervals' }, options(company, input.region))
  if (!response.data) throw new Error('材料尚未确认保存')
  return response.data
}
