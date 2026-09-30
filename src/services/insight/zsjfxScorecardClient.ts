// zsjfxScorecardClient — 综合数据分析「预测×实际对拍」客户端（Epic #3591 S2 / dljy#3594，ZW-04）。
// GET /api/v1/market-insight/zsjfx/scorecard：服务端确定性装配 MAE/MAPE/方向命中率/逐时段误差
// 与异动事件；本客户端只做取数、形状校验与错误映射，不在前端重算指标（控制反转：数值归代码）。
// 配对目录随响应下发（含逐配对可用性），页面据此渲染入口，不自建清单。
import { apiGet } from '@/services/api'
import { isAbortError, toInsightError } from './insightClient'
import { INSIGHT_ERRORS, InsightContractError } from 'shared/insight/contract.mjs'

export const ZSJFX_SCORECARD_PATH = '/api/v1/market-insight/zsjfx/scorecard'

export type ZsjfxScorecardPairInfo = {
  id: string
  kind: string
  label: string
  forecast: string
  actual: string
  available: boolean
  missingTypes: string[]
  selected?: boolean
}

export type ZsjfxScorecardDay = {
  date: string
  status: 'scored' | 'skipped-forecast-missing' | 'skipped-actual-missing' | 'skipped-no-data'
  validSlots: number
  forecastMissing: number
  actualMissing: number
  mae: number | null
  mape: number | null
  mapeExcludedZero: number
  directionHits: number
  directionPairs: number
}

export type ZsjfxScorecardAnomaly = {
  type: 'negative_price' | 'limit_approach' | 'spread_outlier'
  severity: 'high' | 'mid'
  market: 'da' | 'rt' | 'da-rt'
  from: string
  to: string
  value: number
  threshold: number
  message: string
}

export type ZsjfxScorecard = {
  regionId: string
  pair: { id: string; label: string; forecast: string; actual: string }
  dateFrom: string
  dateTo: string
  basis: string
  sourceType: string
  mock: false
  productionWrite: false
  availability: Array<{ key: string; label: string; status: 'real' | 'forecast' | 'mock' | 'missing'; note: string }>
  pairs: ZsjfxScorecardPairInfo[]
  days: ZsjfxScorecardDay[]
  totals: {
    scoredDays: number
    skippedDays: { forecastMissing: number; actualMissing: number; noData: number }
    slots: number
    mae: number | null
    mape: number | null
    directionHitRate: number | null
    directionHitRateNote: string
  } | null
  slotErrors: Array<number | null>
  anomalies: ZsjfxScorecardAnomaly[]
  anomalyNotes: string[]
}

export type ZsjfxScorecardQuery = {
  pair: string
  dateFrom: string
  dateTo: string
}

function isScorecardShape(value: unknown): value is ZsjfxScorecard {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<ZsjfxScorecard>
  return typeof v.pair === 'object' && v.pair !== null
    && Array.isArray(v.days) && Array.isArray(v.pairs)
    && Array.isArray(v.anomalies) && Array.isArray(v.slotErrors)
    && ('totals' in v) && Array.isArray(v.availability)
}

/** 取对拍结果；形状不合规按 422 折叠（不渲染口径不明的数据），网络/未知按 503；取消透传。 */
export async function fetchZsjfxScorecard(query: ZsjfxScorecardQuery, options?: { signal?: AbortSignal }): Promise<ZsjfxScorecard> {
  let payload: { data?: unknown }
  try {
    payload = await apiGet<{ data?: unknown }>(ZSJFX_SCORECARD_PATH, { ...query }, { signal: options?.signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw toInsightError(error)
  }
  const data = payload?.data
  if (!isScorecardShape(data)) {
    throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '对拍结果格式不正确')
  }
  return data
}
