// 复盘事件库/改进措施服务端通道 · 传输层（Epic #2033 · #2046/#2047/#2049）
// ---------------------------------------------------------------------------
// 经 Python agent 薄代理（/agent-api/agent/review/*）到 Node BFF
// （/api/v1/review/risk-events | improvement-actions，权威存储）。
// 读路径探针降级（endpoint-absent 时空态+提示，不合成）；写路径直接抛 Error(msg)
// ——事件登记与行动项宁可报错重试，不静默降级为本地草稿。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'
import {
  classifyStoreResponse,
  coerceCase,
  coerceImprovementAction,
  coerceRiskEvent,
  extractRows,
  isOpenForCarry,
  type CaseSummary,
  type ImprovementActionSummary,
  type RiskEventSummary,
  type StoreFeed
} from './reviewStoreApi'

const BASE = `${AGENT_API_BASE}/review`
const TIMEOUT_MS = 8000

/** crypto.randomUUID 需安全上下文，现场 http 部署没有——与 decisionLogClient 同款降级。 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function readEnvelope(res: Response): Promise<Record<string, unknown> | null> {
  return (await res.json().catch(() => null)) as Record<string, unknown> | null
}

export type RiskEventFilters = {
  eventType?: string
  riskLevel?: 'high' | 'medium' | 'low'
  nearMiss?: boolean
  since?: string
  until?: string
}

export type RiskEventFeed =
  | { available: true; events: RiskEventSummary[] }
  | ({ available: false } & Exclude<StoreFeed, { available: true }>)

export async function fetchRiskEvents(filters: RiskEventFilters = {}): Promise<RiskEventFeed> {
  const qs = new URLSearchParams()
  if (filters.eventType) qs.set('event_type', filters.eventType)
  if (filters.riskLevel) qs.set('risk_level', filters.riskLevel)
  if (filters.nearMiss !== undefined) qs.set('near_miss', String(filters.nearMiss))
  if (filters.since) qs.set('since', filters.since)
  if (filters.until) qs.set('until', filters.until)
  const q = qs.toString()
  try {
    const res = await fetch(`${BASE}/risk-events${q ? `?${q}` : ''}`, {
      method: 'GET',
      headers: identityHeaders(),
      signal: timeoutSignal(TIMEOUT_MS)
    })
    const body: unknown = res.status === 204 ? [] : await res.json().catch(() => null)
    const verdict = classifyStoreResponse(res.status, body)
    if (!verdict.available) return verdict
    const rows = extractRows(body) ?? []
    const events = rows.map(coerceRiskEvent).filter((e): e is RiskEventSummary => e !== null)
    return { available: true, events }
  } catch {
    return { available: false, reason: 'unreachable' }
  }
}

export type RiskEventDraft = {
  eventTime: string
  eventType: string
  riskLevel?: 'high' | 'medium' | 'low' | null
  impactYuan?: number | null
  impactCaliber?: string | null
  positionSnapshot?: Record<string, unknown> | null
  nearMiss?: boolean
  lessons?: string | null
  extremeValue?: number | null
  durationHours?: number | null
}

export async function registerRiskEvent(
  draft: RiskEventDraft,
  idempotencyKey?: string
): Promise<RiskEventSummary> {
  const res = await fetch(`${BASE}/risk-events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders(), 'idempotency-key': idempotencyKey ?? newIdempotencyKey() },
    body: JSON.stringify(draft),
    signal: timeoutSignal(TIMEOUT_MS)
  })
  const body = await readEnvelope(res)
  if (res.status >= 200 && res.status < 300) {
    const ev = coerceRiskEvent(body?.data ?? body)
    if (ev) return ev
    throw new Error('风险事件登记成功但响应形态不符——请刷新核对，不重复提交')
  }
  throw new Error(typeof body?.msg === 'string' && body.msg ? body.msg : `风险事件登记失败（HTTP ${res.status}）`)
}

export async function patchRiskEvent(
  eventId: string,
  patch: { disposal?: string | null; effective?: boolean | null; lessons?: string | null }
): Promise<RiskEventSummary> {
  const res = await fetch(`${BASE}/risk-events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...identityHeaders(), 'idempotency-key': newIdempotencyKey() },
    body: JSON.stringify(patch),
    signal: timeoutSignal(TIMEOUT_MS)
  })
  const body = await readEnvelope(res)
  if (res.status >= 200 && res.status < 300) {
    const ev = coerceRiskEvent(body?.data ?? body)
    if (ev) return ev
    throw new Error('处置回填成功但响应形态不符——请刷新核对')
  }
  throw new Error(typeof body?.msg === 'string' && body.msg ? body.msg : `处置回填失败（HTTP ${res.status}）`)
}

export type ImprovementActionFeed =
  | { available: true; actions: ImprovementActionSummary[] }
  | ({ available: false } & Exclude<StoreFeed, { available: true }>)

export async function fetchImprovementActions(status?: string): Promise<ImprovementActionFeed> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  try {
    const res = await fetch(`${BASE}/improvement-actions${qs}`, {
      method: 'GET',
      headers: identityHeaders(),
      signal: timeoutSignal(TIMEOUT_MS)
    })
    const body: unknown = res.status === 204 ? [] : await res.json().catch(() => null)
    const verdict = classifyStoreResponse(res.status, body)
    if (!verdict.available) return verdict
    const rows = extractRows(body) ?? []
    const actions = rows.map(coerceImprovementAction).filter((a): a is ImprovementActionSummary => a !== null)
    return { available: true, actions }
  } catch {
    return { available: false, reason: 'unreachable' }
  }
}

/** 未闭环清单（open + carried_over）：纪要「上期改进措施回查」的自动带入源。 */
export async function fetchCarryOverActions(): Promise<ImprovementActionFeed> {
  const feed = await fetchImprovementActions('open')
  if (!feed.available) return feed
  const carried = await fetchImprovementActions('carried_over')
  if (!carried.available) return carried
  return { available: true, actions: [...feed.actions, ...carried.actions].filter(isOpenForCarry) }
}

