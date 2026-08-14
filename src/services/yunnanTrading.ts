export type PriceMode = 'unified' | 'node'
export type RetailPackageModel = 'fixed' | 'timeOfUse' | 'passThrough' | 'hybrid'
export type RiskLevel = 'low' | 'medium' | 'high'

export type YunnanRetailCustomer = {
  id: string
  name: string
  industry: string
  nodeName: string
  nodePriceTrial: boolean
  monthlyMwh: number
  packageId: string
  contractCoverage: number
  forecastCurve: number[]
  actualCurve: number[]
}

export type YunnanRetailPackage = {
  id: string
  name: string
  model: RetailPackageModel
  summary: string
  flatPrice?: number
  peakPrice?: number
  normalPrice?: number
  valleyPrice?: number
  passThroughRatio?: number
  serviceFee?: number
  floorPrice?: number
  capPrice?: number
  deviationPassThrough: boolean
}

export type YunnanMarketScenario = {
  id: string
  name: string
  month: string
  ruleVersion: string
  priceMode: PriceMode
  midLongPrice: number
  allocationCharge: number
  imbalanceCharge: number
  ancillaryServiceCharge: number
  returnCredit: number
  dayAheadUnifiedPrice: number[]
  realtimeUnifiedPrice: number[]
  nodePrice: number[]
}

export type SettlementOptions = {
  priceMode?: PriceMode
  contractCoverage?: number
  dayAheadBias?: number
  scenarioId?: string
}

export type SettlementCharge = {
  key: string
  title: string
  amount: number
  formula: string
  note: string
}

export type SettlementWarning = {
  level: RiskLevel
  title: string
  detail: string
}

export type CustomerSettlement = {
  customer: YunnanRetailCustomer
  package: YunnanRetailPackage
  scenario: YunnanMarketScenario
  priceMode: PriceMode
  retailRevenue: number
  purchaseCost: number
  grossMargin: number
  marginRate: number
  averageRetailPrice: number
  averageWholesalePrice: number
  dayAheadDeviationRate: number
  realtimeDeviationRate: number
  contractCoverage: number
  charges: SettlementCharge[]
  warnings: SettlementWarning[]
  curves: {
    contract: number[]
    dayAhead: number[]
    actual: number[]
    retailPrice: number[]
    dayAheadPrice: number[]
    realtimePrice: number[]
  }
}

export type PortfolioSettlement = {
  totalRevenue: number
  totalPurchaseCost: number
  totalMargin: number
  marginRate: number
  averageDeviationRate: number
  totalMwh: number
  highRiskCount: number
  settlements: CustomerSettlement[]
}

export type QuantStressOptions = {
  loadForecastError?: number
  newEnergyVolatility?: number
  nodeSpreadStress?: number
  stopLossRate?: number
  scenarioId?: string
}

export type RuleEffect = 'official' | 'trial' | 'consultation' | 'industry-reference'
export type RuleVerification = 'verified' | 'pending' | 'frozen'

/**
 * 云南与通用国网基线的“规则差异”结构化条目。
 * 不再只用文本锚点，而是把每条规则的依据、效力、核验状态和它驱动的结算科目（affectedCharges）
 * 显性化，让“地区绑定页面”承担规则适配层的职责：规则可核验、可执行、可对账。
 */
export type YunnanRuleDiff = {
  id: string
  dimension: string
  genericBaseline: string
  yunnanRule: string
  effect: RuleEffect
  verification: RuleVerification
  effectiveFrom: string
  /** 关联的结算科目 key，与 SettlementCharge.key 对应，用于把规则映射到可计算金额。 */
  affectedCharges: string[]
  docRef: string
  impact: string
}

/** 规则差异叠加当前场景下的实际驱动金额，体现“规则可执行化”。 */
export type RuleDiffImpact = YunnanRuleDiff & {
  liveAmount: number
  chargeTitles: string[]
}

export type RuleVerificationSummary = {
  total: number
  verified: number
  pending: number
  frozen: number
  /** 待核验或行业转载、尚未固化为正式参数的条目，用于风控提示。 */
  unverified: YunnanRuleDiff[]
}

