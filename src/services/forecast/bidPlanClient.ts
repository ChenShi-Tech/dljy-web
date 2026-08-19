// 当日报价方案摘要（bid_plans 流水线产出，epic #336 PR-D）的服务层出口。
// 从 TradingCockpitView 内联 fetch 收编：视图不得直接 fetch（DEVELOPMENT.md §3.1），
// 散落取数无法统一治理鉴权/超时/错误分类。归一规则自视图原样迁移，行为零变化：
// 非 ok / 无 plan / status !== 'ok' / frontier 非 Array → null（真实或空，agent-backend
// 离线不合成）；mock 与 mockFields 透传，云南结算系数占位时响应 mock=true，
// 卡上必须有可见提示（Mock 冻结纪律）。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'

const BID_PLAN_TIMEOUT_MS = 10000

export interface BidFrontierRow {
  lambda: number
  risk_level: string
  total_declared_mwh: number | null
  expected_profit_yuan: number | null
  expected_revenue_yuan: number | null
  expected_penalty_yuan: number | null
  var_loss_yuan: number | null
  cvar_loss_yuan: number | null
}

export interface BidPlanSummary {
  targetDate: string
  priceModel: string
  lambdas: number[]
  declaredMwh: number | null
  planId: string
  mock: boolean
  mockFields: string[]
  basisNote: string
  frontier: BidFrontierRow[]
}

// 锚定当日申报目标日（运行日+1，本地时区）：latest 不带 target_date 会返回库内最大目标日，
// 历史/未来回填的 ok 方案会被误展示成「当日报价方案」。
export function nextDeclarationTargetDate(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 24 * 3600 * 1000)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

// 取指定目标日的最新 ok 方案摘要；无可展示方案（skipped/error/不存在）→ null。
// 竞态守卫（planReqSeq）留在调用方，它是视图生命周期概念，与取数正交。
export async function fetchLatestBidPlanSummary(targetDate: string): Promise<BidPlanSummary | null> {
  const res = await fetch(
    `${AGENT_API_BASE}/forecast/bid-plans/latest?target_date=${targetDate}`,
    { headers: identityHeaders(), signal: timeoutSignal(BID_PLAN_TIMEOUT_MS) }
  )
  if (!res.ok) return null
  const body = await res.json()
  const plan = body?.plan
  if (!plan || plan.status !== 'ok' || !Array.isArray(plan.frontier)) return null
  const neutral = plan.frontier.find((f: any) => f?.risk_level === 'neutral') ?? plan.frontier[0]
  return {
    targetDate: String(plan.target_date ?? ''),
    priceModel: String(plan.price_model_id ?? '—'),
    lambdas: plan.frontier.map((f: any) => Number(f?.lambda)).filter((v: number) => Number.isFinite(v)),
    declaredMwh: typeof neutral?.total_declared_mwh === 'number' ? neutral.total_declared_mwh : null,
    planId: String(plan.plan_id ?? ''),
    // Mock 冻结纪律：云南结算系数占位时响应 mock=true，卡上必须有可见提示
    mock: body?.mock === true,
    mockFields: Array.isArray(plan.basis?.settlement_mock_fields) ? plan.basis.settlement_mock_fields : [],
    basisNote: String(plan.note ?? body?.note ?? '决策支持参考·非申报/结算依据'),
    frontier: plan.frontier.map((frontier: any) => ({
      lambda: Number(frontier?.lambda),
      risk_level: String(frontier?.risk_level ?? '—'),
      total_declared_mwh: typeof frontier?.total_declared_mwh === 'number' ? frontier.total_declared_mwh : null,
      expected_profit_yuan: typeof frontier?.expected_profit_yuan === 'number' ? frontier.expected_profit_yuan : null,
      expected_revenue_yuan: typeof frontier?.expected_revenue_yuan === 'number' ? frontier.expected_revenue_yuan : null,
      expected_penalty_yuan: typeof frontier?.expected_penalty_yuan === 'number' ? frontier.expected_penalty_yuan : null,
      var_loss_yuan: typeof frontier?.var_loss_yuan === 'number' ? frontier.var_loss_yuan : null,
      cvar_loss_yuan: typeof frontier?.cvar_loss_yuan === 'number' ? frontier.cvar_loss_yuan : null
    }))
  }
}
