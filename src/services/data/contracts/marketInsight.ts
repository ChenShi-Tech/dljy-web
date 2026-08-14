import type {
  DailyAggregate,
  ModuleAvailabilityItem,
  ModuleAvailabilityStatus,
  ModuleContractMeta,
  QuarterHourMarket,
  QuarterHourPoint
} from './common'

/**
 * Adapter 输入源注释：
 * - 山西：`sdpt_zcqxhdl/listrs_full` 汇入价格；`sdpt_zcqxhdl/fhlist24*`、`sdpt_console`
 *   汇入负荷与概览；`sdpt_zptjg`、`sdpt_zsjfx_idx` 等经典 family 汇入热力与异动。
 * - 云南：`sdpt_zcqxhdl/listrs_full__yn` 派生自 `yn_node_price` Parquet 均价矩阵；
 *   `yn_system_supply`、`yn_system_forecast`、`yn_spot_settlement` 与 node-price REST 端点
 *   汇入负荷、新能源、结算价与节点热力。地区缺口必须落 `data_availability`，不串读山西。
 */

export type MarketInsightPricePoint = QuarterHourPoint<number | null>

export type MarketInsightPriceCurve = {
  market: QuarterHourMarket
  label: string
  date: string
  unit: 'yuan_per_mwh'
  points: MarketInsightPricePoint[]
}

export type MarketInsightPriceDailyStat = DailyAggregate & {
  market: QuarterHourMarket
  unit: 'yuan_per_mwh'
}

export type MarketInsightPriceBlock = {
  key: 'price'
  label: '价格'
  status: ModuleAvailabilityStatus
  source: string | null
  curves: MarketInsightPriceCurve[]
  daily: MarketInsightPriceDailyStat[]
  notes: string[]
}

export type MarketInsightLoadBlock = {
  key: 'load'
  label: '负荷'
  status: ModuleAvailabilityStatus
  source: string | null
  systemLoad: Array<QuarterHourPoint<number | null>>
  forecastLoad: Array<QuarterHourPoint<number | null>>
  daily: DailyAggregate[]
  unit: 'mw'
}

export type MarketInsightRenewableBlock = {
  key: 'renewable'
  label: '新能源'
  status: ModuleAvailabilityStatus
  source: string | null
  wind: Array<QuarterHourPoint<number | null>>
  solar: Array<QuarterHourPoint<number | null>>
  total: Array<QuarterHourPoint<number | null>>
  unit: 'mw'
}

export type MarketInsightNodeHeatmapBlock = {
  key: 'node_heatmap'
  label: '节点热力'
  status: ModuleAvailabilityStatus
  source: string | null
  nodes: string[]
  timePoints: string[]
  matrix: Array<Array<number | null>>
  unit: 'yuan_per_mwh'
}

export type MarketInsightAnomaly = {
  id: string
  type: 'negative_price' | 'limit_approach' | 'spread_outlier' | 'load_spike' | 'renewable_drop' | string
  severity: 'high' | 'mid' | 'low'
  time: string | null
  value: number | null
  message: string
  source: string | null
}

export type MarketInsightAvailabilityBlock = {
  key: 'data_availability'
  label: '数据可用性'
  items: ModuleAvailabilityItem[]
}

export type MarketInsightContract = ModuleContractMeta & {
  group: 'market_insight'
  blocks: {
    price: MarketInsightPriceBlock
    load: MarketInsightLoadBlock
    renewable: MarketInsightRenewableBlock
    node_heatmap: MarketInsightNodeHeatmapBlock
    anomalies: MarketInsightAnomaly[]
    data_availability: MarketInsightAvailabilityBlock
  }
}

export type MarketInsightPriceContract = ModuleContractMeta & {
  group: 'market_insight'
  blocks: {
    price: MarketInsightPriceBlock
  }
}
