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
  dateFrom?: string
  dateTo?: string
}) {
  const res = await agentRequest('/api', '/real', {
    query: {
      family: params.family,
      match: params.match,
      region: params.region,
      ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
      ...(params.dateTo ? { dateTo: params.dateTo } : {})
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

/** __list__ 出清清单允许发请求的地区：山西（三德公司私有族的宿主地区）。 */
const CLEARING_LIST_REGION_ALLOWED = 'shanxi'

export async function fetchMarketInsightClearingSpotContract(params: {
  region: string
  timeoutMs?: number
  dateFrom?: string
  dateTo?: string
}): Promise<MarketInsightClearingSpotContract> {
  // #2991：sdpt_zcqxhdl/__list__（连续出清序列）在 dljy 后端注册表（capture-families
  // datasetOwners）登记为山西三德公司私有清单，只有山西有这个键。旧实现任何地区都会发
  // 请求，云南等地拿到的只会是空——更糟的是存在跨地区读取他省公司私有清单的风险。
  // 现改为客户端硬拦截：非山西地区不发任何请求，直接返回「本地区不适用」的诚实空态。
  if (params.region !== CLEARING_LIST_REGION_ALLOWED) {
    return clearingNotApplicableContract(params.region)
  }
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
    timeoutMs: params.timeoutMs,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo
  })
  return toMarketInsightClearingSpotContract({
    payload: body,
    meta: metaFrom({ region: params.region, response: res, body })
  })
}

/**
 * 非山西地区的「本地区不适用」空态：不发请求、不带任何数据。
 * 元信息与能力未开通分支一致（只给地区），空 payload 由契约适配层统一归为 missing 并按既有约定标注非真实；
 * 页面在非山西地区直接显示停用说明卡，不渲染这份契约。
 */
function clearingNotApplicableContract(region: string): MarketInsightClearingSpotContract {
  const contract = toMarketInsightClearingSpotContract({
    payload: {},
    meta: { region_requested: region, region_served: region, region_fallback: false }
  })
  contract.data_availability = contract.data_availability.map((item) => ({
    ...item,
    note: `本地区不适用：sdpt_zcqxhdl/__list__ 是山西公司专属出清清单（dljy#2991），${region} 无对应键，客户端已拦截请求。`
  }))
  contract.blocks.clearing_spot.notes = [
    ...contract.blocks.clearing_spot.notes,
    `#2991：非山西地区（当前 ${region}）不读取 __list__——旧实现会跨地区读取山西公司私有清单，已停用；获权场站的申报、出清与实际对照后续在「场站市场表现」提供。`
  ]
  return contract
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
