// 仪表盘业务装配（原 business.ts 拆出，Epic #744 A4）。
// 服务 DashboardView.vue（/dashboard 工作台）+ AppLayout.vue 顶栏公告。
// 薄 API 门面：走 api.ts 统一信封 + 地区头；决策简报/决策支持执行等类型为 Mock 契约形状，
// 真实实现在 server domains/business-mock/analysis.mjs（默认 demo-only）。

import { apiGet, apiPost } from '@/services/api'

export type MetricCard = {
  label: string
  value: string
  unit: string
  trend: string
  tone: string
}

export type Notice = {
  id: number
  level: string
  title: string
  time: string
}

export type DecisionBriefPriority = 'high' | 'medium' | 'low'

export type DecisionBriefAction = {
  id: string
  priority: DecisionBriefPriority
  owner: string
  action: string
  window: string
  trigger: string
  targetApiFamilies: string[]
  nextStep: string
}

export type DecisionBriefEvidence = {
  id: string
  label: string
  family: string
  metric: string
  confidence: number
  localApi: string
}

export type DecisionBriefBlocker = {
  id: string
  label: string
  status: string
  detail: string
}

export type DecisionBrief = {
  id: string
  generatedAt: string
  area: string
  horizon: string
  status: string
  riskLevel: 'low' | 'medium' | 'high' | string
  summary: string
  primaryRecommendation: string
  expectedImpact: {
    marginYuan: number
    deviationFeeYuan: number
    riskScoreDelta: number
  }
  recommendedActions: DecisionBriefAction[]
  evidence: DecisionBriefEvidence[]
  blockers: DecisionBriefBlocker[]
  sourceApiFamilies: string[]
  nextReviewAt: string
}

export type DecisionSupportAction = DecisionBriefAction & {
  status: string
  decisionGate: string
  acceptanceMetric: string
  linkedEvidenceIds: string[]
}

export type DecisionSupportEvidence = {
  id: string
  layer: string
  label: string
  sourceFamily: string
  localApi: string
  signal: string
  decisionUse: string
}

export type DecisionSupportLinkedExecution = {
  id: string
  sourceActionId: string
  title: string
  executionFamily: string
  executionAction: string
  status: string
  generatedAt: string
  sourceRecordLabel: string
  summary: string
  localApi: string
  localRoute: string
  reviewNote: string
  metrics: string[]
}

export type DecisionSupportExecutionPlan = {
  id: string
  actionId: string
  owner: string
  priority: DecisionBriefPriority
  objective: string
  status: string
  runWindow: string
  plannedPositionMwh: number
  triggerConditions: string[]
  executionSteps: string[]
  localApis: string[]
  sourceFamilies: string[]
  expectedOutput: string
  stopLossRule: string
  reviewGate: string
  privateCacheDependencies: string[]
  gitPolicy: string
}

export type DecisionSupportReview = {
  id: string
  actionId: string
  stage: string
  reviewer: string
  reviewedAt: string
  status: string
  conclusion: string
  metricBefore: string
  metricAfter: string
  settlementImpactYuan: number
  nextAction: string
}

export type DecisionSupportExecutionResponse = {
  documentType: 'decision-support-execution'
  contractVersion: string
  generatedAt: string
  area: string
  horizon: string
  action: DecisionSupportAction | null
  linkedExecutions: DecisionSupportLinkedExecution[]
  executionPlans: DecisionSupportExecutionPlan[]
  evidence: DecisionSupportEvidence[]
  dataReadiness: Array<{
    family: string
    label: string
    runtimeStatus: string
    staticFallback: boolean
    nextAction: string
  }>
  reviews: DecisionSupportReview[]
  statusSummary: {
    executionStatus: string
    staticExecutableCount: number
    pendingRuntimeCount: number
    blockedReviewCount: number
    manualGate: string
  }
  nextRoutes: string[]
  validationChecks: Array<{
    key: string
    label: string
    result: 'pass' | 'warn' | 'block'
    detail: string
  }>
  gitPolicy: string
}

export type DataOperation = {
  kind: 'import' | 'export' | 'template' | 'download'
  label: string
  path: string
  fileTypes: string[]
  family: string
  sourceTypes: string[]
  sourceFiles: string[]
}

export type MarketRow = {
  id: string
  date: string
  module: string
  product: string
  area: string
  volume: number
  price: number
  status: string
  deviation: number
  apiFamily: string
}

export type DashboardPayload = {
  cards: MetricCard[]
  marketRows: MarketRow[]
  notices: Notice[]
  operations: DataOperation[]
  decisionBrief: DecisionBrief
  summary: {
    apiFamilies: string[]
    restoredAt: string
  }
}

export type DashboardExecutionRequest = {
  actionId?: string
  blockerId?: string
}

export type DashboardExecutionResponse = {
  documentType: 'dashboard-execution'
  contractVersion: string
  generatedAt: string
  briefId: string
  area: string
  horizon: string
  action: DecisionBriefAction | null
  blocker: DecisionBriefBlocker | null
  decisionSupportExecution: DecisionSupportExecutionResponse | null
  blockerPlan: {
    owner: string
    status: string
    nextRoutes: string[]
    nextSteps: string[]
  } | null
  nextRoutes: string[]
  validationChecks: Array<{
    key: string
    label: string
    result: 'pass' | 'warn' | 'block'
    detail: string
  }>
  executionSummary: {
    status: string
    message: string
  }
  gitPolicy: string
}

// 透出 provenance 而非只回 data：顶栏公告目前由内存常量供数（provenance.sourceType='MOCK'），
// 调用方据此显示「模拟数据」提示。接真实数据源后 sourceType 变化，提示自动消失——
// 判据来自服务端标注，不在前端硬编码「这里是假的」。
export async function getDashboard() {
  const payload = await apiGet<DashboardPayload>('/dashboard')
  return { ...payload.data!, provenance: payload.provenance }
}

export async function runDashboardExecution(request: DashboardExecutionRequest) {
  const payload = await apiPost<DashboardExecutionResponse>('/dashboard/execute', request)
  return payload.data!
}
