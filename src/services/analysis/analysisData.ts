// 分析序列业务装配（原 business.ts 拆出，Epic #744 A4）。
// 服务 AnalysisView.vue（/analysis 负荷·电价·风险序列）。区别于 analysisClient.ts
// （那是 /api/v1/analysis/* 数据分析用户产物 CRUD）；本文件对接 /analysis/series|export|execute。
// 薄 API 门面：走 api.ts 统一信封 + 地区头。

import { apiGet, apiPost } from '@/services/api'

export type RuntimeContract = {
  action: string
  operationKind: 'import' | 'export' | 'template' | 'download' | 'search'
  productionRoute: string
  path: string
  method: string
  requestContentType: string | null
  queryKeys: string[]
  bodyKeys: string[]
  formFields: string[]
  downloadSelectionKeys?: string[]
  knownEmptyFields: string[]
  responseContentType: string | null
  responseDisposition: string | null
  fileExtension: string | null
  exportFileNameRule?: string | null
  archiveFileNameRule?: string | null
  captureStatus: string
  missingMetadataFields: string[]
}

export type AnalysisMetric = {
  label: string
  value: number
  unit: string
  level: 'low' | 'medium' | 'high'
  apiFamily: string
}

export type AnalysisTarget = 'load' | 'price' | 'risk'

export type AnalysisSeries = {
  documentType?: 'analysis-series' | string
  target: AnalysisTarget
  area: string
  date: string
  hours: string[]
  values: number[]
  metrics: AnalysisMetric[]
  productionRoute?: string
  sourceApi?: string
  operationFamily?: string
  analysisFamily?: string
  selectorApis?: string[]
  requestMethod?: string
  requestContentType?: string | null
  queryKeys?: string[]
  bodyKeys?: string[]
  runtimeContracts?: RuntimeContract[]
}

export type AnalysisExportRequest = {
  target: AnalysisTarget
  area?: string
  date?: string
}

export type AnalysisExportResponse = {
  documentType: 'analysis-export'
  contractVersion: string
  generatedAt: string
  target: AnalysisTarget
  operationFamily: string
  localRoute: string
  productionRoute: string
  runtimeStatus: string
  request: {
    method: string
    path: string
    bodyKeys: string[]
    filters: Record<string, string>
  }
  file: {
    fileName: string
    fileExtension: string
    responseContentType: string
    responseDisposition: string
    exportFileNameRule: string
  }
  preview: {
    rowCount: number
    rows: Array<Record<string, string | number>>
  }
  gitPolicy: string
}

export type AnalysisExecutionRequest = {
  target: AnalysisTarget
  area?: string
  date?: string
}

export type AnalysisExecutionResponse = {
  documentType: 'analysis-execution'
  contractVersion: string
  action: 'review-analysis-series'
  generatedAt: string
  target: AnalysisTarget
  operationFamily: string
  analysisFamily: string
  localRoute: string
  productionRoute: string
  runtimeStatus: string
  sourceDocumentLabel: string
  request: {
    localApi: string
    method: string
    payloadKeys: string[]
  }
  summary: {
    peakHour: string
    peakValue: number
    valleyHour: string
    valleyValue: number
    averageValue: number
    volatility: number
    valueUnit: string
    topMetricLabel: string
    topMetricValue: number
    topMetricUnit: string
    topMetricLevel: 'low' | 'medium' | 'high'
    suggestedAction: string
    nextRoute: string
  }
  validationChecks: Array<{
    key: string
    label: string
    result: 'pass' | 'warn' | 'block'
    detail: string
  }>
  downstreamSuggestions: string[]
  executionSummary: {
    status: string
    message: string
  }
  gitPolicy: string
}

export async function getAnalysisSeries(params: { target: AnalysisTarget; area?: string; date?: string }) {
  const payload = await apiGet<AnalysisSeries>('/analysis/series', params)
  return payload.data!
}

export async function exportAnalysisSeries(request: AnalysisExportRequest) {
  const payload = await apiPost<AnalysisExportResponse>('/analysis/export', request)
  return payload.data!
}

export async function runAnalysisExecution(request: AnalysisExecutionRequest) {
  const payload = await apiPost<AnalysisExecutionResponse>('/analysis/execute', request)
  return payload.data!
}
