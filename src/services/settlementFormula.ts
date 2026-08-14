/**
 * 电力现货结算口径引擎（纯函数 · 可解释 · 带样例）
 *
 * 本文件是报表系统的「口径层」核心：所有结算 / 收益 / 偏差 / 行情报表的数值都由此处的
 * 纯函数计算，不在视图或后端散落公式。设计约束：
 *   1. 只做数学：不取数、不读地区参数。限价 / 免考核带 / 节点价 vs 统一价等口径开关
 *      由 regionSettlementRules.ts 提供，调用方按地区注入到这里的入参。
 *   2. 零运行时依赖：本模块不 import 任何运行时值（最多 import type），因此可被
 *      `node --experimental-strip-types scripts/verify/report-formula-cases.ts` 直接执行回归，
 *      与 quant.ts / tradingLab.ts 的验证方式一致。
 *   3. 每个核心公式在文件末尾 SETTLEMENT_FORMULA_EXAMPLES 配套样例，被
 *      scripts/verify-report-formulas.mjs 断言，保证口径可复现、不漂移。
 *
 * 业务主线（贯穿全系统）——三部制双结算：
 *   R电费 = Σ Q长·P长 + Σ(Q日前−Q长)·P日前 + Σ(Q实际−Q日前)·P实时
 *   含义：「中长期锁定 → 日前偏差预调 → 实时偏差兜底」，不重复结算、分阶段核算。
 *   发电侧 P 取机组节点电价 LMP，用户侧 P 取统一结算点电价（由调用方按地区口径传入），
 *   二者价差形成阻塞盈余 / 不平衡资金（见 imbalanceFund）。
 */

/** 标量或分时段数组（96 点 / 24 点 / 任意粒度）均可，便于既写算例又传真实曲线。 */
export type Numeric = number | number[]

function toArray(value: Numeric): number[] {
  return Array.isArray(value) ? value.map((v) => Number(v) || 0) : [Number(value) || 0]
}

/** 四舍五入到指定小数位（默认 2 位），与 quant.ts 口径一致。 */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round((Number(value) || 0) * factor) / factor
}

/** Σ q·p：逐时段对齐相乘求和，长度不一致按较短对齐。结算电费的基本算子。 */
export function sumProduct(quantities: Numeric, prices: Numeric): number {
  const q = toArray(quantities)
  const p = toArray(prices)
  const n = Math.min(q.length, p.length)
  let acc = 0
  for (let i = 0; i < n; i++) acc += q[i] * p[i]
  return acc
}

function sum(values: Numeric): number {
  return toArray(values).reduce((a, b) => a + b, 0)
}

