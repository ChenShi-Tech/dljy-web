// 页面直调后端 ML 预测端点客户端（/api/v1/forecast/*，经 vite 代理 /agent-api → /api → :8000 FastAPI）。
// 全部预测计算在后端 Python ML 服务，前端只取参数、调用、渲染（PRD v2.2 §一/§六）。
// 数据口径 basis 由后端透传（'captured' 真实 / 'synthetic' 合成验证），前端据此显示角标。
// 后端原名 ironclaw-backend 已更名 agent-backend，代理前缀随之由 /ironclaw-api 改为 /agent-api。
// 基址按环境切换（与 agentClient.AGENT_API_BASE 同约定）：开发态走 vite 代理前缀
// /agent-api（→ :8000 Python），生产/静态部署后端同源直接挂 /api。此前写死 /agent-api
// 会让 ML 预测实验室/工作台在生产构建下全部 404（/agent-api 仅是开发代理别名）。
import { identityHeaders } from '@/services/agent/agentClient'
import { applyRegionHeaders, timeoutSignal, AGENT_API_BASE_ROOT } from '@/services/api'
import { currentRegion } from '@/services/region/regionContext'
import { normalizeForecastModelCatalog, type ForecastModelCatalog } from './modelContract'

export {
  normalizeForecastModelCatalog,
  normalizeModelConfigDescriptor,
  normalizeModelRegistryEntry,
} from './modelContract'
export type {
  ForecastModel,
  ForecastModelCatalog,
  ModelConfigDescriptor,
  ModelQuality,
  ModelRegistryEntry,
  ModelShadowGate,
  ModelStage,
} from './modelContract'

const BASE = `${AGENT_API_BASE_ROOT}/v1/forecast`
const FORECAST_REQUEST_TIMEOUT_MS = 90000
const FORECAST_METADATA_TIMEOUT_MS = 10000

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-region-id': currentRegion.value.id, ...identityHeaders() },
    body: JSON.stringify(body),
    signal: timeoutSignal(FORECAST_REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.detail || `预测请求失败: ${res.status}`)
  }
  // 回读后端地区命中头 x-region-served/x-region-fallback → regionDataStatus → RegionDataBanner，
  // 使预测页的地区回退/合成兜底对用户可见（B03，与现货 spotClient / 量化 quantClient 对齐）。
  applyRegionHeaders(res)
  return (await res.json()) as T
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'x-region-id': currentRegion.value.id, ...identityHeaders() },
    signal: timeoutSignal(FORECAST_METADATA_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`请求失败: ${res.status}`)
  applyRegionHeaders(res)   // 回读地区命中头（B03）
  return (await res.json()) as T
}

export type ForecastMetrics = {
  mae: number
  rmse: number
  mase_vs_naive: number
  improve_vs_knn_pct: number
  passes_gate: boolean
  // 概率预测指标（probabilistic=true 时返回）
  pinball?: number
  picp?: number
  pinaw?: number
  nominal_coverage?: number
  // #764 共形校准标注（prob_metrics 透传）：区间是否经 CQR 校准 + 分位来源
  conformal?: boolean
  quantile_source?: string        // neuralforecast | lightgbm-cqr | lightgbm-quantile
}

export type ForecastBaselineMetrics = {
  naive_mae: number
  knn_mae: number
}

// 数据口径：ForecastBasis 单一权威定义在 services/data/types.ts（Phase 0 统一类型层），
// 与 dataBasis.ts::DataBasis 合并为 DataSourceBasis。此处 re-export 保持本文件
// `import { ForecastBasis } from '@/services/forecast/mlForecastClient'` 不破。
import type { ForecastBasis } from '../data/types'
export type { ForecastBasis }

