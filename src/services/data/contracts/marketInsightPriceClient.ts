import { agentRequest, extractEnvelopeMeta } from '../request'
import type { MarketInsightPriceContract } from './marketInsight'
import {
  MARKET_INSIGHT_PRICE_FAMILY,
  MARKET_INSIGHT_PRICE_MATCH,
  toMarketInsightPriceContract
} from './marketInsightPriceAdapter'

export async function fetchMarketInsightPriceContract(params: {
  region: string
  date?: string
  timeoutMs?: number
}): Promise<MarketInsightPriceContract> {
  const res = await agentRequest('/api', '/real', {
    query: {
      family: MARKET_INSIGHT_PRICE_FAMILY,
      match: MARKET_INSIGHT_PRICE_MATCH,
      region: params.region
    },
    timeoutMs: params.timeoutMs ?? 20000
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`市场洞察价格契约取数失败: ${res.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  }
  const body = await res.json()
  const meta = extractEnvelopeMeta(body)
  return toMarketInsightPriceContract({
    payload: body,
    date: params.date,
    meta: {
      basis: meta.basis,
      mock: meta.mock,
      sourceType: meta.sourceType ?? meta.provenance?.sourceType,
      productionWrite: meta.productionWrite,
      region_requested: params.region,
      region_served: res.headers.get('x-region-served') ?? params.region,
      region_fallback: res.headers.get('x-region-fallback') === 'true'
    }
  })
}
