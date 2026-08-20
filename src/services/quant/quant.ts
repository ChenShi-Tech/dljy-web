import type { DataBasis } from '@/services/dataBasis'
// 仅类型导入（被 --experimental-strip-types 擦除）：保持本模块运行时自包含，verify:quant-logic
// 才能用裸 strip-types 直跑。地区结算计算经 resolveDeviation 由视图注入（见 buildOodaDecision）。
// 仅类型导入（被 strip-types 擦除）：学习胜率由视图注入（tradingMemory.getRegionWinStats）。
import type { WinStats } from '@/services/tradingMemory'

// 偏差考核的输入/输出契约。原定义在 services/labSettlement.ts，该模块的唯一实现
// computeRegionDeviation 只被交易策略实验室调用，随 #1799 一并删除；此处保留类型契约，
// 供未来接入方（如复盘中心接偏差考核）按同一形状注入自己的解析器。
export type LabDeviationInput = {
  regionId: string
  /** 申报 / 合约电量 MWh */
  declaredMwh: number
  /** 实际电量 MWh（与申报的差即偏差电量） */
  actualMwh: number
  /** 考核基准用日前价 元/MWh */
  daPrice: number
  /** 考核基准用实时价 元/MWh */
  rtPrice: number
  /** 偏差主要落在哪个小时（用于取该时段考核系数）；缺省 1.0 */
  segmentHour?: number
  /** 地区未参数化时的回退容差带 %（研究默认） */
  fallbackTolerancePct: number
  /** 地区未参数化时的回退考核单价 元/MWh（研究默认） */
  fallbackAssessmentPrice: number
}

export type LabDeviationResult = {
  /** 考核费用 万元（考核电量 × 考核单价 × 分时段系数 / 10000） */
  assessmentFeeWan: number
  /** 偏差电量 MWh（带符号：实际−申报） */
  deviationMwh: number
  /** 免考核带电量 MWh */
  toleranceBandMwh: number
  /** 超带的考核电量 MWh */
  assessableMwh: number
  /** 实际生效的容差带 % */
  tolerancePct: number
  /** 实际生效的考核单价 元/MWh */
  assessmentPrice: number
  /** 分时段考核系数 */
  segmentFactor: number
  /** 是否落在免考核带内（无考核费） */
  withinTolerance: boolean
  /** 是否用了地区权威规则（false=回退通用口径） */
  ruleApplied: boolean
  /** 规则标签，例如「云南·征求意见稿 v0.1」或「通用口径(未参数化结算规则)」 */
  ruleLabel: string
}

/** 偏差考核解析器：由视图注入；未注入时用 OODA_DEVIATION_FALLBACK。 */
export type LabDeviationResolver = (input: LabDeviationInput) => LabDeviationResult

const OODA_DEVIATION_FALLBACK: LabDeviationResult = {
  assessmentFeeWan: 0,
  deviationMwh: 0,
  toleranceBandMwh: 0,
  assessableMwh: 0,
  tolerancePct: 0,
  assessmentPrice: 0,
  segmentFactor: 1,
  withinTolerance: true,
  ruleApplied: false,
  ruleLabel: '通用口径(未参数化结算规则)'
}

export type PricePoint = {
  hour: number
  price: number
}

export type StorageParams = {
  powerMw: number
  energyMwh: number
  chargeEfficiency: number
  dischargeEfficiency: number
  minSoc: number
  maxSoc: number
  initialSoc: number
  riskBudgetPct: number
  contractPrice: number
  deviationPenaltyPct: number
  /** 峰谷阈值的波动带倍数 σ（analyzePriceCurve 判峰/谷），可选；缺省 0.65。地区可经 deriveRegionTradingParams 校准注入。 */
  peakValleySigma?: number
}

export type PriceCurveStats = {
  mean: number
  min: number
  max: number
  stdDev: number
  peakHours: number[]
  valleyHours: number[]
  spread: number
}

export type ArbitrageOpportunity = {
  chargeHour: number
  dischargeHour: number
  chargePrice: number
  dischargePrice: number
  spread: number
  energyMwh: number
  chargeCostWan: number
  dischargeRevenueWan: number
  netRevenueWan: number
  returnPct: number
}