export type ForecastResult = {
  task: Record<string, unknown>
  points: number[]
  lower: number[]
  upper: number[]
  basis: ForecastBasis
  mock?: boolean                    // true=占位/合成实现（如 tslib compat），禁止当真实精度下注
  source_type?: string             // REAL|CAPTURED|MIXED|MOCK
  model_version: string | null
  // B23：后端 forecast_task.py 已改为 default_factory=dict（永不 None，详见 Python 层修复），故此处保持非可空。
  metrics: ForecastMetrics
  baseline_metrics: ForecastBaselineMetrics
  unit: string
  warnings: string[]
  // Core 转发模式（DLJY_FORECAST_FORWARD_CORE=1）下 Core 不可达或公司上下文不可解析时，
  // forecast_core_adapter.prediction_unavailable_envelope() 返回 HTTP 200 + available:false
  // + 空 points + unavailable_reason。不声明这两个字段，消费方就会把"服务不可用"当成一次
  // 成功预测（空曲线），既不显示真实原因也不触发空态出口。
  // 目标日事后真值 + 基线曲线（#2371，snake_case 与后端 ForecastResult 字段一致）。
  // 后端本就用它们算 metrics/baseline_metrics；Core 转发模式下可能缺，消费方须按可选处理。
  actual?: number[]
  baseline_curves?: { naive?: number[]; knn?: number[] }
  evaluation_mode?: string
  // 目标日前一天的真值 96 点（#2387）：画「过去实线 → 未来虚线」连续视图的过去那一段。
  // 与 baseline_curves.naive 不是一回事——那是「拿前一天当预测」的基线曲线。
  history?: number[]
  available?: boolean
  // ⚠️ 字段名以 snake_case 为准：`prediction_envelope_to_legacy()` 输出的是
  // `unavailable_reason`（forecast_core_adapter.py:393）。camelCase 变体一并声明只为兼容，
  // 读取一律走 unavailableReasonOf() 归一，避免又出现"读了个永远不存在的字段"。
  unavailable_reason?: string | null
  unavailableReason?: string | null
}

/** 取 Core 不可用原因（兼容 snake_case / camelCase 两种形态）。 */
export function unavailableReasonOf(r: Pick<ForecastResult, 'unavailable_reason' | 'unavailableReason'> | null | undefined): string {
  return String(r?.unavailable_reason ?? r?.unavailableReason ?? '').trim()
}

export type ForecastRequest = {
  region_id?: string
  target?: string
  model_type?: string
  train_days?: number
  data_source?: string
  target_date?: string
  probabilistic?: boolean
  conformal?: boolean
  extra?: Record<string, unknown>      // 算法专属参数透传（如 KNN 的 k）
}

// API
// region_id（#763 job646）：/models 的 quality 不达标标注是地区维（skill 相对该地区回测基线），
// 必须带地区，否则后端默认 yunnan，切 shanxi 后模型目录显示云南 skill/quality（跨地区串读）。
// 默认取全局地区（照本文件其它方法的 x-region-id 头/参数范式）。
export async function fetchForecastModels(target = 'price', regionId?: string): Promise<ForecastModelCatalog> {
  const rid = regionId ?? currentRegion.value.id
  const raw = await get<unknown>(`/models?target=${encodeURIComponent(target)}&region_id=${encodeURIComponent(rid)}`)
  return normalizeForecastModelCatalog(raw, { target, regionId: rid })
}

export function runForecastPredict(req: ForecastRequest): Promise<ForecastResult> {
  return post('/predict', req)
}

export type BacktestResult = {
  basis: ForecastBasis
  aggregate: {
    mae: number; rmse: number; naive_mae: number; knn_mae: number
    mase_vs_naive: number; improve_vs_knn_pct: number; n_test_days: number; beats_naive: boolean
  }
  per_day: { day_idx: number; mae: number; mase_vs_naive: number }[]
  // #1573/#1651：full 口径（特征含目标日当期实际外生量）的回测精度为上界，
  // feature_mode/leakage_caveats 由后端披露；前端展示精度时应向用户提示而非裸数值。
  feature_mode?: string
  leakage_caveats?: string[]
}

export function fetchBacktest(req: ForecastRequest, testDays = 15): Promise<BacktestResult> {
  return post(`/backtest?test_days=${testDays}`, req)
}

