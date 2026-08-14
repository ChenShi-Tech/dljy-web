import type { DailyAggregate, ModuleContractMeta, QuarterHourMarket, QuarterHourPoint } from './common'

/**
 * Adapter 输入源注释：
 * - 山西：经典页无完整节点电价重型资产时，按地区注册表声明 `missing` 或仅展示公开均价派生。
 * - 云南：`node_prices/{day_ahead,real_time}` → Parquet/DuckDB → `spotClient` REST 端点；
 *   自有节点视角叠加 `yn_dim_plant_node`/公司授权边界，未授权必须返回 accessDenied 空态。
 */

export type NodePricePoint96 = QuarterHourPoint<number | null>

export type NodePriceNode = {
  nodeId?: string
  nodeName: string
  regionId: string
  ownerCompanyId?: string | null
  plantId?: string | null
}

export type NodePriceSeries = {
  node: NodePriceNode
  date: string
  market: QuarterHourMarket
  unit: 'yuan_per_mwh'
  points: NodePricePoint96[]
}

export type NodePriceDailyAggregate = DailyAggregate & {
  node: NodePriceNode
  market: QuarterHourMarket
  unit: 'yuan_per_mwh'
}

export type NodePriceHeatmap = {
  date: string
  market: QuarterHourMarket
  unit: 'yuan_per_mwh'
  nodes: NodePriceNode[]
  timePoints: string[]
  matrix: Array<Array<number | null>>
}

export type NodePriceAccessBoundary = {
  perspective: 'public_market' | 'own_nodes'
  companyId?: string
  authorizedNodeIds?: string[]
  accessDenied: boolean
  deniedReason?: 'anonymous' | 'company_unauthorized' | 'node_unauthorized' | 'missing_mapping' | string
}

export type NodePriceContract = ModuleContractMeta & {
  group: 'nodePrice'
  access: NodePriceAccessBoundary
  nodes: NodePriceNode[]
  series: NodePriceSeries[]
  daily: NodePriceDailyAggregate[]
  heatmap: NodePriceHeatmap | null
}