export type KellyResult = {
  rawFraction: number
  halfKellyFraction: number
  riskAdjustedFraction: number
  recommendedMwh: number
  edge: number
  payoffRatio: number
}

export type SettlementComparison = {
  mode: 'full-spot' | 'contract-deviation'
  label: string
  revenueWan: number
  costWan: number
  penaltyWan: number
  netWan: number
}

export type OodaRiskMetrics = {
  var95Wan: number
  cvar95Wan: number
  maxLossWan: number
  riskLevel: '低' | '中' | '高'
  // 样本不足（少于 RISK_MIN_SAMPLE）时为 true，UI 必须提示“仅供参考”
  insufficientSample: boolean
}

export type OodaAssumptions = {
  winProbability: number
  // 胜率来源：'heuristic'=无历史样本时的启发式占位（不得当作实测胜率）；
  // 'learned-bayesian'=已有多日回填，用 Beta-Binomial 后验（H8 学习）
  winProbabilityBasis: 'heuristic' | 'learned-bayesian'
  // 学习样本量（0=纯启发式）
  winProbabilitySampleSize: number
  // 失败损失模型：充电后被迫在“充电时点之后的最低价”放电的最坏可行结果
  lossModel: 'worst-feasible-discharge'
  // 偏差考核模型：储能按计划精确充放（实际=申报），偏差电量≈0，主要透出免考核带口径；
  // 预测不确定主体（新能源）的真实偏差分布建模留待后续批次
  deviationModel: 'precise-dispatch'
}

export type OodaDecision = {
  stats: PriceCurveStats
  opportunity: ArbitrageOpportunity | null
  kelly: KellyResult
  risk: OodaRiskMetrics
  settlement: SettlementComparison[]
  // 偏差考核所用结算规则标签（H1）：地区已参数化→效力标注；未参数化→「通用口径」
  settlementRuleLabel: string
  basis: DataBasis
  assumptions: OodaAssumptions
  stages: Array<{
    key: string
    name: string
    status: string
    output: string
  }>
}

export const defaultPriceCurve: PricePoint[] = [
  45, 42, 40, 38, 40, 48, 65, 85, 105, 120, 125, 118,
  110, 108, 112, 120, 130, 135, 125, 95, 75, 60, 52, 48
].map((price, index) => ({ hour: index, price }))

export const defaultStorageParams: StorageParams = {
  powerMw: 100,
  energyMwh: 200,
  chargeEfficiency: 95,
  dischargeEfficiency: 95,
  minSoc: 10,
  maxSoc: 90,
  initialSoc: 50,
  riskBudgetPct: 18,
  contractPrice: 280,
  // 占位默认值：真实偏差考核是“电量偏差超容差带按规则价分时段结算”，P2 改读地区 SettlementRuleSpec
  deviationPenaltyPct: 12,
  // 峰谷判定 σ 倍数默认值（与 analyzePriceCurve 内回退一致）；地区未校准时即此值。
  peakValleySigma: 0.65
}

// CVaR@95 的最小样本数；24 点曲线只有 23 个差分样本，必须标注样本不足
const RISK_MIN_SAMPLE = 30

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function analyzePriceCurve(points: PricePoint[], peakValleySigma = 0.65): PriceCurveStats {
  // 空曲线短路：否则 Math.min(...[])=Infinity / Math.max(...[])=-Infinity，spread=-Infinity，
  // KPI 卡（均价/峰谷价差）直接插值出 Infinity/-Infinity（OODA-1）。
  if (!points.length) {
    return { mean: 0, min: 0, max: 0, stdDev: 0, peakHours: [], valleyHours: [], spread: 0 }
  }
  const prices = points.map((point) => Number(point.price) || 0)
  const mean = prices.reduce((sum, price) => sum + price, 0) / Math.max(prices.length, 1)
  const variance = prices.reduce((sum, price) => sum + (price - mean) ** 2, 0) / Math.max(prices.length, 1)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const sigma = Number.isFinite(peakValleySigma) ? peakValleySigma : 0.65
  const peakThreshold = mean + Math.sqrt(variance) * sigma
  const valleyThreshold = mean - Math.sqrt(variance) * sigma

  return {
    mean: round(mean),
    min,
    max,
    stdDev: round(Math.sqrt(variance)),
    peakHours: points.filter((point) => point.price >= peakThreshold).map((point) => point.hour),
    valleyHours: points.filter((point) => point.price <= valleyThreshold).map((point) => point.hour),
    spread: round(max - min)
  }
}

