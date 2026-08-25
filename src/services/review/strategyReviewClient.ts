// 策略复盘 · 传输层（Epic #2033 · S1 六维「维度二·策略」· #2016）
// ---------------------------------------------------------------------------
// 消费 #2045 已上线的 trading-memory 端点（经 agent 薄代理 → Node BFF）：
//   GET /review/trading-memory/stats —— 按策略分组 Beta-Binomial 后验 +
//     样本 <30 硬门禁（winRate=null + winRateConclusion='样本不足'）
//   GET /review/trading-memory       —— 逐笔结果行（连败 streak 前端自算）
// 读路径探针降级（endpoint-absent 时空态+提示，不合成假胜率）。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'
import { classifyStoreResponse, extractRows } from './reviewStoreApi'

const BASE = `${AGENT_API_BASE}/review`
const TIMEOUT_MS = 8000

export type StrategyWinStat = {
  strategyName: string
  wins: number
  losses: number
  sampleSize: number
  posteriorWinRate: number
  /** 服务端样本门禁后的胜率（<30 笔为 null——不呈现不稳口径） */
  winRate: number | null
  winRateConclusion: string | null
  cumulativePnlWan: number | null
}

export type MemoryOutcomeRow = {
  id: string
  strategyName: string
  date: string
  win: boolean
  realizedPnlWan: number | null
}

export type StrategyStatsFeed =
  | { available: true; stats: StrategyWinStat[] }
  | ({ available: false } & { reason: 'endpoint-absent' | 'unauthorized' | 'unreachable' })

function coerceWinStat(row: unknown): StrategyWinStat | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const strategyName = typeof r.strategyName === 'string' ? r.strategyName : typeof r.strategy_name === 'string' ? r.strategy_name : null
  if (!strategyName) return null
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    strategyName,
    wins: num(r.wins) ?? 0,
    losses: num(r.losses) ?? 0,
    sampleSize: num(r.sampleSize) ?? 0,
    posteriorWinRate: num(r.posteriorWinRate) ?? 0,
    winRate: num(r.winRate),
    winRateConclusion: typeof r.winRateConclusion === 'string' ? r.winRateConclusion : null,
    cumulativePnlWan: num(r.cumulativePnlWan),
  }
}

/** stats 端点信封是 {strategies:[…]}（非裸数组），单独取一层。 */
function extractStrategyRows(body: unknown): unknown[] | null {
  if (body && typeof body === 'object') {
    const data = (body as Record<string, unknown>).data
    if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).strategies)) {
      return (data as Record<string, unknown>).strategies as unknown[]
    }
    if (Array.isArray(data)) return data
  }
  return extractRows(body)
}

export async function fetchStrategyStats(): Promise<StrategyStatsFeed> {
  try {
    const res = await fetch(`${BASE}/trading-memory/stats`, {
      method: 'GET',
      headers: identityHeaders(),
      signal: timeoutSignal(TIMEOUT_MS)
    })
    const body: unknown = await res.json().catch(() => null)
    // stats 信封是 {data:{strategies:[…]}}（data 非数组），classifyStoreResponse 不认——
    // 状态码分类沿用其口径，载荷判定改看 extractStrategyRows。
    if (res.status === 404 || res.status === 405) return { available: false, reason: 'endpoint-absent' }
    if (res.status === 401 || res.status === 403) return { available: false, reason: 'unauthorized' }
    if (!(res.status >= 200 && res.status < 300)) return { available: false, reason: 'unreachable' }
    const rows = extractStrategyRows(body)
    if (!rows) return { available: false, reason: 'endpoint-absent' }
    const stats = rows.map(coerceWinStat).filter((s): s is StrategyWinStat => s !== null)
    return { available: true, stats }
  } catch {
    return { available: false, reason: 'unreachable' }
  }
}

function coerceOutcomeRow(row: unknown): MemoryOutcomeRow | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = typeof r.id === 'number' ? String(r.id) : typeof r.id === 'string' ? r.id : null
  const strategyName = typeof r.strategyName === 'string' ? r.strategyName : typeof r.strategy_name === 'string' ? r.strategy_name : null
  const date = typeof r.date === 'string' ? r.date : null
  if (!id || !strategyName || !date) return null
  const pnl = r.realizedPnlWan ?? r.realized_pnl_wan
  const n = pnl == null ? null : Number(pnl)
  return {
    id,
    strategyName,
    date,
    win: r.win === true,
    realizedPnlWan: n != null && Number.isFinite(n) ? n : null,
  }
}

export type MemoryOutcomesFeed =
  | { available: true; outcomes: MemoryOutcomeRow[] }
  | ({ available: false } & { reason: 'endpoint-absent' | 'unauthorized' | 'unreachable' })

export async function fetchMemoryOutcomes(): Promise<MemoryOutcomesFeed> {
  try {
    const res = await fetch(`${BASE}/trading-memory`, {
      method: 'GET',
      headers: identityHeaders(),
      signal: timeoutSignal(TIMEOUT_MS)
    })
    const body: unknown = res.status === 204 ? [] : await res.json().catch(() => null)
    const verdict = classifyStoreResponse(res.status, body)
    if (!verdict.available) return verdict
    const rows = extractRows(body) ?? []
    const outcomes = rows.map(coerceOutcomeRow).filter((o): o is MemoryOutcomeRow => o !== null)
    return { available: true, outcomes }
  } catch {
    return { available: false, reason: 'unreachable' }
  }
}
