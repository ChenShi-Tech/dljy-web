// 页面直调量化端点客户端（/api/agent/quant/*，经 vite 代理 /agent-api）。
// 与智能体共用同一套确定性工具引擎，序列内联返回（不经 LLM、不走 data_ref）。
// 基址复用 agentClient 的 AGENT_API_BASE：开发态 /agent-api/agent（vite 代理），
// 生产/静态部署 /api/agent（后端同源）。此前写死 /agent-api 会让生产构建下
// 全部量化计算与产出物读取 404。
import { AGENT_API_BASE, encodeAgentPath, identityHeaders } from '@/services/agent/agentClient'
import { currentRegion } from '@/services/region/regionContext'
import { applyRegionHeaders, timeoutSignal } from '@/services/api'
import { QuantHttpError } from './reviewError'
import {
  fetchCgnYunnanPriceBundle,
  hasCgnYunnanPriceEntitlement,
  type CgnYunnanPriceBundle
} from '@/services/market/cgnYunnanLivePrice'

const BASE = `${AGENT_API_BASE}/quant`
const QUANT_REQUEST_TIMEOUT_MS = 45000
const QUANT_READ_TIMEOUT_MS = 10000

export { QuantHttpError, classifyReviewError } from './reviewError'
export type { ReviewFailure } from './reviewError'

function responseDetail(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const body = payload as Record<string, unknown>
  const detail = body.detail ?? body.msg
  if (typeof detail === 'string') return detail
  if (detail == null) return undefined
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    // 统一地区下传：与 api.ts requestHeaders() 对齐，后端 quant 端点据此按地区
    // 回放价格/负荷数据（经 harness queries → ReplayClient → /api/real?region=）。
    headers: { 'content-type': 'application/json', 'x-region-id': currentRegion.value.id, ...identityHeaders() },
    body: JSON.stringify(body),
    signal: timeoutSignal(QUANT_REQUEST_TIMEOUT_MS)
  })
  if (!res.ok) {
    const payload: unknown = await res.json().catch(() => null)
    const detail = responseDetail(payload)
    throw new QuantHttpError(detail ?? `请求失败: ${res.status}`, res.status, detail)
  }
  // 与 fetchCaptured 同源：记录地区命中，使实时监盘/敞口/复盘等页的 RegionDataBanner 生效。
  applyRegionHeaders(res)
  return (await res.json()) as T
}

// 中长期敞口
export type ExposurePoint = { datetime: string; contracted: number; expected: number; gap: number }
export type ExposureResult = {
  month: string
  mode: string
  total_mwh: number
  hedge_ratio: number
  spot_sell_exposure_mwh: number
  spot_buy_exposure_mwh: number
  interpretation: string
  daily_mwh: number
  source: string
  warning?: string
  series: ExposurePoint[]
}

export function fetchExposure(params: {
  month: string
  total_mwh: number
  mode?: string
  expected_source?: 'renewable' | 'load'
}): Promise<ExposureResult> {
  return post('/exposure', { ...params, region: currentRegion.value.id })
}

// 现货监盘
export type MonitorPoint = { time: string; da: number; rt: number; spread: number }
export type MonitorAlert = { time: string; spread: number; direction: string }
export type MonitorResult = {
  date: string
  source: string
  warning?: string
  // 合成演示是否注入了人工异动形态（true=演示场景含构造信号，非真实），前端据此明示
  demo_pattern_injected?: boolean
  spread_threshold: number
  series: MonitorPoint[]
  alerts: MonitorAlert[]
  peak_valley: {
    avg_price: { peak: number | null; flat: number | null; valley: number | null }
    peak_valley_spread: number | null
    spread_ratio: number | null
  }
  // 价格口径标注：云南中广核走集团私有 PG 节点日前/实时电价；
  // 山西走 sdpt_zcqxhdl/listrs_full 的 dmx 容器，日前/实时同为真实 96 点分价（#1531）；
  // 未配置路由的地区诚实不可用。前端据此在状态条显式提示。
  price_basis?: 'cgn_private_node' | 'user_unified' | 'captured_da_rt' | 'baseline_single_line'
  price_note?: string
  sourceType?: 'REAL' | 'MOCK'
  productionWrite?: boolean
  official_grid_api?: boolean
  latest_at?: string | null
  freshness?: 'fresh' | 'stale' | 'unavailable'
  availability?: 'complete' | 'partial' | 'unavailable'
  cgn_price_bundle?: CgnYunnanPriceBundle
}