export type QuantExposureRow = {
  title: string
  value: number
  unit: string
  status: '可控' | '关注' | '超限'
  note: string
}

export type OodaStep = {
  phase: 'Observe' | 'Orient' | 'Decide' | 'Act'
  title: string
  description: string
}

export const yunnanRetailPackages: YunnanRetailPackage[] = [
  {
    id: 'fixed-465',
    name: '固定价稳健套餐',
    model: 'fixed',
    summary: '客户侧价格稳定，售电公司承担主要现货波动和偏差风险。',
    flatPrice: 465,
    deviationPassThrough: false
  },
  {
    id: 'tou-standard',
    name: '分时标准套餐',
    model: 'timeOfUse',
    summary: '按峰平谷给客户传导分时信号，适合曲线稳定、可移峰客户。',
    peakPrice: 535,
    normalPrice: 452,
    valleyPrice: 338,
    deviationPassThrough: false
  },
  {
    id: 'spot-plus-18',
    name: '现货联动加服务费',
    model: 'passThrough',
    summary: '批发侧价格大部分传导给客户，售电公司收取服务费，偏差风险较低。',
    passThroughRatio: 0.92,
    serviceFee: 18,
    deviationPassThrough: true
  },
  {
    id: 'hybrid-cap-floor',
    name: '保底封顶混合套餐',
    model: 'hybrid',
    summary: '现货价格传导叠加保底封顶，兼顾客户接受度和售电侧风险。',
    passThroughRatio: 0.82,
    serviceFee: 26,
    floorPrice: 360,
    capPrice: 540,
    deviationPassThrough: true
  }
]

// 多场景：同一组客户/套餐在不同月份、规则版本和价格口径下的对比，
// 让“规则变化的经营影响”可量化，取代过去写死的单一 2026-06 演示场景。
export const yunnanScenarios: YunnanMarketScenario[] = [
  {
    id: 'yunnan-2026-06',
    name: '连续结算推进 · 统一结算价',
    month: '2026-06',
    ruleVersion: '南方区域运行规则2025 V1.0 + 云南公开细则/试运行参数',
    priceMode: 'unified',
    midLongPrice: 392,
    allocationCharge: 11,
    imbalanceCharge: 3.2,
    ancillaryServiceCharge: 5.6,
    returnCredit: 4,
    dayAheadUnifiedPrice: buildPriceCurve(412, 68, 0.8, 22),
    realtimeUnifiedPrice: buildPriceCurve(418, 82, 1.2, 36),
    nodePrice: buildPriceCurve(429, 96, 1.6, 48)
  },
  {
    id: 'yunnan-2026-09-flood',
    name: '汛期水电消纳 · 低价区间',
    month: '2026-09',
    ruleVersion: '南方区域运行规则2025 V1.0 + 汛期消纳与跨省送出边界',
    priceMode: 'unified',
    midLongPrice: 318,
    allocationCharge: 9,
    imbalanceCharge: 4.1,
    ancillaryServiceCharge: 4.8,
    returnCredit: 7,
    dayAheadUnifiedPrice: buildPriceCurve(326, 86, 0.6, 18),
    realtimeUnifiedPrice: buildPriceCurve(312, 104, 1.0, 30),
    nodePrice: buildPriceCurve(338, 120, 1.4, 44)
  },
  {
    id: 'yunnan-2026-12-node',
    name: '节点电价试点扩大 · 节点口径',
    month: '2026-12',
    ruleVersion: '南方区域运行规则2025 V1.0 + 用户节点电价结算机制试点扩大',
    priceMode: 'node',
    midLongPrice: 408,
    allocationCharge: 12,
    imbalanceCharge: 3.6,
    ancillaryServiceCharge: 6.2,
    returnCredit: 3.4,
    dayAheadUnifiedPrice: buildPriceCurve(421, 74, 0.9, 26),
    realtimeUnifiedPrice: buildPriceCurve(432, 92, 1.3, 42),
    nodePrice: buildPriceCurve(448, 116, 1.7, 58)
  }
]

export function getYunnanScenario(scenarioId?: string): YunnanMarketScenario {
  return yunnanScenarios.find((scenario) => scenario.id === scenarioId) ?? yunnanScenarios[0]
}

