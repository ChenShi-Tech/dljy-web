// 四川披露数据接入服务运维客户端（Issue #1621 / Epic #1618）。
// 对接 server/sichuan-ingest-api.mjs 转发层（前端不直连 Java 服务 8090）。
// 整页仅 ADMIN/BOSS：非管理员后端回 403，由视图层兜底提示。
//
// ⚠️ 字段命名坑（来自 Java AdminController）：
// - controller 手写顶层字段为驼峰：service/baseAddress/scheduleCron/credential/databaseAvailable/databaseError/menus
// - SQL 列透出字段为下划线（datasets.*/recentRuns[]/lastSuccess[]）：
//   records/latest_month/last_captured、run_id/menu_code/trigger_source/started_at/finished_at/
//   status/pages_fetched/records_fetched/records_new/failure_kind/failure_detail
// 同一响应两种风格混用，类型定义逐字保留，不做统一转换。
//
// 无 Mock 兜底：后端 502=服务不可达 / 503=库不可达部分响应 / 200=正常（含空数据诚实空态）。

import { apiGet, apiPost } from './api'

// ---- /admin/status 响应类型（严格对应 Java AdminController）----

// 凭据块：全是掩码或「(未设置)」，前端任何路径拿不到明文。
export type SichuanCredentialStatus = {
  configured: boolean
  missing: string // 逗号分隔缺项名；空串=齐全
  file: string
  accessTokenUri: string
  appIdMasked: string
  appSecretMasked: string
  sm4KeyMasked: string
  sm2PrivateKeyMasked: string
}

// 数据集统计：SQL 列名透出（下划线）。
export type SichuanDatasetSummary = {
  records: number | null
  latest_month: string | null
  last_captured: string | null
}

// 最近运行 / 最近成功：SQL 列名透出（下划线）。
export type SichuanIngestRunStatus = 'running' | 'success' | 'failed'

// 触发来源。'retry' 是 Issue #1622 引入的退避重试——一轮调度里可自愈的失败会隔一段时间
// 再采一次，每次尝试各留一行。分开记而不并进 'schedule'，运维才能区分
// 「调度跑了 3 轮」与「跑了 1 轮、重试了 2 次」：前者说明调度配错，后者说明退避在正常工作。
export type SichuanTriggerSource = 'schedule' | 'manual' | 'startup' | 'retry'

export type SichuanRecentRun = {
  run_id: number
  menu_code: string
  trigger_source: SichuanTriggerSource
  started_at: string
  finished_at: string | null
  status: SichuanIngestRunStatus
  pages_fetched: number
  records_fetched: number
  records_new: number
  failure_kind: SichuanFailureKind | null
  failure_detail: string | null
}

export type SichuanLastSuccess = {
  menu_code: string
  run_id: number
  finished_at: string
  records_fetched: number
  records_new: number
}

// menu 元数据：controller 手写（驼峰）。
export type SichuanMenuMeta = {
  code: string // 'scpx_001_01' | 'scpx_001_02'
  label: string // 中文标签
  path: string // 上游 API 路径
}

// failure_kind 枚举（Java FailureKind.getDbValue，小写下划线）。
export type SichuanFailureKind = 'credential' | 'network' | 'contract_drift' | 'server_error' | 'unknown'

// 连续失败告警（Issue #1622）。controller 手写（驼峰），时间为 ISO-8601 字符串。
//
// 口径是「自上次成功以来连续失败 N 次」，不是「最近 N 次里失败几次」——后者会把老失败
// 算进今天的告警，也会在昨天刚成功过的情况下继续报警。
export type SichuanAlertLevel = 'warning' | 'critical'

export type SichuanIngestAlert = {
  menuCode: string
  menuLabel: string
  level: SichuanAlertLevel
  consecutiveFailures: number
  since: string | null
  lastFailedAt: string | null
  lastFailureKind: SichuanFailureKind | null
  // 处置建议：同一 failure_kind 在告警条与运行明细里说的必须是同一件事。
  hint: string
}

// status 正常响应（200）。databaseAvailable 为 false 时（503）下列 datasets/recentRuns/lastSuccess/menus 缺失。
export type SichuanIngestStatus = {
  service: string
  baseAddress: string
  scheduleCron: string
  credential: SichuanCredentialStatus
  databaseAvailable: boolean
  databaseError?: string // 仅 503 时出现
  datasets?: {
    loadForecast?: SichuanDatasetSummary
    reservoirPlan?: SichuanDatasetSummary
  }
  recentRuns?: SichuanRecentRun[]
  lastSuccess?: SichuanLastSuccess[]
  menus?: SichuanMenuMeta[]
  // 告警（Issue #1622）。服务端在 200 响应里**总是**带这个键（无告警时为空数组）；
  // 键缺失只可能是旧版服务或 503 部分响应，两者含义都不是「一切正常」，
  // 故前端不得把 undefined 当成空数组渲染成绿色。
  alerts?: SichuanIngestAlert[]
  alertThreshold?: number
}