/** 逐时段相减（a−b），长度按较长对齐、缺位补 0。偏差电量的基本算子。 */
function subtract(a: Numeric, b: Numeric): number[] {
  const x = toArray(a)
  const y = toArray(b)
  const n = Math.max(x.length, y.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((x[i] ?? 0) - (y[i] ?? 0))
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// 域 C / D：三部制双结算主公式（所有结算与收益报表的根）
// ───────────────────────────────────────────────────────────────────────────

export type ThreePartInput = {
  /** 中长期（净）合约分时电量 MWh */
  qLong: Numeric
  /** 中长期（净）合约分时价 元/MWh */
  pLong: Numeric
  /** 日前出清分时电量 MWh */
  qDayAhead: Numeric
  /** 日前结算价 元/MWh（发电侧=机组节点价 LMP；用户侧=统一结算点价） */
  pDayAhead: Numeric
  /** 实际（上网 / 用电）分时电量 MWh */
  qActual: Numeric
  /** 实时结算价 元/MWh */
  pRealtime: Numeric
}

export type ThreePartResult = {
  /** 中长期电费 = Σ Q长·P长 */
  mediumLongFee: number
  /** 日前偏差电费 = Σ(Q日前−Q长)·P日前 */
  dayAheadDeviationFee: number
  /** 实时偏差电费 = Σ(Q实际−Q日前)·P实时 */
  realtimeDeviationFee: number
  /** 总电费（三段之和） */
  totalFee: number
  /** 结算电量 = Σ Q实际 */
  settlementQuantity: number
  /** 综合结算电价 = 总电费 / 结算电量 元/MWh */
  settlementPrice: number
}

/** 三部制双结算。发电侧收入与用户侧支出共用此式，区别只在传入的 P 口径不同。 */
export function threePartSettlement(input: ThreePartInput): ThreePartResult {
  const mediumLongFee = sumProduct(input.qLong, input.pLong)
  const dayAheadDeviationFee = sumProduct(subtract(input.qDayAhead, input.qLong), input.pDayAhead)
  const realtimeDeviationFee = sumProduct(subtract(input.qActual, input.qDayAhead), input.pRealtime)
  const totalFee = mediumLongFee + dayAheadDeviationFee + realtimeDeviationFee
  const settlementQuantity = sum(input.qActual)
  return {
    mediumLongFee: round(mediumLongFee),
    dayAheadDeviationFee: round(dayAheadDeviationFee),
    realtimeDeviationFee: round(realtimeDeviationFee),
    totalFee: round(totalFee),
    settlementQuantity: round(settlementQuantity),
    settlementPrice: round(settlementQuantity !== 0 ? totalFee / settlementQuantity : 0)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 域 E：偏差考核（免考核带 + 超带按考核单价结算，单价为负置 0）
// ───────────────────────────────────────────────────────────────────────────

export type DeviationAssessmentInput = {
  /** 申报 / 合约电量 MWh（逐时段或汇总均可） */
  qDeclared: Numeric
  /** 实际电量 MWh */
  qActual: Numeric
  /** 免考核带（比例，如 0.03 表示 ±3%）；各省差异，来自 regionSettlementRules */
  tolerance: number
  /** 考核单价 元/MWh；规则规定为负时置 0（不倒贴） */
  assessmentPrice: number
}

export type DeviationAssessmentResult = {
  /** 偏差电量 = Σ Q实际 − Σ Q申报（带符号） */
  deviationQuantity: number
  /** 偏差率 = 偏差电量 / 申报电量 */
  deviationRate: number
  /** 免考核带电量 = |申报| × tolerance */
  toleranceBandQuantity: number
  /** 超免考核带的考核电量 = max(|偏差| − 免考核带, 0) */
  assessableQuantity: number
  /** 考核费用 = 考核电量 × max(考核单价, 0) */
  assessmentFee: number
  /** 是否落在免考核带内 */
  withinTolerance: boolean
}

export function deviationAssessment(input: DeviationAssessmentInput): DeviationAssessmentResult {
  const declared = sum(input.qDeclared)
  const actual = sum(input.qActual)
  const deviation = actual - declared
  const band = Math.abs(declared) * Math.max(input.tolerance, 0)
  const assessable = Math.max(Math.abs(deviation) - band, 0)
  const unitPrice = Math.max(input.assessmentPrice, 0)
  return {
    deviationQuantity: round(deviation),
    deviationRate: round(declared !== 0 ? deviation / declared : 0, 4),
    toleranceBandQuantity: round(band),
    assessableQuantity: round(assessable),
    assessmentFee: round(assessable * unitPrice),
    withinTolerance: assessable <= 0
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 域 B：节点电价 LMP 三分量分解（能量 + 阻塞 + 网损）
// ───────────────────────────────────────────────────────────────────────────

export type LmpComponents = { energy: number; congestion: number; loss: number }

/** LMP = 能量分量 + 阻塞分量 + 网损分量。来自 SCED/SCUC 拉格朗日乘子。 */
export function decomposeLMP(c: LmpComponents): LmpComponents & { lmp: number } {
  const energy = Number(c.energy) || 0
  const congestion = Number(c.congestion) || 0
  const loss = Number(c.loss) || 0
  return { energy: round(energy), congestion: round(congestion), loss: round(loss), lmp: round(energy + congestion + loss) }
}

// ───────────────────────────────────────────────────────────────────────────
// 域 D / H：度电毛利、批零价差
// ───────────────────────────────────────────────────────────────────────────

export type UnitEnergyMarginInput = { revenue: number; cost: number; energyMwh: number }

/** 度电毛利。同时给出元/MWh 与元/度两种口径，电力报表常用后者。 */
export function unitEnergyMargin(input: UnitEnergyMarginInput) {
  const energy = Number(input.energyMwh) || 0
  const grossMargin = (Number(input.revenue) || 0) - (Number(input.cost) || 0)
  const per = (v: number) => (energy !== 0 ? v / energy : 0)
  return {
    grossMargin: round(grossMargin),
    unitRevenue: round(per(input.revenue)),
    unitCost: round(per(input.cost)),
    unitMargin: round(per(grossMargin)),
    unitMarginYuanPerKwh: round(per(grossMargin) / 1000, 4)
  }
}

export type RetailSpreadInput = {
  /** 用户（零售）到户电价 元/MWh */
  retailPrice: number
  /** 购电（批发）成本 元/MWh */
  purchaseCost: number
  /** 输配电价 元/MWh */
  gridTariff: number
  /** 政府性基金及附加 元/MWh */
  govFund: number
  /** 可选电量 MWh：给出则同时算毛利总额 */
  energyMwh?: number
}

/** 售电批零价差 = 用户电价 − 购电成本 − 输配电价 − 政府性基金。售电核心盈利指标。 */
export function retailSpread(input: RetailSpreadInput) {
  const spread = (Number(input.retailPrice) || 0) - (Number(input.purchaseCost) || 0)
    - (Number(input.gridTariff) || 0) - (Number(input.govFund) || 0)
  const result: { spreadYuanPerMwh: number; spreadYuanPerKwh: number; grossProfit?: number } = {
    spreadYuanPerMwh: round(spread),
    spreadYuanPerKwh: round(spread / 1000, 4)
  }
  if (input.energyMwh != null) result.grossProfit = round(spread * input.energyMwh)
  return result
}

// ───────────────────────────────────────────────────────────────────────────
// 域 C：不平衡资金 / 市场盈余、容量电价
// ───────────────────────────────────────────────────────────────────────────

export type ImbalanceInput = {
  /** 用户侧按统一结算点电价支付的能量电费 */
  userEnergyFeeUnified: number
  /** 机组市场化电量按节点价收取的能量电费 */
  generatorEnergyFeeNodal: number
  /** 用户日前申报电量（逐时段）MWh */
  userDayAheadQty: Numeric
  /** 日前机组出清市场电量（逐时段）MWh */
  generatorClearedQty: Numeric
  /** 日前统一价（逐时段）元/MWh */
  pDayAheadUnified: Numeric
  /** 实时统一价（逐时段）元/MWh */
  pRealtimeUnified: Numeric
}

/**
 * 市场盈余 = 用户侧统一价能量电费 − 机组节点价能量电费
 *          = 发用不平衡偏差电费 + 阻塞盈余（不设资金池，分类疏导）。
 * 发用不平衡偏差电费 = Σ(Q用户日前 − Q机组出清)·(P日前统一 − P实时统一)。
 */
export function imbalanceFund(input: ImbalanceInput) {
  const marketSurplus = (Number(input.userEnergyFeeUnified) || 0) - (Number(input.generatorEnergyFeeNodal) || 0)
  const imbalanceFee = sumProduct(
    subtract(input.userDayAheadQty, input.generatorClearedQty),
    subtract(input.pDayAheadUnified, input.pRealtimeUnified)
  )
  return {
    marketSurplus: round(marketSurplus),
    imbalanceFee: round(imbalanceFee),
    congestionSurplus: round(marketSurplus - imbalanceFee)
  }
}

export type CapacityAllocationInput = {
  /** 全市场应回收容量电费总额 元 */
  totalCapacityFee: number
  /** 该用户当月用电量 MWh */
  userConsumptionMwh: number
  /** 全部工商业用户当月总用电量 MWh */
  totalUserConsumptionMwh: number
}

/** 用户分摊容量电费 = 总额 × (用户用电量 / 全部工商业用户总用电量)。 */
export function capacityFeeAllocation(input: CapacityAllocationInput) {
  const share = input.totalUserConsumptionMwh !== 0
    ? input.userConsumptionMwh / input.totalUserConsumptionMwh
    : 0
  return { allocationShare: round(share, 6), allocatedFee: round(input.totalCapacityFee * share) }
}

export type CapacityRevenueInput = {
  /** 容量电价 元/kW·年（如煤电全国统一 330） */
  capacityPriceYuanPerKwYear: number
  /** 机组申报最大出力 kW */
  capacityKw: number
  /** 容量考核系数（0~1，默认 1） */
  assessmentCoeff?: number
  /** 回收比例（如 2026 起 ≥0.5），默认 1 表示足额 */
  recoveryRatio?: number
}

/** 机组月度容量电费 = 容量电价 ÷ 12 × 申报最大出力 × 考核系数 × 回收比例。 */
export function monthlyCapacityRevenue(input: CapacityRevenueInput) {
  const coeff = input.assessmentCoeff ?? 1
  const recovery = input.recoveryRatio ?? 1
  const annual = (Number(input.capacityPriceYuanPerKwYear) || 0) * (Number(input.capacityKw) || 0) * coeff * recovery
  return { annualFee: round(annual), monthlyFee: round(annual / 12) }
}

// ───────────────────────────────────────────────────────────────────────────
// 域 G：持仓覆盖 / 风险敞口、VaR / CVaR
// ───────────────────────────────────────────────────────────────────────────

/** 持仓覆盖率 = 已对冲电量 / 预测电量；未对冲敞口 = 预测 − 已对冲。 */
export function hedgeCoverage(input: { contractedMwh: number; forecastMwh: number }) {
  const cov = input.forecastMwh !== 0 ? input.contractedMwh / input.forecastMwh : 0
  return { coverageRate: round(cov, 4), openExposureMwh: round(input.forecastMwh - input.contractedMwh) }
}

export type VarCvarResult = {
  /** 在险价值（给定置信水平下的潜在最大损失，>=0） */
  var: number
  /** 条件在险价值 / 期望损失（尾部平均，>=0） */
  cvar: number
  confidence: number
  sampleCount: number
  /** 样本不足（< minSample）时为 true，UI 必须提示“仅供参考” */
  insufficientSample: boolean
}

/**
 * 历史模拟法 VaR / CVaR。pnl 为盈亏样本（正=盈利，负=亏损），损失 = −pnl。
 * 电价尖峰厚尾，故同时给 CVaR 度量尾部。与 quant.ts buildRiskMetrics 同口径。
 */
export function varCvar(pnl: number[], confidence = 0.95, minSample = 30): VarCvarResult {
  const losses = pnl.map((v) => -(Number(v) || 0)).sort((a, b) => b - a)
  if (!losses.length) return { var: 0, cvar: 0, confidence, sampleCount: 0, insufficientSample: true }
  const idx = Math.min(Math.floor(losses.length * (1 - confidence)), losses.length - 1)
  const tail = losses.slice(0, idx + 1)
  const varVal = Math.max(losses[idx] ?? 0, 0)
  const cvar = Math.max(tail.reduce((a, b) => a + b, 0) / tail.length, 0)
  return { var: round(varVal, 4), cvar: round(cvar, 4), confidence, sampleCount: losses.length, insufficientSample: losses.length < minSample }
}

// ───────────────────────────────────────────────────────────────────────────
// 域 B / F：中标率、价格统计（分位 / 峰谷价差 / 波动率 / 负电价）
// ───────────────────────────────────────────────────────────────────────────

/** 中标率 = 中标电量 / 申报电量。 */
export function clearedRatio(input: { clearedMwh: Numeric; declaredMwh: Numeric }) {
  const cleared = sum(input.clearedMwh)
  const declared = sum(input.declaredMwh)
  return { clearedMwh: round(cleared), declaredMwh: round(declared), clearedRatio: round(declared !== 0 ? cleared / declared : 0, 4) }
}

/** 线性插值分位数（0~1）。 */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * Math.min(Math.max(q, 0), 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export type PriceStatsResult = {
  mean: number
  std: number
  min: number
  max: number
  /** 峰谷价差 = max − min */
  peakValleySpread: number
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
  /** 负电价时段计数 */
  negativeCount: number
}

/** 行情价格统计：均值 / 标准差 / 分位 / 峰谷价差 / 负电价时段。 */
export function priceStats(prices: number[]): PriceStatsResult {
  const arr = prices.map((v) => Number(v) || 0)
  if (!arr.length) {
    return { mean: 0, std: 0, min: 0, max: 0, peakValleySpread: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, negativeCount: 0 }
  }
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length
  const sorted = [...arr].sort((a, b) => a - b)
  return {
    mean: round(mean),
    std: round(Math.sqrt(variance)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    peakValleySpread: round(sorted[sorted.length - 1] - sorted[0]),
    p5: round(quantile(sorted, 0.05)),
    p25: round(quantile(sorted, 0.25)),
    p50: round(quantile(sorted, 0.5)),
    p75: round(quantile(sorted, 0.75)),
    p95: round(quantile(sorted, 0.95)),
    negativeCount: arr.filter((v) => v < 0).length
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 域 D：收益归因（把盈亏拆段并校验合计，保证归因可加总）
// ───────────────────────────────────────────────────────────────────────────

export type AttributionLeg = { label: string; amount: number }

/** 收益归因：各分项金额 + 占比，合计应等于综合收益。 */
export function revenueAttribution(legs: AttributionLeg[]) {
  const total = legs.reduce((a, l) => a + (Number(l.amount) || 0), 0)
  return {
    legs: legs.map((l) => ({ label: l.label, amount: round(l.amount), share: round(total !== 0 ? l.amount / total : 0, 4) })),
    total: round(total)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 样例（被 scripts/verify-report-formulas.mjs 断言，保证口径不漂移）
// ───────────────────────────────────────────────────────────────────────────

export type FormulaExample = {
  name: string
  run: () => unknown
  expect: Record<string, number | boolean>
}

export const SETTLEMENT_FORMULA_EXAMPLES: FormulaExample[] = [
  {
    name: '三部制双结算主公式（Q长30@340, 日前32@80, 实际29@10）',
    run: () => threePartSettlement({ qLong: [30], pLong: [340], qDayAhead: [32], pDayAhead: [80], qActual: [29], pRealtime: [10] }),
    // 10200 + 160 + (−30) = 10330；综合电价 10330/29 ≈ 356.21
    expect: { mediumLongFee: 10200, dayAheadDeviationFee: 160, realtimeDeviationFee: -30, totalFee: 10330, settlementQuantity: 29, settlementPrice: 356.21 }
  },
  {
    name: '三部制 96 点逐时段聚合（恒定量价等价于标量）',
    run: () => threePartSettlement({
      qLong: Array(96).fill(30 / 96), pLong: Array(96).fill(340),
      qDayAhead: Array(96).fill(32 / 96), pDayAhead: Array(96).fill(80),
      qActual: Array(96).fill(29 / 96), pRealtime: Array(96).fill(10)
    }),
    expect: { totalFee: 10330, settlementQuantity: 29 }
  },
  {
    name: '偏差考核：申报100、实际108、免考核带3%、考核单价50 → 考核电量5、考核费250',
    run: () => deviationAssessment({ qDeclared: 100, qActual: 108, tolerance: 0.03, assessmentPrice: 50 }),
    // |108−100|=8，免考核带=100×3%=3，考核电量=8−3=5，考核费=5×50=250
    expect: { deviationQuantity: 8, toleranceBandQuantity: 3, assessableQuantity: 5, assessmentFee: 250, withinTolerance: false }
  },
  {
    name: '偏差考核：落在免考核带内（实际102，带3%）→ 不考核',
    run: () => deviationAssessment({ qDeclared: 100, qActual: 102, tolerance: 0.03, assessmentPrice: 50 }),
    expect: { assessableQuantity: 0, assessmentFee: 0, withinTolerance: true }
  },
  {
    name: '考核单价为负时置 0（不倒贴）',
    run: () => deviationAssessment({ qDeclared: 100, qActual: 120, tolerance: 0, assessmentPrice: -80 }),
    expect: { assessableQuantity: 20, assessmentFee: 0 }
  },
  {
    name: 'LMP 三分量：能量300 + 阻塞45 + 网损12 = 357',
    run: () => decomposeLMP({ energy: 300, congestion: 45, loss: 12 }),
    expect: { energy: 300, congestion: 45, loss: 12, lmp: 357 }
  },
  {
    name: '度电毛利：收入50万、成本36.1万、电量1000MWh → 度电毛利139元/MWh=0.139元/度',
    run: () => unitEnergyMargin({ revenue: 500000, cost: 361000, energyMwh: 1000 }),
    expect: { grossMargin: 139000, unitMargin: 139, unitMarginYuanPerKwh: 0.139 }
  },
  {
    name: '售电批零价差：450 − 300 − 130 − 5 = 15元/MWh=0.015元/度',
    run: () => retailSpread({ retailPrice: 450, purchaseCost: 300, gridTariff: 130, govFund: 5, energyMwh: 1000 }),
    expect: { spreadYuanPerMwh: 15, spreadYuanPerKwh: 0.015, grossProfit: 15000 }
  },
  {
    name: '容量分摊：总额120万 × (用户800/总8000) = 12万',
    run: () => capacityFeeAllocation({ totalCapacityFee: 1200000, userConsumptionMwh: 800, totalUserConsumptionMwh: 8000 }),
    expect: { allocationShare: 0.1, allocatedFee: 120000 }
  },
  {
    name: '月度容量电费：330元/kW·年 × 100000kW × 50%回收 ÷ 12',
    run: () => monthlyCapacityRevenue({ capacityPriceYuanPerKwYear: 330, capacityKw: 100000, recoveryRatio: 0.5 }),
    // 年=330×100000×0.5=16,500,000；月=1,375,000
    expect: { annualFee: 16500000, monthlyFee: 1375000 }
  },
  {
    name: '持仓覆盖：已对冲850 / 预测1000 = 85%，敞口150',
    run: () => hedgeCoverage({ contractedMwh: 850, forecastMwh: 1000 }),
    expect: { coverageRate: 0.85, openExposureMwh: 150 }
  },
  {
    name: '中标率：中标320 / 申报400 = 80%',
    run: () => clearedRatio({ clearedMwh: 320, declaredMwh: 400 }),
    expect: { clearedRatio: 0.8 }
  },
  {
    name: '收益归因合计校验：三段相加 = 综合收益',
    run: () => revenueAttribution([
      { label: '中长期', amount: 10200 },
      { label: '日前偏差', amount: 160 },
      { label: '实时偏差', amount: -30 }
    ]),
    expect: { total: 10330 }
  }
]
