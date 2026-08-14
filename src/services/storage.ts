export type StorageCalculatorForm = {
  province: string
  system_power_mw: number
  battery_capacity_mwh: number
  system_efficiency: number
  dod: number
  eol: number
  lifecycle_degradation: number
  lifecycle_cycles: number
  first_year_eol: number
  land_area_mu: number
  land_price_per_mu: number
  feasibility_cost: number
  construction_period: number
  construction_interest_rate: number
  epc_unit_price: number
  equipment_unit_price: number
  operation_years: number
  land_rent_annual: number
  om_percentage: number
  om_growth_rate: number
  insurance_rate: number
  other_cost_annual: number
  replace_battery: boolean
  replace_battery_year: number
  replace_battery_unit_price: number
  salvage_rate: number
  loan_term: number
  loan_ratio: number
  loan_interest_rate: number
  discount_rate: number
  lease_price_per_mw: number
  lease_capacity_mw: number
  lease_term_years: number
  lease_continue_after_term: boolean
  lease_continue_amount: number
  lease_correlates_eol: boolean
  compensation_standard: number
  deduct_capacity: boolean
  deduct_ratio: number
  plant_consumption_rate: number
  peak_load_hours: number
  supply_demand_coefficient: number
  subsidy_years: number
  subsidy_continue: boolean
  subsidy_continue_amount: number
  capacity_correlates_eol: boolean
  annual_change_rate: number
  energy_deduct_capacity: boolean
  energy_deduct_ratio: number
  energy_annual_cycles: number
  energy_charge_price: number
  energy_discharge_price: number
  energy_correlates_eol: boolean
  energy_policy_years: number
  energy_annual_change_rate: number
  subsidy_type: string
  subsidy_standard: number
  subsidy_base_type: string
  subsidy_correlates_eol: boolean
  subsidy_execution_years: number
  subsidy_decline_rate: number
  primary_freq_regulation: boolean
  primary_freq_capacity: number
  primary_freq_deduct_ratio: number
  primary_freq_mileage: number
  primary_freq_clearing_price: number
  primary_freq_k_value: number
  primary_freq_days: number
  primary_freq_supply_short_years: number
  primary_freq_supply_short_change: number
  primary_freq_oversupply_years: number
  primary_freq_oversupply_change: number
  primary_freq_balance_years: number
  primary_freq_balance_change: number
  primary_freq_correlates_eol: boolean
  primary_freq_duration_minutes: number
  secondary_freq_regulation: boolean
  secondary_freq_capacity: number
  secondary_freq_deduct_ratio: number
  secondary_freq_mileage: number
  secondary_freq_clearing_price: number
  secondary_freq_k_value: number
  secondary_freq_days: number
  secondary_freq_supply_short_years: number
  secondary_freq_supply_short_change: number
  secondary_freq_oversupply_years: number
  secondary_freq_oversupply_change: number
  secondary_freq_balance_years: number
  secondary_freq_balance_change: number
  secondary_freq_correlates_eol: boolean
  secondary_freq_duration_minutes: number
  vat_output_rate: number
  tax_rate: number
  vat_input_rate1: number
  vat_input_rate2: number
  is_three_free_half: boolean
  target_equity_irr: number
  lcoe: number
}

export type StorageRevenue = {
  lease_revenue: number
  capacity_payment: number
  energy_revenue: number
  energy_charge_cost: number
  energy_discharge_revenue: number
  subsidy_revenue: number
  primary_freq_revenue: number
  secondary_freq_revenue: number
  auxiliary_revenue: number
  total_revenue: number
  capacity_retention: number
  annual_discharge_mwh: number
  annual_charge_mwh: number
}

export type StorageCashFlowItem = {
  year: number
  revenue: number
  charging_cost: number
  om_cost: number
  depreciation: number
  loan_principal: number
  loan_interest: number
  income_tax: number
  replacement_cost: number
  net_cash_flow: number
  cumulative_cash_flow: number
  capacity_retention: number
  annual_discharge: number
}

export type StorageCalculationResult = {
  success: true
  lcoe: number
  total_investment: number
  equity_investment: number
  annual_discharge: number
  annual_revenue: number
  annual_charging_cost: number
  payback_period: number
  dynamic_payback_period: number
  npv_value: number
  actual_equity_irr: number
  cash_flows: number[]
  cash_flow_schedule: StorageCashFlowItem[]
  revenue_breakdown: Record<string, number>
  capacity_retention_schedule: number[]
  summary: Record<string, number | string>
}

export type StorageSensitivityResult = {
  success: true
  /** 基准 IRR（%），无解时为 NaN */
  base_value: number
  target_param: 'IRR'
  sensitivity_results: Record<string, {
    base_value: number
    changes: number[]
    /** 与 changes 一一对应；IRR 无解的点为 null（图表断点），不再丢点 */
    values: Array<number | null>
  }>
}