export const yunnanRuleDiffs: YunnanRuleDiff[] = [
  {
    id: 'user-side-settlement-formula',
    dimension: '用户侧电费结算公式',
    genericBaseline: '多数国网省份用户侧以单一加权均价结算，偏差项合并列示。',
    yunnanRule: '用户侧电费 = 中长期合约 + 日前偏差 + 实时偏差 + 市场分摊 + 不平衡资金 + 辅助服务 - 分摊返还，逐项拆分。',
    effect: 'consultation',
    verification: 'verified',
    effectiveFrom: '2023-07-28',
    affectedCharges: ['retailRevenue', 'midLong', 'dayAhead', 'realtime'],
    docRef: '云南电力市场结算实施细则（征求意见稿）',
    impact: '决定零售套餐定价口径，逐项拆分后才能识别套餐倒挂来源。'
  },
  {
    id: 'unified-vs-node-price',
    dimension: '日前/实时价格口径',
    genericBaseline: '成熟市场普遍按用户所在节点电价结算。',
    yunnanRule: '起步阶段用户侧采用统一结算点电价，节点电价试点客户可切换节点价口径。',
    effect: 'trial',
    verification: 'pending',
    effectiveFrom: '2024-03-18',
    affectedCharges: ['dayAhead', 'realtime'],
    docRef: '云南用户节点电价结算机制试点动态',
    impact: '价格口径切换会直接改变日前/实时偏差电费，影响节点试点客户毛利。'
  },
  {
    id: 'imbalance-split',
    dimension: '不平衡资金处理',
    genericBaseline: '部分省份设置笼统不平衡资金池统一分摊。',
    yunnanRule: '南方区域规则要求不设笼统资金池，日前与实时不平衡资金分开计算。',
    effect: 'official',
    verification: 'verified',
    effectiveFrom: '2025-06-17',
    affectedCharges: ['imbalance'],
    docRef: '南方区域电力市场运行规则（试行，2025年V1.0版）',
    impact: '不平衡资金需独立列账，避免与普通分摊混淆造成对账偏差。'
  },
  {
    id: 'allocation-return-split',
    dimension: '分摊与返还科目',
    genericBaseline: '通用做法常将阻塞盈余、偏差返还并入综合分摊净额。',
    yunnanRule: '阻塞盈余、偏差收益等返还需按分项记录，以负数抵减总成本。',
    effect: 'official',
    verification: 'verified',
    effectiveFrom: '2025-06-17',
    affectedCharges: ['allocation', 'returnCredit'],
    docRef: '南方区域电力市场运行规则（试行，2025年V1.0版）',
    impact: '分摊返还分项后可沉淀台账，月度返还波动对毛利的影响可追踪。'
  },
  {
    id: 'ancillary-standalone',
    dimension: '辅助服务费用',
    genericBaseline: '辅助服务费用常并入综合分摊项。',
    yunnanRule: '调频、备用等辅助服务费用作为独立科目跟踪，不混入普通分摊。',
    effect: 'consultation',
    verification: 'pending',
    effectiveFrom: '2023-07-28',
    affectedCharges: ['ancillary'],
    docRef: '云南电力市场结算实施细则（征求意见稿）',
    impact: '独立科目便于评估辅助服务对售电成本的边际影响。'
  },
  {
    id: 'continuous-settlement-draft',
    dimension: '连续结算规则效力',
    genericBaseline: '正式连续结算规则应作为执行依据固化参数。',
    yunnanRule: '2025连续结算报审稿属行业转载，按待核验资料处理，不固化为正式参数。',
    effect: 'industry-reference',
    verification: 'frozen',
    effectiveFrom: '2025-06-28',
    affectedCharges: [],
    docRef: '云南连续结算试运行实施方案报审稿（行业转载）',
    impact: '量化/结算不得把报审稿参数误固化，需等正式文件核验后再启用。'
  }
]

/**
 * 把规则差异映射到当前场景下的实际驱动金额：
 * 对每条规则关联的结算科目，汇总组合内各客户该科目的金额，体现“规则→可计算金额”的可执行闭环。
 */