// ---- /admin/trigger 响应类型 ----
export type SichuanTriggerItemStatus = 'success' | 'failed' | 'skipped'

export type SichuanTriggerItem = {
  menuCode: string
  status: SichuanTriggerItemStatus
  runId: number | null // skipped 时为 null
  pages: number | null
  fetched: number | null
  inserted: number | null
  failureKind: SichuanFailureKind | null
  message: string | null
}

export type SichuanTriggerResult = {
  results: SichuanTriggerItem[]
}

// ---- /health 响应类型 ----
export type SichuanIngestHealth = {
  status: string // 'up'
  service: string // 'sichuan-ingest'
}

// ---- 客户端函数 ----
// service 层只做纯封装（不持有全局 ref）；页面自管 status/loading/error 态。

export async function fetchSichuanIngestStatus(): Promise<SichuanIngestStatus> {
  const envelope = await apiGet<SichuanIngestStatus>('/api/v1/sichuan-ingest')
  if (!envelope.data) throw new Error(envelope.msg || '四川接入服务状态为空')
  return envelope.data
}

export async function triggerSichuanIngest(menuCode?: string): Promise<SichuanTriggerResult> {
  // POST /api/v1/* 受网关幂等门：缺 Idempotency-Key → 428。apiPost 自动注入该头（见 api.ts）。
  const path = menuCode
    ? `/api/v1/sichuan-ingest/trigger?menuCode=${encodeURIComponent(menuCode)}`
    : '/api/v1/sichuan-ingest/trigger'
  const envelope = await apiPost<SichuanTriggerResult>(path, {})
  if (!envelope.data) throw new Error(envelope.msg || '四川接入服务触发无返回')
  return envelope.data
}

export async function fetchSichuanIngestHealth(): Promise<SichuanIngestHealth> {
  const envelope = await apiGet<SichuanIngestHealth>('/api/v1/sichuan-ingest/health')
  if (!envelope.data) throw new Error(envelope.msg || '四川接入服务健康检查为空')
  return envelope.data
}

// ---- UI 元数据：中文标签与状态色 ----
export const FAILURE_KIND_LABEL: Record<SichuanFailureKind, string> = {
  credential: '凭据失效',
  network: '平台不可达',
  contract_drift: '契约漂移',
  server_error: '服务端错误',
  unknown: '未知',
}

export const FAILURE_KIND_TAG_TYPE: Record<SichuanFailureKind, 'danger' | 'warning' | 'info'> = {
  credential: 'danger',
  network: 'warning',
  contract_drift: 'warning',
  server_error: 'danger',
  unknown: 'info',
}

export const RUN_STATUS_TAG_TYPE: Record<SichuanIngestRunStatus, 'success' | 'danger' | 'warning'> = {
  running: 'warning',
  success: 'success',
  failed: 'danger',
}

// 触发来源中文标签。'retry' 必须能被一眼看懂——运维看到一串 retry 才知道
// 「服务在自己重试」而不是「有人在反复点触发」。
export const TRIGGER_SOURCE_LABEL: Record<SichuanTriggerSource, string> = {
  schedule: '定时调度',
  retry: '自动重试',
  manual: '手动触发',
  startup: '启动采集',
}

export const ALERT_LEVEL_LABEL: Record<SichuanAlertLevel, string> = {
  warning: '需关注',
  critical: '需处理',
}

// 级别 → Element Plus alert 类型。判据是「不采取行动会不会自己好」：
// critical=不介入就不会好（凭据失效/契约漂移/已连续失败到不像临时波动）。
export const ALERT_LEVEL_TYPE: Record<SichuanAlertLevel, 'error' | 'warning'> = {
  warning: 'warning',
  critical: 'error',
}

export const TRIGGER_STATUS_LABEL: Record<SichuanTriggerItemStatus, string> = {
  success: '成功',
  failed: '失败',
  skipped: '已跳过',
}

// dataPath 字段 → 数据集 code 映射（用于把 menus[].label 关联到 datasets 块）。
export const DATASET_KEY_TO_MENU_CODE: Record<string, string> = {
  loadForecast: 'scpx_001_01',
  reservoirPlan: 'scpx_001_02',
}
