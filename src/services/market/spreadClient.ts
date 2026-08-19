// 日前-实时价差端点客户端（agent-backend /api/v1/spot/spread，经 vite 代理 /agent-api）。
// 同 spotClient/elasticityClient 模式：开发态 /agent-api/v1/spot，生产同源 /api/v1/spot。
//
// 端点契约（统一 BaseResponse，data 解出后返回）：
// GET /v1/spot/spread?date=&region=&window=&threshold=
//
// 数据来源（真实）：价差=节点电价系统均价 DA−RT；预测=昨日同时段价差(persistence)+A 弹性增强。
// kind=决策支持参考·非结算依据；套利收益=回放参考、非真实成交；严格地区 yunnan「真实或空」。
import { identityHeaders } from '@/services/agent/agentClient'
import { currentRegion } from '@/services/region/regionContext'
import { applyRegionHeaders, timeoutSignal, AGENT_API_BASE_ROOT } from '@/services/api'

const BASE = `${AGENT_API_BASE_ROOT}/v1/spot`
const SPREAD_REQUEST_TIMEOUT_MS = 40000

export type SpreadPoint = { time_point: string; spread: number }
export type SpreadArbitrage = {
  revenue_yuan: number
  never_act_revenue_yuan: number
  acted: number
  total: number
  beats_never_act: boolean
  profitable: boolean
}
export type SpreadOptimizer = {
  available: boolean
  reason?: string
  resolution?: string
  predicted_objective_yuan?: number
  realized_revenue_yuan?: number
  never_act_revenue_yuan?: number
  beats_never_act?: boolean
  cross_arbitrage_mwh?: number
  points?: number
}
export type SpreadResult = {
  date: string
  region: string | null
  prev_day?: string
  available: boolean
  reason: string | null
  kind: string
  spread_forecast: SpreadPoint[]
  spread_actual: SpreadPoint[]
  sign_hit_rate: number | null
  sign_hit_count: number
  elasticity_enhanced?: boolean
  arbitrage: SpreadArbitrage | null
  optimizer: SpreadOptimizer | null
  threshold?: number
  train_days: number
  notes: string[]
}

type BaseResponse<T> = {
  code: number
  message?: string
  data: T
  mock?: boolean
  sourceType?: string
  productionWrite?: boolean
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

/**
 * 日前-实时价差预测与套利决策：预测目标日价差（符号+幅度），回测符号命中率，
 * 按预测信号驱动 cross_period_optimizer 回放套利收益。data.available=False 表示缺真实数据（空态）。
 */
export async function fetchSpread(
  date: string,
  region?: string,
  window = 21,
  threshold = 20
): Promise<SpreadResult> {
  const res = await fetch(`${BASE}/spread${buildQuery({ date, region, window, threshold })}`, {
    method: 'GET',
    headers: { 'x-region-id': currentRegion.value.id, ...identityHeaders() },
    signal: timeoutSignal(SPREAD_REQUEST_TIMEOUT_MS)
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({} as Record<string, unknown>))
    const message =
      (detail as { message?: string; detail?: string }).message ??
      (detail as { detail?: string }).detail
    throw new Error(message || `请求失败: ${res.status}`)
  }
  applyRegionHeaders(res)
  const body = (await res.json()) as BaseResponse<SpreadResult>
  return body.data
}
