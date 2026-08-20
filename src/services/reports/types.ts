// 报表引擎领域类型（原寄存在 src/services/fullSuite.ts，2026-07-01 拆出解耦）。
// 报表中心（reportEngine / templates / ReportCenterView）只依赖这些类型，
// 与「全功能闭环」(full-suite) 演示模块彻底脱钩，后者已于 #1642 全量下线。
import type { Provenance } from '@/services/api'

/**
 * 报表数据域范围。
 * 原为 `FullSuiteDomainPayload['dataScope']` 的索引访问，此处内联为独立类型，
 * 断开报表域对 full-suite 领域类型的依赖。
 */
export type ReportDataScope = {
  tenantId: string
  areaCode: string
  areaName: string
  subjectId: string
  subjectName: string
  subjectType: string
  ownerOrgId: string
  visibility: string
}

/** 报表参数面板 schema（Phase 0 引擎扩展，可选向后兼容）。 */
export type ReportParamSchema = {
  /** 时间维度 */
  time?: {
    granularity?: 'POINT_96' | 'POINT_24' | 'MIN_15' | 'DAY' | 'MONTH'
    mode?: 'date' | 'month' | 'range'
  }
  /** 是否按地区参数化 */
  region?: boolean
  /** 适用主体类型（GENERATOR / RETAILER / LOAD / STORAGE / GROUP / TRADER） */
  subjectTypes?: string[]
  /** 适用市场（中长期 / 日前 / 实时 / 辅助服务） */
  market?: string[]
}

export type ReportTemplate = {
  templateId: string
  templateName: string
  reportType: string
  version: string
  ownerRole: string
  dataScopePreset: string
  blockIds: string[]
  exportFormats: string[]
  approvalGate: string
  status: string
  updatedAt: string
  // 报表引擎扩展（Phase 0；均为可选，保持对既有 mock 的向后兼容）
  /** 业务域标签 A–H（如 'C-结算'） */
  domain?: string
  /** 优先级 */
  priority?: 'P0' | 'P1' | 'P2'
  /** 适用主体类型，空=全主体通用 */
  subjectTypes?: string[]
  /** 适用地区 id，空=全地区 */
  region?: string
  /** 参数面板 schema */
  paramSchema?: ReportParamSchema
  /** 数据溯源（生成实例时回填） */
  provenance?: Provenance
}

export type ReportBlock = {
  blockId: string
  blockName: string
  blockType: string
  sourceModules: string[]
  metrics: string[]
  refreshMode: string
  dataLayer: string
  status: string
}

export type ReportGenerationJob = {
  jobId: string
  templateId: string
  templateName: string
  period: string
  dataScope: string
  triggeredBy: string
  triggerMode: string
  progress: number
  durationMs: number
  status: string
  reviewer: string
  generatedAt: string
  traceId: string
}

export type ReportExportArtifact = {
  artifactId: string
  jobId: string
  fileName: string
  format: string
  fileSizeKb: number
  checksum: string
  downloadScope: string
  status: string
}

export type ReportArchiveRecord = {
  archiveId: string
  jobId: string
  archiveNo: string
  title: string
  period: string
  retentionPolicy: string
  reviewer: string
  publishedAt: string | null
  status: string
}

export type ReportReview = {
  reviewId: string
  reviewedAt: string
  conclusion: string
  qualityChecks: Array<{
    checkId: string
    name: string
    result: string
    detail: string
  }>
  nextActions: string[]
}

export type ReportsClosedLoop = {
  dataScope: ReportDataScope
  period: string
  summary: {
    templateCount: number
    enabledTemplateCount: number
    blockCount: number
    aiBlockCount: number
    generationJobCount: number
    completedJobCount: number
    pendingReviewCount: number
    exportArtifactCount: number
    publishedArtifactCount: number
    archiveCount: number
    archivedCount: number
    averageDurationMs: number
  }
  templates: ReportTemplate[]
  blocks: ReportBlock[]
  generationJobs: ReportGenerationJob[]
  exportArtifacts: ReportExportArtifact[]
  archives: ReportArchiveRecord[]
  review: ReportReview
  performanceBudget: {
    normalQueryMs: number
    complexQueryMs: number
    reportGenerationMs: number
    exportGenerationMs: number
    progressRequiredAfterMs: number
    currentMockLatencyMs: number
    optimizationHooks: string[]
  }
  governance: {
    templateGate: string
    aiTextGate: string
    exportGate: string
    bossReportGate: string
    auditRequiredActions: string[]
  }
}
