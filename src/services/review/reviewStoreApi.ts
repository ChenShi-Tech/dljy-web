// 复盘事件库/改进措施数据面 · 纯逻辑（Epic #2033 · #2046/#2047/#2049 服务端接线）
// ---------------------------------------------------------------------------
// risk-events（#2047 模板九）与 improvement-actions（#2042/#2049 上期回查）的行
// 归一与响应分类。纯逻辑独立成文件（沿用 templateInstanceApi 惯例）：传输层模块
// 链触 window，进不了 vitest node 环境。
//
// #2047 红线在归一层兜底：near_miss（侥幸逃过）impactYuan 恒 null——服务端已拒，
// 前端再压一道，两道闸都过才渲染。

/** 风险事件摘要（对齐 review.risk_events 关键列；id 统一 string 出口） */
export type RiskEventSummary = {
  id: string
  eventTime: string
  eventType: string
  riskLevel: 'high' | 'medium' | 'low' | null
  impactYuan: number | null
  impactCaliber: string | null
  nearMiss: boolean
  disposal: string | null
  effective: boolean | null
  lessons: string | null
  extremeValue: number | null
  durationHours: number | null
  updatedAt: string | null
}

/** 改进措施摘要（对齐 review.improvement_actions；status 四态） */
export type ImprovementActionSummary = {
  id: string
  action: string
  owner: string | null
  dueDate: string | null
  status: 'open' | 'done' | 'dropped' | 'carried_over'
  updatedAt: string | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function coerceRiskEvent(row: unknown): RiskEventSummary | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = typeof r.id === 'number' ? String(r.id) : typeof r.id === 'string' ? r.id : null
  const eventTime = str(r.eventTime) ?? str(r.event_time)
  const eventType = str(r.eventType) ?? str(r.event_type)
  if (!id || !eventTime || !eventType) return null
  const level = str(r.riskLevel) ?? str(r.risk_level)
  const nearMiss = r.nearMiss === true || r.near_miss === true
  return {
    id,
    eventTime,
    eventType,
    riskLevel: level === 'high' || level === 'medium' || level === 'low' ? level : null,
    impactYuan: nearMiss ? null : numOrNull(r.impactYuan ?? r.impact_yuan),
    impactCaliber: nearMiss ? null : str(r.impactCaliber) ?? str(r.impact_caliber),
    nearMiss,
    disposal: str(r.disposal),
    effective: r.effective == null ? null : r.effective === true,
    lessons: str(r.lessons),
    extremeValue: numOrNull(r.extremeValue ?? r.extreme_value),
    durationHours: numOrNull(r.durationHours ?? r.duration_hours),
    updatedAt: str(r.updatedAt) ?? str(r.updated_at),
  }
}

/** 案例摘要（对齐 review.cases 关键列；#2047 near_miss 入案例库） */
export type CaseSummary = {
  id: string
  caseNo: string
  caseType: 'decision' | 'risk' | 'deviation'
  title: string
  visibility: 'public' | 'internal'
  lessons: string
  createdAt: string | null
}

export function coerceCase(row: unknown): CaseSummary | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = typeof r.id === 'number' ? String(r.id) : typeof r.id === 'string' ? r.id : null
  const caseNo = str(r.caseNo) ?? str(r.case_no)
  const caseType = str(r.caseType) ?? str(r.case_type)
  const title = str(r.title)
  const visibility = str(r.visibility)
  if (!id || !caseNo || !title) return null
  if (caseType !== 'decision' && caseType !== 'risk' && caseType !== 'deviation') return null
  return {
    id,
    caseNo,
    caseType,
    title,
    visibility: visibility === 'public' ? 'public' : 'internal',
    lessons: str(r.lessons) ?? '',
    createdAt: str(r.createdAt) ?? str(r.created_at),
  }
}

export function coerceImprovementAction(row: unknown): ImprovementActionSummary | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = typeof r.id === 'number' ? String(r.id) : typeof r.id === 'string' ? r.id : null
  const action = str(r.action)
  const status = str(r.status)
  if (!id || !action) return null
  if (status !== 'open' && status !== 'done' && status !== 'dropped' && status !== 'carried_over') return null
  return {
    id,
    action,
    owner: str(r.owner),
    dueDate: str(r.dueDate) ?? str(r.due_date),
    status,
    updatedAt: str(r.updatedAt) ?? str(r.updated_at),
  }
}

/** 提取 {data:[…]} / 裸数组信封里的行；形态不符返回 null（宁降级不误读）。 */
export function extractRows(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).data)) {
    return (body as Record<string, unknown>).data as unknown[]
  }
  return null
}

export type StoreFeed =
  | { available: true }
  | { available: false; reason: 'endpoint-absent' | 'unauthorized' | 'unreachable' }

/** 与 classifyInstanceResponse 同口径：404/405/HTML 兜底 → 端点未上线，诚实降级。 */
export function classifyStoreResponse(status: number, body: unknown): StoreFeed {
  if (status === 404 || status === 405) return { available: false, reason: 'endpoint-absent' }
  if (status === 401 || status === 403) return { available: false, reason: 'unauthorized' }
  if (status >= 200 && status < 300) {
    return extractRows(body) ? { available: true } : { available: false, reason: 'endpoint-absent' }
  }
  return { available: false, reason: 'unreachable' }
}

/**
 * #2049 验收断言：纪要「上期改进措施」自动带入项必须与 improvement_actions 的
 * 未闭环（open/carried_over）清单一致——带入行少一条、多一条或引到已闭环 id 都算
 * 违规。违规清单空数组 = 通过。
 */
export function broughtActionsViolations(
  brought: ReadonlyArray<{ actionId: string; action: string; status: ImprovementActionSummary['status'] }>,
  openActions: ReadonlyArray<ImprovementActionSummary>
): string[] {
  const openById = new Map(openActions.map((a) => [a.id, a]))
  const violations: string[] = []
  for (const b of brought) {
    const src = openById.get(b.actionId)
    if (!src) { violations.push(`带入项 ${b.actionId} 不在未闭环清单（或已闭环）`); continue }
    if (src.action !== b.action) violations.push(`带入项 ${b.actionId} 文本不一致（与服务端 action 不匹配）`)
    if (b.status !== src.status) violations.push(`带入项 ${b.actionId} 状态不一致（与服务端 status 不匹配）`)
  }
  const broughtIds = new Set(brought.map((b) => b.actionId))
  for (const a of openActions) {
    if (!broughtIds.has(a.id)) violations.push(`未闭环项 ${a.id}（${a.action.slice(0, 20)}…）未带入`)
  }
  return violations
}

/** 未闭环判定：open 与 carried_over 都要带上期纪要回查（dropped/done 不带）。 */
export function isOpenForCarry(a: ImprovementActionSummary): boolean {
  return a.status === 'open' || a.status === 'carried_over'
}