type NumericStorageKey = {
  [K in keyof StorageCalculatorForm]: StorageCalculatorForm[K] extends number ? K : never
}[keyof StorageCalculatorForm]

const baseStorageForm: StorageCalculatorForm = {
  province: '新疆',
  system_power_mw: 200,
  battery_capacity_mwh: 400,
  system_efficiency: 92,
  dod: 95,
  eol: 70,
  lifecycle_degradation: 30,
  lifecycle_cycles: 8000,
  first_year_eol: 97,
  land_area_mu: 40,
  land_price_per_mu: 15,
  feasibility_cost: 50,
  construction_period: 0.5,
  construction_interest_rate: 3.5,
  epc_unit_price: 0.75,
  equipment_unit_price: 0.5,
  operation_years: 25,
  land_rent_annual: 0,
  om_percentage: 2,
  om_growth_rate: 1,
  insurance_rate: 0.2,
  other_cost_annual: 0,
  replace_battery: true,
  replace_battery_year: 13,
  replace_battery_unit_price: 0.3,
  salvage_rate: 5,
  loan_term: 10,
  loan_ratio: 80,
  loan_interest_rate: 3.5,
  discount_rate: 4,
  lease_price_per_mw: 0,
  lease_capacity_mw: 0,
  lease_term_years: 0,
  lease_continue_after_term: true,
  lease_continue_amount: 0,
  lease_correlates_eol: false,
  compensation_standard: 330,
  deduct_capacity: false,
  deduct_ratio: 0,
  plant_consumption_rate: 1.74,
  peak_load_hours: 11,
  supply_demand_coefficient: 89.53,
  subsidy_years: 2,
  subsidy_continue: true,
  subsidy_continue_amount: 0,
  capacity_correlates_eol: true,
  annual_change_rate: 0,
  energy_deduct_capacity: false,
  energy_deduct_ratio: 0,
  energy_annual_cycles: 350,
  energy_charge_price: 0.15,
  energy_discharge_price: 0.35,
  energy_correlates_eol: true,
  energy_policy_years: 0,
  energy_annual_change_rate: 0,
  subsidy_type: 'none',
  subsidy_standard: 0,
  subsidy_base_type: '放电电量',
  subsidy_correlates_eol: true,
  subsidy_execution_years: 5,
  subsidy_decline_rate: -10,
  primary_freq_regulation: false,
  primary_freq_capacity: 20,
  primary_freq_deduct_ratio: 0,
  primary_freq_mileage: 5000,
  primary_freq_clearing_price: 10,
  primary_freq_k_value: 1.8,
  primary_freq_days: 330,
  primary_freq_supply_short_years: 2,
  primary_freq_supply_short_change: 5,
  primary_freq_oversupply_years: 2,
  primary_freq_oversupply_change: -35,
  primary_freq_balance_years: 21,
  primary_freq_balance_change: -2,
  primary_freq_correlates_eol: false,
  primary_freq_duration_minutes: 0.5,
  secondary_freq_regulation: true,
  secondary_freq_capacity: 20,
  secondary_freq_deduct_ratio: 10,
  secondary_freq_mileage: 4000,
  secondary_freq_clearing_price: 12,
  secondary_freq_k_value: 2,
  secondary_freq_days: 330,
  secondary_freq_supply_short_years: 1,
  secondary_freq_supply_short_change: 5,
  secondary_freq_oversupply_years: 2,
  secondary_freq_oversupply_change: -20,
  secondary_freq_balance_years: 22,
  secondary_freq_balance_change: -2,
  secondary_freq_correlates_eol: false,
  secondary_freq_duration_minutes: 3,
  vat_output_rate: 13,
  tax_rate: 25,
  vat_input_rate1: 13,
  vat_input_rate2: 9,
  is_three_free_half: true,
  target_equity_irr: 10,
  lcoe: 0.7
}

export const storageProvinceList = ['甘肃', '广东', '江苏', '内蒙古', '宁夏', '青海', '山东', '西藏', '新疆', '浙江']

