import { calculateIRR, calculateNPV } from '@/services/storage'

export type WindSolarProjectType = 'wind' | 'solar'
export type WindSolarCalcMode = 'irr_to_lcoe' | 'lcoe_to_irr'

export type WindSolarForm = {
  project_type: WindSolarProjectType
  capacity_mw: number
  hours_per_year: number
  curtailment_rate: number
  /** 光伏组件年衰减率（%/年，第二年起逐年衰减；光伏默认 0.55，风电默认 0） */
  degradation_rate: number
  /** 首年衰减率（%，仅作用于第一年；光伏默认 2，风电默认 0） */
  first_year_degradation: number
  investment_per_mw: number
  om_cost_per_mw: number
  om_growth_rate: number
  discount_rate: number
  project_life: number
  salvage_rate: number
  depreciation_years: number
  loan_ratio: number
  loan_interest_rate: number
  loan_term: number
  tax_rate: number
  is_three_free_half: boolean
  /** 增值税率（%）。电价（lcoe）按含税口径输入，收入侧价税分离 */
  vat_rate: number
  /**
   * 增值税即征即退比例（%）。
   * 政策依据：光伏发电增值税即征即退 50%（财税〔2013〕66号）；
   * 风力发电增值税即征即退 50%（财税〔2015〕74号）。
   */
  vat_refund_rate: number
  target_equity_irr: number
  /** 含税上网电价 / LCOE（元/kWh，含税口径） */
  lcoe: number
}

export type WindSolarCashFlowItem = {
  year: number
  revenue: number
  om_cost: number
  depreciation: number
  loan_principal: number
  loan_interest: number
  income_tax: number
  net_cash_flow: number
  cumulative_cash_flow: number
}

export type WindSolarResult = {
  success: true
  mode: WindSolarCalcMode
  /** 含税 LCOE（元/kWh）；反推不收敛/无解时为 NaN */
  lcoe: number
  /** LCOE 反推是否收敛（lcoe_to_irr 模式下恒为 true）。false 时 UI 显示「未收敛」 */
  lcoe_converged: boolean
  total_investment: number
  equity_investment: number
  annual_generation: number
  annual_revenue: number
  /** 静态回收期（年）；项目期内未回收时为 NaN */
  payback_period: number
  /** 项目期内是否收回资本金。false 时 UI 显示「未回收」 */
  payback_reached: boolean
  npv_value: number
  /** 资本金 IRR（%）；无实根/不收敛时为 NaN，UI 显示「无解」 */
  actual_equity_irr: number
  cash_flows: number[]
  cash_flow_schedule: WindSolarCashFlowItem[]
  summary: Record<string, number | string>
}

export type WindSolarSensitivityResult = {
  success: true
  /** 基准输出（IRR % 或 LCOE 元/kWh）；无解时为 NaN */
  base_value: number
  target_param: 'LCOE' | 'IRR'
  sensitivity_results: Record<string, {
    base_value: number
    /** 恒为 7 个点：-30/-20/-10/0/+10/+20/+30（%） */
    changes: number[]
    /** 与 changes 一一对应；输出无解（NaN）的点置 null（图表断点），不丢点 */
    values: Array<number | null>
    /**
     * 标准弹性系数 = (输出相对变化) / (输入相对变化)
     * = ((v(+30%) − v(−30%)) / v(0)) / 0.6；端点或基准无解时为 null
     */
    sensitivity: number | null
  }>
}

type NumericWindSolarKey = {
  [K in keyof WindSolarForm]: WindSolarForm[K] extends number ? K : never
}[keyof WindSolarForm]

