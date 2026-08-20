// 决策日志服务端数据面 · 纯逻辑（Epic #2033 · M1 · #2037 前端切换）
// ---------------------------------------------------------------------------
// #2037 服务端化后决策日志有两条通道：
//   · 服务端台账（/agent-api/agent/review/decision-logs → Node BFF）：追加写落库 +
//     服务端 SHA-256 哈希链，链校验结论由服务端 /verify 端点给出（前端不重算——
//     浏览器端没有 node:crypto，而 WebCrypto 非安全上下文不可用，重算只会时灵时不灵）；
//   · 浏览器原型（decisionLogStore 的 localStorage 实现）：端点未部署时的诚实降级。
//
// 本模块收拢「可测的纯逻辑」（沿用 templateInstanceApi.ts 惯例）：响应分类、
// 服务端行归一为共享 DecisionLogEntry、原型导入计划。传输层另见 decisionLogClient.ts。
import type {
  ChainVerdict,
  DecisionLogEntry
} from 'shared/trading-rules/decision-log.mjs'

/** 探针结果三态（语义对齐 templateInstanceApi 的 TemplateInstanceFeed） */
export type DecisionLogFeed =
  | { available: true; entries: DecisionLogEntry[] }
  | { available: false; reason: 'endpoint-absent' | 'unauthorized' | 'unreachable' }

/** /verify 端点的链校验结论视图（服务端权威，前端只展示不重算） */
export type ChainVerdictView = {
  engine: string
  verdict: ChainVerdict
}

/** 服务端行 → 共享 DecisionLogEntry。行形态不符返回 null（宁丢一行不误读全链）。 */
export function coerceEntry(row: unknown): DecisionLogEntry | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = typeof r.id === 'number' ? String(r.id) : typeof r.id === 'string' ? r.id : null
  if (!id) return null
  const targetDate = typeof r.targetDate === 'string' ? r.targetDate : typeof r.target_date === 'string' ? r.target_date : null
  const decisionPoint =
    typeof r.decisionPoint === 'string' ? r.decisionPoint : typeof r.decision_point === 'string' ? r.decision_point : null
  if (!targetDate || !decisionPoint) return null
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
    return Number.isFinite(n) ? n : null
  }
  const p10 = num(r.p10)
  const p50 = num(r.p50)
  const p90 = num(r.p90)
  const confidence = num(r.confidence)
  const prevHash = typeof r.prevHash === 'string' ? r.prevHash : typeof r.prev_hash === 'string' ? r.prev_hash : null
  const hash = typeof r.hash === 'string' ? r.hash : null
  // 参与哈希与校验的字段缺一不可；actual/lesson/author 允许空（回填前/旧数据）
  if (p10 === null || p50 === null || p90 === null || confidence === null || !prevHash || !hash) return null
  const actual = num(r.actual)
  return {
    id,
    seq: num(r.seq) ?? 0,
    at: typeof r.at === 'string' ? r.at : '',
    targetDate,
    decisionPoint,
    judgement: typeof r.judgement === 'string' ? r.judgement : '',
    rationale: typeof r.rationale === 'string' ? r.rationale : '',
    p10,
    p50,
    p90,
    confidence,
    author: typeof r.author === 'string' ? r.author : '',
    actual: actual === null ? null : actual,
    lesson: typeof r.lesson === 'string' ? r.lesson : null,
    correctionOf:
      r.correctionOf != null ? String(r.correctionOf) : r.correction_of != null ? String(r.correction_of) : null,
    prevHash,
    hash
  }
}

/** 从响应体提取条目。容忍三种信封：裸数组 / {data:[…]} / {entries:[…]}（同 templateInstanceApi）。 */
function extractEntries(body: unknown): DecisionLogEntry[] | null {
  const rows: unknown[] | null = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).data)
      ? ((body as Record<string, unknown>).data as unknown[])
      : body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).entries)
        ? ((body as Record<string, unknown>).entries as unknown[])
        : null
  if (!rows) return null
  const mapped = rows.map(coerceEntry).filter((x): x is DecisionLogEntry => x !== null)
  // 行存在但全部不合法 → 形态不符，按「端点不存在」降级（HTML 兜底页不当空链渲染）
  if (mapped.length === 0 && rows.length > 0) return null
  return mapped
}

export function classifyDecisionLogResponse(status: number, body: unknown): DecisionLogFeed {
  if (status === 404 || status === 405) return { available: false, reason: 'endpoint-absent' }
  if (status === 401 || status === 403) return { available: false, reason: 'unauthorized' }
  if (status >= 200 && status < 300) {
    const entries = extractEntries(body)
    return entries ? { available: true, entries } : { available: false, reason: 'endpoint-absent' }
  }
  return { available: false, reason: 'unreachable' }
}

/** 传输层 catch 用：网络异常与 HTTP 错误统一归 unreachable。 */
export function classifyDecisionLogError(_e: unknown): DecisionLogFeed {
  return { available: false, reason: 'unreachable' }
}

/** /verify 响应 data → 视图。形态不符返回 null（页面如实显示「校验服务不可用」）。 */
export function coerceVerdict(data: unknown): ChainVerdictView | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const v = d.verdict
  if (!v || typeof v !== 'object') return null
  const verdict = v as Record<string, unknown>
  if (typeof verdict.intact !== 'boolean') return null
  return {
    engine: typeof d.engine === 'string' ? d.engine : 'unknown',
    verdict: {
      intact: verdict.intact,
      brokenAtSeq: typeof verdict.brokenAtSeq === 'number' ? verdict.brokenAtSeq : null,
      reason: typeof verdict.reason === 'string' ? verdict.reason : null
    }
  }
}

/** 原型导入：本地一条 → 服务端追加计划。correctionOf 保留**本地 id**，执行期查映射换服务端 id。 */
export type ImportStep = {
  localId: string
  draft: {
    targetDate: string
    decisionPoint: string
    judgement: string
    rationale: string
    p10: number
    p50: number
    p90: number
    confidence: number
    correctionOf: string | null
  }
  /** 已回填过实际值的条目：追加后须补一次 backfill（actual/lesson 不参与哈希，可后补） */
  backfill: { actual: number; lesson: string | null } | null
}

/**
 * 把浏览器原型链转成服务端导入计划（按链序逐条）。
 * 注意：author 刻意不进 draft——服务端从会话身份落名（不可代签），导入者即责任人；
 * at 也不进（服务端以落链时间为决策时点，导入时间 ≠ 原判断时间，页面文案如实说明）。
 */
export function buildImportPlan(localLog: readonly DecisionLogEntry[]): ImportStep[] {
  return localLog.map((e) => ({
    localId: e.id,
    draft: {
      targetDate: e.targetDate,
      decisionPoint: e.decisionPoint,
      judgement: e.judgement,
      rationale: e.rationale,
      p10: e.p10,
      p50: e.p50,
      p90: e.p90,
      confidence: e.confidence,
      correctionOf: e.correctionOf
    },
    backfill: e.actual === null ? null : { actual: e.actual, lesson: e.lesson }
  }))
}
