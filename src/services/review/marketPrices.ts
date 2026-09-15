import { apiPost } from '@/services/api'
import type { TopicAnalysisResult } from './topicAnalysis'
import type { ReportEvidence } from './workpapers'
export type MarketPriceInput = { region: string; period: { date: string; cadence: 'day' | 'week' | 'month'; asOf: string }; referencePeriod?: { start: string; end: string }; selection?: { plant: string; node: string }; selections?: string[]; thresholds?: { spreadYuan: number } }
export type MarketPriceResult = {
  periods: { current: { start: string; end: string }; reference: { start: string; end: string }; incomplete: boolean }
  subjects: Array<{ plant: string; node: string }>; selection: { plant: string; node: string } | null; notice: string
  analysis: (TopicAnalysisResult & { comparison: { coverage: { priceMinutes: number; alignedMinutes: number }; current: { prices: TopicAnalysisResult['prices'] }; reference: { prices: TopicAnalysisResult['prices'] }; changes: { daPrice: number | null; rtPrice: number | null; spread: number | null } } }) | null
}
const headers = (company: string, region: string) => ({ 'x-company-id': company, 'x-tenant-id': company, 'x-region-id': region })
export async function fetchMarketPrices(company: string, input: MarketPriceInput, signal?: AbortSignal): Promise<MarketPriceResult> {
  const result = await apiPost<MarketPriceResult>('/api/v1/review/analysis/market-prices', input, { signal, headers: headers(company, input.region) })
  if (!result.data) throw new Error('价格资料响应不完整')
  return result.data
}
export async function captureMarketPrices(company: string, input: MarketPriceInput): Promise<ReportEvidence> {
  const result = await apiPost<ReportEvidence>('/api/v1/review/evidence', { kind: 'market_prices', ...input }, { headers: headers(company, input.region) })
  if (!result.data) throw new Error('价格材料未保存')
  return result.data
}
