import type { GridMarketSpatialSnapshot } from './marketSpatial'
import type {
  GridDisclosureCategory,
  GridGeoNode,
  GridGeoNodeListResponse,
  GridGeoWeatherLayer,
  GridGeoWeatherSnapshot,
  GridMarketMetric,
} from './types'

export type SpatialCommandScene = 'overview' | 'nodes' | 'weather' | 'market' | 'disclosure' | 'topology'

export type SpatialLayerState = {
  status: 'idle' | 'loading' | 'available' | 'empty' | 'degraded' | 'error' | 'not-configured'
  reason: string
  updatedAt?: string | null
}

export const COMMAND_MARKET_REPLAY_DATE = '2026-05-01'
export const COMMAND_NODE_PAGE_SIZE = 500

export const disclosureCategoryLabel: Record<GridDisclosureCategory, string> = {
  maintenance: '检修',
  outage: '停运',
  intervention: '人工干预',
  congestion: '断面阻塞',
  constraint: '运行约束',
}

function validWgs84Node(node: GridGeoNode) {
  const location = node.location
  return node.locationStatus !== 'unresolved'
    && location?.coordinateSystem === 'WGS84'
    && Number.isFinite(location.longitude)
    && Number.isFinite(location.latitude)
    && location.longitude >= -180
    && location.longitude <= 180
    && location.latitude >= -90
    && location.latitude <= 90
}

export function commandNodesFromResponse(response: GridGeoNodeListResponse) {
  const nodes = response.data.items.filter(validWgs84Node)
  const total = response.data.pagination.total
  return {
    nodes,
    total,
    truncatedByPage: total > response.data.items.length,
    excludedInvalidCoordinates: response.data.items.length - nodes.length,
    sourceType: response.sourceType,
    mock: response.mock,
    productionWrite: response.productionWrite,
  }
}

/**
 * 合并多次分页/分档拉取的节点结果（驾驶舱 located + approximate 两档合并入图）。
 * 任一档为 Mock 即整体拒绝——「一半真实一半模拟」的合并结果不能当成真实数据画。
 */
export function mergeCommandNodeResults(
  ...results: Array<Pick<ReturnType<typeof commandNodesFromResponse>, 'nodes' | 'total' | 'truncatedByPage' | 'excludedInvalidCoordinates'> & { mock: boolean; productionWrite: boolean }>
) {
  return {
    nodes: results.flatMap((result) => result.nodes),
    total: results.reduce((sum, result) => sum + result.total, 0),
    truncatedByPage: results.some((result) => result.truncatedByPage),
    excludedInvalidCoordinates: results.reduce((sum, result) => sum + result.excludedInvalidCoordinates, 0),
    mock: results.some((result) => result.mock),
    productionWrite: results.some((result) => result.productionWrite),
  }
}

export function weatherItemSupportsLayer(item: GridGeoWeatherSnapshot, layer: GridGeoWeatherLayer) {
  if (layer === 'none') return false
  if (layer === 'wind') return Number.isFinite(item.windSpeedMs) && Number.isFinite(item.windDirectionDeg)
  if (layer === 'temperature') return Number.isFinite(item.temperatureC)
  if (layer === 'precipitation') return Number.isFinite(item.precipitationMm)
  if (layer === 'irradiance') return Number.isFinite(item.shortwaveRadiationWm2)
  return Number.isFinite(item.cloudCoverPercent)
}

export function commandWeatherItems(items: GridGeoWeatherSnapshot[], layer: GridGeoWeatherLayer) {
  return items.filter((item) => weatherItemSupportsLayer(item, layer))
}

export function trustedMarketMetrics(snapshot: GridMarketSpatialSnapshot | null): GridMarketMetric[] {
  if (!snapshot) return []
  if (snapshot.sources.nodePrice.mock || snapshot.sources.output.mock) return []
  return snapshot.metrics
}
