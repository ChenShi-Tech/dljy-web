// 命名分析视图客户端（dljy-meta#18 / P2 #60）。
//
// 复用既有 /api/v1/analysis/views（analysis-store，DataScope 鉴权 + 幂等）。把 text2sql/dashboard
// 产出的 AnalysisChartSpec / AnalysisDashboard + SQL + 原问题存为命名视图，供 data-browser/ai-agent
// 检索与再打开。刷新语义：保存的是 spec + SQL + 问题；重开渲染快照，「刷新」经再次向 agent 提问重跑。

import { apiGet, apiPost } from '../api'
import type { AnalysisViewChartConfig, AnalysisViewDashboardConfig } from '@dljy/contracts'

const VIEWS_PATH = '/v1/analysis/views'
export const ANALYSIS_VIEW_ROUTE = '/ai-agent'

export type AnalysisViewConfig = AnalysisViewChartConfig | AnalysisViewDashboardConfig

export type SavedAnalysisView = {
  viewId: string
  name: string
  routePath: string
  config: AnalysisViewConfig
  createdAt?: string
  updatedAt?: string
}

function newIdempotencyKey(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `av-${Date.now().toString(36)}-${rand}`
}

/** 保存一个命名分析视图（图表或仪表盘）。 */
export async function saveAnalysisView(
  name: string,
  config: AnalysisViewConfig,
  routePath: string = ANALYSIS_VIEW_ROUTE,
): Promise<SavedAnalysisView> {
  const res = await apiPost<{ view: SavedAnalysisView }>(
    VIEWS_PATH,
    { name, routePath, config: { ...config, savedAt: config.savedAt ?? new Date().toISOString() } },
    { headers: { 'idempotency-key': newIdempotencyKey() } },
  )
  return (res as { view?: SavedAnalysisView; data?: SavedAnalysisView }).view
    ?? (res as { data?: SavedAnalysisView }).data as SavedAnalysisView
}

/** 列出命名分析视图（按 routePath，默认 /ai-agent）。 */
export async function listAnalysisViews(routePath: string = ANALYSIS_VIEW_ROUTE): Promise<SavedAnalysisView[]> {
  // 服务端标准形状是 { code, data: { rows, total } }（server/analysis-api.mjs::envelope），
  // 兼容顶层 rows / data 直接为数组的历史形状（codex P1 3635805735）。
  const res = await apiGet<{ rows?: SavedAnalysisView[]; data?: { rows?: SavedAnalysisView[] } | SavedAnalysisView[] }>(VIEWS_PATH, { routePath })
  const nested = (res as { data?: { rows?: SavedAnalysisView[] } | SavedAnalysisView[] }).data
  const rows = (res as { rows?: SavedAnalysisView[] }).rows
    ?? (Array.isArray(nested) ? nested : nested?.rows)
    ?? []
  return Array.isArray(rows) ? rows : []
}
