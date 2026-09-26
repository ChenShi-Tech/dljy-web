// 会话来源接入点标签：history-key（落库为 page_key）→ 中文来源名。
// 历史列表与侧边栏运行中会话共用一份，避免两处各记一套、新增接入点时漏改一处。
// 已下线的接入点（如敞口看板/现货监盘的旧侧栏、驾驶舱任务台）保留词条，存量会话照常显示原来源。
export const HISTORY_SOURCE_LABELS: Readonly<Record<string, string>> = {
  ai_center: 'AI 侧边栏',
  workbench: '工作台',
  morning_brief: '交易晨报',
  pre_submit_check: '申报前体检',
  policy_intel: '政策情报',
  strategic_qa: '战略问答',
  declaration_checkup: '申报体检',
  storage_copilot: '储能测算',
  review_center: '复盘中心',
  review_object_assistant: '复盘助手',
  declaration_market: '申报台·情报',
  declaration_draft: '申报台·起草',
  s2_market_analysis: '一日作业台·行情分析',
  s3_direction_advice: '一日作业台·方向判断',
  s4_storage_plan_review: '一日作业台·储能调度',
  sidekick_exposure: '敞口分析',
  sidekick_spot: '监盘解读',
  dashboard_overview: '驾驶舱任务台',
  captured_browser: '数据浏览器'
}

export function historySourceLabel(pageKey: string | null | undefined): string | null {
  return pageKey ? HISTORY_SOURCE_LABELS[pageKey] ?? null : null
}