export function getYunnanRuleDiffImpacts(options: SettlementOptions = {}): RuleDiffImpact[] {
  const portfolio = getYunnanRetailDashboard(undefined, options)
  const chargeTotals = new Map<string, { amount: number; title: string }>()
  for (const settlement of portfolio.settlements) {
    for (const charge of settlement.charges) {
      const current = chargeTotals.get(charge.key) ?? { amount: 0, title: charge.title }
      current.amount += charge.amount
      chargeTotals.set(charge.key, current)
    }
  }
  return yunnanRuleDiffs.map((diff) => {
    const related = diff.affectedCharges.map((key) => chargeTotals.get(key)).filter(Boolean) as Array<{ amount: number; title: string }>
    return {
      ...diff,
      liveAmount: related.reduce((total, item) => total + item.amount, 0),
      chargeTitles: related.map((item) => item.title)
    }
  })
}

export function getYunnanRuleVerificationSummary(): RuleVerificationSummary {
  const verified = yunnanRuleDiffs.filter((diff) => diff.verification === 'verified')
  const pending = yunnanRuleDiffs.filter((diff) => diff.verification === 'pending')
  const frozen = yunnanRuleDiffs.filter((diff) => diff.verification === 'frozen')
  return {
    total: yunnanRuleDiffs.length,
    verified: verified.length,
    pending: pending.length,
    frozen: frozen.length,
    unverified: [...pending, ...frozen]
  }
}

export const yunnanRetailCustomers: YunnanRetailCustomer[] = [
  {
    id: 'aluminum-load',
    name: '滇中新材料铝业',
    industry: '有色金属',
    nodeName: '昆明负荷节点A',
    nodePriceTrial: true,
    monthlyMwh: 28600,
    packageId: 'hybrid-cap-floor',
    contractCoverage: 0.9,
    forecastCurve: buildLoadCurve(28600 / 30, 0.88, 0.18, 0.08),
    actualCurve: buildLoadCurve(28600 / 30, 0.9, 0.24, 0.1)
  },
  {
    id: 'silicon-plant',
    name: '曲靖硅材制造',
    industry: '硅材',
    nodeName: '曲靖负荷节点B',
    nodePriceTrial: true,
    monthlyMwh: 18400,
    packageId: 'spot-plus-18',
    contractCoverage: 0.86,
    forecastCurve: buildLoadCurve(18400 / 30, 0.7, 0.32, 0.24),
    actualCurve: buildLoadCurve(18400 / 30, 0.74, 0.38, 0.26)
  },
  {
    id: 'tea-park',
    name: '普洱茶产业园',
    industry: '园区综合',
    nodeName: '普洱负荷节点C',
    nodePriceTrial: false,
    monthlyMwh: 7200,
    packageId: 'tou-standard',
    contractCoverage: 0.82,
    forecastCurve: buildLoadCurve(7200 / 30, 0.62, 0.4, 0.18),
    actualCurve: buildLoadCurve(7200 / 30, 0.64, 0.48, 0.2)
  },
  {
    id: 'cement-load',
    name: '昭通水泥负荷',
    industry: '建材',
    nodeName: '昭通负荷节点D',
    nodePriceTrial: false,
    monthlyMwh: 11600,
    packageId: 'fixed-465',
    contractCoverage: 0.94,
    forecastCurve: buildLoadCurve(11600 / 30, 0.78, 0.2, 0.14),
    actualCurve: buildLoadCurve(11600 / 30, 0.8, 0.28, 0.16)
  }
]

export function getYunnanRetailDashboard(packageId?: string, options: SettlementOptions = {}): PortfolioSettlement {
  const scenario = getYunnanScenario(options.scenarioId)
  const settlements = yunnanRetailCustomers.map((customer) => {
    const selectedPackage = yunnanRetailPackages.find((item) => item.id === (packageId ?? customer.packageId)) ?? yunnanRetailPackages[0]
    return calculateCustomerSettlement(customer, selectedPackage, scenario, options)
  })
  return summarizePortfolio(settlements)
}