const defaults: Record<WindSolarProjectType, WindSolarForm> = {
  wind: {
    project_type: 'wind',
    capacity_mw: 100,
    hours_per_year: 3000,
    curtailment_rate: 5,
    degradation_rate: 0,
    first_year_degradation: 0,
    investment_per_mw: 400,
    om_cost_per_mw: 5,
    om_growth_rate: 2,
    discount_rate: 8,
    project_life: 20,
    salvage_rate: 5,
    depreciation_years: 20,
    loan_ratio: 70,
    loan_interest_rate: 4.5,
    loan_term: 15,
    tax_rate: 25,
    is_three_free_half: true,
    vat_rate: 13,
    // 风电增值税即征即退 50%（财税〔2015〕74号）
    vat_refund_rate: 50,
    target_equity_irr: 10,
    lcoe: 0.35
  },
  solar: {
    project_type: 'solar',
    capacity_mw: 100,
    hours_per_year: 1500,
    curtailment_rate: 3,
    degradation_rate: 0.55,
    first_year_degradation: 2,
    investment_per_mw: 190,
    om_cost_per_mw: 3.5,
    om_growth_rate: 2,
    discount_rate: 8,
    project_life: 25,
    salvage_rate: 5,
    depreciation_years: 20,
    loan_ratio: 70,
    loan_interest_rate: 4.5,
    loan_term: 15,
    tax_rate: 25,
    is_three_free_half: true,
    vat_rate: 13,
    // 光伏增值税即征即退 50%（财税〔2013〕66号）
    vat_refund_rate: 50,
    target_equity_irr: 10,
    lcoe: 0.32
  }
}

export function getWindSolarDefaultForm(projectType: WindSolarProjectType = 'solar'): WindSolarForm {
  return { ...defaults[projectType] }
}

function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 与 round 同精度，但保留 NaN（无解语义），供 IRR/LCOE/回收期等可无解字段使用 */
function roundKeepNaN(value: number, digits = 2) {
  return Number.isFinite(value) ? round(value, digits) : NaN
}

/**
 * 边界口径（C5/C7）：折旧年限、贷款年限不得超过项目寿命。
 * View 表单负责提示并 clamp，服务层再兜底一次防越界输入。
 */
function normalizeForm(form: WindSolarForm): WindSolarForm {
  const life = Math.max(1, form.project_life)
  return {
    ...form,
    project_life: life,
    depreciation_years: Math.min(Math.max(form.depreciation_years, 1), life),
    loan_term: Math.min(Math.max(form.loan_term, 1), life)
  }
}

function totalInvestment(form: WindSolarForm) {
  const total = form.capacity_mw * form.investment_per_mw
  return {
    total,
    equity: total * (1 - form.loan_ratio / 100)
  }
}

/** 无衰减的理论首年上网电量（万kWh） */
function baseAnnualGeneration(form: WindSolarForm) {
  return form.capacity_mw * form.hours_per_year * 1000 * (1 - form.curtailment_rate / 100) / 10000
}

/**
 * C6 光伏衰减：第 y 年电量 = 理论首年电量 × (1 − 首年衰减/100) × (1 − 年衰减/100)^(y−1)
 * （y 从 1 起；风电默认两项衰减均为 0，退化为常数电量）
 */
export function generationForYear(form: WindSolarForm, year: number) {
  return baseAnnualGeneration(form)
    * (1 - form.first_year_degradation / 100)
    * (1 - form.degradation_rate / 100) ** (year - 1)
}

function depreciationSchedule(form: WindSolarForm, investment: number) {
  const depreciableBase = investment * (1 - form.salvage_rate / 100)
  const annualDepreciation = depreciableBase / Math.max(form.depreciation_years, 1)
  return Array.from({ length: form.project_life }, (_, index) => index < form.depreciation_years ? annualDepreciation : 0)
}

function loanSchedule(form: WindSolarForm, investment: number) {
  const loanAmount = investment * form.loan_ratio / 100
  const annualRate = form.loan_interest_rate / 100
  const annualPayment = annualRate === 0
    ? loanAmount / Math.max(form.loan_term, 1)
    : loanAmount * (annualRate * (1 + annualRate) ** form.loan_term) / ((1 + annualRate) ** form.loan_term - 1)
  const schedule: Array<{ principal: number; interest: number }> = []
  let balance = loanAmount

  for (let year = 0; year < form.project_life; year += 1) {
    if (balance > 1e-6 && year < form.loan_term) {
      const interest = balance * form.loan_interest_rate / 100
      const principal = Math.min(annualPayment - interest, balance)
      balance -= principal
      schedule.push({ principal, interest })
    } else {
      schedule.push({ principal: 0, interest: 0 })
    }
  }
  return schedule
}

