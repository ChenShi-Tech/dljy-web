import { AREA_LABEL_BY_REGION } from 'shared/region/constants.mjs'
import { AGENT_API_BASE_ROOT } from '@/services/api'
import { agentRequest } from '../request'
import type { NodePriceContract } from './nodePrice'
import {
  deniedNodePriceAccess,
  toNodePriceDailyContract,
  toNodePriceEmptyContract,
  toNodePriceHeatmapContract,
  toNodePriceSeriesContract,
  type NodePriceEnvelopeMeta,
  type NodePriceMarket
} from './nodePriceAdapter'
import { resolveMechanismProfile } from '@/services/region/mechanismProfile'
import { resolveServingRoute } from './servingRoutes.gen'

// 数据链路：serving-route-registry（node_price 数据集）门控 → agent-backend
// /agent-api/v1/spot/node-price/*（DuckDB 读云南 derived Parquet，BaseResponse 信封）。
// 未配置路由的地区（如山西等国网省份）在本层即返回诚实空态，不发请求、不回落他省。
const BASE = `${AGENT_API_BASE_ROOT}/v1/spot`
const NODE_PRICE_TIMEOUT_MS = 20000

type GateResult =
  | { ok: true; regionLabel: string }
  | { ok: false; contract: NodePriceContract }

// 机制画像注入：消费方从契约直接拿到「怎么读」（da/rt 是否分离、粒度与重采样、
// 价格标的），无需自己按地区分支。纯投影，无请求成本。
function withMechanism(contract: NodePriceContract, regionId: string): NodePriceContract {
  return { ...contract, mechanism: resolveMechanismProfile(regionId, 'node_price') }
}

// 注册表门控 + 地区中文名解析（节点价 API 以业务地区中文名下传；未知地区诚实空态）。
function gate(regionId: string): GateResult {
  if (!resolveServingRoute('node_price', regionId)) {
    return {
      ok: false,
      contract: withMechanism(toNodePriceEmptyContract({
        regionId,
        reason: `地区 ${regionId} 未在 serving-route-registry 配置 node_price 路由（该市场无节点价数据源或尚未接入），不回落他省口径`
      }), regionId)
    }
  }
  const regionLabel = (AREA_LABEL_BY_REGION as Record<string, string>)[regionId]
  if (!regionLabel?.trim()) {
    return {
      ok: false,
      contract: withMechanism(toNodePriceEmptyContract({ regionId, reason: `地区 ${regionId} 无权威中文名映射，已停止取数` }), regionId)
    }
  }
  return { ok: true, regionLabel }
}

function envelopeMeta(regionId: string, response: Response, body: Record<string, unknown>): NodePriceEnvelopeMeta {
  return {
    mock: body.mock === true,
    sourceType: typeof body.sourceType === 'string' ? body.sourceType : undefined,
    productionWrite: body.productionWrite === true,
    region_requested: regionId,
    region_served: response.headers.get('x-region-served') ?? regionId,
    region_fallback: response.headers.get('x-region-fallback') === 'true'
  }
}

async function fetchSpot(path: string, regionLabel: string, query: Record<string, string | number | undefined>) {
  const response = await agentRequest(BASE, path, {
    query: { ...query, region: regionLabel },
    timeoutMs: NODE_PRICE_TIMEOUT_MS
  })
  return response
}

function deniedContract(regionId: string, status: number): NodePriceContract {
  return withMechanism(toNodePriceEmptyContract({
    regionId,
    access: deniedNodePriceAccess(status === 401 ? 'anonymous' : 'company_unauthorized'),
    reason: status === 401 ? '未登录或凭据失效，节点电价不可读' : '当前公司未获授权读取该地区节点电价'
  }), regionId)
}

async function parseOrThrow(response: Response, regionId: string): Promise<
  { kind: 'denied'; contract: NodePriceContract } | { kind: 'ok'; body: Record<string, unknown> }
> {
  if (response.status === 401 || response.status === 403) {
    return { kind: 'denied', contract: deniedContract(regionId, response.status) }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`节点电价契约取数失败: ${response.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  }
  return { kind: 'ok', body: (await response.json()) as Record<string, unknown> }
}

export async function fetchNodePriceDailyContract(params: {
  regionId: string
  date: string
  market: NodePriceMarket
  limit?: number
}): Promise<NodePriceContract> {
  const gated = gate(params.regionId)
  if (!gated.ok) return gated.contract
  const response = await fetchSpot('/node-price/daily', gated.regionLabel, {
    date: params.date,
    market: params.market,
    limit: params.limit ?? 5000
  })
  const parsed = await parseOrThrow(response, params.regionId)
  if (parsed.kind === 'denied') return parsed.contract
  return withMechanism(toNodePriceDailyContract({
    regionId: params.regionId,
    date: params.date,
    market: params.market,
    payload: parsed.body.data as Parameters<typeof toNodePriceDailyContract>[0]['payload'],
    meta: envelopeMeta(params.regionId, response, parsed.body)
  }), params.regionId)
}

export async function fetchNodePriceSeriesContract(params: {
  regionId: string
  date: string
  market: NodePriceMarket
  nodeName: string
}): Promise<NodePriceContract> {
  const gated = gate(params.regionId)
  if (!gated.ok) return gated.contract
  const response = await fetchSpot('/node-price/series', gated.regionLabel, {
    date: params.date,
    market: params.market,
    node: params.nodeName
  })
  const parsed = await parseOrThrow(response, params.regionId)
  if (parsed.kind === 'denied') return parsed.contract
  return withMechanism(toNodePriceSeriesContract({
    regionId: params.regionId,
    date: params.date,
    market: params.market,
    nodeName: params.nodeName,
    payload: parsed.body.data as Parameters<typeof toNodePriceSeriesContract>[0]['payload'],
    meta: envelopeMeta(params.regionId, response, parsed.body)
  }), params.regionId)
}

export async function fetchNodePriceHeatmapContract(params: {
  regionId: string
  date: string
  market: NodePriceMarket
  topNodes?: number
}): Promise<NodePriceContract> {
  const gated = gate(params.regionId)
  if (!gated.ok) return gated.contract
  const response = await fetchSpot('/node-price/heatmap', gated.regionLabel, {
    date: params.date,
    market: params.market,
    top_nodes: params.topNodes ?? 40
  })
  const parsed = await parseOrThrow(response, params.regionId)
  if (parsed.kind === 'denied') return parsed.contract
  return withMechanism(toNodePriceHeatmapContract({
    regionId: params.regionId,
    date: params.date,
    market: params.market,
    payload: parsed.body.data as Parameters<typeof toNodePriceHeatmapContract>[0]['payload'],
    meta: envelopeMeta(params.regionId, response, parsed.body)
  }), params.regionId)
}