// 消费方：仅本模块内 getYunnanRetailDashboard 内部调用，
// 无外部 import；故不导出（#458 死代码清理）。如需外部直接调用单客户结算再恢复 export。
function calculateCustomerSettlement(
  customer: YunnanRetailCustomer,
  selectedPackage: YunnanRetailPackage,
  scenario: YunnanMarketScenario,
  options: SettlementOptions = {}
): CustomerSettlement {
  const priceMode = options.priceMode ?? scenario.priceMode
  const contractCoverage = clamp(options.contractCoverage ?? customer.contractCoverage, 0.6, 1.05)
  const dayAheadBias = clamp(options.dayAheadBias ?? 0, -0.08, 0.08)
  const contractCurve = customer.forecastCurve.map((value) => value * contractCoverage)
  const dayAheadCurve = buildDayAheadCurve(customer.forecastCurve, scenario.dayAheadUnifiedPrice, scenario.realtimeUnifiedPrice, dayAheadBias)
  const actualCurve = customer.actualCurve
  const dayAheadPrice = resolvePriceCurve(scenario, customer, priceMode, 'dayAhead')
  const realtimePrice = resolvePriceCurve(scenario, customer, priceMode, 'realtime')
  const retailPrice = buildRetailPriceCurve(selectedPackage, scenario, customer, priceMode)
  const multiplier = 30

  const retailRevenue = sumProduct(actualCurve, retailPrice) * multiplier
  const midLongCost = sum(contractCurve.map((value) => value * scenario.midLongPrice)) * multiplier
  const dayAheadDeviationCost = sum(dayAheadCurve.map((value, index) => (value - contractCurve[index]) * dayAheadPrice[index])) * multiplier
  const realtimeDeviationCost = sum(actualCurve.map((value, index) => (value - dayAheadCurve[index]) * realtimePrice[index])) * multiplier
  const actualMwh = sum(actualCurve)
  const allocationCost = actualMwh * scenario.allocationCharge * multiplier
  const imbalanceCost = actualMwh * scenario.imbalanceCharge * multiplier
  const ancillaryServiceCost = actualMwh * scenario.ancillaryServiceCharge * multiplier
  const returnCredit = actualMwh * scenario.returnCredit * multiplier
  const purchaseCost = midLongCost + dayAheadDeviationCost + realtimeDeviationCost + allocationCost + imbalanceCost + ancillaryServiceCost - returnCredit
  const grossMargin = retailRevenue - purchaseCost
  const totalMwh = sum(actualCurve) * multiplier
  const marginRate = retailRevenue === 0 ? 0 : grossMargin / retailRevenue
  const averageRetailPrice = retailRevenue / totalMwh
  const averageWholesalePrice = purchaseCost / totalMwh
  const dayAheadDeviationRate = deviationRate(dayAheadCurve, contractCurve)
  const realtimeDeviationRate = deviationRate(actualCurve, dayAheadCurve)
  const charges: SettlementCharge[] = [
    {
      key: 'retailRevenue',
      title: '零售套餐收入',
      amount: retailRevenue,
      formula: 'Σ Q实际,t × P零售,t',
      note: '根据客户套餐价格曲线形成收入。'
    },
    {
      key: 'midLong',
      title: '中长期合约电费',
      amount: midLongCost,
      formula: 'Σ Q中长期净合约,t × P中长期,t',
      note: '按云南中长期分时曲线衔接现货结算。'
    },
    {
      key: 'dayAhead',
      title: '日前偏差电费',
      amount: dayAheadDeviationCost,
      formula: 'Σ (Q日前,t - Q中长期,t) × P日前统一/节点,t',
      note: '用户侧起步按统一结算价，节点价试点客户可切换节点口径。'
    },
    {
      key: 'realtime',
      title: '实时偏差电费',
      amount: realtimeDeviationCost,
      formula: 'Σ (Q实际,t - Q日前,t) × P实时统一/节点,t',
      note: '实际用电与日前申报差额进入实时偏差结算。'
    },
    {
      key: 'allocation',
      title: '市场分摊费用',
      amount: allocationCost,
      formula: 'Σ Q实际,t × P市场分摊',
      note: '记录省内市场公共分摊项，后续可按正式规则继续拆分。'
    },
    {
      key: 'imbalance',
      title: '不平衡资金',
      amount: imbalanceCost,
      formula: 'Σ Q实际,t × P不平衡资金',
      note: '承接用户侧偏差、不平衡资金等按电量分摊的结算影响。'
    },
    {
      key: 'ancillary',
      title: '辅助服务费用',
      amount: ancillaryServiceCost,
      formula: 'Σ Q实际,t × P辅助服务',
      note: '将调频、备用等辅助服务相关费用作为独立科目跟踪。'
    },
    {
      key: 'returnCredit',
      title: '分摊返还',
      amount: -returnCredit,
      formula: '-Σ Q实际,t × P返还',
      note: '阻塞盈余、偏差收益等返还按规则分项记录。'
    }
  ]
  const warnings = buildSettlementWarnings({
    customer,
    selectedPackage,
    priceMode,
    grossMargin,
    marginRate,
    averageRetailPrice,
    averageWholesalePrice,
    dayAheadDeviationRate,
    realtimeDeviationRate
  })

  return {
    customer,
    package: selectedPackage,
    scenario,
    priceMode,
    retailRevenue,
    purchaseCost,
    grossMargin,
    marginRate,
    averageRetailPrice,
    averageWholesalePrice,
    dayAheadDeviationRate,
    realtimeDeviationRate,
    contractCoverage,
    charges,
    warnings,
    curves: {
      contract: contractCurve,
      dayAhead: dayAheadCurve,
      actual: actualCurve,
      retailPrice,
      dayAheadPrice,
      realtimePrice
    }
  }
}