export async function fetchMonitor(date: string, spreadThreshold = 80): Promise<MonitorResult> {
  // 云南 + 中广核 home company 才走集团私有 PG；其他集团保持其普通 serving route，
  // 不触碰中广核端点。私有链路一旦命中，403/503 直接交页面显示且不运行时回落。
  if (currentRegion.value.id === 'yunnan' && hasCgnYunnanPriceEntitlement()) {
    const bundle = await fetchCgnYunnanPriceBundle(date, spreadThreshold)
    const warning = bundle.availability === 'unavailable'
      ? '该日尚无中广核云南厂侧节点电价'
      : bundle.freshness === 'stale'
        ? '厂侧价格已超过新鲜度阈值，请检查实时轮询进程'
        : bundle.availability === 'partial'
          ? '日前或实时价格部分缺失，价差只按共同时间点计算'
          : undefined
    return {
      date,
      source: 'cgn_yunnan_private_pg',
      sourceType: 'REAL',
      productionWrite: false,
      official_grid_api: bundle.source.officialGridApi,
      latest_at: bundle.latestAt,
      freshness: bundle.freshness,
      availability: bundle.availability,
      warning,
      spread_threshold: spreadThreshold,
      series: bundle.monitor.series,
      alerts: bundle.monitor.alerts,
      peak_valley: bundle.monitor.peakValley,
      price_basis: 'cgn_private_node',
      price_note: '中广核云南厂侧合作方 API → 私有 PostgreSQL；日前/实时节点均价严格分离，非电网官方接口',
      cgn_price_bundle: bundle
    }
  }
  return post('/monitor', { date, spread_threshold: spreadThreshold, region: currentRegion.value.id })
}

// 复盘
export type ReviewDetailPoint = {
  datetime: string
  declared: number
  actual: number
  deviation: number
  assessed_mwh: number
  da_price?: number
  rt_price?: number
}
export type ReviewResult = {
  date: string
  /** 综合来源；申报与实际来源不同时形如 `replay+client_provided:actual_mwh_96`。 */
  source: string
  /** 申报侧来源（回放族 / `declaration_order:<id>`）。 */
  declared_source?: string
  /**
   * 实际侧来源。`client_provided:actual_mwh_96` 表示曲线由调用方提供、服务端无法验证，
   * 不得据此声明整份复盘为真实采集数据（#1487 / #1496）。
   */
  actual_source?: string
  /**
   * 这份复盘不能被当成什么，由后端随响应下发，页面必须原样呈现。
   * 数字本身不带口径：山西实际侧取的是平台「实时电量」，是否等同于偏差考核采信的
   * 实际结算电量尚未核实；罚款金额基于未核验的规则参数。把边界只留在文档里等于没写。
   */
  caliber_caveats?: string[]
  warning?: string
  deviation: {
    points: number
    total_abs_deviation_mwh: number
    assessed_mwh: number
    estimated_penalty_yuan: number
    tolerance_pct: number
    worst_point: { datetime?: string; deviation: number }
  }
  backtest: {
    points: number
    da_revenue_yuan: number
    avg_da_price: number
    da_rt_spread_pnl_yuan?: number
    note?: string
  }
  detail: ReviewDetailPoint[]
}

export function fetchReview(params: {
  date: string
  tolerance_pct?: number
  penalty_price?: number
  // P1-4：以申报单曲线为回测基准（96 点 MWh/15min），替代合成申报量
  declared_mwh_96?: number[]
  // 实际上网电量曲线（96 点 MWh/15min）。入参优先，不传不等于没有：
  // #1487 拆掉悬空的 sdpt_settlement 后这里曾恒 503，但 Epic #1485 已把山西经
  // serving-route 的 actual_energy 路由接上（sdpt_zptqx type='2' 平台实时电量），
  // 故不传时后端会自行取数；未登记路由的地区（含云南）才诚实 503
  // （source='not_onboarded'，detail 说明「尚未接入」而非「该日无数据」）。
  // 云南由 yn_spot_settlement 派生后传入的工作在 #1488。
  actual_mwh_96?: number[]
  declaration_id?: string
}): Promise<ReviewResult> {
  return post('/review', { ...params, region: currentRegion.value.id })
}