export async function createImprovementAction(input: {
  action: string
  owner?: string | null
  dueDate?: string | null
}): Promise<ImprovementActionSummary> {
  const res = await fetch(`${BASE}/improvement-actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders(), 'idempotency-key': newIdempotencyKey() },
    body: JSON.stringify(input),
    signal: timeoutSignal(TIMEOUT_MS)
  })
  const body = await readEnvelope(res)
  if (res.status >= 200 && res.status < 300) {
    const a = coerceImprovementAction(body?.data ?? body)
    if (a) return a
    throw new Error('行动项写入成功但响应形态不符——请刷新核对，不重复提交')
  }
  throw new Error(typeof body?.msg === 'string' && body.msg ? body.msg : `行动项写入失败（HTTP ${res.status}）`)
}

export async function patchImprovementAction(
  actionId: string,
  patch: { action?: string; owner?: string | null; dueDate?: string | null; status?: string }
): Promise<ImprovementActionSummary> {
  const res = await fetch(`${BASE}/improvement-actions/${encodeURIComponent(actionId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...identityHeaders(), 'idempotency-key': newIdempotencyKey() },
    body: JSON.stringify(patch),
    signal: timeoutSignal(TIMEOUT_MS)
  })
  const body = await readEnvelope(res)
  if (res.status >= 200 && res.status < 300) {
    const a = coerceImprovementAction(body?.data ?? body)
    if (a) return a
    throw new Error('行动项更新成功但响应形态不符——请刷新核对')
  }
  throw new Error(typeof body?.msg === 'string' && body.msg ? body.msg : `行动项更新失败（HTTP ${res.status}）`)
}

// ── 案例库（#2047 near_miss 入案例库；服务端 case_no 生成 AL-YYYYMMDD-NNN） ───

export type CaseFeed =
  | { available: true; cases: CaseSummary[] }
  | ({ available: false } & Exclude<StoreFeed, { available: true }>)

export async function fetchCases(caseType?: string): Promise<CaseFeed> {
  const qs = caseType ? `?case_type=${encodeURIComponent(caseType)}` : ''
  try {
    const res = await fetch(`${BASE}/cases${qs}`, {
      method: 'GET',
      headers: identityHeaders(),
      signal: timeoutSignal(TIMEOUT_MS)
    })
    const body: unknown = res.status === 204 ? [] : await res.json().catch(() => null)
    const verdict = classifyStoreResponse(res.status, body)
    if (!verdict.available) return verdict
    const rows = extractRows(body) ?? []
    const cases = rows.map(coerceCase).filter((c): c is CaseSummary => c !== null)
    return { available: true, cases }
  } catch {
    return { available: false, reason: 'unreachable' }
  }
}

export type CaseDraft = {
  caseType: 'decision' | 'risk' | 'deviation'
  title: string
  background: string
  conclusion: string
  lessons: string
  applicableScene?: string | null
  visibility?: 'public' | 'internal'
  sourceInstanceId?: number | null
}

export async function registerCase(draft: CaseDraft): Promise<CaseSummary> {
  const res = await fetch(`${BASE}/cases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders(), 'idempotency-key': newIdempotencyKey() },
    body: JSON.stringify(draft),
    signal: timeoutSignal(TIMEOUT_MS)
  })
  const body = await readEnvelope(res)
  if (res.status >= 200 && res.status < 300) {
    const c = coerceCase(body?.data ?? body)
    if (c) return c
    throw new Error('案例登记成功但响应形态不符——请到案例库核对，不重复提交')
  }
  throw new Error(typeof body?.msg === 'string' && body.msg ? body.msg : `案例登记失败（HTTP ${res.status}）`)
}
