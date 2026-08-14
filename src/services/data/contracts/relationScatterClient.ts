import { fetchCaptured } from '@/services/captured'
import { buildRealtimeScatter } from '@/services/market/yunnanRealtime'
import { regionCapabilityAllowsRequest } from '@/services/region/regionModules'
import { extractEnvelopeMeta } from '../request'
import {
  MARKET_INSIGHT_RELATION_FAMILY,
  type MarketInsightRelationKind,
  type MarketInsightRelationPriceMode,
  type MarketInsightRelationScatterContract,
  toMarketInsightRelationScatterContract
} from './relationScatterAdapter'

const ROUTE_BY_KIND: Record<MarketInsightRelationKind, string> = {
  renewable: '/sjfx/zrxgx',
  load: '/sjfx/zrxgx2'
}

const SHANXI_MATCH_PREFIX: Record<MarketInsightRelationKind, string> = {
  renewable: '_list24__',
  load: 'fhlist24__'
}

function shanxiMatch(kind: MarketInsightRelationKind, runDate: string): string {
  return `${SHANXI_MATCH_PREFIX[kind]}${runDate}`
}

function sourceFromForecast(kind: MarketInsightRelationKind, priceMode: MarketInsightRelationPriceMode): string {
  const xMetric = kind === 'renewable' ? 'new_energy_actual' : 'load_actual'
  const priceKey = priceMode === 'rq' ? 'da_user_price' : 'rt_user_price'
  return `yn_system_forecast/${xMetric}+${priceKey}`
}

function capabilityAllowsRequest(kind: MarketInsightRelationKind, region: string): boolean {
  return regionCapabilityAllowsRequest(ROUTE_BY_KIND[kind], region)
}

async function fetchShanxiRelationScatter(params: {
  kind: MarketInsightRelationKind
  region: string
  runDate: string
  days: number
  priceMode: MarketInsightRelationPriceMode
}): Promise<MarketInsightRelationScatterContract> {
  const match = shanxiMatch(params.kind, params.runDate)
  const body = await fetchCaptured<unknown>(MARKET_INSIGHT_RELATION_FAMILY, match, { region: params.region })
  const meta = extractEnvelopeMeta(body)
  return toMarketInsightRelationScatterContract({
    kind: params.kind,
    payload: body,
    runDate: params.runDate,
    days: params.days,
    priceMode: params.priceMode,
    source: `${MARKET_INSIGHT_RELATION_FAMILY}/${match}`,
    notes: [
      params.kind === 'renewable'
        ? '山西由 sdpt_zcqxhdl/list24 回放适配为价格-新能源 24 小时散点。'
        : '山西由 sdpt_zcqxhdl/fhlist24 回放适配为价格-统调负荷 24 小时散点。'
    ],
    meta: {
      basis: meta.basis,
      mock: meta.mock,
      sourceType: meta.sourceType ?? meta.provenance?.sourceType,
      productionWrite: meta.productionWrite,
      region_requested: params.region,
      region_served: params.region,
      region_fallback: false
    }
  })
}

async function fetchYunnanRelationScatter(params: {
  kind: MarketInsightRelationKind
  region: string
  runDate: string
  days: number
  priceMode: MarketInsightRelationPriceMode
}): Promise<MarketInsightRelationScatterContract> {
  const payload = await buildRealtimeScatter({
    runDate: params.runDate,
    days: params.days,
    xMetric: params.kind === 'renewable' ? 'new_energy_actual' : 'load_actual',
    priceMode: params.priceMode,
    region: params.region
  })
  return toMarketInsightRelationScatterContract({
    kind: params.kind,
    payload,
    runDate: params.runDate,
    days: params.days,
    priceMode: params.priceMode,
    source: sourceFromForecast(params.kind, params.priceMode),
    notes: [
      '云南由 yn_system_forecast 真实长表适配，96 点/天按小时均值聚合为 24 点散点。',
      '云南无 xnyzd/xnyg/xnygd 山西专有竖线维度，页面按能力注册表隐藏。'
    ],
    meta: {
      basis: 'captured',
      mock: false,
      sourceType: 'CAPTURE',
      productionWrite: false,
      region_requested: params.region,
      region_served: params.region,
      region_fallback: false
    }
  })
}

export async function fetchMarketInsightRelationScatterContract(params: {
  kind: MarketInsightRelationKind
  region: string
  runDate: string
  days: number
  priceMode: MarketInsightRelationPriceMode
}): Promise<MarketInsightRelationScatterContract> {
  if (!capabilityAllowsRequest(params.kind, params.region)) {
    return toMarketInsightRelationScatterContract({
      kind: params.kind,
      payload: {},
      runDate: params.runDate,
      days: params.days,
      priceMode: params.priceMode,
      source: null,
      notes: ['当前地区能力注册表声明该关系图不可用，未发起跨地区回放请求。'],
      meta: {
        basis: 'captured',
        mock: false,
        sourceType: 'CAPTURE',
        productionWrite: false,
        region_requested: params.region,
        region_served: params.region,
        region_fallback: false
      }
    })
  }
  if (params.region === 'yunnan') return fetchYunnanRelationScatter(params)
  return fetchShanxiRelationScatter(params)
}
