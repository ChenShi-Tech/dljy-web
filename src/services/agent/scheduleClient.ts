// 定时任务调度客户端：对接后端 /api/agent/schedules/*（CRUD + 立即执行 + 执行历史）。
// 结果中心复用既有报告端点 /api/agent/quant/reports[/content]（无需新后端）。
// 类型镜像后端 packages/agent-runtime/src/agent_runtime/api/schedule_store.py 的 scheduled_tasks / task_executions。
//
// #538 阶段 1：改用 agent/httpClient 工厂，删本地 adminHeaders/adminJsonHeaders/jsonOrThrow 样板。
// 调度端点（CRUD/触发/执行历史）需管理员鉴权 → 用 http.getAdmin/post/put/delete；
// 报告端点是业务读 → 用 http.get。

import { createAgentClient } from '@/services/agent/httpClient'

const http = createAgentClient('', { timeoutMs: 10_000 })

export type ScheduleKind =
  | 'disclosure_crawl'
  | 'daily_review'
  | 'risk_patrol'
  | 'spot_watch'
  | 'morning_brief'
  | 'data_ingestion'
  | 'forecast_run'
  | 'bid_plan'
  | 'forecast_report'
  | 'review_trigger'

export type ScheduledTask = {
  id: string
  kind: ScheduleKind
  at: string // "HH:MM"
  enabled: boolean
  params: Record<string, unknown>
  title: string
  owner: string
  created_at: number
  updated_at: number
  last_run?: string | null
  last_status?: string | null
  last_result?: string | null
}

export type TaskExecution = {
  id: string
  task_id: string
  kind: ScheduleKind
  trigger: 'schedule' | 'manual'
  started_at: number
  completed_at?: number | null
  status: 'running' | 'ok' | 'error' | 'skipped'
  result?: string | null
  result_json?: Record<string, unknown> | null
  log?: string | null
}

export type ScheduleCreateBody = {
  kind: ScheduleKind
  at: string
  params?: Record<string, unknown>
  enabled?: boolean
  title?: string
}

export type ScheduleUpdateBody = {
  at?: string
  params?: Record<string, unknown>
  enabled?: boolean
  title?: string
}

// 结果中心：报告条目（后端 /quant/reports 返回）
export type ReportItem = {
  session_id: string
  path: string
  title: string
  mtime: number
}