// 预测质量记分牌（#763 PR-2）：只读 rolling_report 产物（data/generated/forecast-report/*.json）
// 后端 /forecast/scoreboard 定位指定 region 最新滚动回测报告透传；无产物→available=false（诚实空态）。
// 报告 basis 由后端原样透传（synthetic 报告页面显著警示「合成数据·不代表真实精度」，不回退假数据）。
export type ScoreboardModelMetrics = {
  mae: number | null
  rmse: number | null
  mase_vs_naive: number | null
  improve_vs_knn_pct: number | null
  skill_vs_lear: number | null
  skill_vs_seasonal_naive: number | null
  n_days: number
  passes_gate: boolean
  passes_skill_gate: boolean
}
export type ScoreboardQuantiles = {
  pinball: number | null
  picp: number | null
  pinaw: number | null
  crps_approx: number | null
  winkler: number | null
}
// 分段 MAE：{段: {模型: MAE|null}}（by_month/by_season/by_segment）
export type ScoreboardBucket = Record<string, Record<string, number | null>>
// 逐日明细：date/month/season/day_idx + 各模型 `<model>_mae`/`<model>_rmse`/`<model>_mase` + 概率指标。
export type ScoreboardPerDay = Record<string, number | string | null>
export type ScoreboardRun = {
  overall: Record<string, ScoreboardModelMetrics>
  by_month: ScoreboardBucket
  by_season: ScoreboardBucket
  by_segment: ScoreboardBucket
  quantiles: ScoreboardQuantiles
  gate_basis: string
  skill_gate_references: string[]
  leakage_caveats: string[]
  per_day: ScoreboardPerDay[]
  meta: {
    n_test_days: number
    n_fits: number
    n_strides: number
    models: string[]
    min_train_days: number
    refit_every: number
    gap_days: number
    feats_used: string[]
  }
}
export type ScoreboardReport = {
  region_id: string
  basis: ForecastBasis
  generated_at: string
  date_range: [string, string]
  n_days: number
  runs: Record<string, ScoreboardRun>
}
export type ScoreboardResponse = {
  available: boolean
  region_id: string
  generated_at?: string
  report?: ScoreboardReport
}
export function fetchForecastScoreboard(regionId?: string): Promise<ScoreboardResponse> {
  const rid = regionId ?? currentRegion.value.id
  return get(`/scoreboard?region_id=${encodeURIComponent(rid)}`)
}

// 申报决策建议（预测→动作）
export type GeneratorStrategy = 'p50' | 'p10' | 'expected'
export type BidAdviceRequest = ForecastRequest & {
  subject_type?: string            // 'retailer' | 'storage' | 'generator'
  storage_power_mw?: number
  storage_energy_mwh?: number
  total_load_mw?: number
  // 发电侧申报（generator，G3.2）
  strategy?: GeneratorStrategy
  clearing_price?: number
  tolerance_pct?: number
  assessment_price?: number
  forecast_points?: number[]       // 站级 P50 出力(MW)，给定则后端跳过内部价格预测
  forecast_lower?: number[]        // P10
  forecast_upper?: number[]        // P90
}

export type StorageAdvice = {
  schedule: { slot: number; action: string; power_mw: number }[]
  charge_slots: number
  discharge_slots: number
  expected_charge_cost_yuan: number
  expected_discharge_revenue_yuan: number
  expected_profit_yuan: number
}

export type RetailerAdvice = {
  bid_curve: { slot: number; qty_mw: number; bid_price: number; tier: string; advice: string }[]
  expected_cost_yuan: number
  cost_range_yuan: [number, number]
}

// 发电侧申报建议（G3.2）
export type GeneratorAdvice = {
  strategy: GeneratorStrategy
  bid_curve: { slot: number; qty_mw: number; lower_mw: number; p50_mw: number; upper_mw: number; tier: string; advice: string }[]
  total_declared_mwh: number
  p50_total_mwh: number
  band_total_mwh: [number, number]
  clearing_price: number
  note: string
}

export type BidAdvice = {
  subject_type: string
  basis: ForecastBasis
  price_tiers: string[]
  valley_threshold: number
  peak_threshold: number
  storage?: StorageAdvice
  retailer?: RetailerAdvice
  generator?: GeneratorAdvice
}

export type BidAdviceResult = {
  forecast: { points: number[]; lower: number[]; upper: number[]; basis: ForecastBasis; unit: string }
  advice: BidAdvice
}

export function fetchBidAdvice(req: BidAdviceRequest): Promise<BidAdviceResult> {
  return post('/bid-advice', req)
}

