// 交易晨报数据包客户端：消费 agent-backend /v1/morning-brief/*（仿 investmentAssessmentClient）。
// bundle 由后端确定性装配（不经 LLM），逐项标注数据真伪供 DataQualityPanel 渲染。
import { AGENT_API_BASE_ROOT, applyRegionHeaders, timeoutSignal } from '@/services/api'
import { identityHeaders } from '@/services/agent/agentClient'

const BASE = `${AGENT_API_BASE_ROOT}/v1/morning-brief`
const REQUEST_TIMEOUT_MS = 45000

export type BriefDataStatus = 'real' | 'forecast' | 'mock' | 'missing'
export type BriefBasis = 'captured' | 'synthetic'

export type DataAvailabilityItem = {
  key: string
  label: string
  status: BriefDataStatus
  source: string | null
  confidence?: number
  note?: string
}

// 序列点：后端按 family 不同（如 {datetime,value}），统一弱类型，前端按需取 datetime/value。
export type SeriesPoint = Record<string, unknown>

export type ForecastBand = {
  source: string | null
  unit?: string
  // bundle v2 起内联全量序列（前端自包含、可直接画图）；不再下发跨会话失效的 data_ref。
  series?: SeriesPoint[]
  band: { p10?: number; p50?: number; p90?: number } | null
}

// market 各序列条目：摘要 + 口径 + 内联全量序列（bundle v2）。
export type MarketSeriesEntry = {
  summary?: Record<string, unknown>
  source?: string
  unit?: string
  series?: SeriesPoint[]
}

export type MorningBriefBundle = {
  meta: {
    schema_version: number
    date: string
    region_id: string
    region_name: string
    run_mode: string
    generated_at: string
  }
  basis: BriefBasis
  sourceType: 'REAL' | 'MOCK'
  mock: boolean
  productionWrite: false
  data_availability: DataAvailabilityItem[]
  market: Record<string, MarketSeriesEntry>
  forecast_band: ForecastBand
  position: Record<string, unknown>
  risk: {
    thresholds: Record<string, unknown>
    breaches: unknown[]
    key_risks: string[]
    basis: string
    mock: boolean
  }
  region_rules: Record<string, unknown>
  gaps: { key: string; reason: string; severity: string }[]
  assumptions: Record<string, unknown>
  ui: { components: string[] }
}

export type MorningBriefRunResult = MorningBriefBundle & {
  success: true
  run_id: string
  persistence?: { saved: boolean; storage?: string; error?: string; reason?: string }
}

export type MorningBriefRunListItem = {
  run_id: string
  brief_date: string
  region: { id: string; name?: string }
  run_mode: string
  basis: BriefBasis
  sourceType: 'REAL' | 'MOCK'
  created_at: string
  gaps: { key: string; reason: string; severity: string }[]
}

export type MorningBriefRunRequest = {
  date: string
  region_id?: string
  region_name?: string
  run_mode?: string
  save?: boolean
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${fallback}: ${res.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  }
  return (await res.json()) as T
}

/** 数据预检：确定性装配晨报 bundle（不落库、不经 LLM）。 */
export async function fetchMorningBriefBundle(params: {
  date: string
  region_id?: string
  region_name?: string
  run_mode?: string
}): Promise<MorningBriefBundle> {
  const url = new URL(`${BASE}/bundle`, window.location.origin)
  url.searchParams.set('date', params.date)
  if (params.region_id) url.searchParams.set('region', params.region_id)
  if (params.region_name) url.searchParams.set('region_name', params.region_name)
  if (params.run_mode) url.searchParams.set('run_mode', params.run_mode)
  const res = await fetch(url.toString(), {
    headers: identityHeaders(),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS)
  })
  applyRegionHeaders(res)
  return readJson<MorningBriefBundle>(res, '晨报数据预检失败')
}

/** 生成并落库晨报运行快照。 */
export async function runMorningBrief(payload: MorningBriefRunRequest): Promise<MorningBriefRunResult> {
  const res = await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders() },
    body: JSON.stringify(payload),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS)
  })
  applyRegionHeaders(res)
  return readJson<MorningBriefRunResult>(res, '晨报生成失败')
}

export async function listMorningBriefRuns(limit = 20): Promise<MorningBriefRunListItem[]> {
  const url = new URL(`${BASE}/runs`, window.location.origin)
  url.searchParams.set('limit', String(limit))
  const res = await fetch(url.toString(), {
    headers: identityHeaders(),
    signal: timeoutSignal(15000)
  })
  const data = await readJson<{ success: true; items: MorningBriefRunListItem[] }>(res, '读取晨报历史失败')
  return data.items
}

export async function getMorningBriefRun(runId: string): Promise<MorningBriefRunResult> {
  const res = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}`, {
    headers: identityHeaders(),
    signal: timeoutSignal(15000)
  })
  return readJson<MorningBriefRunResult>(res, '读取晨报运行失败')
}

export async function deleteMorningBriefRun(runId: string): Promise<void> {
  const res = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
    headers: identityHeaders(),
    signal: timeoutSignal(15000)
  })
  await readJson<{ success: true }>(res, '删除晨报运行失败')
}
