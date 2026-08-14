// AI 辅助建议留痕与回溯（#1969）—— localStorage 原型态存储（与决策日志同款警示）
//
// 审计价值：写回单据时区分「哪些字段是 AI 建议后采纳的、哪些是人自己填的」；
// 回溯价值：建议 vs 实际结果的偏差可统计（该不该信它）。decision_log 类建议的
// 命中可与决策日志 T+2 回填的实际值对上；其它 kind 的实际值无系统来源时
// 如实显示「无实际值来源」。
export type AssistTraceEntry = {
  id: string
  at: string
  targetDate: string
  kind: string
  /** 建议值快照（仅被展示/采纳的字段） */
  suggestion: Record<string, unknown>
  basis: Record<string, string>
  confidence: number
  /** 用户点了「采纳填入」为 true；仅查看未采纳为 false */
  adopted: boolean
  adoptedFields: string[]
  /** 关联决策日志条目（decision_log 类建议被写入链后回填 id，供命中比对） */
  decisionLogId?: string | null
  /** T+2 回填的实际值（decision_log 类，经 S7 决策日志回填同步） */
  actual?: number | null
}

const KEY = 'dljy.assist-trace.v1'
const PROTOTYPE_NOTICE = 'AI 建议留痕为浏览器本地存储（原型态）——换机器不可见，服务端化随决策日志 #2037 一并处理'

function readAll(): AssistTraceEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as AssistTraceEntry[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(entries: AssistTraceEntry[]) {
  window.localStorage.setItem(KEY, JSON.stringify(entries.slice(-500)))
}

export function listAssistTrace(targetDate?: string): AssistTraceEntry[] {
  const all = readAll()
  return targetDate ? all.filter((e) => e.targetDate === targetDate) : all
}

export function recordAssistSuggestion(entry: Omit<AssistTraceEntry, 'id' | 'adopted' | 'adoptedFields'>): string {
  const id = `at-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const full: AssistTraceEntry = { ...entry, id, adopted: false, adoptedFields: [] }
  writeAll([...readAll(), full])
  return id
}

export function markAssistAdopted(id: string, fields: string[]) {
  writeAll(readAll().map((e) => (e.id === id ? { ...e, adopted: true, adoptedFields: fields } : e)))
}

export function linkAssistToDecision(id: string, decisionLogId: string) {
  writeAll(readAll().map((e) => (e.id === id ? { ...e, decisionLogId } : e)))
}

export function backfillAssistActual(id: string, actual: number) {
  writeAll(readAll().map((e) => (e.id === id ? { ...e, actual } : e)))
}

/** decision_log 类建议命中判断：实际值落在建议 P10–P90 内为命中（与决策日志同口径）。 */
export function assistHitOf(entry: AssistTraceEntry): boolean | null {
  if (entry.actual === null || entry.actual === undefined) return null
  const p10 = Number(entry.suggestion.p10)
  const p90 = Number(entry.suggestion.p90)
  if (!Number.isFinite(p10) || !Number.isFinite(p90)) return null
  return entry.actual >= p10 && entry.actual <= p90
}

export const ASSIST_TRACE_NOTICE = PROTOTYPE_NOTICE