export function detectPeakValleyArbitrage(points: PricePoint[], params: StorageParams): ArbitrageOpportunity | null {
  if (points.length < 2) return null

  // 在时间序上找“先低后高”的最大价差对：充电必须早于放电，物理可行由构造保证。
  // 无可行对（如价格单调下行）时返回 null，绝不回退到时序不可行的组合。
  let runningLow = points[0]
  let charge: PricePoint | null = null
  let discharge: PricePoint | null = null
  let bestSpread = -Infinity
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    const candidate = point.price - runningLow.price
    if (candidate > bestSpread) {
      bestSpread = candidate
      charge = runningLow
      discharge = point
    }
    if (point.price < runningLow.price) runningLow = point
  }
  if (!charge || !discharge || bestSpread <= 0) return null
  const spread = bestSpread

  const usableSoc = Math.max(params.maxSoc - params.minSoc, 0) / 100
  // 单小时充/放窗口（24 点曲线一格 1h）：可调度电量受 SOC 可用域与“功率×窗口时长”双重约束。
  // energyMwh 与 powerMw 量纲不同，必须乘窗口时长后才能比较。
  const dispatchWindowHours = 1
  const usableEnergy = Math.min(params.energyMwh * usableSoc, params.powerMw * dispatchWindowHours)
  const chargedEnergy = usableEnergy / Math.max(params.chargeEfficiency / 100, 0.01)
  const dischargedEnergy = usableEnergy * (params.dischargeEfficiency / 100)
  const chargeCostWan = (chargedEnergy * charge.price) / 10000
  const dischargeRevenueWan = (dischargedEnergy * discharge.price) / 10000
  const netRevenueWan = dischargeRevenueWan - chargeCostWan

  return {
    chargeHour: charge.hour,
    dischargeHour: discharge.hour,
    chargePrice: charge.price,
    dischargePrice: discharge.price,
    spread: round(spread),
    energyMwh: round(usableEnergy),
    chargeCostWan: round(chargeCostWan, 4),
    dischargeRevenueWan: round(dischargeRevenueWan, 4),
    netRevenueWan: round(netRevenueWan, 4),
    returnPct: round(chargeCostWan > 0 ? (netRevenueWan / chargeCostWan) * 100 : 0)
  }
}

export function calculateKelly(winProbability: number, winPayoff: number, losePayoff: number, params: StorageParams): KellyResult {
  const p = Math.min(Math.max(winProbability, 0), 1)
  const loss = Math.max(Math.abs(losePayoff), 0.01)
  const payoffRatio = Math.max(winPayoff / loss, 0.01)
  const rawFraction = Math.max(0, (payoffRatio * p - (1 - p)) / payoffRatio)
  const halfKellyFraction = rawFraction * 0.5
  const riskAdjustedFraction = Math.min(halfKellyFraction, params.riskBudgetPct / 100)
  const usableEnergy = params.energyMwh * Math.max(params.maxSoc - params.minSoc, 0) / 100

  return {
    rawFraction: round(rawFraction * 100, 2),
    halfKellyFraction: round(halfKellyFraction * 100, 2),
    riskAdjustedFraction: round(riskAdjustedFraction * 100, 2),
    recommendedMwh: round(usableEnergy * riskAdjustedFraction),
    edge: round(payoffRatio * p - (1 - p), 4),
    payoffRatio: round(payoffRatio, 2)
  }
}

// 失败情形损失估计（万元）：充电已发生、被迫在充电时点之后的最低价放电的最坏可行结果。
// 数据驱动（来自同一条曲线），替代旧实现用“价格标准差”冒充损失的做法。
function estimateDownsideWan(points: PricePoint[], params: StorageParams, opportunity: ArbitrageOpportunity | null): number {
  if (!opportunity) return 0.01
  const after = points.filter((point) => point.hour > opportunity.chargeHour)
  if (!after.length) return Math.max(opportunity.chargeCostWan, 0.01)
  const worstPrice = Math.min(...after.map((point) => point.price))
  const dischargedEnergy = opportunity.energyMwh * (params.dischargeEfficiency / 100)
  const worstRevenueWan = (dischargedEnergy * worstPrice) / 10000
  return Math.max(opportunity.chargeCostWan - worstRevenueWan, 0.01)
}