const provinceDefaults: Record<string, Partial<StorageCalculatorForm>> = {
  新疆: {
    province: '新疆',
    system_power_mw: 200,
    battery_capacity_mwh: 400,
    land_price_per_mu: 2,
    energy_charge_price: 0.15,
    energy_discharge_price: 0.35,
    compensation_standard: 165,
    supply_demand_coefficient: 89.53,
    peak_load_hours: 11,
    subsidy_continue_amount: 1935,
    secondary_freq_clearing_price: 10,
    energy_annual_cycles: 350
  },
  内蒙古: {
    province: '内蒙古',
    system_power_mw: 200,
    battery_capacity_mwh: 400,
    land_price_per_mu: 18,
    energy_charge_price: 0.18,
    energy_discharge_price: 0.38,
    compensation_standard: 350,
    supply_demand_coefficient: 90,
    peak_load_hours: 10,
    secondary_freq_clearing_price: 13,
    energy_annual_cycles: 360
  },
  青海: {
    province: '青海',
    system_power_mw: 200,
    battery_capacity_mwh: 400,
    land_price_per_mu: 2,
    energy_charge_price: 0.15,
    energy_discharge_price: 0.35,
    compensation_standard: 185,
    supply_demand_coefficient: 88,
    peak_load_hours: 11,
    secondary_freq_clearing_price: 10,
    energy_annual_cycles: 350
  },
  甘肃: {
    province: '甘肃',
    system_power_mw: 200,
    battery_capacity_mwh: 400,
    land_price_per_mu: 14,
    energy_charge_price: 0.17,
    energy_discharge_price: 0.37,
    compensation_standard: 330,
    supply_demand_coefficient: 89,
    peak_load_hours: 6,
    secondary_freq_clearing_price: 12,
    energy_annual_cycles: 350
  },
  宁夏: {
    province: '宁夏',
    system_power_mw: 200,
    battery_capacity_mwh: 400,
    land_price_per_mu: 16,
    energy_charge_price: 0.18,
    energy_discharge_price: 0.38,
    compensation_standard: 340,
    supply_demand_coefficient: 89.5,
    peak_load_hours: 6,
    secondary_freq_clearing_price: 12.5,
    energy_annual_cycles: 355
  },
  西藏: {
    province: '西藏',
    system_power_mw: 100,
    battery_capacity_mwh: 200,
    land_price_per_mu: 10,
    energy_charge_price: 0.2,
    energy_discharge_price: 0.45,
    compensation_standard: 380,
    supply_demand_coefficient: 85,
    peak_load_hours: 6,
    secondary_freq_clearing_price: 15,
    energy_annual_cycles: 300
  },
  江苏: {
    province: '江苏',
    system_power_mw: 100,
    battery_capacity_mwh: 200,
    land_price_per_mu: 50,
    energy_charge_price: 0.25,
    energy_discharge_price: 0.55,
    compensation_standard: 400,
    supply_demand_coefficient: 92,
    peak_load_hours: 4,
    secondary_freq_clearing_price: 18,
    energy_annual_cycles: 400
  },
  浙江: {
    province: '浙江',
    system_power_mw: 100,
    battery_capacity_mwh: 200,
    land_price_per_mu: 55,
    energy_charge_price: 0.26,
    energy_discharge_price: 0.56,
    compensation_standard: 410,
    supply_demand_coefficient: 92.5,
    peak_load_hours: 4,
    secondary_freq_clearing_price: 18.5,
    energy_annual_cycles: 410
  },
  广东: {
    province: '广东',
    system_power_mw: 150,
    battery_capacity_mwh: 300,
    land_price_per_mu: 60,
    energy_charge_price: 0.28,
    energy_discharge_price: 0.58,
    compensation_standard: 420,
    supply_demand_coefficient: 93,
    peak_load_hours: 4,
    secondary_freq_clearing_price: 19,
    energy_annual_cycles: 420
  },
  山东: {
    province: '山东',
    system_power_mw: 150,
    battery_capacity_mwh: 300,
    land_price_per_mu: 45,
    energy_charge_price: 0.24,
    energy_discharge_price: 0.52,
    compensation_standard: 390,
    supply_demand_coefficient: 91,
    peak_load_hours: 4,
    secondary_freq_clearing_price: 17,
    energy_annual_cycles: 390
  }
}

export function getStorageDefaultForm(province = '新疆'): StorageCalculatorForm {
  return {
    ...baseStorageForm,
    ...(provinceDefaults[province] ?? provinceDefaults.新疆),
    province
  }
}

function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function cloneForm(form: StorageCalculatorForm): StorageCalculatorForm {
  return { ...form }
}

function calculateSingleBatteryRetention(year: number) {
  if (year <= 0) return 1
  if (year === 1) return 0.94
  return Math.max(0, 0.94 - 0.015 * (year - 1))
}

export function calculateCapacityRetention(form: StorageCalculatorForm, year: number) {
  if (year <= 0) return 1
  if (form.replace_battery && year >= form.replace_battery_year) {
    return calculateSingleBatteryRetention(year - form.replace_battery_year + 1)
  }
  return calculateSingleBatteryRetention(year)
}

