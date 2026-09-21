// 套保接口客户端（openspec build-midlong-spot-hedging 任务 8.1，specs HW-01..10）。
//
// 只经 HTTP 取数（前端不自开数据库连接），基址 /api/v1/hedge（vite 代理到 4174）。
// 数值为十进制字符串、未知为 null：本客户端只做类型包装，不做口径加工（前端不算正式口径）。
// 地区由 applyRegionHeaders 统一注入 x-region-id；写接口带 Idempotency-Key。

import { timeoutSignal } from '@/services/api'
import { identityHeaders } from '@/services/agent/agentClient'
import { currentRegion } from '@/services/region/regionContext'

const BASE = '/api/v1/hedge'
const TIMEOUT_MS = 15000

export class HedgeApiError extends Error {
  status: number
  errorCode: string
  details: Record<string, unknown> | null
  constructor(status: number, errorCode: string, message: string, details: Record<string, unknown> | null = null) {
    super(message)
    this.status = status
    this.errorCode = errorCode
    this.details = details
  }
}

async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, opts: { body?: unknown; query?: Record<string, string | undefined> } = {}): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
  }
  const headers: Record<string, string> = {
    ...(identityHeaders() as Record<string, string>),
  }
  if (method !== 'GET') headers['idempotency-key'] = crypto.randomUUID()
  if (method !== 'GET') headers['content-type'] = 'application/json'
  void currentRegion
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
    signal: timeoutSignal(TIMEOUT_MS),
  })
  const payload = await res.json().catch(() => ({ code: res.status, msg: '响应不是 JSON', data: { errorCode: 'STORAGE_UNAVAILABLE' } }))
  if (!res.ok || (payload.code && payload.code >= 400)) {
    const data = payload.data ?? {}
    throw new HedgeApiError(res.status, data.errorCode ?? 'STORAGE_UNAVAILABLE', payload.msg ?? '套保服务请求失败', data.details ?? null)
  }
  return payload.data as T
}

// ── 读侧 ──────────────────────────────────────────────────────────────────────

export interface HedgeLegMeta { key: string; status: string; asOf?: string | null; note?: string | null }

export interface HedgeOverview {
  asOf: string
  view: string
  intervals: Array<{
    start: string; end: string; covered: boolean
    generation: { value: string | null; source: string | null; sourceKey?: string | null; uncoveredReason?: string | null; unknownStationIds?: number[] }
    locked: { midlong: string | null; mechanism: { value: string | null; note?: string | null }; total: string | null }
    exposure: { withMechanism: string | null; midlongOnly: string | null }
  }>
  ratio: { coverage: Record<string, unknown>; withMechanism: { value: string | null; status: string }; midlongOnly: { value: string | null; status: string } }
  // 旧后端（未走 assembleOverview 的精简响应）可能缺这三个字段（#3133）：类型放宽 + 模板可选链防护。
  standardMetrics?: Record<string, { level: string; reason: string | null; hints: string[]; tier: string | null; basis: string | null }>
  sensitivity?: { value: string | null; incomplete: boolean; reference: string | null; note: string | null }
  watchlist: { rows: Array<Record<string, unknown>>; basisUsed: string; note: string | null; disclaimer: string }
  scheme: { schemeId: number; versionNo: number; basis: string; name: string } | null
  legs: Record<string, unknown>
  gaps: Array<{ code: string; message: string; affected: string | null }>
}

export function fetchOverview(query: { fromDate: string; toDate: string; granularity?: string; scope?: string; stationId?: string; subjectId?: string; asOf?: string }) {
  return request<HedgeOverview>('GET', '/overview', { query: query as Record<string, string | undefined> })
}

export function fetchSummary(query: { window: 'today2' | 'month'; asOf?: string }) {
  return request<Record<string, unknown>>('GET', '/summary', { query })
}

export function fetchMonths(query: { fromMonth: string; toMonth: string; asOf?: string }) {
  return request<Record<string, unknown>>('GET', '/months', { query })
}

export function fetchBreakdown(query: { fromDate: string; toDate: string; dimension: string; asOf?: string }) {
  return request<Record<string, unknown>>('GET', '/breakdown', { query })
}

export function fetchContracts(query: { fromDate: string; toDate: string; asOf?: string }) {
  return request<Record<string, unknown>>('GET', '/contracts', { query })
}

export function fetchBandActivation(query: { asOf?: string }) {
  return request<Record<string, unknown>>('GET', '/band/activation', { query })
}

export function fetchBandPresets() {
  return request<Record<string, unknown>>('GET', '/band/presets')
}

export function fetchMechanismParams(query: { stationId?: string; asOf?: string }) {
  return request<Record<string, unknown>>('GET', '/mechanism-params', { query })
}

export function fetchBaselines(query: { fromMonth?: string; toMonth?: string; asOf?: string }) {
  return request<Record<string, unknown>>('GET', '/baselines', { query })
}

export function fetchSettlement(query: { fromDate: string; toDate: string; granularity?: string; view?: string }) {
  return request<Record<string, unknown>>('GET', '/settlement/review', { query })
}

export function fetchCaps(query: { fromMonth?: string; toMonth?: string }) {
  return request<Record<string, unknown>>('GET', '/caps', { query })
}

// ── 写侧（公司写权限；写口详见 Epic #3037 待用户决定节）──────────────────────

export function putBaselines(items: Array<{ stationId: number; month: string; quantityMwh: string; basisNote?: string; expectedVersionNo?: number }>) {
  return request<Record<string, unknown>>('PUT', '/baselines', { body: { items } })
}

export function requestBandSchemeCreate(body: { name: string; presetKey?: string; origin?: string; tiers?: unknown; basis?: string; note?: string }) {
  return request<Record<string, unknown>>('POST', '/band/schemes', { body })
}

export function activateBand(body: { schemeId: number; versionNo: number; reason: string; rowVersion?: number; effectiveFrom?: string }) {
  return request<Record<string, unknown>>('PUT', '/band/activation', { body })
}

export function putCaps(items: Array<{ subjectId: number; month: string; capMwh: string; sourceNote?: string; rowVersion?: number }>) {
  return request<Record<string, unknown>>('PUT', '/caps', { body: { items } })
}

export function postMechanismVersion(periodKey: string, body: { action: 'EDIT' | 'CONFIRM' | 'END'; baseVersionNo: number; [key: string]: unknown }) {
  return request<Record<string, unknown>>('POST', `/mechanism-params/${periodKey}/versions`, { body })
}

/** 补仓试算（HM-07）：无状态，POST 但无副作用；服务端不落任何表。 */
export function postSimulate(body: {
  window: { fromDate: string; toDate: string }
  adjustments: Array<{ from?: string; to?: string; quantityMwh: string; shape: { kind: string; stationId?: number; contractId?: number } }>
}) {
  return request<Record<string, unknown>>('POST', '/simulate', { body })
}
