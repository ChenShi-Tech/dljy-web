// S1 昨日复盘摘要 · 纯逻辑（trading-day-morning-summary-and-lazy-stages 任务 1.2）
// ---------------------------------------------------------------------------
// 字段核对注记（任务 1.1 只读取样，展示字段必须能在此指认出处）：
// - 措施行 = ImprovementActionSummary { id, action, owner（负责人）, dueDate（回查日）,
//   status: 'open'|'done'|'dropped'|'carried_over', updatedAt }
//   —— reviewStoreApi.ts::coerceImprovementAction 逐字段判型，无猜测字段。
// - 取数 = fetchCarryOverActions()：open + carried_over 两查合并后经 isOpenForCarry
//   过滤的未闭环清单（reviewStoreClient.ts:157-163）；传输不在此文件——本模块保持纯逻辑
//   可进 vitest node 环境（分层惯例同 reviewStoreApi / reviewStoreClient）。
// - 不可用判型来自 classifyStoreResponse：endpoint-absent(404/405) / unauthorized(401/403)
//   / unreachable；映射到摘要四态时按「诚实口径」收敛（design 决策 6）：
//   endpoint-absent 与 unreachable 都归 unavailable（读取失败），不冒充空产物。
// - loop-snapshot 不作摘要源：平台级端点仅平台超管 ADMIN 可读（dljy review-api.mjs:15，
//   #2760），业务受众恒 403；昨夜报告由 OvernightReportCard、风险事件由 MorningRiskPanel
//   各自承载，摘要块不重复取数。
import { isOpenForCarry, type ImprovementActionSummary } from '@/services/review/reviewStoreApi'

/** 摘要四态（spec「摘要数据源三态诚实显示」：unauthorized / unavailable / empty + ok） */
export type MorningSummaryState =
  | { kind: 'ok'; actions: MorningSummaryAction[] }
  | { kind: 'empty' }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' }

export type MorningSummaryAction = ImprovementActionSummary & { overdue: boolean }

/** 摘要 scope 键：任一维度变化都视为新上下文，旧响应不得回写（spec 竞态场景） */
export function morningSummaryScopeKey(scope: {
  companyId: string
  region: string
  targetDate: string
}): string {
  return `${scope.companyId}\n${scope.region}\n${scope.targetDate}`
}

/** 回查日已过且仍未闭环 = 过期未验证（无回查日不算过期，不推算） */
export function isOverdueAction(action: ImprovementActionSummary, todayIso: string): boolean {
  if (!isOpenForCarry(action)) return false
  if (!action.dueDate) return false
  return action.dueDate < todayIso
}

/**
 * 措施排序：过期未验证置顶（spec），其余按回查日升序、无回查日垫后；同序保持原
 * 相对顺序（稳定），不发明新的优先级。
 */
export function orderActions(
  actions: ImprovementActionSummary[],
  todayIso: string
): MorningSummaryAction[] {
  const decorated = actions.map((action) => ({ ...action, overdue: isOverdueAction(action, todayIso) }))
  const rank = (a: MorningSummaryAction): number => {
    if (a.overdue) return 0
    if (a.dueDate) return 1
    return 2
  }
  return decorated
    .map((action, index) => ({ action, index }))
    .sort((x, y) => {
      const rx = rank(x.action)
      const ry = rank(y.action)
      if (rx !== ry) return rx - ry
      if (rx === 1 && x.action.dueDate !== y.action.dueDate) {
        return (x.action.dueDate ?? '') < (y.action.dueDate ?? '') ? -1 : 1
      }
      return x.index - y.index
    })
    .map(({ action }) => action)
}

/** 服务端响应 → 摘要四态。endpoint-absent/unreachable 同归 unavailable（决策 6：不把失败当空产物） */
export function toMorningSummaryState(feed: {
  available: boolean
  reason?: 'endpoint-absent' | 'unauthorized' | 'unreachable'
  actions?: ImprovementActionSummary[]
}, todayIso: string): MorningSummaryState {
  if (!feed.available) {
    return feed.reason === 'unauthorized' ? { kind: 'unauthorized' } : { kind: 'unavailable' }
  }
  const ordered = orderActions(feed.actions ?? [], todayIso)
  return ordered.length ? { kind: 'ok', actions: ordered } : { kind: 'empty' }
}
