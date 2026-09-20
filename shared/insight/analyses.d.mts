// 市场洞察分析目录类型（#2993）。
export type InsightEndpoint = { method: 'GET' | 'POST'; path: string }
export declare const INSIGHT_ENDPOINTS: Readonly<{ capabilities: InsightEndpoint; coverage: InsightEndpoint; query: InsightEndpoint; researchPreview: InsightEndpoint; researchDefinitionList: InsightEndpoint; researchDefinitionSave: InsightEndpoint; researchDefinitionGet: InsightEndpoint; researchDefinitionRun: InsightEndpoint }>
export type InsightAnalysis = {
  analysisId: string
  version: string
  title: string
  pageIds: readonly string[]
  regionIds: readonly string[]
  sourceIds: readonly string[]
  access: 'public' | 'company'
  filters: Readonly<Record<string, (value: unknown) => unknown>>
  /** requiresObjects：必须先选对象才能查（节点价按省全量读取会远超观测上限） */
  limits: { maxDays: number; maxObjects: number; requiresObjects: boolean }
  /** 同一分析可给出的视图：series 明细、summary 统计、spread 日前实时价差、profile 多日切面、basis 节点基差（#3004） */
  views: readonly InsightView[]
  /** 视图族：同名视图（如 summary）在价格与供需下算法不同（#3005） */
  viewFamily: 'price' | 'supply' | 'overview' | 'grid' | 'records' | null
  /** 需要参考期读取的视图（同进度比较读前 days 天），参考期读取同样进读取版本集合 */
  reference?: { days: number; views: readonly InsightView[] }
}
export type InsightView = 'series' | 'summary' | 'spread' | 'profile' | 'basis' | 'forecast-error' | 'residual-proxy' | 'key-items' | 'limit-match' | 'records'
export declare function viewFilter(allowed: readonly InsightView[]): (value: unknown) => InsightView
export declare function referenceObjectFilter(value: unknown): string
export declare function resolutionFilter(value: unknown): 15 | 60 | 1440
export declare function objectIdsFilter(max: number): (value: unknown) => readonly string[]
export declare const INSIGHT_ANALYSES: readonly InsightAnalysis[]
export declare function getInsightAnalysis(analysisId: string): InsightAnalysis | null
export declare function listInsightAnalyses(regionId: string): InsightAnalysis[]
export declare const insightCatalog: { getAnalysis: (analysisId: string) => InsightAnalysis | null }