export function buildRiskMetrics(points: PricePoint[], opportunity: ArbitrageOpportunity | null): OodaRiskMetrics {
  // 相邻时点价差仅作日内波动代理（非策略损益分布）；时序差分截断到曲线末点，
  // 不做环绕，23:00 与次日 00:00 不属于同一交易日，环绕会制造虚假价差样本。
  // P2 接入多日历史后改为“同充放时段组合”的策略损益样本。
  const spreads: number[] = []
  for (let i = 0; i < points.length - 1; i++) {
    spreads.push((points[i + 1].price - points[i].price) / 10000)
  }
  const insufficientSample = spreads.length < RISK_MIN_SAMPLE
  if (!spreads.length) {
    return { var95Wan: 0, cvar95Wan: 0, maxLossWan: 0, riskLevel: '低', insufficientSample: true }
  }
  const sortedLosses = spreads.map((value) => -value).sort((a, b) => b - a)
  const varIndex = Math.min(Math.floor(sortedLosses.length * 0.05), sortedLosses.length - 1)
  const tail = sortedLosses.slice(0, Math.max(varIndex + 1, 1))
  const var95Wan = Math.max(sortedLosses[varIndex] ?? 0, 0) * (opportunity?.energyMwh ?? 100)
  const cvar95Wan = Math.max(tail.reduce((sum, value) => sum + value, 0) / tail.length, 0) * (opportunity?.energyMwh ?? 100)
  const maxLossWan = Math.max(...sortedLosses, 0) * (opportunity?.energyMwh ?? 100)
  const riskScore = cvar95Wan / Math.max(opportunity?.netRevenueWan ?? 1, 0.01)

  return {
    var95Wan: round(var95Wan, 4),
    cvar95Wan: round(cvar95Wan, 4),
    maxLossWan: round(maxLossWan, 4),
    riskLevel: riskScore > 0.75 ? '高' : riskScore > 0.35 ? '中' : '低',
    insufficientSample
  }
}

function compareSettlement(
  opportunity: ArbitrageOpportunity | null,
  params: StorageParams,
  regionId?: string,
  resolveDeviation?: LabDeviationResolver
): { comparisons: SettlementComparison[]; ruleLabel: string } {
  if (!opportunity) {
    return {
      comparisons: [
        { mode: 'full-spot', label: '全现货', revenueWan: 0, costWan: 0, penaltyWan: 0, netWan: 0 },
        { mode: 'contract-deviation', label: '合约+偏差', revenueWan: 0, costWan: 0, penaltyWan: 0, netWan: 0 }
      ],
      ruleLabel: '—'
    }
  }

  const fullSpot: SettlementComparison = {
    mode: 'full-spot',
    label: '全现货',
    revenueWan: opportunity.dischargeRevenueWan,
    costWan: opportunity.chargeCostWan,
    penaltyWan: 0,
    netWan: opportunity.netRevenueWan
  }

  // H1：偏差考核接地区权威结算口径（免考核带 + 超带按考核单价分时段结算），替代旧
  // 「|放电价−合约价|×电量×罚比%」自创口径。储能按计划精确充放（实际=申报）→偏差≈0、
  // 主要透出免考核带；地区未参数化时回退研究默认并显式标注，不静默套用别省规则。
  // resolveDeviation 由视图注入；当前无注入方（#1799 后），一律走 fallback。
  const deviationInput: LabDeviationInput = {
    regionId: regionId ?? '',
    declaredMwh: opportunity.energyMwh,
    actualMwh: opportunity.energyMwh,
    daPrice: opportunity.chargePrice,
    rtPrice: opportunity.dischargePrice,
    segmentHour: opportunity.dischargeHour,
    fallbackTolerancePct: 3,
    fallbackAssessmentPrice: params.contractPrice * Math.max(params.deviationPenaltyPct, 0) / 100
  }
  const deviation = resolveDeviation ? resolveDeviation(deviationInput) : OODA_DEVIATION_FALLBACK
  const contractRevenueWan = (opportunity.energyMwh * params.contractPrice) / 10000
  const contractMode: SettlementComparison = {
    mode: 'contract-deviation',
    label: '合约+偏差',
    revenueWan: round(contractRevenueWan, 4),
    costWan: opportunity.chargeCostWan,
    penaltyWan: round(deviation.assessmentFeeWan, 4),
    netWan: round(contractRevenueWan - opportunity.chargeCostWan - deviation.assessmentFeeWan, 4)
  }

  return { comparisons: [fullSpot, contractMode], ruleLabel: deviation.ruleLabel }
}