export type WindSolarYearCashFlow = {
  year: number
  /** 收入（万元）＝ 不含税电费收入 ＋ 增值税即征即退退税额（见 E3 注释） */
  revenue: number
  om_cost: number
  depreciation: number
  loan_interest: number
  loan_principal: number
  income_tax: number
  net_cash_flow: number
}

export type WindSolarCashFlowDetail = {
  equity_investment: number
  years: WindSolarYearCashFlow[]
  /** cash_flows[0] = −资本金；cash_flows[y] = 第 y 年净现金流（与 years 同源） */
  cash_flows: number[]
}

/**
 * E6 单一数据源：现金流分项在此一次性构建，
 * calculateWindSolarCashFlows（IRR/LCOE 求解）与明细表 schedule 均复用本函数，杜绝双实现漂移。
 *
 * E3 增值税接线（最小正确实现，进项抵扣简化处理）：
 * - 电价（lcoe）按含税口径输入，含税电费 = 电价 × 电量；
 * - 不含税收入 = 含税电费 / (1 + vat_rate/100)（销项税按电价价税分离简化，
 *   不建模进项税抵扣期，即当期应纳增值税 ≈ 销项税额）；
 * - 即征即退退税额 = 当期应纳增值税 × vat_refund_rate/100，计入收入侧
 *   （光伏 50%：财税〔2013〕66号；风电 50%：财税〔2015〕74号）；
 * - 城建税及教育费附加等附加税暂不建模（金额小且随退税政策口径变化，避免引入更大失真）。
 */
export function buildWindSolarCashFlowDetail(input: WindSolarForm, lcoe: number): WindSolarCashFlowDetail {
  const form = normalizeForm(input)
  const investment = totalInvestment(form)
  const depreciation = depreciationSchedule(form, investment.total)
  const loans = loanSchedule(form, investment.total)
  const vatDivisor = 1 + form.vat_rate / 100
  const years: WindSolarYearCashFlow[] = []
  const cashFlows = [-investment.equity]

  for (let index = 0; index < form.project_life; index += 1) {
    const year = index + 1
    // 含税电费收入（万元）= 含税电价(元/kWh) × 当年电量(万kWh)
    const grossRevenue = generationForYear(form, year) * lcoe
    const netRevenue = grossRevenue / vatDivisor
    // 简化口径下当期应纳增值税 = 销项税额 = 含税收入 − 不含税收入
    const vatPayable = grossRevenue - netRevenue
    const vatRefund = vatPayable * form.vat_refund_rate / 100
    const revenue = netRevenue + vatRefund

    const omCost = form.om_cost_per_mw * form.capacity_mw * (1 + form.om_growth_rate / 100) ** index
    // 简化口径：即征即退退税额并入应税收入（未建模财税〔2008〕151号免税情形）
    const taxableIncome = revenue - omCost - depreciation[index] - loans[index].interest
    let incomeTax = 0
    if (form.is_three_free_half) {
      // 三免三减半（企业所得税优惠，财税〔2008〕46号公共基础设施目录口径）
      if (index < 3) incomeTax = 0
      else if (index < 6) incomeTax = Math.max(0, taxableIncome * form.tax_rate / 100 * 0.5)
      else incomeTax = Math.max(0, taxableIncome * form.tax_rate / 100)
    } else {
      incomeTax = Math.max(0, taxableIncome * form.tax_rate / 100)
    }

    let netCashFlow = revenue - omCost - incomeTax - loans[index].principal - loans[index].interest
    if (year === form.project_life) netCashFlow += investment.total * form.salvage_rate / 100
    if (Math.abs(netCashFlow) < 1e-6) netCashFlow = 0

    years.push({
      year,
      revenue,
      om_cost: omCost,
      depreciation: depreciation[index],
      loan_interest: loans[index].interest,
      loan_principal: loans[index].principal,
      income_tax: incomeTax,
      net_cash_flow: netCashFlow
    })
    cashFlows.push(netCashFlow)
  }

  return { equity_investment: investment.equity, years, cash_flows: cashFlows }
}

