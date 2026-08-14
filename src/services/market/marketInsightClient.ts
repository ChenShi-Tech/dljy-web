// 市场洞察驾驶舱数据包客户端：消费 agent-backend /v1/market-insight/bundle。
// bundle 由后端确定性装配（不经 LLM），逐项标注数据真伪供 dljy-ui 组件确定性渲染。
// 类型严格对齐可选 Agent 服务的 build_market_insight_bundle 契约（blocks 结构）。
import { AGENT_API_BASE_ROOT, applyRegionHeaders, timeoutSignal } from '@/services/api'
import { identityHeaders } from '@/services/agent/agentClient'

const BASE = `${AGENT_API_BASE_ROOT}/v1/market-insight`
const REQUEST_TIMEOUT_MS = 45000

export type InsightDataStatus = 'real' | 'forecast' | 'mock' | 'missing'
export type InsightBasis = 'captured' | 'synthetic'

export type InsightAvailabilityItem = {
  key: string
  label: string
  status: InsightDataStatus
  source: string | null
  note?: string
}

export type InsightAnomaly = {
  type: 'negative_price' | 'limit_approach' | 'spread_outlier' | 'elasticity_steep' | string
  severity: 'high' | 'mid' | 'low'
  time: string | null
  value: number
  threshold: number
  message: string
}

export type InsightUiComponent = { component: string; block: string }

/** 单个 snapshot 子项（KPI 摘要 + 句柄 + 迷你曲线预览 + 口径）。 */
export type InsightSnapshotEntry = {
  summary?: Record<string, unknown>
  data_ref?: string
  source?: string
  unit?: string
  preview?: unknown
  status?: InsightDataStatus
  formula?: string
}

export type MarketInsightBundle = {
  meta: {
    schema_version: number
    date: string
    region: string
    region_name: string
    market: string
    generated_at: string
  }
  basis: InsightBasis
  sourceType: 'REAL' | 'MOCK'
  mock: boolean
  productionWrite: false
  data_availability: InsightAvailabilityItem[]
  blocks: {
    snapshot: Record<string, InsightSnapshotEntry>
    elasticity: Record<string, unknown> & { available?: boolean; status?: InsightDataStatus }
    spread: Record<string, unknown> & { available?: boolean; status?: InsightDataStatus }
    node_price: Record<string, unknown> & { available?: boolean; status?: InsightDataStatus }
    forecast_band: Record<string, unknown> & { band?: { p10?: number; p50?: number; p90?: number } | null }
    anomalies: InsightAnomaly[]
  }
  narrative: string | null
  gaps: { key: string; reason: string; severity: string }[]
  assumptions: Record<string, unknown>
  ui: { components: InsightUiComponent[] }
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${fallback}: ${res.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  }
  return (await res.json()) as T
}

/** 数据预检：确定性装配市场洞察 bundle（不落库、不经 LLM）。 */
export async function fetchMarketInsightBundle(params: {
  date: string
  region?: string
  region_name?: string
  market?: string
}): Promise<MarketInsightBundle> {
  const url = new URL(`${BASE}/bundle`, window.location.origin)
  url.searchParams.set('date', params.date)
  if (params.region) url.searchParams.set('region', params.region)
  if (params.region_name) url.searchParams.set('region_name', params.region_name)
  if (params.market) url.searchParams.set('market', params.market)
  const res = await fetch(url.toString(), {
    headers: identityHeaders(),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS)
  })
  applyRegionHeaders(res)
  return readJson<MarketInsightBundle>(res, '市场洞察数据预检失败')
}
