// 决策日志服务端通道 · 传输层（Epic #2033 · M1 · #2037 前端切换）
// ---------------------------------------------------------------------------
// 经 Python agent 薄代理（/agent-api/agent/review/decision-logs）到 Node BFF
// （/api/v1/review/decision-logs，权威存储）。契约见 docs/review-system/review-system-design.md §3.3：
//   GET  /decision-logs            → {code:200, data: entries[]}
//   GET  /decision-logs/verify     → {code:200, data: {engine, verdict, hitRate, coverage?}}
//   POST /decision-logs            → {code:200, data: entry}（author 由会话强制，不可代签）
//   POST /decision-logs/{id}/backfill → {code:200, data: entry}（actual/lesson 不参与哈希）
// 错误信封 {code, msg}：写入路径直接抛 Error(msg)——审计台账宁可报错重试，不静默降级。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'
import type { DecisionLogEntry } from 'shared/trading-rules/decision-log.mjs'
import {
  classifyDecisionLogError,
  classifyDecisionLogResponse,
  coerceEntry,
  coerceVerdict,
  type ChainVerdictView,
  type DecisionLogFeed
} from './decisionLogApi'

const BASE = `${AGENT_API_BASE}/review/decision-logs`
const TIMEOUT_MS = 8000

/** 幂等键：crypto.randomUUID 需安全上下文，现场 http 部署没有——降级到时间戳+随机数。 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export type DecisionLogFilters = {
  /** 按标的日过滤（coverageOf 同口径） */
  targetDate?: string
}

export async function fetchDecisionLogFeed(filters: DecisionLogFilters = {}): Promise<DecisionLogFeed> {
  const qs = filters.targetDate ? `?target_date=${encodeURIComponent(filters.targetDate)}` : ''
  let feed: DecisionLogFeed
  try {
    const res = await fetch(`${BASE}${qs}`, {
      method: 'GET',
      headers: identityHeaders(),
      signal: timeoutSignal(TIMEOUT_MS)
    })
    const body: unknown = res.status === 204 ? [] : await res.json().catch(() => null)
    feed = classifyDecisionLogResponse(res.status, body)
  } catch (e) {
    feed = classifyDecisionLogError(e)
  }
  return feed
}

/** 服务端链校验结论（SHA-256，权威）。不可用返回 null——页面如实提示，不拿前端 FNV 冒充。 */
export async function fetchChainVerdict(): Promise<ChainVerdictView | null> {
  try {
    const res = await fetch(`${BASE}/verify`, {
      method: 'GET',
      headers: identityHeaders(),
      signal: timeoutSignal(TIMEOUT_MS)
    })
    if (res.status !== 200) return null
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return coerceVerdict(body?.data ?? body)
  } catch {
    return null
  }
}

async function readEntry(res: Response, fallbackMsg: string): Promise<DecisionLogEntry> {
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (res.status >= 200 && res.status < 300) {
    const entry = coerceEntry(body?.data ?? body)
    if (entry) return entry
    throw new Error(`${fallbackMsg}成功但响应形态不符（#2037 契约）——请重试并反馈`)
  }
  const msg = typeof body?.msg === 'string' && body.msg ? body.msg : `${fallbackMsg}失败（HTTP ${res.status}）`
  throw new Error(msg)
}

/** 追加一条（服务端算 SHA-256 并接链）。draft 不带 author——服务端按会话身份落名。 */
export async function postDecisionLog(
  draft: Record<string, unknown> & { correctionOf?: string | null }
): Promise<DecisionLogEntry> {
  const res = await fetch(`${BASE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders(), 'idempotency-key': newIdempotencyKey() },
    body: JSON.stringify(draft),
    signal: timeoutSignal(TIMEOUT_MS)
  })
  return readEntry(res, '决策日志写入')
}

/** T+2 回填实际结果（actual/lesson 不参与哈希，不破坏链）。 */
export async function postBackfill(entryId: string, patch: { actual?: number; lesson?: string }): Promise<DecisionLogEntry> {
  const res = await fetch(`${BASE}/${encodeURIComponent(entryId)}/backfill`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders(), 'idempotency-key': newIdempotencyKey() },
    body: JSON.stringify(patch),
    signal: timeoutSignal(TIMEOUT_MS)
  })
  return readEntry(res, '决策日志回填')
}
