// 综合数据分析「预测×实际对拍」共享契约类型（Epic #3591 / #3594，ZW-04/ZW-08）。
// 运行时值与校验来自 zsjfx-scorecard.mjs。

export declare const ZSJFX_SCORECARD_MAX_WINDOW_DAYS: number
export declare const ZSJFX_SCORECARD_MAPE_DENOM_FLOOR: number

export type ZsjfxScorecardPair = {
  id: string
  kind: 'load' | 'newenergy' | 'generation' | 'price'
  label: string
  forecast: string
  actual: string
}

export declare const ZSJFX_SCORECARD_PAIRS: ReadonlyArray<ZsjfxScorecardPair>

export type ZsjfxScorecardRequest = {
  pair: ZsjfxScorecardPair
  dateFrom: string
  dateTo: string
  windowDays: number
}

export declare function parseZsjfxScorecardRequest(query: Record<string, unknown>): ZsjfxScorecardRequest

export declare function checkPairAvailability(
  pair: ZsjfxScorecardPair,
  catalogTypes: ReadonlyArray<string>,
): { available: boolean; missingTypes: string[] }

export type ZsjfxScorecardDayMetrics = {
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

export type ZsjfxScorecardResult = {
  regionId: string
  pair: ZsjfxScorecardPair
  dateFrom: string
  dateTo: string
  basis: string
  sourceType: string
  mock: false
  productionWrite: false
  availability: Array<{ key: string; label: string; status: 'real' | 'forecast' | 'mock' | 'missing'; note: string }>
  days: ZsjfxScorecardDayMetrics[]
  totals: {
    scoredDays: number
    skippedDays: { forecastMissing: number; actualMissing: number; noData: number }
    slots: number
    mae: number | null
    mape: number | null
    directionHitRate: number | null
    directionHitRateNote: string
  }
  slotErrors: Array<number | null>
  anomalies: ZsjfxScorecardAnomaly[]
  anomalyNotes: string[]
}
