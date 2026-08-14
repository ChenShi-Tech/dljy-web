import { clearCaptureAccessDenied, markCaptureAccessDenied } from '@/services/api'
import { getRegionCapabilityForPath } from '@/services/region/regionModules'
import { agentRequest, extractEnvelopeMeta } from '../request'
import {
  SPOT_DAY_AHEAD_ENERGY_FAMILY,
  SPOT_DAY_AHEAD_ENERGY_MATCH,
  SPOT_DAY_AHEAD_REPORT_FAMILY,
  toSpotDayAheadEnergyContract,
  toSpotDayAheadReportContract,
  type SpotDayAheadEnergyContract,
  type SpotDayAheadReportContract,
  type SpotTradingAdapterMeta
} from './spotTrading'

const ROUTES = {
  report: '/xhjy/zrqsb',
  energy: '/xhjy/zptqx'
} as const

function capabilityAllowsRequest(path: string, region: string): boolean {
  const capability = getRegionCapabilityForPath(path, region)
  return capability?.status === 'available'
}

function emptyMeta(region: string): SpotTradingAdapterMeta {
  return {
    basis: 'captured',
    mock: false,
    sourceType: 'CAPTURE',
    productionWrite: false,
    region_requested: region,
    region_served: region,
    region_fallback: false
  }
}

function metaFrom(params: {
  region: string
  response?: Response
  body?: unknown
}): SpotTradingAdapterMeta {
  const meta = extractEnvelopeMeta(params.body)
  return {
    basis: meta.basis,
    mock: meta.mock,
    sourceType: meta.sourceType ?? meta.provenance?.sourceType,
    productionWrite: meta.productionWrite,
    region_requested: params.region,
    region_served: params.response?.headers.get('x-region-served') ?? params.region,
    region_fallback: params.response?.headers.get('x-region-fallback') === 'true'
  }
}

async function fetchReplay(params: {
  family: string
  match: string
  region: string
  timeoutMs?: number
}): Promise<{ res: Response; body: unknown; denied: boolean }> {
  const res = await agentRequest('/api', '/real', {
    query: {
      family: params.family,
      match: params.match,
      region: params.region
    },
    timeoutMs: params.timeoutMs ?? 20000
  })

  if (res.status === 401 || res.status === 403) {
    const visibility = res.headers.get('x-data-visibility')
    markCaptureAccessDenied(res.status as 401 | 403, visibility === 'company' || visibility === 'public' ? visibility : null, params.family)
    return { res, body: {}, denied: true }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`现货交易契约取数失败: ${res.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  }

  const body = await res.json()
  const code = Number((body as { code?: unknown })?.code ?? 200)
  if (Number.isFinite(code) && code >= 400) {
    throw new Error(`现货交易契约取数失败: code=${code}`)
  }
  clearCaptureAccessDenied(params.family)
  return { res, body, denied: false }
}

export async function fetchSpotDayAheadReportContract(params: {
  region: string
  date: string
  match: string
  timeoutMs?: number
}): Promise<SpotDayAheadReportContract> {
  if (!capabilityAllowsRequest(ROUTES.report, params.region)) {
    return toSpotDayAheadReportContract({
      payload: {},
      date: params.date,
      match: params.match,
      meta: emptyMeta(params.region)
    })
  }

  const { res, body, denied } = await fetchReplay({
    family: SPOT_DAY_AHEAD_REPORT_FAMILY,
    match: params.match,
    region: params.region,
    timeoutMs: params.timeoutMs
  })
  return toSpotDayAheadReportContract({
    payload: body,
    date: params.date,
    match: params.match,
    meta: denied ? emptyMeta(params.region) : metaFrom({ region: params.region, response: res, body })
  })
}

export async function fetchSpotDayAheadEnergyContract(params: {
  region: string
  timeoutMs?: number
}): Promise<SpotDayAheadEnergyContract> {
  if (!capabilityAllowsRequest(ROUTES.energy, params.region)) {
    return toSpotDayAheadEnergyContract({
      payload: {},
      meta: emptyMeta(params.region)
    })
  }

  const { res, body, denied } = await fetchReplay({
    family: SPOT_DAY_AHEAD_ENERGY_FAMILY,
    match: SPOT_DAY_AHEAD_ENERGY_MATCH,
    region: params.region,
    timeoutMs: params.timeoutMs
  })
  return toSpotDayAheadEnergyContract({
    payload: body,
    meta: denied ? emptyMeta(params.region) : metaFrom({ region: params.region, response: res, body })
  })
}
