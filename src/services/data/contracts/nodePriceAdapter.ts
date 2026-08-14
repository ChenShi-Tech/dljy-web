import type { ModuleAvailabilityStatus, ModuleContractMeta } from './common'
import type {
  NodePriceAccessBoundary,
  NodePriceContract,
  NodePriceDailyAggregate,
  NodePriceHeatmap,
  NodePriceNode,
  NodePriceSeries
} from './nodePrice'

/**
 * Adapter 输入源：agent-backend /v1/spot/node-price/*（Python BaseResponse 信封，
 * DuckDB 读云南 derived Parquet）。地区路由与门控见 servingRoutes.gen（serving-route-registry
 * 生成物）；未配置路由的地区在 client 层即返回空态，不会进入本 adapter。
 * basis 口径：Parquet 回放 = captured；mock=true 一律 synthetic（ModuleContractBasis 二值）。
 */

export const NODE_PRICE_DATASET_ID = 'node_price'
export const NODE_PRICE_UNIT = 'yuan_per_mwh' as const

export type NodePriceMarket = 'da' | 'rt'

export type NodePriceEnvelopeMeta = {
  mock?: boolean
  sourceType?: string
  productionWrite?: boolean
  region_requested: string
  region_served: string
  region_fallback: boolean
}

export type NodePriceRawDailyItem = {
  node_name: string
  avg: number | null
  max: number | null
  min: number | null
  neg_share_pct: number | null
  points: number
}

export type NodePriceRawSeries = { series: Array<{ time_point: string; price: number | null }>; points: number }
export type NodePriceRawHeatmap = { nodes: string[]; time_points: string[]; matrix: Array<Array<number | null>> }

export const PUBLIC_MARKET_ACCESS: NodePriceAccessBoundary = {
  perspective: 'public_market',
  accessDenied: false
}

export function deniedNodePriceAccess(reason: NodePriceAccessBoundary['deniedReason']): NodePriceAccessBoundary {
  return { perspective: 'public_market', accessDenied: true, deniedReason: reason }
}

function contractMeta(meta: NodePriceEnvelopeMeta): ModuleContractMeta {
  // ModuleContractBasis 二值收敛：mock/MOCK → synthetic；其余（DuckDB 读 Parquet）→ captured。
  // 不 import ../basis：verify 脚本以 strip-types 直跑 adapter，adapter 保持零运行时外部依赖。
  const synthetic = meta.mock === true || meta.sourceType === 'MOCK'
  return {
    schema_version: 1,
    basis: synthetic ? 'synthetic' : 'captured',
    sourceType: (meta.sourceType || 'MOCK') as ModuleContractMeta['sourceType'],
    // mock 与 basis 从同一 synthetic 判定派生：上游只给 sourceType:'MOCK' 而漏 mock 字段时，
    // 也必须标 mock:true——否则 availability 误标 real、消费方（usableDaily 按 mock 过滤）
    // 会把模拟数据放进指标且不显示 Mock 提示。
    mock: synthetic,
    productionWrite: false,
    data_availability: [],
    region_requested: meta.region_requested,
    region_served: meta.region_served,
    region_fallback: meta.region_fallback
  }
}

function availability(
  meta: ModuleContractMeta,
  access: NodePriceAccessBoundary,
  hasData: boolean,
  source: string | null,
  note?: string
): { status: ModuleAvailabilityStatus; entry: ModuleContractMeta['data_availability'][number] } {
  const status: ModuleAvailabilityStatus = access.accessDenied || !hasData ? 'missing' : meta.mock ? 'mock' : 'real'
  return {
    status,
    entry: {
      key: NODE_PRICE_DATASET_ID,
      label: '现货节点电价',
      status,
      source: status === 'missing' ? null : source,
      ...(note ? { note } : {})
    }
  }
}

function toNode(nodeName: string, regionId: string): NodePriceNode {
  return { nodeName, regionId }
}

// 96 点点号从 time_point 的 HH:MM 推导（hour*4 + minute/15 + 1），而非数组下标——
// 序列缺中间时段时下标编号会把缺口后的点整体前移，破坏与出力/结算 96 点的对齐。
// 无法解析的时点回退下标编号（不丢数据）。
function pointFromTime(time: string, fallbackIndex: number): number {
  const match = /(\d{1,2}):(\d{2})/.exec(time)
  if (!match) return fallbackIndex + 1
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59 || minute % 15 !== 0) return fallbackIndex + 1
  return hour * 4 + minute / 15 + 1
}

