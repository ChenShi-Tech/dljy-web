import { AGENT_API_BASE_ROOT, applyRegionHeaders, timeoutSignal } from '@/services/api'
import { identityHeaders } from '@/services/agent/agentClient'

const BASE = `${AGENT_API_BASE_ROOT}/v1/investment-assessment`
const REQUEST_TIMEOUT_MS = 45000

export type InvestmentAssetType = 'storage' | 'wind_solar' | 'truck_charging'
export type InvestmentBasis = 'real' | 'captured' | 'synthetic' | 'illustrative'

export type InvestmentAssessmentRequest = {
  asset_type?: InvestmentAssetType
  project_id?: string | null
  project_name?: string
  region_id: string
  region_name: string
  input: Record<string, unknown>
  scenario_set?: { label: string; input: Record<string, unknown> }[]
  save?: boolean
  basis?: InvestmentBasis
}

export type InvestmentAssessmentResult = {
  success: true
  run_id: string
  project_id: string
  project_name: string
  asset_type: InvestmentAssetType
  basis: InvestmentBasis
  sourceType: 'REAL' | 'MOCK'
  mock: boolean
  productionWrite: false
  formula_version: string
  region: { id: string; name: string }
  input: Record<string, unknown>
  decision: Record<string, unknown>
  finance: Record<string, unknown>
  storage?: {
    calculator?: Record<string, unknown>
    arbitrage?: Record<string, unknown>
    dispatch?: { rows?: Record<string, unknown>[]; meta?: Record<string, unknown> }
    dispatch_assumptions?: Record<string, unknown>
  }
  arbitrage?: Record<string, unknown>
  dispatch?: { rows?: Record<string, unknown>[]; meta?: Record<string, unknown> }
  sensitivity: Record<string, unknown>
  assumptions: Record<string, unknown>
  persistence?: { saved: boolean; storage?: string; error?: string; reason?: string }
  ui?: { components?: string[] }
}

export type InvestmentRunListItem = {
  run_id: string
  project_id: string
  project_name: string
  asset_type: InvestmentAssetType
  region: { id: string; name?: string }
  basis: InvestmentBasis
  sourceType: 'REAL' | 'MOCK'
  formula_version: string
  created_at: string
  decision: Record<string, unknown>
  finance: Record<string, unknown>
}

export type InvestmentIntentParseResult = {
  success: true
  asset_type: InvestmentAssetType
  field_patch: Record<string, unknown>
  confidence: number
  missing_fields: string[]
  explanation: string
  requires_confirmation: boolean
  productionWrite: false
  mock: boolean
  sourceType: 'REAL' | 'MOCK'
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${fallback}: ${res.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  }
  return (await res.json()) as T
}

export async function runInvestmentAssessment(payload: InvestmentAssessmentRequest): Promise<InvestmentAssessmentResult> {
  const res = await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders() },
    body: JSON.stringify(payload),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS)
  })
  applyRegionHeaders(res)
  return readJson<InvestmentAssessmentResult>(res, '投资测算失败')
}

export async function listInvestmentRuns(assetType: InvestmentAssetType = 'storage', limit = 20): Promise<InvestmentRunListItem[]> {
  const url = new URL(`${BASE}/runs`, window.location.origin)
  url.searchParams.set('asset_type', assetType)
  url.searchParams.set('limit', String(limit))
  const res = await fetch(url.toString(), {
    headers: identityHeaders(),
    signal: timeoutSignal(15000)
  })
  const data = await readJson<{ success: true; items: InvestmentRunListItem[] }>(res, '读取投资测算历史失败')
  return data.items
}

export async function getInvestmentRun(runId: string): Promise<InvestmentAssessmentResult> {
  const res = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}`, {
    headers: identityHeaders(),
    signal: timeoutSignal(15000)
  })
  return readJson<InvestmentAssessmentResult>(res, '读取投资测算运行失败')
}

export async function deleteInvestmentRun(runId: string): Promise<void> {
  const res = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
    headers: identityHeaders(),
    signal: timeoutSignal(15000)
  })
  await readJson<{ success: true }>(res, '删除投资测算运行失败')
}

export async function parseInvestmentIntent(payload: {
  text: string
  asset_type?: InvestmentAssetType
  region_id: string
  region_name: string
  current_input: Record<string, unknown>
}): Promise<InvestmentIntentParseResult> {
  const res = await fetch(`${BASE}/intents/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders() },
    body: JSON.stringify({ asset_type: 'storage', ...payload }),
    signal: timeoutSignal(15000)
  })
  return readJson<InvestmentIntentParseResult>(res, '解析投资测算意图失败')
}