// kind 展示元信息（label / 图标字 / 参数 schema），供编辑面板渲染动态参数表单
export type ScheduleParamField = {
  key: string
  label: string
  type: 'date' | 'number' | 'text' | 'region'
  placeholder?: string
  hint?: string
}
export type ScheduleKindMeta = {
  kind: ScheduleKind
  label: string
  char: string
  desc: string
  reportType?: string // 产出报告类型（结果中心据此筛选）；无报告型留空
  params: ScheduleParamField[]
}
export const SCHEDULE_KIND_META: ScheduleKindMeta[] = [
  {
    kind: 'morning_brief',
    label: '交易晨报',
    char: '晨',
    desc: '隔夜行情研判 + 次日价格预测带 + 风险摘要，落盘 market_brief 报告（预测值诚实标注）',
    reportType: 'market_brief',
    params: [
      { key: 'brief_date', label: '晨报日期', type: 'date', hint: '留空=当日' },
      { key: 'region_id', label: '地区', type: 'region', hint: '留空=默认地区' }
    ]
  },
  {
    kind: 'daily_review',
    label: '日度复盘',
    char: '复',
    desc: '查当日出清/结算 → 对比预测偏差 → 偏差归因 → 落盘 daily_review 报告',
    reportType: 'daily_review',
    params: [{ key: 'review_date', label: '复盘日期', type: 'date', hint: '留空=昨日' }]
  },
  {
    kind: 'risk_patrol',
    label: '风控巡检',
    char: '控',
    desc: '查最近出清价异动 + CVaR 风险核查，异常时落盘 risk_alert 报告',
    reportType: 'risk_alert',
    params: [{ key: 'region_id', label: '地区', type: 'region', hint: '留空=默认地区' }]
  },
  {
    kind: 'spot_watch',
    label: '现货异动盯盘',
    char: '盯',
    desc: '扫今日实时 vs 日前逐点价差，超阈值汇总告警（演示数据走 synthetic 回放需标注）',
    params: [
      { key: 'region_id', label: '地区', type: 'region', hint: '留空=默认地区' },
      {
        key: 'spread_threshold',
        label: '价差阈值(元/MWh)',
        type: 'number',
        placeholder: '120',
        hint: '> 0，默认 120'
      }
    ]
  },
  {
    kind: 'disclosure_crawl',
    label: '披露爬取',
    char: '披',
    desc: '抓取交易中心/能源局公告政策入披露库（无参数）',
    params: []
  },
  {
    kind: 'data_ingestion',
    label: '数据摄取',
    char: '摄',
    desc: '触发云南现货/气象/市场经营分析数据摄入（POST /api/v1/ingest/:kind，复用 ETL CLI 落 capture-raw+capture.sqlite）',
    params: [
      {
        key: 'ingest_kind',
        label: '摄取类型',
        type: 'text',
        placeholder: 'weather-export',
        hint: 'weather-export / spot-export / market-export / southern-export（spot 需 dir，market 需 dir/file）'
      }
    ]
  },
  {
    kind: 'forecast_run',
    label: '每日预测管线',
    char: '预',
    desc: '训练预测器组（naive_1d/弹性/ridge/lightgbm）→ T+1 96 点电价预测落 forecast_runs（数据未到位自动 skipped 留痕；产出仅决策支持、非申报/结算依据）',
    params: [
      { key: 'region_id', label: '地区', type: 'region', hint: '留空=yunnan' },
      { key: 'target_date', label: '目标日', type: 'date', hint: '留空=运行日+1（回填历史日显式指定）' }
    ]
  },
  {
    kind: 'bid_plan',
    label: '报价方案流水线',
    char: '报',
    desc: '读 forecast_runs 价格预测 → mean-CVaR 三档 λ 申报前沿 + 偏差考核评估 → bid_plans 落库（决策支持参考、非申报/结算依据；无 ok 价格 run 自动 skipped）',
    params: [
      { key: 'region_id', label: '地区', type: 'region', hint: '留空=yunnan' },
      { key: 'target_date', label: '目标日', type: 'date', hint: '留空=运行日+1' },
      { key: 'capacity_mw', label: '申报量上限(MW)', type: 'number', hint: '可选，装机容量约束' }
    ]
  },
  {
    kind: 'forecast_report',
    label: '周度预测精度报告',
    char: '评',
    desc: '按约定星期跑 rolling_report 全年 walk-forward 回测，产精度趋势报告落 data/generated/forecast-report/（非报告日自动 skipped 留痕；数据不足空跑也 skipped）',
    params: [
      { key: 'region_id', label: '地区', type: 'region', hint: '留空=yunnan' },
      { key: 'weekday', label: '报告日(0=周一..6=周日)', type: 'number', hint: '留空=0（每周一）' }
    ]
  },
  {
    kind: 'review_trigger',
    label: '复盘触发引擎',
    char: '盘',
    desc: '按日/周/月/季周期生成复盘模板实例分母（Epic #2033 · #2039：服务令牌调 Node /api/v1/review/trigger，幂等可重跑；待办箱/覆盖率据此出真数）',
    params: [
      { key: 'date', label: '触发日期', type: 'date', hint: '留空=当日（回补历史日显式指定）' }
    ]
  }
]
export function scheduleKindMeta(kind?: string): ScheduleKindMeta | undefined {
  return SCHEDULE_KIND_META.find((m) => m.kind === kind)
}

// 调度端点（CRUD/触发/执行历史）阶段 A 起统一管理员鉴权：携带 x-admin-token
// （服务端未配 HARNESS_ADMIN_TOKEN 时返回空头，后端放行；与 skills/llm 写操作同款）。
// httpClient 的 getAdmin/post/put/delete 自动带 adminHeaders（identity + token）。

// 任务 CRUD
export async function listSchedules(kind?: ScheduleKind): Promise<ScheduledTask[]> {
  const qs = kind ? `?kind=${encodeURIComponent(kind)}` : ''
  return http.getAdmin<ScheduledTask[]>(`/schedules${qs}`)
}

export async function createSchedule(body: ScheduleCreateBody): Promise<ScheduledTask> {
  return http.post<ScheduledTask>('/schedules', body)
}

export async function updateSchedule(id: string, patch: ScheduleUpdateBody): Promise<ScheduledTask> {
  return http.put<ScheduledTask>(`/schedules/${encodeURIComponent(id)}`, patch)
}

export async function deleteSchedule(id: string): Promise<void> {
  await http.delete<{ removed: string }>(`/schedules/${encodeURIComponent(id)}`)
}

export async function triggerSchedule(id: string): Promise<{ ok: boolean; exec_id: string }> {
  return http.post<{ ok: boolean; exec_id: string }>(`/schedules/${encodeURIComponent(id)}/trigger`)
}

export async function getExecutions(id: string, limit = 50): Promise<TaskExecution[]> {
  const data = await http.getAdmin<{ executions: TaskExecution[] }>(
    `/schedules/${encodeURIComponent(id)}/executions?limit=${encodeURIComponent(limit)}`
  )
  return data.executions
}

// 结果中心：复用既有报告端点（不新增后端）
export async function listReports(reportType: string, limit = 50): Promise<ReportItem[]> {
  const data = await http.get<{ report_type: string; reports: ReportItem[] }>(
    `/quant/reports?report_type=${encodeURIComponent(reportType)}&limit=${encodeURIComponent(limit)}`
  )
  return data.reports
}

export async function getReportContent(sessionId: string, path: string): Promise<{ path: string; content: string }> {
  return http.get<{ path: string; content: string }>(
    `/quant/reports/content?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
  )
}