// 交易决策驾驶舱（一站式决策包）
export type CockpitResult = {
  basis: ForecastBasis
  price_forecast: { points: number[]; lower: number[]; upper: number[]; unit: string }
  bid_advice: BidAdvice
  deviation_risk: { expected_penalty_yuan: number; worst_penalty_yuan: number; high_risk_slots: number }
  midterm_trend: { daily_avg_price: number[]; horizon_days: number }
}

export function fetchCockpit(req: BidAdviceRequest): Promise<CockpitResult> {
  return post('/cockpit', req)
}

// 偏差风险情景量化（/risk-quantify）
// VaR/CVaR 为整条申报曲线的标量聚合结果，不返回逐时段 VaR/CVaR 序列。
export type RiskQuantifyRequest = ForecastRequest & {
  clearing_price?: number
  n_scenarios?: number
  alpha?: number
  corr?: number
  actual_points?: number[]
  actual_lower?: number[]
  actual_upper?: number[]
  declared_mw?: number[]
  tolerance_pct?: number
  assessment_price?: number
  segment_factors?: number[]
  slot_hours?: number
}

export type RiskQuantification = {
  alpha: number
  n_scenarios: number
  expected_penalty_yuan: number
  var_penalty_yuan: number
  cvar_penalty_yuan: number
  expected_revenue_yuan: number
  expected_net_yuan: number
  var_net_loss_yuan: number
  cvar_net_loss_yuan: number
  forecast_value_yuan_per_10pct_tighter: number
  high_risk_slots: number
  tolerance_pct: number
  assessment_price: number
  segmented: boolean
  note: string
}

export type RiskQuantifyResult = {
  forecast: { points: number[]; lower: number[]; upper: number[]; basis: ForecastBasis; unit: string; target: string }
  risk_quantification: RiskQuantification
  // #764 VaR/CVaR 消费的尾部是否经 CQR 校准分位（内部预测默认 true；客户端自带 band 时 false）
  quantile_calibrated?: boolean
  mock: boolean
  source_type: string
  productionWrite: boolean
}

// 后端 forecast 站级分支（传 actual_points 时）返回 basis='client_station_forecast'，基于客户端
// 传入站级预测的推算，属 ForecastBasis 词表外值。归一到合法枚举保守标注（推算类→illustrative，
// 未知→synthetic），防类型谎报致 DataBasisBadge 渲染 undefined。
const FORECAST_BASIS_ALLOWED: readonly ForecastBasis[] = ['real', 'captured', 'illustrative', 'synthetic']
function normalizeForecastBasis(raw: unknown): ForecastBasis {
  const v = String(raw ?? '')
  if ((FORECAST_BASIS_ALLOWED as readonly string[]).includes(v)) return v as ForecastBasis
  if (v === 'client_station_forecast') return 'illustrative'
  return 'synthetic'
}

export async function fetchRiskQuantify(req: RiskQuantifyRequest): Promise<RiskQuantifyResult> {
  const res = await post<RiskQuantifyResult>('/risk-quantify', req)
  return { ...res, forecast: { ...res.forecast, basis: normalizeForecastBasis(res.forecast?.basis) } }
}

// PR-P0b 电价闭环：两阶段 mean-CVaR 申报优化（/optimize-bid）
// 后端 OptimizeBidRequest 接 forecast 电价预测 P50（price_forecast_p50）替代 clearing_price 常数（400），
// 修复旧实现 clearing_price 恒 400 与 forecast 电价预测断裂（forecast 已产出 P10/P50/P90 但未喂回申报）。
// 前端类型对齐（字段对齐 forecast.py 的 OptimizeBidRequest + bid_optimizer.optimize_bid 响应）；UI 接入留后续。
export type OptimizeBidRequest = ForecastRequest & {
  actual_points?: number[]              // 站级出力 P50（MW），给定则后端跳过内部预测
  actual_lower?: number[]               // P10
  actual_upper?: number[]               // P90
  declared_mw?: number[]                // 申报曲线（未给则用 P50）
  tolerance_pct?: number                // 容差带 %
  assessment_price?: number             // 考核单价（元/MWh）
  segment_factors?: number[]
  slot_hours?: number
  clearing_price?: number               // 标量出清价（元/MWh，缺省 400；被 price_forecast_p50 覆盖）
  n_scenarios?: number
  alpha?: number                        // VaR/CVaR 置信
  corr?: number                         // 情景跨时段相关
  capacity_mw?: number                  // 申报量上限（装机）
  lambdas?: number[]                    // 风险偏好档位 λ
  price_forecast_p50?: number[]         // PR-P0b：逐时段电价预测 P50（元/MWh，替代 clearing_price 常数）
}