function calculateLoanSchedule(form: StorageCalculatorForm, totalInvestment: number) {
  const loanAmount = totalInvestment * form.loan_ratio / 100
  const schedule: Array<{ principal: number; interest: number }> = []
  const annualRate = form.loan_interest_rate / 100
  const annualPayment = annualRate === 0
    ? loanAmount / Math.max(form.loan_term, 1)
    : loanAmount * (annualRate * (1 + annualRate) ** form.loan_term) / ((1 + annualRate) ** form.loan_term - 1)

  let balance = loanAmount
  for (let year = 0; year < form.operation_years; year += 1) {
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

export function calculateTotalInvestment(form: StorageCalculatorForm) {
  const epcTotal = form.battery_capacity_mwh * 1_000_000 * form.epc_unit_price / 10000
  const landCost = form.land_area_mu * form.land_price_per_mu
  const constructionInterest = epcTotal * form.construction_interest_rate / 100 * form.construction_period
  const totalInvestment = epcTotal + landCost + form.feasibility_cost + constructionInterest

  return {
    epcTotal,
    landCost,
    constructionInterest,
    totalInvestment,
    equityInvestment: totalInvestment * (1 - form.loan_ratio / 100)
  }
}

export function calculateStorageRevenue(form: StorageCalculatorForm, year: number): StorageRevenue {
  const capacityRetention = calculateCapacityRetention(form, year)

  let leaseRevenue = 0
  if (form.lease_term_years === 0 || form.lease_term_years >= year) {
    leaseRevenue = form.lease_price_per_mw * form.lease_capacity_mw
    if (form.lease_correlates_eol) leaseRevenue *= capacityRetention
  } else if (form.lease_continue_after_term) {
    leaseRevenue = form.lease_continue_amount
  }

  const maxDurationHours = form.system_power_mw > 0 ? form.battery_capacity_mwh / form.system_power_mw : 0
  const reliableCapacityCoefficient = Math.min(maxDurationHours / Math.max(form.peak_load_hours, 1), 1)
  let basePowerMw = form.system_power_mw * (1 - form.plant_consumption_rate / 100)
  if (form.deduct_capacity) basePowerMw *= (1 - form.deduct_ratio / 100)
  const reliableCapacity = basePowerMw * reliableCapacityCoefficient
  const capacityPaymentBase = reliableCapacity * 1000 * form.compensation_standard / 10000
  let capacityPayment = capacityPaymentBase * form.supply_demand_coefficient / 100
  if (form.capacity_correlates_eol) capacityPayment *= capacityRetention

  if (form.subsidy_years > 0 && year > form.subsidy_years) {
    capacityPayment = form.subsidy_continue ? form.subsidy_continue_amount : 0
  } else if (form.subsidy_years > 0 && year > 1) {
    capacityPayment *= (1 + form.annual_change_rate / 100) ** (year - 1)
  }

  const availableCapacityMwh = form.energy_deduct_capacity
    ? form.battery_capacity_mwh * (1 - form.energy_deduct_ratio / 100)
    : form.battery_capacity_mwh
  const annualChargeMwh = availableCapacityMwh * form.dod / 100 / Math.max(form.system_efficiency / 100, 0.01) * form.energy_annual_cycles
  const annualChargeCost = annualChargeMwh * form.energy_charge_price / 10
  const annualDischargeMwh = availableCapacityMwh * form.dod / 100 * (form.system_efficiency / 100) * form.energy_annual_cycles
  const annualDischargeRevenue = annualDischargeMwh * form.energy_discharge_price / 10
  const energyBaseRevenue = (annualDischargeRevenue - annualChargeCost) * form.first_year_eol / 100

  let energyRevenue = energyBaseRevenue
  if (form.energy_correlates_eol) {
    energyRevenue = year === 1 ? energyBaseRevenue : energyBaseRevenue * calculateCapacityRetention(form, year - 1)
  }
  if (form.energy_policy_years > 0 && year > form.energy_policy_years) {
    energyRevenue = energyBaseRevenue
  } else if (form.energy_policy_years > 0 && year > 1) {
    energyRevenue = energyBaseRevenue * (1 + form.energy_annual_change_rate / 100) ** (year - 1)
  }

  const subsidyBase = form.subsidy_base_type === '充电电量' ? annualChargeMwh : annualDischargeMwh
  const firstYearSubsidyBase = form.subsidy_type === 'none' ? 0 : form.subsidy_standard * subsidyBase / 10
  let subsidyRevenue = 0
  if (year <= form.subsidy_execution_years && form.subsidy_execution_years > 0) {
    const declineMultiplier = year === 1 ? 1 : (1 + form.subsidy_decline_rate / 100) ** (year - 1)
    subsidyRevenue = firstYearSubsidyBase * declineMultiplier
    if (form.subsidy_correlates_eol) subsidyRevenue *= capacityRetention
  }

  let primaryFreqRevenue = 0
  if (form.primary_freq_regulation && form.primary_freq_mileage > 0) {
    const baseRevenue = form.primary_freq_mileage * form.primary_freq_clearing_price * form.primary_freq_k_value * form.primary_freq_days / 10000
    primaryFreqRevenue = baseRevenue * stagedMultiplier(
      year,
      form.primary_freq_supply_short_years,
      form.primary_freq_supply_short_change,
      form.primary_freq_oversupply_years,
      form.primary_freq_oversupply_change,
      form.primary_freq_balance_change
    )
    if (form.primary_freq_correlates_eol) primaryFreqRevenue *= capacityRetention
  }

  let secondaryFreqRevenue = 0
  if (form.secondary_freq_regulation && form.secondary_freq_mileage > 0) {
    const baseRevenue = form.secondary_freq_mileage * form.secondary_freq_clearing_price * form.secondary_freq_k_value * form.secondary_freq_days / 10000
    secondaryFreqRevenue = baseRevenue * stagedMultiplier(
      year,
      form.secondary_freq_supply_short_years,
      form.secondary_freq_supply_short_change,
      form.secondary_freq_oversupply_years,
      form.secondary_freq_oversupply_change,
      form.secondary_freq_balance_change
    )
    if (form.secondary_freq_correlates_eol) secondaryFreqRevenue *= capacityRetention
  }

  const auxiliaryRevenue = primaryFreqRevenue + secondaryFreqRevenue
  const totalRevenue = leaseRevenue + capacityPayment + energyRevenue + subsidyRevenue + auxiliaryRevenue

  return {
    lease_revenue: leaseRevenue,
    capacity_payment: capacityPayment,
    energy_revenue: energyRevenue,
    energy_charge_cost: annualChargeCost,
    energy_discharge_revenue: annualDischargeRevenue,
    subsidy_revenue: subsidyRevenue,
    primary_freq_revenue: primaryFreqRevenue,
    secondary_freq_revenue: secondaryFreqRevenue,
    auxiliary_revenue: auxiliaryRevenue,
    total_revenue: totalRevenue,
    capacity_retention: capacityRetention,
    annual_discharge_mwh: annualDischargeMwh,
    annual_charge_mwh: annualChargeMwh
  }
}

function stagedMultiplier(
  year: number,
  supplyShortYears: number,
  supplyShortChange: number,
  oversupplyYears: number,
  oversupplyChange: number,
  balanceChange: number
) {
  if (year <= supplyShortYears) return (1 + supplyShortChange / 100) ** year
  const supplyEnd = (1 + supplyShortChange / 100) ** supplyShortYears
  if (year <= supplyShortYears + oversupplyYears) {
    return supplyEnd * (1 + oversupplyChange / 100) ** (year - supplyShortYears)
  }
  const oversupplyEnd = supplyEnd * (1 + oversupplyChange / 100) ** oversupplyYears
  return oversupplyEnd * (1 + balanceChange / 100) ** (year - supplyShortYears - oversupplyYears)
}

export function calculateStorageCashFlows(form: StorageCalculatorForm) {
  const totals = calculateTotalInvestment(form)
  const loanSchedule = calculateLoanSchedule(form, totals.totalInvestment)
  const baseOmCost = totals.totalInvestment * form.om_percentage / 100
  const insuranceCost = totals.epcTotal * form.insurance_rate / 100
  const depreciableBase = totals.totalInvestment * (1 - form.salvage_rate / 100)
  const annualDepreciation = depreciableBase / Math.max(form.operation_years, 1)
  const batteryReplacementCost = form.replace_battery
    ? form.battery_capacity_mwh * 1_000_000 * form.replace_battery_unit_price / 10000
    : 0
  const cashFlows = [-totals.equityInvestment]

  for (let yearIndex = 0; yearIndex < form.operation_years; yearIndex += 1) {
    const year = yearIndex + 1
    const revenueInfo = calculateStorageRevenue(form, year)
    const omCost = baseOmCost * (1 + form.om_growth_rate / 100) ** yearIndex
    const depreciation = form.replace_battery && year >= form.replace_battery_year
      ? (depreciableBase + batteryReplacementCost) / Math.max(form.operation_years, 1)
      : annualDepreciation
    const interest = loanSchedule[yearIndex]?.interest ?? 0
    const principal = loanSchedule[yearIndex]?.principal ?? 0
    const replacementCost = form.replace_battery && year === form.replace_battery_year ? batteryReplacementCost : 0
    const taxableIncome = revenueInfo.total_revenue - omCost - insuranceCost - depreciation - interest
    let incomeTax = 0
    if (form.is_three_free_half) {
      if (yearIndex < 3) incomeTax = 0
      else if (yearIndex < 6) incomeTax = Math.max(0, taxableIncome * form.tax_rate / 100 * 0.5)
      else incomeTax = Math.max(0, taxableIncome * form.tax_rate / 100)
    } else {
      incomeTax = Math.max(0, taxableIncome * form.tax_rate / 100)
    }

    let netCashFlow = revenueInfo.total_revenue
      - omCost
      - insuranceCost
      - form.land_rent_annual
      - form.other_cost_annual
      - incomeTax
      - principal
      - interest
      - replacementCost

    if (year === form.operation_years) {
      netCashFlow += totals.totalInvestment * form.salvage_rate / 100
    }
    cashFlows.push(Math.abs(netCashFlow) < 1e-6 ? 0 : netCashFlow)
  }

  return cashFlows
}

/**
 * 资本金内部收益率 IRR（%）。
 * E2 修复：负 IRR 如实返回（项目亏损时 IRR 为负是正常财务结论，不得截断为 0）；
 * 现金流无变号 / 搜索区间内无实根 / 不收敛时返回 NaN（不再用 0 当哨兵，
 * 调用方用 Number.isFinite 判断"无解"，UI 层显示为「无解」，图表点置 null）。
 */
export function calculateIRR(cashFlows: number[]) {
  // 现金流全为同号时 NPV 单调不变号，IRR 无实根
  if (cashFlows.length < 2 || !cashFlows.some((value) => value > 0) || !cashFlows.some((value) => value < 0)) return NaN

  // IRR 结果不走 round()（round 会把 NaN 折叠成 0，属哨兵泄漏），单独保留 4 位小数
  const roundIrr = (rate: number) => Math.round(rate * 100 * 10000) / 10000

  const npvAt = (rate: number) => cashFlows.reduce((sum, cashFlow, index) => sum + cashFlow / (1 + rate) ** index, 0)
  const derivativeAt = (rate: number) => cashFlows.reduce((sum, cashFlow, index) => sum - index * cashFlow / (1 + rate) ** (index + 1), 0)

  let rate = 0.1
  for (let index = 0; index < 100; index += 1) {
    const value = npvAt(rate)
    const derivative = derivativeAt(rate)
    if (Math.abs(value) < 1e-6) return roundIrr(rate)
    if (Math.abs(derivative) < 1e-10) break
    rate -= value / derivative
    if (!Number.isFinite(rate) || rate <= -0.99 || rate > 10) break
  }

  let previousRate = -0.95
  let previousValue = npvAt(previousRate)
  for (let step = 1; step <= 1200; step += 1) {
    const currentRate = -0.95 + step * (5.95 / 1200)
    const currentValue = npvAt(currentRate)
    if (previousValue === 0) return roundIrr(previousRate)
    if (previousValue * currentValue <= 0) {
      let low = previousRate
      let high = currentRate
      for (let index = 0; index < 80; index += 1) {
        const mid = (low + high) / 2
        const midValue = npvAt(mid)
        if (Math.abs(midValue) < 1e-7) return roundIrr(mid)
        if (npvAt(low) * midValue <= 0) high = mid
        else low = mid
      }
      return roundIrr((low + high) / 2)
    }
    previousRate = currentRate
    previousValue = currentValue
  }

  // 网格扫描区间 (-95%, 500%) 内未找到变号：视为无解
  return NaN
}

export function calculateNPV(cashFlows: number[], discountRate: number) {
  if (!cashFlows.length || discountRate <= -100) return 0
  const rate = discountRate / 100
  return cashFlows.reduce((sum, cashFlow, index) => sum + cashFlow / (1 + rate) ** index, 0)
}

export function calculatePaybackPeriod(cashFlows: number[], discountRate = 0) {
  if (!cashFlows.length) return 0
  let cumulative = 0
  const rate = discountRate / 100

  for (let year = 0; year < cashFlows.length; year += 1) {
    const discounted = discountRate === 0 ? cashFlows[year] : cashFlows[year] / (1 + rate) ** year
    const previous = cumulative
    cumulative += discounted
    if (cumulative >= 0 && year > 0) {
      const currentYearCash = Math.max(discounted, 1e-6)
      return round(year - 1 + Math.abs(previous) / currentYearCash, 2)
    }
  }

  return 0
}

function calculateAnnualCyclesForTargetIRR(form: StorageCalculatorForm) {
  const target = form.target_equity_irr
  const lowForm = { ...form, energy_annual_cycles: 0 }
  const highForm = { ...form, energy_annual_cycles: 700 }
  const lowIrr = calculateIRR(calculateStorageCashFlows(lowForm))
  const highIrr = calculateIRR(calculateStorageCashFlows(highForm))

  // IRR 可能为 NaN（无解），用否定式比较保证 NaN 走"达不到目标"分支
  if (lowIrr >= target) return 0
  if (!(highIrr >= target)) return 700

  let low = 0
  let high = 700
  for (let index = 0; index < 60; index += 1) {
    const mid = (low + high) / 2
    const modified = { ...form, energy_annual_cycles: mid }
    const irr = calculateIRR(calculateStorageCashFlows(modified))
    if (irr >= target) high = mid
    else low = mid
  }
  return round(high, 0)
}

function calculateStorageLcoe(form: StorageCalculatorForm, totalInvestment: number) {
  const annualDischarge = (year: number) => {
    return form.battery_capacity_mwh
      * calculateCapacityRetention(form, year)
      * form.dod / 100
      * form.system_efficiency / 100
      * form.energy_annual_cycles
  }
  const objective = (lcoe: number) => {
    const firstYearDischarge = annualDischarge(1)
    const firstYearRevenue = calculateStorageRevenue(form, 1).total_revenue
    if (firstYearDischarge <= 0 || firstYearRevenue <= 0) return -Infinity
    const equivalentAnnualRevenue = lcoe * firstYearDischarge * 10
    const multiplier = Math.max(0.1, Math.min(10, equivalentAnnualRevenue / firstYearRevenue))
    const modified = {
      ...form,
      lease_price_per_mw: Math.max(0, form.lease_price_per_mw * multiplier),
      compensation_standard: Math.max(0, form.compensation_standard * multiplier),
      energy_charge_price: Math.max(0.01, form.energy_charge_price * multiplier),
      energy_discharge_price: Math.max(0.01, form.energy_discharge_price * multiplier),
      primary_freq_mileage: Math.max(0, form.primary_freq_mileage * multiplier),
      secondary_freq_mileage: Math.max(0, form.secondary_freq_mileage * multiplier)
    }
    const cashFlows = calculateStorageCashFlows(modified)
    if (cashFlows.reduce((sum, value) => sum + value, 0) <= 0) return -Infinity
    const irr = calculateIRR(cashFlows)
    // IRR 无解（NaN）时视为远低于目标，驱动二分往抬价方向走
    if (!Number.isFinite(irr)) return -Infinity
    return irr - form.target_equity_irr
  }

  if (totalInvestment <= 0 || objective(0) >= 0) return 0
  let low = 0
  let high = 2
  for (let index = 0; index < 20 && objective(high) < 0; index += 1) {
    high *= 2
    if (high > 10) return -1
  }
  for (let index = 0; index < 120; index += 1) {
    const mid = Math.min(Math.max((low + high) / 2, 0.01), 2)
    const diff = objective(mid)
    if (Math.abs(diff) < 1e-4 || high - low < 1e-4) return round(mid, 4)
    if (diff > 0) high = mid
    else low = mid
  }
  return round((low + high) / 2, 4)
}

export function calculateStorageInvestment(input: StorageCalculatorForm): StorageCalculationResult {
  const form = cloneForm(input)
  if (form.energy_annual_cycles <= 0) {
    form.energy_annual_cycles = calculateAnnualCyclesForTargetIRR(form)
  }

  const totals = calculateTotalInvestment(form)
  const cashFlows = calculateStorageCashFlows(form)
  const firstYearRevenue = calculateStorageRevenue(form, 1)
  const loanSchedule = calculateLoanSchedule(form, totals.totalInvestment)
  const baseOmCost = totals.totalInvestment * form.om_percentage / 100
  const insuranceCost = totals.epcTotal * form.insurance_rate / 100
  const depreciableBase = totals.totalInvestment * (1 - form.salvage_rate / 100)
  const annualDepreciation = depreciableBase / Math.max(form.operation_years, 1)
  const batteryReplacementCost = form.replace_battery
    ? form.battery_capacity_mwh * 1_000_000 * form.replace_battery_unit_price / 10000
    : 0
  const schedule: StorageCashFlowItem[] = []
  const retentionSchedule: number[] = []
  let cumulative = cashFlows[0]

  for (let yearIndex = 0; yearIndex < form.operation_years; yearIndex += 1) {
    const year = yearIndex + 1
    const revenueInfo = calculateStorageRevenue(form, year)
    const omCost = baseOmCost * (1 + form.om_growth_rate / 100) ** yearIndex
    const depreciation = form.replace_battery && year >= form.replace_battery_year
      ? (depreciableBase + batteryReplacementCost) / Math.max(form.operation_years, 1)
      : annualDepreciation
    const interest = loanSchedule[yearIndex]?.interest ?? 0
    const principal = loanSchedule[yearIndex]?.principal ?? 0
    const replacementCost = form.replace_battery && year === form.replace_battery_year ? batteryReplacementCost : 0
    const taxableIncome = revenueInfo.total_revenue - omCost - insuranceCost - depreciation - interest
    const incomeTax = form.is_three_free_half
      ? yearIndex < 3 ? 0 : yearIndex < 6 ? Math.max(0, taxableIncome * form.tax_rate / 100 * 0.5) : Math.max(0, taxableIncome * form.tax_rate / 100)
      : Math.max(0, taxableIncome * form.tax_rate / 100)
    const netCashFlow = cashFlows[year] ?? 0
    cumulative += netCashFlow
    retentionSchedule.push(round(revenueInfo.capacity_retention * 100, 2))
    schedule.push({
      year,
      revenue: round(revenueInfo.total_revenue, 2),
      charging_cost: round(revenueInfo.energy_charge_cost, 2),
      om_cost: round(omCost, 2),
      depreciation: round(depreciation, 2),
      loan_principal: round(principal, 2),
      loan_interest: round(interest, 2),
      income_tax: round(incomeTax, 2),
      replacement_cost: round(replacementCost, 2),
      net_cash_flow: round(netCashFlow, 2),
      cumulative_cash_flow: round(cumulative, 2),
      capacity_retention: round(revenueInfo.capacity_retention * 100, 2),
      annual_discharge: round(revenueInfo.annual_discharge_mwh, 2)
    })
  }

  const annualRevenue = firstYearRevenue.total_revenue
  const actualIrr = calculateIRR(cashFlows)
  const lcoe = form.lcoe && form.lcoe > 0 ? form.lcoe : calculateStorageLcoe(form, totals.totalInvestment)

  return {
    success: true,
    lcoe: round(lcoe, 4),
    total_investment: round(totals.totalInvestment, 2),
    equity_investment: round(totals.equityInvestment, 2),
    annual_discharge: round(firstYearRevenue.annual_discharge_mwh, 2),
    annual_revenue: round(annualRevenue, 2),
    annual_charging_cost: round(firstYearRevenue.energy_charge_cost, 2),
    payback_period: calculatePaybackPeriod(cashFlows),
    dynamic_payback_period: calculatePaybackPeriod(cashFlows, form.discount_rate),
    npv_value: round(calculateNPV(cashFlows, form.discount_rate), 2),
    // IRR 无解时保留 NaN（round 会折叠为 0），UI 层用 Number.isFinite 判断显示「无解」
    actual_equity_irr: Number.isFinite(actualIrr) ? round(actualIrr, 4) : NaN,
    cash_flows: cashFlows.map((value) => round(value, 2)),
    cash_flow_schedule: schedule,
    revenue_breakdown: {
      lease_revenue: round(firstYearRevenue.lease_revenue, 2),
      capacity_payment: round(firstYearRevenue.capacity_payment, 2),
      energy_revenue: round(firstYearRevenue.energy_revenue, 2),
      peak_valley_arbitrage: round(firstYearRevenue.energy_discharge_revenue - firstYearRevenue.energy_charge_cost, 2),
      energy_charge_cost: round(firstYearRevenue.energy_charge_cost, 2),
      energy_discharge_revenue: round(firstYearRevenue.energy_discharge_revenue, 2),
      subsidy_revenue: round(firstYearRevenue.subsidy_revenue, 2),
      primary_freq_revenue: round(firstYearRevenue.primary_freq_revenue, 2),
      secondary_freq_revenue: round(firstYearRevenue.secondary_freq_revenue, 2),
      auxiliary_revenue: round(firstYearRevenue.auxiliary_revenue, 2),
      total_revenue: round(annualRevenue, 2),
      capacity_retention: round(firstYearRevenue.capacity_retention * 100, 2),
      annual_discharge_mwh: round(firstYearRevenue.annual_discharge_mwh, 2)
    },
    capacity_retention_schedule: retentionSchedule,
    summary: {
      province: form.province,
      energy_annual_cycles: round(form.energy_annual_cycles, 0),
      annual_revenue: round(annualRevenue, 2),
      annual_charging_cost: round(firstYearRevenue.energy_charge_cost, 2),
      annual_discharge: round(firstYearRevenue.annual_discharge_mwh, 2),
      target_equity_irr: form.target_equity_irr
    }
  }
}

export function runStorageSensitivityAnalysis(input: StorageCalculatorForm): StorageSensitivityResult {
  const form = cloneForm(input)
  const baseValue = calculateIRR(calculateStorageCashFlows(form))
  const params: Array<[string, NumericStorageKey, number]> = [
    ['系统功率', 'system_power_mw', 0.3],
    ['电池容量', 'battery_capacity_mwh', 0.3],
    ['EPC 单价', 'epc_unit_price', 0.3],
    ['年循环次数', 'energy_annual_cycles', 0.3],
    ['补偿标准', 'compensation_standard', 0.3],
    ['供需系数', 'supply_demand_coefficient', 0.3],
    ['放电电价', 'energy_discharge_price', 0.3],
    ['充电电价', 'energy_charge_price', 0.3],
    ['调频出清价', 'secondary_freq_clearing_price', 0.3],
    ['运维占比', 'om_percentage', 0.3]
  ]
  const results: StorageSensitivityResult['sensitivity_results'] = {}

  params.forEach(([label, key, range]) => {
    const base = form[key]
    if (base === 0) return
    const changes: number[] = []
    const values: Array<number | null> = []
    ;[-range, -0.2, -0.1, 0, 0.1, 0.2, range].forEach((change) => {
      const modified = cloneForm(form)
      modified[key] = base * (1 + change)
      const value = calculateIRR(calculateStorageCashFlows(modified))
      // 负 IRR 如实保留；仅无解（NaN）时置 null 让图表断点，不再整点丢弃
      changes.push(round(change * 100, 0))
      values.push(Number.isFinite(value) ? round(value, 4) : null)
    })
    results[label] = {
      base_value: round(base, 4),
      changes,
      values
    }
  })

  return {
    success: true,
    base_value: Number.isFinite(baseValue) ? round(baseValue, 4) : NaN,
    target_param: 'IRR',
    sensitivity_results: results
  }
}