function summarizePortfolio(settlements: CustomerSettlement[]): PortfolioSettlement {
  const totalRevenue = sum(settlements.map((item) => item.retailRevenue))
  const totalPurchaseCost = sum(settlements.map((item) => item.purchaseCost))
  const totalMargin = totalRevenue - totalPurchaseCost
  const totalMwh = sum(settlements.map((item) => sum(item.curves.actual) * 30))
  const averageDeviationRate = settlements.length
    ? sum(settlements.map((item) => item.realtimeDeviationRate)) / settlements.length
    : 0
  const highRiskCount = settlements.filter((item) => item.warnings.some((warning) => warning.level === 'high')).length

  return {
    totalRevenue,
    totalPurchaseCost,
    totalMargin,
    marginRate: totalRevenue === 0 ? 0 : totalMargin / totalRevenue,
    averageDeviationRate,
    totalMwh,
    highRiskCount,
    settlements
  }
}

function buildLoadCurve(totalDailyMwh: number, base: number, volatility: number, eveningPeak: number) {
  const weights = Array.from({ length: 96 }, (_, index) => {
    const hour = index / 4
    const industrialBase = base + Math.sin((hour - 7) / 24 * Math.PI * 2) * volatility
    const evening = Math.exp(-Math.pow(hour - 20, 2) / 12) * eveningPeak
    const valley = hour >= 1 && hour <= 6 ? -volatility * 0.45 : 0
    return Math.max(0.08, industrialBase + evening + valley)
  })
  const totalWeight = sum(weights)
  return weights.map((weight) => totalDailyMwh * weight / totalWeight)
}

function buildPriceCurve(base: number, amplitude: number, phase: number, spike: number) {
  return Array.from({ length: 96 }, (_, index) => {
    const hour = index / 4
    const morning = Math.exp(-Math.pow(hour - 10, 2) / 10) * spike * 0.45
    const evening = Math.exp(-Math.pow(hour - 20, 2) / 9) * spike
    const valley = hour >= 1 && hour <= 6 ? -amplitude * 0.34 : 0
    const wave = Math.sin((hour + phase) / 24 * Math.PI * 2) * amplitude
    return Math.max(120, base + wave + morning + evening + valley)
  })
}

function buildDayAheadCurve(forecastCurve: number[], dayAheadPrice: number[], realtimePrice: number[], bias: number) {
  return forecastCurve.map((value, index) => {
    const spread = realtimePrice[index] - dayAheadPrice[index]
    const priceAdjustment = clamp(spread / 1000, -0.025, 0.025)
    return value * (1 + bias + priceAdjustment)
  })
}