export function buildOodaDecision(
  points: PricePoint[],
  params: StorageParams,
  basis: DataBasis = 'illustrative',
  regionId?: string,
  resolveDeviation?: LabDeviationResolver,
  learnedWinStats?: WinStats
): OodaDecision {
  const stats = analyzePriceCurve(points, params.peakValleySigma ?? 0.65)
  const opportunity = detectPeakValleyArbitrage(points, params)
  // H8 学习：有多日回填(learnedWinStats.sampleSize>0)时用 Beta-Binomial 后验胜率；否则
  // 退回启发式占位（价差越大胜率越高），并通过 assumptions 显式透出来源。
  const learned = learnedWinStats && learnedWinStats.sampleSize > 0 ? learnedWinStats : null
  const heuristicWinProb = Math.min(0.82, Math.max(0.5, 0.5 + stats.spread / Math.max(stats.max, 1) * 0.25))
  const winProbability = learned ? learned.posteriorWinRate : heuristicWinProb
  const downsideWan = estimateDownsideWan(points, params, opportunity)
  const kelly = calculateKelly(winProbability, Math.max(opportunity?.netRevenueWan ?? 0.01, 0.01), downsideWan, params)
  const risk = buildRiskMetrics(points, opportunity)
  const { comparisons: settlement, ruleLabel: settlementRuleLabel } = compareSettlement(opportunity, params, regionId, resolveDeviation)

  return {
    stats,
    opportunity,
    kelly,
    risk,
    settlement,
    settlementRuleLabel,
    basis,
    assumptions: {
      winProbability: round(winProbability, 3),
      winProbabilityBasis: learned ? 'learned-bayesian' : 'heuristic',
      winProbabilitySampleSize: learned ? learned.sampleSize : 0,
      lossModel: 'worst-feasible-discharge',
      deviationModel: 'precise-dispatch'
    },
    stages: [
      {
        key: 'observe',
        name: 'Observe',
        status: '完成',
        output: `识别 ${stats.valleyHours.length} 个低价时段、${stats.peakHours.length} 个高价时段`
      },
      {
        key: 'orient',
        name: 'Orient',
        status: opportunity ? '可交易' : '观望',
        output: opportunity ? `最大价差 ${opportunity.spread} 元/MWh` : '当前无“先低后高”的可行充放窗口'
      },
      {
        key: 'decide',
        name: 'Decide',
        status: kelly.riskAdjustedFraction > 0 ? '生成仓位' : '空仓',
        output: `Kelly 风险折减仓位 ${kelly.riskAdjustedFraction}%（${learned ? `贝叶斯学习胜率 ${round(winProbability * 100, 1)}%·${learned.sampleSize}样本` : `启发式胜率 ${round(winProbability * 100, 1)}%`}）`
      },
      {
        key: 'act',
        name: 'Act',
        status: opportunity ? '待申报' : '无动作',
        output: opportunity ? `${opportunity.chargeHour}:00 充电，${opportunity.dischargeHour}:00 放电` : '保持现有头寸'
      },
      {
        key: 'learn',
        name: 'Learn',
        status: learned ? `已学习 ${learned.sampleSize} 笔` : '待回填',
        output: learned
          ? `贝叶斯后验胜率 ${round(learned.posteriorWinRate * 100, 1)}%（累计损益 ${learned.cumulativePnlWan} 万元），回填新结果将继续更新`
          : '执行后回填本次盈亏，按 Beta-Binomial 后验逐日学习地区胜率'
      }
    ]
  }
}
