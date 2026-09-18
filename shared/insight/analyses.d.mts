// 市场洞察分析目录类型（#2993）。
export type InsightEndpoint = { method: 'GET' | 'POST'; path: string }
export declare const INSIGHT_ENDPOINTS: Readonly<{ capabilities: InsightEndpoint; coverage: InsightEndpoint; query: InsightEndpoint }>
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
}
export declare function resolutionFilter(value: unknown): 15 | 60 | 1440
export declare function objectIdsFilter(max: number): (value: unknown) => readonly string[]
export declare const INSIGHT_ANALYSES: readonly InsightAnalysis[]
export declare function getInsightAnalysis(analysisId: string): InsightAnalysis | null
export declare function listInsightAnalyses(regionId: string): InsightAnalysis[]
export declare const insightCatalog: { getAnalysis: (analysisId: string) => InsightAnalysis | null }
