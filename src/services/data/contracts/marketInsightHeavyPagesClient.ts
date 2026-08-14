import { agentRequest, extractEnvelopeMeta } from '../request'
import { regionCapabilityAllowsRequest } from '@/services/region/regionModules'
import {
  MARKET_INSIGHT_ACTUAL_LOAD_FAMILY,
  MARKET_INSIGHT_ACTUAL_LOAD_MATCH,
  MARKET_INSIGHT_CLEARING_MATCH,
  MARKET_INSIGHT_PRICE_FAMILY,
  MARKET_INSIGHT_PRICE_MATCH,
  MARKET_INSIGHT_ZSJFX_FAMILY,
  MARKET_INSIGHT_ZSJFX_META_MATCH,
  type MarketInsightActualLoadContract,
  type MarketInsightClearingSpotContract,
  type MarketInsightPriceAnalysisContract,
  type MarketInsightZsjfxContract,
  toMarketInsightActualLoadContract,
  toMarketInsightClearingSpotContract,
  toMarketInsightPriceAnalysisContract,
  toMarketInsightZsjfxDayContract,
  toMarketInsightZsjfxMetaContract
} from './marketInsightHeavyPages'

type ContractMetaParams = {
  region: string
  response?: Response
  body?: unknown
}

const ROUTES = {
  zsjfx: '/sjfx/singleZsjfx',
  price: '/sjfx/zrsjg',
  clearing: '/sjfx/zcqxhdl',
  actualLoad: '/sjfx/actualLoad'
} as const

function capabilityAllowsRequest(path: string, region: string): boolean {
  return regionCapabilityAllowsRequest(path, region)
}

function metaFrom({ region, response, body }: ContractMetaParams) {
  const meta = extractEnvelopeMeta(body)
  return {
    basis: meta.basis,
    mock: meta.mock,
    sourceType: meta.sourceType ?? meta.provenance?.sourceType,
    productionWrite: meta.productionWrite,
    region_requested: region,
    region_served: response?.headers.get('x-region-served') ?? region,
    region_fallback: response?.headers.get('x-region-fallback') === 'true'
  }
}

async function fetchReplay(params: {
  family: string
  match: string
  region: string
  timeoutMs?: number
}) {
  const res = await agentRequest('/api', '/real', {
    query: {
      family: params.family,
      match: params.match,
      region: params.region
    },
    timeoutMs: params.timeoutMs ?? 20000
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`市场洞察契约取数失败: ${res.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  }
  const body = await res.json()
  return { res, body }
}

export async function fetchMarketInsightZsjfxMetaContract(params: {
  region: string
  timeoutMs?: number
}): Promise<MarketInsightZsjfxContract> {
  if (!capabilityAllowsRequest(ROUTES.zsjfx, params.region)) {
    return toMarketInsightZsjfxMetaContract({
      payload: {},
      meta: metaFrom({ region: params.region })
    })
  }
  const { res, body } = await fetchReplay({
    family: MARKET_INSIGHT_ZSJFX_FAMILY,
    match: MARKET_INSIGHT_ZSJFX_META_MATCH,
    region: params.region,
    timeoutMs: params.timeoutMs
  })
  return toMarketInsightZsjfxMetaContract({
    payload: body,
    meta: metaFrom({ region: params.region, response: res, body })
  })
}

export async function fetchMarketInsightZsjfxDayContract(params: {
  region: string
  date: string
  timeoutMs?: number
}): Promise<MarketInsightZsjfxContract> {
  if (!capabilityAllowsRequest(ROUTES.zsjfx, params.region)) {
    return toMarketInsightZsjfxDayContract({
      payload: {},
      date: params.date,
      meta: metaFrom({ region: params.region })
    })
  }
  const { res, body } = await fetchReplay({
    family: MARKET_INSIGHT_ZSJFX_FAMILY,
    match: `zsjfx_day__${params.date}`,
    region: params.region,
    timeoutMs: params.timeoutMs
  })
  return toMarketInsightZsjfxDayContract({
    payload: body,
    date: params.date,
    meta: metaFrom({ region: params.region, response: res, body })
  })
}

export async function fetchMarketInsightPriceAnalysisContract(params: {
  region: string
  timeoutMs?: number
}): Promise<MarketInsightPriceAnalysisContract> {
  if (!capabilityAllowsRequest(ROUTES.price, params.region)) {
    return toMarketInsightPriceAnalysisContract({
      payload: {},
      meta: metaFrom({ region: params.region })
    })
  }
  const { res, body } = await fetchReplay({
    family: MARKET_INSIGHT_PRICE_FAMILY,
    match: MARKET_INSIGHT_PRICE_MATCH,
    region: params.region,
    timeoutMs: params.timeoutMs
  })
  return toMarketInsightPriceAnalysisContract({
    payload: body,
    meta: metaFrom({ region: params.region, response: res, body })
  })
}

export async function fetchMarketInsightClearingSpotContract(params: {
  region: string
  timeoutMs?: number
}): Promise<MarketInsightClearingSpotContract> {
  if (!capabilityAllowsRequest(ROUTES.clearing, params.region)) {
    return toMarketInsightClearingSpotContract({
      payload: {},
      meta: metaFrom({ region: params.region })
    })
  }
  const { res, body } = await fetchReplay({
    family: MARKET_INSIGHT_PRICE_FAMILY,
    match: MARKET_INSIGHT_CLEARING_MATCH,
    region: params.region,
    timeoutMs: params.timeoutMs
  })
  return toMarketInsightClearingSpotContract({
    payload: body,
    meta: metaFrom({ region: params.region, response: res, body })
  })
}

export async function fetchMarketInsightActualLoadContract(params: {
  region: string
  timeoutMs?: number
}): Promise<MarketInsightActualLoadContract> {
  if (!capabilityAllowsRequest(ROUTES.actualLoad, params.region)) {
    return toMarketInsightActualLoadContract({
      payload: {},
      meta: metaFrom({ region: params.region })
    })
  }
  const { res, body } = await fetchReplay({
    family: MARKET_INSIGHT_ACTUAL_LOAD_FAMILY,
    match: MARKET_INSIGHT_ACTUAL_LOAD_MATCH,
    region: params.region,
    timeoutMs: params.timeoutMs
  })
  return toMarketInsightActualLoadContract({
    payload: body,
    meta: metaFrom({ region: params.region, response: res, body })
  })
}