export function calculateWindSolarCashFlows(form: WindSolarForm, lcoe: number) {
  return buildWindSolarCashFlowDetail(form, lcoe).cash_flows
}

/**
 * E4 LCOE 反推：二分求解使资本金 IRR 达到目标值的含税电价。
 * 区间由初始扩张（high 至多扩到 10 元/kWh）保证，二分中不再对 mid 做 [0.01,2] 硬夹逼；
 * 扩张失败（10 元/kWh 仍达不到目标 IRR）即无解，返回 NaN（不再用 -1 当哨兵）。
 */
export function calculateWindSolarLcoe(input: WindSolarForm) {
  const form = normalizeForm(input)
  const objective = (lcoe: number) => {
    const cashFlows = calculateWindSolarCashFlows(form, lcoe)
    const totalCashFlow = cashFlows.reduce((sum, cashFlow) => sum + cashFlow, 0)
    if (totalCashFlow <= 0) return -Infinity
    const irr = calculateIRR(cashFlows)
    // IRR 无解视为远低于目标，驱动二分向抬价方向收敛
    if (!Number.isFinite(irr)) return -Infinity
    return irr - form.target_equity_irr
  }

  if (objective(0) >= 0) return 0
  let low = 0
  let high = 0.5
  for (let index = 0; index < 20 && objective(high) < 0; index += 1) {
    high *= 2
    if (high > 10) return NaN
  }

  for (let index = 0; index < 140; index += 1) {
    const mid = (low + high) / 2
    const diff = objective(mid)
    if (Math.abs(diff) < 1e-4 || high - low < 1e-4) return round(mid, 4)
    if (diff > 0) high = mid
    else low = mid
  }

  return round((low + high) / 2, 4)
}

/**
 * 静态回收期（年）。累计现金流在项目期内未转正时返回 NaN（E5：不再用 -1 当哨兵），
 * 调用方以 Number.isFinite / payback_reached 判断并显示「未回收」。
 */
export function calculateWindSolarPayback(cashFlows: number[]) {
  let cumulative = 0
  for (let year = 0; year < cashFlows.length; year += 1) {
    cumulative += cashFlows[year]
    if (cumulative >= 0) {
      if (year > 0) {
        const previous = cumulative - cashFlows[year]
        if (previous < 0 && cashFlows[year] !== 0) return round(year - 1 + Math.abs(previous) / Math.abs(cashFlows[year]), 2)
      }
      return year
    }
  }
  return NaN
}