// 结算口径日复盘（云南三段式）
/**
 * 与 `fetchReview`（申报 vs 实际偏差考核）是两套口径，不可混用：
 * 本接口返回电网结算单口径，实际上网电量按「中长期 / 日前增量 / 实时增量」三段分解并逐段计价。
 * `daDevEnergy`/`rtDevEnergy` 是增量电量，不是「偏离申报被考核的量」，展示时不要写成偏差或罚款。
 * 目前仅云南接入；其他地区后端返回 503（`not_onboarded`）。
 */
export type SettlementSegment = {
  ltmEnergy: number
  daClearedEnergy: number
  daDevEnergy: number
  rtDevEnergy: number
  actualOnGridEnergy: number
  daDevFee: number
  rtDevFee: number
  totalEnergy: number
  totalFee: number
  /** 按电量加权（Σ totalFee / Σ totalEnergy），非各厂站均价的算术平均。 */
  avgPrice: number | null
}

/** 明细逐行直传结算单原值；源行缺字段时为 null（不折成 0，前端显示「—」）。 */
export type SettlementPlantRow = {
  plant: string
  ltmEnergy: number | null
  daClearedEnergy: number | null
  daDevEnergy: number | null
  rtDevEnergy: number | null
  actualOnGridEnergy: number | null
  daDevFee: number | null
  rtDevFee: number | null
  totalFee: number | null
  avgPrice: number | null
}

export type SettlementReviewResult = {
  date: string
  region: string
  source: string
  // AGENTS.md Mock 红线四件套（#1562 P1）：yn_spot_settlement 命中 mock 生成器时，
  // 后端标 sourceType='MOCK'/productionWrite=false/mock=true/warning，页面据此渲染可见
  // 「模拟数据」提示，避免把模拟结算单当真实结算口径（真金白银）。
  mock: boolean
  sourceType: 'REAL' | 'MOCK'
  productionWrite: boolean
  warning?: string
  basis: 'settlement_three_segment'
  basis_note: string
  plant_count: number
  summary: SettlementSegment
  plants: SettlementPlantRow[]
}

export function fetchSettlementReview(date: string): Promise<SettlementReviewResult> {
  return post('/settlement-review', { date, region: currentRegion.value.id })
}

// 量化权威计算
// 交易策略实验室（/xhjy/trading-lab）随 #1799 删除后，指向 agent-backend
// /kelly /arbitrage /cvar /twap /milp 的五个客户端函数失去全部消费者，一并移除。
// 后端端点保留，其科学性审查、参数可配置与 agent 工具化见 #1800。

// PR-P1b 跨期套利：日前 vs 实时 联合储能套利（cvxpy LP）
// 后端 optimize_cross_period 在无可行解时只回 {is_feasible:false, status, note}（不含收益/
// 计划字段），可行时才回完整字段。故用 is_feasible 判别联合精确建模契约，消费方须先收窄
// is_feasible===true 才能访问 objective_yuan/schedule 等，杜绝无可行解时 undefined 崩溃
// （与全审查 B18 PatchtstResult.available 判别联合同口径，B18 为已修 P1）。
export type CrossPeriodResult = {
  is_feasible: true
  status: string
  objective_yuan: number
  da_revenue_yuan: number
  rt_revenue_yuan: number
  cross_arbitrage_mwh: number
  schedule: Array<{ t: number; chg_da: number; dch_da: number; chg_rt: number; dch_rt: number }>
  note: string
} | {
  is_feasible: false
  status: string
  note: string
}

export function fetchCrossPeriodArbitrage(params: {
  day_ahead_prices: number[]
  real_time_prices: number[]
  capacity_mwh?: number
  max_power_mw?: number
}): Promise<CrossPeriodResult> {
  return post('/cross-period-arbitrage', params)
}

