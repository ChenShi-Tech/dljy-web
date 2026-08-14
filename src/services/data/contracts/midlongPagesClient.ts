import { agentRequest, extractEnvelopeMeta } from '../request'
import { regionCapabilityAllowsRequest } from '@/services/region/regionModules'
import {
  MIDLONG_INTER_PROVINCIAL_FAMILY,
  MIDLONG_INTER_PROVINCIAL_MATCH,
  toMidlongInterProvincialContract,
  type MidlongInterProvincialContract
} from './midlongPages'

type ContractMetaParams = {
  region: string
  response?: Response
  body?: unknown
}

const ROUTES = {
  interProvincial: '/sjxh/zjzzt'
} as const

function capabilityAllowsRequest(path: string, region: string): boolean {
  return regionCapabilityAllowsRequest(path, region)
}

function metaFrom({ region, response, body }: ContractMetaParams) {
  const meta = extractEnvelopeMeta(body)
  return {
    basis: meta.basis ?? 'captured',
    mock: meta.mock ?? false,
    sourceType: meta.sourceType ?? meta.provenance?.sourceType ?? 'CAPTURE',
    productionWrite: meta.productionWrite ?? false,
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
    throw new Error(`中长期契约取数失败: ${res.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  }
  const body = await res.json()
  return { res, body }
}

export async function fetchMidlongInterProvincialContract(params: {
  region: string
  timeoutMs?: number
}): Promise<MidlongInterProvincialContract> {
  if (!capabilityAllowsRequest(ROUTES.interProvincial, params.region)) {
    return toMidlongInterProvincialContract({
      payload: {},
      meta: metaFrom({ region: params.region })
    })
  }
  const { res, body } = await fetchReplay({
    family: MIDLONG_INTER_PROVINCIAL_FAMILY,
    match: MIDLONG_INTER_PROVINCIAL_MATCH,
    region: params.region,
    timeoutMs: params.timeoutMs
  })
  return toMidlongInterProvincialContract({
    payload: body,
    meta: metaFrom({ region: params.region, response: res, body })
  })
}
