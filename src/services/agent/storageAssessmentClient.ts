import { AGENT_API_BASE_ROOT, applyRegionHeaders, timeoutSignal } from '@/services/api'
import { identityHeaders } from '@/services/agent/agentClient'

const BASE = `${AGENT_API_BASE_ROOT}/v1/storage-assessment`
const REQUEST_TIMEOUT_MS = 30000

export type StorageAssessmentRequest = {
  region_id: string
  region_name: string
  battery_capacity_mwh: number
  max_power_mw: number
  roundtrip_efficiency: number
  total_investment_wan: number
  target_equity_irr?: number
  operation_years?: number
}

export type StorageAssessmentResult = {
  success: true
  run_id: string
  basis: 'real' | 'captured' | 'synthetic' | 'illustrative'
  sourceType: 'REAL' | 'MOCK'
  mock: boolean
  productionWrite: false
  region: { id: string; name: string }
  input: Record<string, unknown>
  decision: Record<string, unknown>
  finance: Record<string, unknown>
  arbitrage: Record<string, unknown>
  dispatch: { rows: Record<string, unknown>[]; meta: Record<string, unknown> }
  sensitivity: Record<string, unknown>
  assumptions: Record<string, unknown>
  ui?: { components?: string[] }
}

export async function runStorageAssessment(payload: StorageAssessmentRequest): Promise<StorageAssessmentResult> {
  const res = await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders() },
    body: JSON.stringify(payload),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS)
  })
  applyRegionHeaders(res)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`储能评估失败: ${res.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  }
  return (await res.json()) as StorageAssessmentResult
}
