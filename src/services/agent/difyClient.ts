// Dify 报告工坊 — 前端 API 客户端
// 参照 src/services/api.ts 的封装模式。
// 前端通过 /dify-api/* 调用，由 Vite proxy → Node server → Dify 容器。
//
// 授权：跑报告走应用 API（/v1/workflows/run，app-xxx）；探活走 /dify-api/health
// （后端用 app-xxx 调应用 API 探针，非 401 即通）。不再用 console API（app-xxx 调 /console/api/apps 必 401）。
// 多 workflow 应用：每模板一个 app key，后端 dify-proxy 按 body 顶层 template_name 选 key。

import { apiPost, apiGet } from '@/services/api'
import { getCurrentUser } from '@/services/auth'

// ============================================================
// 类型定义
// ============================================================

export interface ReportTemplate {
  id: string
  name: string
  description: string
  mode: 'workflow' | 'chat' | 'agent-chat'
  tags: string[]
  created_at: string
}

export interface ReportParams {
  templateId: string
  date_range?: { start: string; end: string }
  company_id?: string
  station_ids?: string[]
  market_type?: string
  output_format?: 'markdown' | 'html'
}

export interface ReportResult {
  workflow_run_id: string
  task_id: string
  data: {
    outputs: Record<string, any>
    status: 'succeeded' | 'failed' | 'running' | 'partial_succeeded'
    error?: string
    total_steps: number
    total_tokens: number
    created_at: number
    finished_at: number
  }
}

export interface ReportHistoryItem {
  id: string
  template_name: string
  company_id: string
  workflow_run_id: string
  status: string
  created_at: string
  params: ReportParams
}

// ============================================================
// 模板 id 映射：前端本地模板 id → Dify workflow 应用名（DIFY_APP_KEYS 的 key）
// ============================================================
const TEMPLATE_ID_TO_DIFY: Record<string, string> = {
  'daily-spot': 'daily-spot-report',
  'monthly-settlement': 'monthly-settlement',
  'station-compare': 'station-output-compare',
  'contract-tracker': 'contract-tracker',
  'risk-dashboard': 'risk-dashboard'
}

/** 前端本地模板 id → Dify workflow 应用名（未映射则原样返回） */
export function toDifyTemplateName(localId: string): string {
  return TEMPLATE_ID_TO_DIFY[localId] || localId
}

// ============================================================
// API 函数
// ============================================================

/**
 * 执行报告工作流（应用 API）
 * 代理 POST /dify-api/v1/workflows/run；body 顶层 template_name 供后端选对应 workflow 应用 key（不透传 Dify）
 */
export async function runReportWorkflow(
  params: ReportParams
): Promise<ReportResult> {
  const difyName = toDifyTemplateName(params.templateId)
  const inputs: Record<string, any> = {
    date_start: params.date_range?.start ?? '',
    date_end: params.date_range?.end ?? '',
    company_id: params.company_id ?? '',
    station_ids: params.station_ids ?? [],
    market_type: params.market_type ?? 'spot',
    output_format: params.output_format ?? 'markdown'
  }
  // monthly-settlement（结算计算器）workflow 必填合同业务参数；前端报告工坊通用参数（日期/市场）不含，
  // 此处注入演示值让 workflow 跑通。真实使用：报告工坊加合同参数输入 UI，或模板改为从 company_contracts
  // 工具按日期范围自动取（settlement 计算而非用户手填）。
  if (difyName === 'monthly-settlement') {
    inputs.contract_quantity = '100'
    inputs.contract_price = '400'
    inputs.spot_price = '500'
    inputs.actual_quantity = '110'
  }
  const body = {
    template_name: difyName,
    inputs,
    response_mode: 'blocking',
    user: getCurrentUser()?.username ?? 'dljy-user'  // 按当前登录用户区分 Dify user 维度
  }
  const res = await apiPost<any>('/dify-api/v1/workflows/run', body)
  return {
    workflow_run_id: res?.workflow_run_id ?? '',
    task_id: res?.task_id ?? '',
    data: res?.data ?? res
  }
}

/**
 * 探活：检查指定模板对应的 Dify workflow 应用是否接通（app key 有效 + Dify 可达）
 * 代理 GET /dify-api/health?template=<dify-name>；后端用应用 API 探针，非 401 即通。
 * @param templateId 前端本地模板 id（如 'daily-spot'）；不传则探默认 daily-spot-report
 */
export async function pingDifyService(templateId?: string): Promise<boolean> {
  try {
    const difyName = templateId ? toDifyTemplateName(templateId) : 'daily-spot-report'
    const res = await apiGet<any>('/dify-api/health', { template: difyName })
    return res?.available === true
  } catch {
    return false
  }
}

/**
 * 获取报告历史列表（console API；app-xxx 调会 401，仅作兼容，报告工坊主链路用本地历史）
 */
export async function listReportHistory(
  appId: string,
  companyId?: string
): Promise<ReportHistoryItem[]> {
  const query: Record<string, string> = {}
  if (companyId) query.company_id = companyId
  const res = await apiGet<any>(`/dify-api/console/api/apps/${appId}/workflow-logs`, query)
  return res?.data ?? []
}

/**
 * 获取单个报告的详细结果
 */
export async function getReportDetail(reportId: string): Promise<ReportResult | null> {
  try {
    const res = await apiGet<any>('/dify-api/console/api/apps/workflow-logs/${reportId}')
    return res?.data ?? null
  } catch {
    return null
  }
}
