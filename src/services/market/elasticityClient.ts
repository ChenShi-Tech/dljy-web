// 价格弹性引擎端点客户端（agent-backend /api/v1/spot/elasticity，经 vite 代理 /agent-api）。
// 与 spotClient 同源思路：开发态走 vite 代理 /agent-api/v1/spot，生产/静态部署后端同源
// /api/v1/spot。所有前端 agent 客户端统一走该基址，避免生产 404。
//
// 端点契约（统一 BaseResponse{code,message,data,mock,sourceType,productionWrite}，data 解出后返回）：
// GET /v1/spot/elasticity?date=&market=&region=&segments=&window=
//
// 数据来源（真实）：竞价空间=zptsj（统调负荷−新能源，外送 0 占位）、出清价=节点电价系统均价。
// kind=分析参考·非结算依据；严格地区 yunnan「真实或空」，缺真实数据 available=False（不臆造）。
// region 维度按业务地区中文名（如「云南」）下传，同时按全局当前地区注入 x-region-id。
import { identityHeaders } from '@/services/agent/agentClient'
import { currentRegion } from '@/services/region/regionContext'
import { applyRegionHeaders, timeoutSignal, AGENT_API_BASE_ROOT } from '@/services/api'
import type { SpotMarket } from '@/services/market/spotClient'

const BASE = `${AGENT_API_BASE_ROOT}/v1/spot`
const ELASTICITY_REQUEST_TIMEOUT_MS = 30000

export type ElasticitySegment = {
  seg: number
  slope: number
  intercept: number
  x_lo: number
  x_hi: number
  y_lo: number
  y_hi: number
  n: number
  label: 'steep' | 'flat'
}
export type ElasticityTimePoint = { time_point: string; value?: number | null; price?: number | null; label?: string }
export type ElasticityResult = {
  date: string
  market: SpotMarket
  region: string | null
  available: boolean
  reason: string | null
  kind: string
  segments: ElasticitySegment[]
  slope_threshold?: number
  bid_space: Array<{ time_point: string; value: number | null }>
  actual_price: Array<{ time_point: string; price: number | null }>
  predicted_price: Array<{ time_point: string; price: number | null }>
  classification: Array<{ time_point: string; label: 'steep' | 'flat' | null }>
  mae_model: number | null
  mae_naive: number | null
  mae_improvement_pct: number | null
  prediction_method: string | null
  steep_share_pct: number | null
  naive_prev_day: string | null
  train_days: number
  train_points: number
  external_send_included: boolean
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
 * 价格弹性预判：拟合「竞价空间→出清价」分段弹性曲线，对目标日 held-out 预判价格水平
 * + 陡/平弹性分类，对照 naive(昨日同时段)。data.available=False 表示缺真实数据（空态）。
 */
export async function fetchElasticity(
  date: string,
  market: SpotMarket = 'da',
  region?: string,
  segments = 4,
  window = 21
): Promise<ElasticityResult> {
  const res = await fetch(`${BASE}/elasticity${buildQuery({ date, market, region, segments, window })}`, {
    method: 'GET',
    headers: { 'x-region-id': currentRegion.value.id, ...identityHeaders() },
    signal: timeoutSignal(ELASTICITY_REQUEST_TIMEOUT_MS)
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({} as Record<string, unknown>))
    const message =
      (detail as { message?: string; detail?: string }).message ??
      (detail as { detail?: string }).detail
    throw new Error(message || `请求失败: ${res.status}`)
  }
  applyRegionHeaders(res)
  const body = (await res.json()) as BaseResponse<ElasticityResult>
  return body.data
}