// PR-P1c 电力申报执行：申报曲线提交 + 撮合回执（替代股票 TWAP 拆单）
export type BidSubmissionReceipt = {
  bid_id: string
  market: string
  status: string
  declared_segments: number
  declared_qty_mwh: number
  cleared_qty_mwh: number
  avg_clearing_price: number | null
  submitted_at: string
  mock: boolean
  note: string
}

export function fetchBidSubmit(params: {
  declared_curve: Array<{ slot: number; qty_mw: number; price_yuan: number }>
  market?: string
}): Promise<BidSubmissionReceipt> {
  return post('/bid-submit', params)
}

// PR-P2 回测：历史电价→储能峰谷套利→日损益→quantstats 绩效
export type BacktestMetrics = {
  sharpe: number
  sortino: number
  max_drawdown: number
  win_rate: number
  volatility: number
  cagr: number
}

export type BacktestResult = {
  n_days: number
  daily_pnl_yuan: number[]
  cumulative_pnl_yuan: number
  daily_returns: number[]
  capital_yuan: number
  avg_daily_pnl_yuan: number
  profitable_days: number
  quantstats_available: boolean
  metrics?: BacktestMetrics
  metrics_error?: string
  note: string
}

export function fetchBacktest(params: {
  price_history: number[][]
  capacity_mwh?: number
  max_power_mw?: number
  charge_efficiency?: number
  discharge_efficiency?: number
  cycle_cost_yuan_per_mwh?: number
  capital_yuan?: number
}): Promise<BacktestResult> {
  return post('/backtest', params)
}

// 风险指标（CVaR 引擎权威计算，#2047 压力测试消费）
export type CvarResult = {
  var_95: number
  var_99: number
  cvar_95: number
  cvar_99: number
  max_drawdown: number
  volatility: number
  sharpe_ratio: number
  sortino_ratio: number
  tail_risk: number
  policy_source?: string
}

/** 收益率/价差序列（分数口径）→ VaR/CVaR/波动率/最大回撤/夏普/索提诺（历史模拟法）。 */
export function fetchCvar(returns: number[]): Promise<CvarResult> {
  return post('/cvar', { returns })
}

// 历史报告
export type ReportItem = { session_id: string; path: string; title: string; mtime: number }

export async function fetchReports(reportType = 'daily_review'): Promise<ReportItem[]> {
  const res = await fetch(`${BASE}/reports?report_type=${encodeURIComponent(reportType)}`, {
    headers: identityHeaders(),
    signal: timeoutSignal(QUANT_READ_TIMEOUT_MS)
  })
  if (!res.ok) return []
  return ((await res.json()).reports ?? []) as ReportItem[]
}

/** 读取某会话某产出物正文（复用 artifacts 端点的路径防护 + 会话归属 ACL）。
 *  仅适用于「当前用户拥有的 live/历史会话」产出物；共享报告请用 fetchReportContent。 */
export async function fetchArtifactContent(sessionId: string, path: string): Promise<string> {
  const res = await fetch(
    `${AGENT_API_BASE}/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeAgentPath(path)}`,
    { headers: identityHeaders(), signal: timeoutSignal(QUANT_READ_TIMEOUT_MS) }
  )
  if (!res.ok) throw new Error(`读取失败: ${res.status}`)
  const data = await res.json()
  return typeof data === 'string' ? data : (data.content ?? JSON.stringify(data))
}

/** 读取历史复盘报告正文（报告专用受控端点）。按公司数据范围鉴权，使定时任务/内嵌复盘
 *  (persistHistory=false)产出的共享报告也能被有权用户打开，避免通用 artifacts 端点的
 *  会话归属 ACL 把无登录上下文的报告误判为 403。 */
export async function fetchReportContent(sessionId: string, path: string): Promise<string> {
  const res = await fetch(
    `${BASE}/reports/content?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
    { headers: identityHeaders(), signal: timeoutSignal(QUANT_READ_TIMEOUT_MS) }
  )
  if (!res.ok) throw new Error(`读取失败: ${res.status}`)
  const data = await res.json()
  return typeof data === 'string' ? data : (data.content ?? JSON.stringify(data))
}