function baseContract(
  meta: ModuleContractMeta,
  access: NodePriceAccessBoundary
): NodePriceContract {
  return { ...meta, group: 'nodePrice', access, nodes: [], series: [], daily: [], heatmap: null }
}

/** 空态/拒绝态契约（未配置路由、地区无标签、401/403 授权拒绝共用）。 */
export function toNodePriceEmptyContract(params: {
  regionId: string
  access?: NodePriceAccessBoundary
  reason: string
}): NodePriceContract {
  const meta = contractMeta({
    mock: false,
    sourceType: undefined,
    region_requested: params.regionId,
    region_served: params.regionId,
    region_fallback: false
  })
  // 空态不伪装来源：sourceType 置 MOCK 会误导，这里保持 basis=captured 但 availability=missing。
  const contract = baseContract({ ...meta, basis: 'captured', sourceType: 'DB', mock: false }, params.access ?? PUBLIC_MARKET_ACCESS)
  contract.data_availability = [{ key: NODE_PRICE_DATASET_ID, label: '现货节点电价', status: 'missing', source: null, note: params.reason }]
  return contract
}

export function toNodePriceDailyContract(params: {
  regionId: string
  date: string
  market: NodePriceMarket
  payload: { count?: number; items?: NodePriceRawDailyItem[] } | null
  meta: NodePriceEnvelopeMeta
  access?: NodePriceAccessBoundary
  source?: string
}): NodePriceContract {
  const access = params.access ?? PUBLIC_MARKET_ACCESS
  const meta = contractMeta(params.meta)
  const items = params.payload?.items ?? []
  const { entry } = availability(meta, access, items.length > 0, params.source ?? 'duckdb:node_price')
  const contract = baseContract(meta, access)
  contract.data_availability = [entry]
  if (access.accessDenied) return contract
  contract.daily = items.map((item): NodePriceDailyAggregate => ({
    node: toNode(item.node_name, params.regionId),
    market: params.market,
    unit: NODE_PRICE_UNIT,
    date: params.date,
    avg: item.avg,
    max: item.max,
    min: item.min,
    spread: item.max !== null && item.min !== null ? item.max - item.min : null,
    negativeSharePct: item.neg_share_pct,
    points: item.points
  }))
  contract.nodes = contract.daily.map((row) => row.node)
  return contract
}

export function toNodePriceSeriesContract(params: {
  regionId: string
  date: string
  market: NodePriceMarket
  nodeName: string
  payload: NodePriceRawSeries | null
  meta: NodePriceEnvelopeMeta
  access?: NodePriceAccessBoundary
  source?: string
}): NodePriceContract {
  const access = params.access ?? PUBLIC_MARKET_ACCESS
  const meta = contractMeta(params.meta)
  const points = params.payload?.series ?? []
  const { entry } = availability(meta, access, points.length > 0, params.source ?? 'duckdb:node_price')
  const contract = baseContract(meta, access)
  contract.data_availability = [entry]
  if (access.accessDenied) return contract
  const node = toNode(params.nodeName, params.regionId)
  const series: NodePriceSeries = {
    node,
    date: params.date,
    market: params.market,
    unit: NODE_PRICE_UNIT,
    points: points.map((point, index) => ({ point: pointFromTime(point.time_point, index), time: point.time_point, value: point.price }))
  }
  contract.nodes = [node]
  contract.series = points.length ? [series] : []
  return contract
}

export function toNodePriceHeatmapContract(params: {
  regionId: string
  date: string
  market: NodePriceMarket
  payload: NodePriceRawHeatmap | null
  meta: NodePriceEnvelopeMeta
  access?: NodePriceAccessBoundary
  source?: string
}): NodePriceContract {
  const access = params.access ?? PUBLIC_MARKET_ACCESS
  const meta = contractMeta(params.meta)
  const nodes = params.payload?.nodes ?? []
  const { entry } = availability(meta, access, nodes.length > 0, params.source ?? 'duckdb:node_price')
  const contract = baseContract(meta, access)
  contract.data_availability = [entry]
  if (access.accessDenied) return contract
  contract.nodes = nodes.map((name) => toNode(name, params.regionId))
  contract.heatmap = nodes.length
    ? {
        date: params.date,
        market: params.market,
        unit: NODE_PRICE_UNIT,
        nodes: contract.nodes,
        timePoints: params.payload?.time_points ?? [],
        matrix: params.payload?.matrix ?? []
      } satisfies NodePriceHeatmap
    : null
  return contract
}
