// 现货节点电价端点客户端（agent-backend /api/v1/spot/*，经 vite 代理 /agent-api）。
// 与 quantClient 同源思路：开发态走 vite 代理 /agent-api/v1/spot，生产/静态部署
// 后端同源 /api/v1/spot。此前若写死 /agent-api 会让生产构建下全部现货读取 404。
//
// 端点契约（统一 BaseResponse{code,message,data}，data 解出后返回）：
// GET /v1/spot/regions
// GET /v1/spot/node-price/nodes?q=&limit=&region=
// GET /v1/spot/node-price/series?date=&node=&market=&region=
// GET /v1/spot/node-price/daily?date=&market=&limit=&region=
// GET /v1/spot/node-price/heatmap?date=&market=&top_nodes=&region=
// 云南全局地区下，上述 node-price 路径固定改写为 /v1/spot/cgn-yunnan/node-price/*，
// 并移除客户端 company/region query；token 主体与 x-region-id 由私有路由核验。
//
// region 维度按业务地区中文名（如「云南」）下传，候选来自 fetchSpotRegions()；
// 同时按全局当前地区注入 x-region-id（与 api.ts requestHeaders() 对齐），
// 使后端地区命中头经 applyRegionHeaders 写入 regionDataStatus，RegionDataBanner 生效。
import { identityHeaders } from '@/services/agent/agentClient'
import { currentRegion } from '@/services/region/regionContext'
import { applyRegionHeaders, timeoutSignal, AGENT_API_BASE_ROOT } from '@/services/api'
import { hasCgnYunnanPriceEntitlement } from '@/services/market/cgnYunnanLivePrice'

// agentClient.AGENT_API_BASE 带 /agent 后缀，现货端点挂在 /v1/spot 下，故从 ROOT 单独推导。
const BASE = `${AGENT_API_BASE_ROOT}/v1/spot`
const SPOT_REQUEST_TIMEOUT_MS = 20000

export type SpotMarket = 'da' | 'rt'

export type SpotRegions = { count: number; regions: string[] }
export type SpotNodes = { count: number; nodes: string[] }
export type NodePricePoint = { time_point: string; price: number | null }
export type NodePriceSeries = { series: NodePricePoint[]; points: number }
export type DailySummaryItem = {
  node_name: string
  avg: number | null
  max: number | null
  min: number | null
  neg_share_pct: number | null
  points: number
}
export type DailySummary = { count: number; items: DailySummaryItem[] }
export type HeatmapData = {
  nodes: string[]
  time_points: string[]
  matrix: Array<Array<number | null>>
}

// 后端 BaseResponse 完整契约（agent-backend common.py:40）：顶层除 code/message/data 外，
// 还含可信度元信息 mock / sourceType / productionWrite。此前本地类型只声明前三者，致
// 元信息在类型层「丢失」（get() 的 return body.data 进一步丢弃）。Phase 2 补齐类型声明，
// Phase 3 起经 data/request.ts::extractEnvelopeMeta 透传到 UnifiedResult 供 UI 显示可信度。
type BaseResponse<T> = {
  code: number
  message?: string
  data: T
  mock?: boolean
  sourceType?: string
  productionWrite?: boolean
}

export type SpotDataResult<T> = {
  data: T
  mock: boolean
  sourceType: string
  productionWrite: boolean
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

async function getEnvelope<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<SpotDataResult<T>> {
  // 只有 token 对应账号的 home company 属中广核云南时才选择专属 PG 路径；其他
  // 集团即使进入共用云南页面也走自己的普通 serving route，不向专属端点制造 403。
  // 私有路径一旦选中，403/503 仍原样失败，绝不运行时回落普通节点价。
  const privateYunnan = currentRegion.value.id === 'yunnan'
    && path.startsWith('/node-price/')
    && hasCgnYunnanPriceEntitlement()
  const effectiveBase = privateYunnan ? `${BASE}/cgn-yunnan` : BASE
  const effectiveParams = privateYunnan ? { ...params, region: undefined } : params
  const headers = identityHeaders()
  if (privateYunnan) delete headers['x-company-id']
  const res = await fetch(`${effectiveBase}${path}${buildQuery(effectiveParams)}`, {
    method: 'GET',
    headers: { ...headers, 'x-region-id': currentRegion.value.id },
    signal: timeoutSignal(SPOT_REQUEST_TIMEOUT_MS),
    cache: privateYunnan ? 'no-store' : 'default'
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
    const nested = payload.detail
    const message = typeof payload.message === 'string'
      ? payload.message
      : typeof nested === 'string'
        ? nested
        : nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).message === 'string'
          ? String((nested as Record<string, unknown>).message)
          : undefined
    throw new Error(message || `请求失败: ${res.status}`)
  }
  // 与 quantClient.post 同源：记录地区命中，使页面 RegionDataBanner 据此提示基线回退。
  applyRegionHeaders(res)
  const body = (await res.json()) as BaseResponse<T>
  if (privateYunnan && (body.mock === true || body.sourceType !== 'REAL' || body.productionWrite === true)) {
    throw new Error('中广核云南私有节点价响应可信度标注不符合真实只读契约')
  }
  return {
    data: body.data,
    mock: body.mock === true || body.sourceType === 'MOCK',
    sourceType: body.sourceType ?? '',
    productionWrite: body.productionWrite === true,
  }
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  return (await getEnvelope<T>(path, params)).data
}

/** 可用现货地区清单（中文名，如「云南」「广东」）。 */
export function fetchSpotRegions(): Promise<SpotRegions> {
  return get('/regions')
}

/** 节点名检索（filterable + remote 后端模糊匹配）。 */
export function searchSpotNodes(q: string, region?: string, limit = 50): Promise<SpotNodes> {
  return get('/node-price/nodes', { q, limit, region })
}

/** 单节点原生粒度价格序列（da=日前 / rt=实时）。 */
export function fetchNodePriceSeries(
  date: string,
  node: string,
  market: SpotMarket,
  region?: string
): Promise<NodePriceSeries> {
  return get('/node-price/series', { date, node, market, region })
}

export function fetchNodePriceSeriesWithMeta(
  date: string,
  node: string,
  market: SpotMarket,
  region?: string
): Promise<SpotDataResult<NodePriceSeries>> {
  return getEnvelope('/node-price/series', { date, node, market, region })
}

/** 当日全节点日聚合明细（avg/max/min/负价占比）。 */
export function fetchDailySummary(
  date: string,
  market: SpotMarket,
  limit = 200,
  region?: string
): Promise<DailySummary> {
  return get('/node-price/daily', { date, market, limit, region })
}

/** 当空间态势等页面需要展示可信度 quartet 时，保留顶层信封元信息。 */
export function fetchDailySummaryWithMeta(
  date: string,
  market: SpotMarket,
  limit = 200,
  region?: string
): Promise<SpotDataResult<DailySummary>> {
  return getEnvelope('/node-price/daily', { date, market, limit, region })
}

/** top_nodes × 原生时段价格热力图矩阵。 */
export function fetchHeatmap(
  date: string,
  market: SpotMarket,
  topNodes = 40,
  region?: string
): Promise<HeatmapData> {
  return get('/node-price/heatmap', { date, market, top_nodes: topNodes, region })
}