export type OptimizeBidFrontierPoint = {
  lambda: number
  risk_level: 'aggressive' | 'neutral' | 'conservative'
  bid_curve_mw: number[]
  total_declared_mwh: number
  expected_profit_yuan: number
  expected_revenue_yuan: number
  expected_penalty_yuan: number
  var_loss_yuan: number
  cvar_loss_yuan: number
}

export type OptimizeBidResult = {
  forecast: { points: number[]; lower: number[]; upper: number[]; basis: ForecastBasis; unit: string; target: string }
  optimize_bid: {
    n_scenarios: number
    alpha: number
    frontier: OptimizeBidFrontierPoint[]
    solver: string
    note: string
  }
  // #764 mean-CVaR 情景分位是否经 CQR 校准（与 RiskQuantifyResult 同语义）
  quantile_calibrated?: boolean
  mock: boolean
  source_type: string
  productionWrite: boolean
}

export function fetchOptimizeBid(req: OptimizeBidRequest): Promise<OptimizeBidResult> {
  return post('/optimize-bid', req)
}

// 功能 C：偏差考核最小化申报 copilot（/deviation-bid-copilot）
// 申报优化目标=偏差考核费用约束下最大化收益；对照基线(P50 直报)，接地区结算规则（新疆）。
// 申报为决策支持参考·非结算依据，提交前强制人工确认（HITL）。
export type DeviationBidCopilotRequest = OptimizeBidRequest & {
  region?: string                 // 地区结算规则（新疆真实；其他标 mock 占位）
  region_id?: string              // 数据地区（地区命中头 x-region-served 来源；与结算规则 region 区分）
  realized_actual?: number[]      // 评估用实发（回测口径）；缺省用三点分布均值
}

export type CopilotDeclaration = {
  declaration_mw: number[]
  revenue_yuan: number
  assessment_fee_yuan: number
  net_yuan: number
  deviation_mwh: number
  feasible: boolean
  capacity_ok: boolean
  ramp_ok: boolean
  nonneg_ok: boolean
  label: string
}

export type DeviationCopilotResult = {
  forecast: { points: number[]; lower: number[]; upper: number[]; basis: ForecastBasis; unit: string; target: string }
  copilot: {
    region: string
    kind: string
    spec: {
      region: string
      tolerance_pct: number
      assessment_price: number
      cost_under_rate: number
      cost_over_rate: number
      ramp_limit_pct: number
      capacity_mw?: number
      source: string
      mock_fields: string[]
    }
    points: number
    baseline: CopilotDeclaration
    optimized: CopilotDeclaration
    fell_back_to_baseline?: boolean
    g1_fee_below_baseline: boolean
    g2_revenue_not_worse: boolean
    g3_feasible: boolean
    fee_reduction_yuan: number
    revenue_gain_yuan: number
    hitl_required: boolean
    notes: string[]
  }
  mock: boolean
  source_type: string
  productionWrite: boolean
}

export function fetchDeviationBidCopilot(req: DeviationBidCopilotRequest): Promise<DeviationCopilotResult> {
  return post('/deviation-bid-copilot', req)
}

export function runForecastTrain(req: ForecastRequest): Promise<{
  task: Record<string, unknown>
  basis: ForecastBasis
  model_version: string | null
  metrics: ForecastMetrics
  baseline_metrics: ForecastBaselineMetrics
  warnings: string[]
}> {
  return post('/train', req)
}

// L2 扩展端点：超短期 / 中长期 / 偏差考核 / 序列预测（后端 forecast.py 已实现）