export function calculateWindSolarInvestment(input: WindSolarForm, mode: WindSolarCalcMode): WindSolarResult {
  const form = normalizeForm(input)
  const lcoe = mode === 'lcoe_to_irr' ? form.lcoe : calculateWindSolarLcoe(form)
  const lcoeConverged = Number.isFinite(lcoe)
  const investment = totalInvestment(form)
  // 首年（含首年衰减）上网电量与收入，作为展示口径
  const firstYearGeneration = generationForYear(form, 1)

  // E6：明细表与求解共用同一份现金流分项数据源
  const detail = lcoeConverged
    ? buildWindSolarCashFlowDetail(form, lcoe)
    : { equity_investment: investment.equity, years: [], cash_flows: [] }
  const schedule: WindSolarCashFlowItem[] = []
  let cumulative = -detail.equity_investment
  for (const item of detail.years) {
    cumulative += item.net_cash_flow
    schedule.push({
      year: item.year,
      revenue: round(item.revenue, 2),
      om_cost: round(item.om_cost, 2),
      depreciation: round(item.depreciation, 2),
      loan_principal: round(item.loan_principal, 2),
      loan_interest: round(item.loan_interest, 2),
      income_tax: round(item.income_tax, 2),
      net_cash_flow: round(item.net_cash_flow, 2),
      cumulative_cash_flow: round(cumulative, 2)
    })
  }

  const irr = lcoeConverged ? calculateIRR(detail.cash_flows) : NaN
  const payback = lcoeConverged ? calculateWindSolarPayback(detail.cash_flows) : NaN
  const paybackReached = Number.isFinite(payback)
  const annualRevenue = detail.years[0]?.revenue ?? NaN

  return {
    success: true,
    mode,
    lcoe: roundKeepNaN(lcoe, 4),
    lcoe_converged: lcoeConverged,
    total_investment: round(investment.total, 2),
    equity_investment: round(investment.equity, 2),
    annual_generation: round(firstYearGeneration, 2),
    annual_revenue: roundKeepNaN(annualRevenue, 2),
    payback_period: roundKeepNaN(payback, 2),
    payback_reached: paybackReached,
    npv_value: lcoeConverged ? round(calculateNPV(detail.cash_flows, form.discount_rate), 2) : NaN,
    actual_equity_irr: roundKeepNaN(irr, 4),
    cash_flows: detail.cash_flows.map((cashFlow) => round(cashFlow, 2)),
    cash_flow_schedule: schedule,
    summary: {
      project_type: form.project_type,
      lcoe: roundKeepNaN(lcoe, 4),
      lcoe_converged: String(lcoeConverged),
      total_investment: round(investment.total, 2),
      equity_investment: round(investment.equity, 2),
      annual_generation: round(firstYearGeneration, 2),
      annual_revenue: roundKeepNaN(annualRevenue, 2),
      payback_period: paybackReached ? roundKeepNaN(payback, 2) : '未回收',
      actual_equity_irr: roundKeepNaN(irr, 4),
      target_equity_irr: form.target_equity_irr
    }
  }
}

/**
 * E1 敏感性分析：输出标准弹性系数。
 * 弹性 = (输出相对变化)/(输入相对变化) = ((v(+30%) − v(−30%)) / v(0)) / 0.6。
 * 每个参数恒保留 7 个扰动点；输出无解（NaN）的点在曲线中置 null（断点），不再按 value>0 过滤丢点。
 */
export function runWindSolarSensitivityAnalysis(input: WindSolarForm, mode: WindSolarCalcMode): WindSolarSensitivityResult {
  const form = normalizeForm(input)
  const targetParam = mode === 'lcoe_to_irr' ? 'IRR' : 'LCOE'
  const evaluate = (candidate: WindSolarForm) => mode === 'lcoe_to_irr'
    ? calculateIRR(calculateWindSolarCashFlows(candidate, form.lcoe))
    : calculateWindSolarLcoe(candidate)
  const baseValue = evaluate(form)
  const sensitivityParams: Array<[string, NumericWindSolarKey]> = [
    ['装机容量', 'capacity_mw'],
    ['单位投资', 'investment_per_mw'],
    ['年利用小时', 'hours_per_year'],
    ['弃风/弃光比例', 'curtailment_rate'],
    ['运维成本', 'om_cost_per_mw'],
    ['贷款比例', 'loan_ratio'],
    ['贷款利率', 'loan_interest_rate']
  ]
  const changeSteps = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]
  const results: WindSolarSensitivityResult['sensitivity_results'] = {}

  sensitivityParams.forEach(([label, key]) => {
    const base = form[key]
    if (base === 0) return
    const values: Array<number | null> = []
    const changes: number[] = []
    changeSteps.forEach((change) => {
      const modified = { ...form, [key]: base * (1 + change) }
      const value = evaluate(modified)
      changes.push(round(change * 100, 0))
      values.push(Number.isFinite(value) ? round(value, 4) : null)
    })
    // 端点取 ±30%，基准取 0 扰动点；任一无解则弹性无定义（null）
    const vLow = values[0]
    const vBase = values[3]
    const vHigh = values[6]
    const sensitivity = vLow !== null && vHigh !== null && vBase !== null && vBase !== 0
      ? round(((vHigh - vLow) / vBase) / 0.6, 4)
      : null
    results[label] = {
      base_value: round(base, 4),
      changes,
      values,
      sensitivity
    }
  })

  return {
    success: true,
    base_value: roundKeepNaN(baseValue, 4),
    target_param: targetParam,
    sensitivity_results: results
  }
}