function resolvePriceCurve(scenario: YunnanMarketScenario, customer: YunnanRetailCustomer, priceMode: PriceMode, stage: 'dayAhead' | 'realtime') {
  if (priceMode === 'node' && customer.nodePriceTrial) {
    return stage === 'dayAhead'
      ? scenario.nodePrice.map((price) => price * 0.97)
      : scenario.nodePrice
  }
  return stage === 'dayAhead' ? scenario.dayAheadUnifiedPrice : scenario.realtimeUnifiedPrice
}

function buildRetailPriceCurve(selectedPackage: YunnanRetailPackage, scenario: YunnanMarketScenario, customer: YunnanRetailCustomer, priceMode: PriceMode) {
  const wholesaleReference = resolvePriceCurve(scenario, customer, priceMode, 'realtime')
  if (selectedPackage.model === 'fixed') {
    return wholesaleReference.map(() => selectedPackage.flatPrice ?? 0)
  }
  if (selectedPackage.model === 'timeOfUse') {
    return wholesaleReference.map((_, index) => {
      const hour = index / 4
      if ((hour >= 10 && hour < 12) || (hour >= 18 && hour < 22)) return selectedPackage.peakPrice ?? 0
      if (hour >= 0 && hour < 7) return selectedPackage.valleyPrice ?? 0
      return selectedPackage.normalPrice ?? 0
    })
  }
  const ratio = selectedPackage.passThroughRatio ?? 1
  const serviceFee = selectedPackage.serviceFee ?? 0
  return wholesaleReference.map((price) => {
    const rawPrice = price * ratio + serviceFee
    if (selectedPackage.model === 'hybrid') {
      return clamp(rawPrice, selectedPackage.floorPrice ?? rawPrice, selectedPackage.capPrice ?? rawPrice)
    }
    return rawPrice
  })
}

function buildSettlementWarnings(input: {
  customer: YunnanRetailCustomer
  selectedPackage: YunnanRetailPackage
  priceMode: PriceMode
  grossMargin: number
  marginRate: number
  averageRetailPrice: number
  averageWholesalePrice: number
  dayAheadDeviationRate: number
  realtimeDeviationRate: number
}) {
  const warnings: SettlementWarning[] = []
  if (input.grossMargin < 0 || input.marginRate < 0.02) {
    warnings.push({
      level: 'high',
      title: '套餐倒挂风险',
      detail: `零售均价 ${input.averageRetailPrice.toFixed(1)} 元/MWh，批发成本 ${input.averageWholesalePrice.toFixed(1)} 元/MWh，毛利空间不足。`
    })
  } else if (input.marginRate < 0.055) {
    warnings.push({
      level: 'medium',
      title: '利润缓冲偏低',
      detail: '售电毛利率低于 5.5%，需要复核中长期覆盖率和偏差传导条款。'
    })
  }
  if (input.realtimeDeviationRate > 0.1) {
    warnings.push({
      level: 'high',
      title: '实时偏差偏高',
      detail: '实际用电与日前申报偏差超过 10%，实时偏差费用可能吞噬套餐利润。'
    })
  } else if (input.dayAheadDeviationRate > 0.08) {
    warnings.push({
      level: 'medium',
      title: '日前敞口偏高',
      detail: '日前申报与中长期曲线偏差超过 8%，建议调整合约曲线覆盖。'
    })
  }
  if (input.priceMode === 'node' && input.customer.nodePriceTrial && !input.selectedPackage.deviationPassThrough) {
    warnings.push({
      level: 'medium',
      title: '节点价试点未充分传导',
      detail: '客户处于用户节点电价试点范围，但当前套餐未传导偏差费用。'
    })
  }
  if (!warnings.length) {
    warnings.push({
      level: 'low',
      title: '风险可控',
      detail: '当前套餐、合约覆盖率和申报偏差处于演示阈值内。'
    })
  }
  return warnings
}

function deviationRate(a: number[], b: number[]) {
  const numerator = sum(a.map((value, index) => Math.abs(value - b[index])))
  const denominator = sum(a.map((value) => Math.abs(value)))
  return denominator === 0 ? 0 : numerator / denominator
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function sumProduct(a: number[], b: number[]) {
  return a.reduce((total, value, index) => total + value * b[index], 0)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