// 超短期滚动预测（下一 15min，误差远低于日前）
export type UltraShortResult = {
  target: string
  basis: ForecastBasis
  horizon: string
  points: number[]
}
export function runUltraShort(req: ForecastRequest): Promise<UltraShortResult> {
  return post('/ultra-short', req)
}

// 中长期日均电价趋势（未来 N 天，服务中长期签约/套保）
export type MidtermResult = {
  basis: ForecastBasis
  horizon_days: number
  daily_avg_price: number[]
  mae: number
  persistence_mae: number
  // persistence_mae==0 时后端返 null（midterm.py），前端须按可空渲染（B17）。
  mase_vs_persistence: number | null
  beats_persistence: boolean
  unit: string
}
export function runMidterm(req: ForecastRequest, horizonDays = 14): Promise<MidtermResult> {
  return post(`/midterm?horizon_days=${horizonDays}`, req)
}

// 偏差考核风险（申报 vs 实际偏差罚款的期望/最坏估计）
export type DeviationRiskRequest = ForecastRequest & {
  tolerance_pct?: number
  assessment_price?: number
  segment_factors?: number[]       // 逐时段考核价系数(SettlementRuleSpec.timeSegmentFactors，G3.1)
  slot_hours?: number              // 每时段时长(h)，缺省按点数推断
  declared_mw?: number[]
  // 直接传入实际/预测出力(站级 generator 用)，给定则后端跳过内部 run_forecast
  actual_points?: number[]
  actual_lower?: number[]
  actual_upper?: number[]
}
export type DeviationRiskResult = {
  forecast: { points: number[]; lower: number[]; upper: number[]; basis: ForecastBasis; unit: string; target: string }
  deviation_risk: {
    expected_total_penalty_yuan: number
    worst_total_penalty_yuan: number
    high_risk_slots: number
    tolerance_pct: number
    assessment_price: number
    tolerance_band_mw: number        // 逐时段免考核带均值(±MW)
    slot_hours?: number
    segmented?: boolean
    // #1575/#1649：未提供可用 P10/P90 分位带（站级 generator 传 actual_lower/upper=None 常态）时
    // 后端标 ci_available=false 且 worst 退化为 expected，前端不得把 worst 渲染成「最坏罚款」红字。
    ci_available: boolean
    per_slot?: { slot: number; expected_penalty: number; worst_penalty: number }[]
  }
}
export function runDeviationRisk(req: DeviationRiskRequest): Promise<DeviationRiskResult> {
  return post('/deviation-risk', req)
}

// PatchTST 序列预测（前日 96 点 → 次日 96 点，深度时序）。
// 判别联合（B18）：available=false 时后端只回 {available,reason}（无 torch/样本<30 必然命中，
// 见 sequence_forecast.py:41,49），不含指标/points；available=true 才有完整结果。消费方须先判 available。
export type PatchtstResult =
  | { available: false; reason: string }
  | {
      available: true
      basis: ForecastBasis
      horizon: string
      n_test_days: number
      mae: number
      persistence_mae: number
      mase_vs_persistence: number | null   // naive_mae==0 时后端返 null（B17）
      beats_persistence: boolean
      points: number[]
    }
export function runPatchtstSeq(req: ForecastRequest): Promise<PatchtstResult> {
  return post('/patchtst-seq', req)
}

// 站级发电量预测（光伏出力，G1.2/G1.3 + G2 真实数据接入）
// 前端传入 company station 的 station_id + installed_capacity(MW)。
// G2：data_source=auto/real 时后端优先用站级真实出力训练(basis=real)，缺则合成；
// weather_points 提供真实预测日气象则升 sourceType=MIXED/REAL，否则合成典型日 → MOCK。
export type StationGenerationWeatherPoint = {
  hour: number
  radiation?: number
  temperature?: number
  humidity?: number
  wind_speed?: number
  cloud_cover?: number
}
export type StationGenerationRequest = {
  station_id: string
  installed_capacity: number       // MW
  station_type?: string
  model_type?: string
  date?: string                    // YYYY-MM-DD，默认今天
  region_id?: string               // 站级真实出力按地区隔离加载(G2.1)
  data_source?: 'auto' | 'synthetic' | 'real'
  weather_points?: StationGenerationWeatherPoint[]   // 真实预测日气象(G2.2)
}
export type StationGenerationPoint = {
  hour: number
  power_mw: number
  lower_mw: number
  upper_mw: number
}
// 晴空基线 / 历史实际出力（#765 PR-2 三线对比）；mw=null 表示该时段无数据
export type StationHourMwPoint = {
  hour: number
  mw: number | null
}
export type StationGenerationResult = {
  station_id: string
  installed_capacity_mw: number
  station_type: string
  model_type: string
  region_id?: string
  date: string
  unit: string
  points: StationGenerationPoint[]
  clearsky_baseline_mw: StationHourMwPoint[]   // 无云理论出力（pvlib 晴空 GHI × 装机 × PR，非实测）
  actual_mw: StationHourMwPoint[] | null        // 历史实际出力回放；未来日/无数据为 null（不合成）
  peak_mw: number
  daily_energy_mwh: number
  data_source?: string
  train_basis?: 'real' | 'synthetic'
  weather_basis?: 'real' | 'synthetic'
  basis: string
  sourceType: string
  mock: boolean
  productionWrite: boolean
  warnings: string[]
}
export function runStationGeneration(req: StationGenerationRequest): Promise<StationGenerationResult> {
  return post('/station-generation', req)
}

// 预测日真实 NWP（Open-Meteo 免费源，G2.2 / #844）
// 前端预测前先取预测日逐时气象 → 填 station-generation 的 weather_points → weather_basis=real。
// 走 /v1/weather/day-forecast（与 station-generation 同源解析坐标：region_id+station_id）；
// 拿不到/部分覆盖则不传 weather_points，后端自动合成典型日回退 + 既有 warning。
// 前端做当日缓存（同 date+坐标不重复拉），守 Open-Meteo 免费源 10k 请求/日限额。
const WEATHER_BASE = `${AGENT_API_BASE_ROOT}/v1/weather`

export type DayWeatherPoint = {
  hour: number
  radiation: number      // GHI W/m²（Open-Meteo shortwave_radiation）
  temperature: number
  humidity: number
  wind_speed: number     // m/s
  cloud_cover: number
}
export type DayWeatherResult = {
  date: string
  points: DayWeatherPoint[]          // 形状同 StationGenerationWeatherPoint，可直接作 weather_points 传入
  n_points: number
  source: string                     // 'Open-Meteo'
  sourceType: string                 // 'REAL'（NWP 为真实气象源）；缺数/超窗时 points=[] 仍标 REAL（非合成冒充）
  mock: boolean
  productionWrite: boolean
  note: string                       // 取数来源（历史 Archive/预报 Forecast）或失败原因
}

// 当日缓存：会话内同 date+坐标只拉一次 Open-Meteo（key 含 date/region/station/显式坐标）。
const dayWeatherCache = new Map<string, DayWeatherResult>()

export async function fetchDayWeather(req: {
  date?: string                      // YYYY-MM-DD，缺省走后端「今天」（与 station-generation 默认同源，避免前端时区漂移）
  region_id?: string
  station_id?: string
  lat?: number
  lon?: number
}): Promise<DayWeatherResult> {
  const cacheKey = `d=${req.date ?? ''}|r=${req.region_id ?? ''}|s=${req.station_id ?? ''}|lat=${req.lat ?? ''}|lon=${req.lon ?? ''}`
  const cached = dayWeatherCache.get(cacheKey)
  if (cached) return cached
  const params = new URLSearchParams()
  if (req.date) params.set('date', req.date)
  if (req.region_id) params.set('region_id', req.region_id)
  if (req.station_id) params.set('station_id', req.station_id)
  if (req.lat != null) params.set('lat', String(req.lat))
  if (req.lon != null) params.set('lon', String(req.lon))
  const res = await fetch(`${WEATHER_BASE}/day-forecast?${params.toString()}`, {
    headers: { 'x-region-id': currentRegion.value.id, ...identityHeaders() },
    signal: timeoutSignal(FORECAST_METADATA_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`真实气象取数失败: ${res.status}`)
  applyRegionHeaders(res)   // 回读地区命中头（B03）
  const body = (await res.json()) as DayWeatherResult
  dayWeatherCache.set(cacheKey, body)
  return body
}
