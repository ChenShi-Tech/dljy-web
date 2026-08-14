// 重卡充换电投资测算（逐年现金流重构版）
//
// 审计修复要点（对应审计编号）：
// - A1/A5/G3：以「逐年现金流表」为唯一事实源 —— 等额本息下利息随贷款余额逐年递减、贷款期满本息归零、
//   折旧仅在折旧年限内计提、所得税逐年计算（亏损年为 0，亏损结转未建模，见 buildYearlyCashFlow 注释）；
//   IRR/NPV/回收期/现金流明细全部由同一张表推出，不再用「同一 equityCashFlow 平推 N 年」。
// - A2/A3/E3：收入门控 —— 自有车付给自有站的充电服务费/电费属内部交易，合并口径下收入侧不计
//   （成本侧只计一次购电成本，二选一取「收入侧剔除」）；纯充电站电费收入无条件计（平进平出+服务费）；
//   混合/挂靠/外委按非自有车比例计对外充电收入。
// - A4：土地不参与折旧，折旧基数 = 总投资 − 土地费用；期末残值 = 设备残值 + 土地原值回收（简化口径：
//   土地按原值一次性收回，不建模增值/摊销）。
// - A7：现金流表覆盖全项目期（0..project_life），期末年含残值回收列。
// - E1：目标 IRR 反算运价改为对主模型资本金 IRR 的二分搜索（区间自适应扩张），天然与主模型同口径；
//   不收敛返回 NaN + converged:false。
// - G1/C1/D1：电池更换资本性支出、两部制基本电费、增值税及附加的最小接线（参数化，默认保守）。
// - C2/C3/D2/D3/F：电耗单源（由 kWh/km 电耗参数派生公里电费成本与充电功率，删除 1.5/1.1 魔数）、
//   回程带货率独立参数、除零守卫显式化（safeDiv 返回 0，不再用 Math.max(1,x) 静默替换合法小数值）、
//   贷款比例 100% 返回显式提示而非伪数值、折现率 0% 合法、敏感性只列对当前模式生效的参数。

export type TruckChargingProjectType = 'truck' | 'charging' | 'integrated'
export type TruckChargingCalcMode = 'by_truck' | 'by_volume'
export type TruckChargingOperationMode = 'owned' | 'affiliated' | 'outsourced' | 'mixed'
export type TruckChargingProfitMode = 'by_price' | 'by_rate'
export type TruckChargingRouteMode = 'simple' | 'multi_segment'

export interface TruckRouteSegment {
  start: string
  end: string
  distance: number
  rate: number
  enabled: boolean
  dailyVolume: number
  energyConsumption: number
  highwayDistance: number
  highwayTollRate: number
  outsourced_price: number
}

export interface TruckChargingForm {
  project_type: TruckChargingProjectType
  calc_mode: TruckChargingCalcMode
  operation_mode: TruckChargingOperationMode
  profit_mode: TruckChargingProfitMode
  route_mode: TruckChargingRouteMode
  route_segments: TruckRouteSegment[]
  truck_count: number
  truck_capacity: number
  charging_station_count: number
  operating_days: number
  annual_transport_volume: number
  avg_transport_distance: number
  daily_transport_volume: number
  daily_mileage: number
  freight_rate: number
  target_irr: number
  load_factor: number
  /** 回程带货率（%）：回程实际载货量占单程载量的比例，独立参数（C3） */
  return_load_factor: number
  forward_energy_consumption: number
  return_energy_consumption: number
  return_factor: number
  affiliated_truck_count: number
  affiliated_fee_per_truck: number
  management_fee_rate: number
  outsourced_truck_count: number
  outsourced_rate: number
  owned_truck_ratio: number
  service_fee: number
  electricity_price: number
  daily_charging: number
  enable_charging_params: boolean
  truck_price: number
  station_cost_per_kw: number
  station_investment: number
  land_cost: number
  other_construction: number
  driver_salary: number
  daily_highway_toll: number
  maintenance_cost: number
  insurance_cost: number
  station_om_cost: number
  labor_cost: number
  /** 电池更换年份（第 N 年发生资本性支出；0 表示不更换）（G1） */
  battery_replacement_year: number
  /** 电池更换成本（万元/车）（G1） */
  battery_replacement_cost: number
  /** 两部制基本电费（元/kW·月，按充电站总功率计；0 表示不启用）（C1） */
  demand_charge: number
  project_life: number
  depreciation_years: number
  salvage_rate: number
  loan_interest_rate: number
  loan_ratio: number
  loan_term: number
  tax_rate: number
  vat_rate: number
  discount_rate: number
}

export interface TruckAllocation {
  owned: number
  affiliated: number
  outsourced: number
}

export interface TruckChargingBreakdownRow {
  item: string
  amount: number
  ratio: number
  description?: string
}

export interface TruckChargingCashFlowRow {
  year: number
  revenue: number
  /** 付现成本：经营成本 + 电池更换资本性支出（不含利息/本金/税金） */
  cost: number
  /** 当年贷款利息（等额本息，逐年递减；贷款期满为 0） */
  interest: number
  /** 当年偿还贷款本金（贷款期满为 0） */
  principal: number
  /** 当年折旧（非现金项，仅展示；折旧期外为 0） */
  depreciation: number
  /** 当年税金合计：增值税及附加 + 所得税 */
  tax: number
  /** 期末残值回收：设备残值 + 土地原值（仅期末年） */
  salvage: number
  net_cash_flow: number
  cumulative_cash_flow: number
}

export interface TruckChargingDerivedMetrics {
  total_distance: number
  daily_mileage: number
  avg_freight_rate: number
  avg_energy_consumption: number
  /** 电耗单源派生的公里电费成本（元/km）= 综合电耗 × (电价 + 服务费)（C2） */
  energy_cost_per_km: number
  load_factor: number
  daily_highway_toll: number
  daily_charging_per_station: number
  daily_total_charging: number
  total_charging_power: number
  charging_gun_count: number
  station_investment: number
  total_station_investment: number
  outsourced_rate: number
}

export interface TruckChargingResult {
  success: true
  actual_truck_count: number
  owned_truck_count: number
  affiliated_truck_count: number
  outsourced_truck_count: number
  calculated_freight_rate: number
  total_investment: number
  annual_revenue: number
  annual_cost: number
  annual_profit: number
  /** 资本金 IRR（%）；资本金为 0（loan_ratio≥100）时为 NaN，并在 warnings 给出提示（D2） */
  equity_irr: number
  /** 动态回收期（年）；项目期内未回收为 NaN */
  payback_period: number
  npv: number
  /** 目标 IRR 反算运价是否收敛（仅 by_rate 模式返回）（E1） */
  freight_rate_converged?: boolean
  /** 显式提示（资本金为 0、反算未收敛等），替代静默伪数值 */
  warnings: string[]
  revenue_breakdown: TruckChargingBreakdownRow[]
  cost_breakdown: TruckChargingBreakdownRow[]
  cash_flow: TruckChargingCashFlowRow[]
  affiliated_fee_income: number
  management_fee_income: number
  affiliated_total_income: number
  affiliated_income_breakdown: TruckChargingBreakdownRow[]
  affiliated_driver_avg_income: number
  affiliated_driver_cost: number
  affiliated_driver_net_income: number
  affiliated_driver_cost_breakdown: TruckChargingBreakdownRow[]
  affiliated_total_revenue: number
  affiliated_total_cost: number
  affiliated_total_profit: number
  derived: TruckChargingDerivedMetrics
}

export interface TruckChargingSensitivityResult {
  base_npv: number
  base_irr: number
  target_param: 'NPV' | '资本金IRR'
  sensitivity_results: Record<string, {
    changes: number[]
    values: number[]
    base_value: number
    sensitivity: number
  }>
}

export interface TruckChargingFreightSolveResult {
  freight_rate: number
  converged: boolean
}

const DEFAULT_SEGMENTS: TruckRouteSegment[] = [
  {
    start: '米东碱沟煤矿',
    end: '沙湾帅科焦化有限公司',
    distance: 287,
    rate: 65,
    enabled: true,
    dailyVolume: 3000,
    energyConsumption: 1.6,
    highwayDistance: 0,
    highwayTollRate: 0,
    outsourced_price: 77
  },
  {
    start: '沙湾帅科焦化有限公司',
    end: '宝武八一钢铁有限公司',
    distance: 270,
    rate: 45,
    enabled: true,
    dailyVolume: 1000,
    energyConsumption: 1.6,
    highwayDistance: 0,
    highwayTollRate: 0,
    outsourced_price: 59.5
  },
  {
    start: '宝武八一钢铁有限公司',
    end: '米东碱沟煤矿',
    distance: 50,
    rate: 0,
    enabled: true,
    dailyVolume: 0,
    energyConsumption: 1.6,
    highwayDistance: 0,
    highwayTollRate: 0,
    outsourced_price: 17.5
  }
]

// —— 口径常数（集中声明，不在算式里散落魔数）——
/** 日有效充电小时数：充电总功率 = 日充电量 / (有效小时 × 功率利用率)，即由充电量反推功率（C2） */
const CHARGING_HOURS_PER_DAY = 10
/** 充电功率利用率 */
const POWER_UTILIZATION = 0.7
/** 多段线路空驶段能耗折减系数 */
const EMPTY_RUN_ENERGY_FACTOR = 0.65
/** 分段未填能耗时的默认电耗（kWh/km） */
const DEFAULT_SEGMENT_ENERGY = 1.6
/** 交通运输服务增值税率（运费收入销项，价税分离）（D1） */
const FREIGHT_VAT_RATE = 0.09
/** 增值税附加税费率（城建 7% + 教育附加 3% + 地方教育附加 2%） */
const VAT_SURCHARGE_RATE = 0.12
/** 司机税金：按小规模纳税人 1% 征收率简化（以销售额近似增值额口径的最小实现）（G2） */
const DRIVER_SMALL_TAXPAYER_RATE = 0.01

const round = (value: number, digits = 2) => {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 与 round 相同，但保留 NaN（用于 IRR/回收期/NPV 等「无定义」需显式暴露的指标）（D2） */
const roundOrNaN = (value: number, digits = 2) => (Number.isFinite(value) ? round(value, digits) : NaN)

const ratio = (value: number, total: number) => total ? value / total : 0
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** 除零守卫：分母非正或非有限时显式返回 0，不再用 Math.max(1,x) 静默替换合法小数值（D3/F 类） */
const safeDiv = (numerator: number, denominator: number) =>
  Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : 0

function enabledSegments(form: TruckChargingForm) {
  return form.route_segments.filter((seg) => seg.enabled)
}

function annuityPayment(principal: number, ratePercent: number, years: number) {
  if (principal <= 0 || years <= 0) return 0
  const rate = ratePercent / 100
  if (rate === 0) return principal / years
  return principal * rate * (1 + rate) ** years / ((1 + rate) ** years - 1)
}

function calculateIrr(cashFlows: number[], guess = 0.1) {
  if (!cashFlows || cashFlows.length < 2) return NaN
  // 现金流无正负交替时 IRR 无定义（全负=纯亏损、全正=无投入），显式返回 NaN，
  // 否则牛顿法会在无根多项式上发散出天文数字伪 IRR。
  const hasPositive = cashFlows.some((value) => value > 0)
  const hasNegative = cashFlows.some((value) => value < 0)
  if (!hasPositive || !hasNegative) return NaN

  const scale = Math.max(1, ...cashFlows.map((value) => Math.abs(value)))
  const npvAt = (rate: number) =>
    cashFlows.reduce((sum, value, t) => sum + value / (1 + rate) ** t, 0)

  // 先用牛顿法快速收敛
  let rate = guess
  for (let i = 0; i < 100; i += 1) {
    let npv = 0
    let derivative = 0
    for (let t = 0; t < cashFlows.length; t += 1) {
      npv += cashFlows[t] / (1 + rate) ** t
      derivative += -t * cashFlows[t] / (1 + rate) ** (t + 1)
    }
    if (Math.abs(npv) < 1e-8 * scale || Math.abs(derivative) < 1e-10) break
    rate -= npv / derivative
    if (rate < -1) rate = -0.99
  }
  // 不截断负值：负 IRR 反映亏损项目，Math.max(0, ...) 会把亏损显示为 0 掩盖真实收益。
  if (Number.isFinite(rate) && rate > -1 && Math.abs(npvAt(rate)) < 1e-6 * scale) return rate * 100

  // 牛顿法未收敛时兜底二分：区间 [-99%, 1000%]，NPV(rate) 在常规「先负后正」现金流上单调递减
  let lo = -0.99
  let hi = 10
  const npvLo = npvAt(lo)
  const npvHi = npvAt(hi)
  if (!Number.isFinite(npvLo) || !Number.isFinite(npvHi) || npvLo * npvHi > 0) return NaN
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2
    const npvMid = npvAt(mid)
    if (Math.abs(npvMid) < 1e-8 * scale) return mid * 100
    if (npvMid * npvLo > 0) lo = mid
    else hi = mid
  }
  return ((lo + hi) / 2) * 100
}

export function getDefaultTruckChargingForm(): TruckChargingForm {
  return {
    project_type: 'integrated',
    calc_mode: 'by_truck',
    operation_mode: 'owned',
    profit_mode: 'by_price',
    route_mode: 'simple',
    route_segments: DEFAULT_SEGMENTS.map((seg) => ({ ...seg })),
    truck_count: 50,
    truck_capacity: 30,
    charging_station_count: 2,
    operating_days: 330,
    annual_transport_volume: 100,
    avg_transport_distance: 300,
    daily_transport_volume: 3000,
    daily_mileage: 600,
    freight_rate: 0.45,
    target_irr: 12,
    load_factor: 100,
    return_load_factor: 0,
    forward_energy_consumption: 1.6,
    return_energy_consumption: 1.04,
    return_factor: 0.5,
    affiliated_truck_count: 0,
    affiliated_fee_per_truck: 3,
    management_fee_rate: 10,
    outsourced_truck_count: 0,
    outsourced_rate: 0.35,
    owned_truck_ratio: 70,
    service_fee: 0.25,
    electricity_price: 0.6,
    daily_charging: 3000,
    enable_charging_params: true,
    truck_price: 60,
    station_cost_per_kw: 700,
    station_investment: 200,
    land_cost: 100,
    other_construction: 50,
    driver_salary: 12,
    daily_highway_toll: 0,
    maintenance_cost: 3,
    insurance_cost: 2,
    station_om_cost: 10,
    labor_cost: 50,
    battery_replacement_year: 6,
    battery_replacement_cost: 25,
    demand_charge: 0,
    project_life: 10,
    depreciation_years: 10,
    salvage_rate: 5,
    loan_interest_rate: 4.5,
    loan_ratio: 70,
    loan_term: 5,
    tax_rate: 25,
    vat_rate: 13,
    discount_rate: 8
  }
}

export function calculateTotalDistance(form: TruckChargingForm) {
  if (form.route_mode !== 'multi_segment') return form.avg_transport_distance * 2
  return enabledSegments(form).reduce((sum, seg) => sum + (seg.distance || 0), 0)
}

export function calculateLoadFactor(form: TruckChargingForm) {
  if (form.route_mode !== 'multi_segment') return form.load_factor
  const segments = enabledSegments(form)
  const totalDistance = segments.reduce((sum, seg) => sum + (seg.distance || 0), 0)
  if (!segments.length || totalDistance <= 0) return form.load_factor

  let weightedLoadFactor = 0
  let currentVehicles = 0

  segments.forEach((segment, index) => {
    const segmentVolume = segment.dailyVolume || 0
    const segmentDistance = segment.distance || 0
    if (segmentDistance <= 0) return

    let segmentLoadFactor = 0
    if (segmentVolume > 0) {
      const segmentTripsNeeded = Math.ceil(safeDiv(segmentVolume, form.truck_capacity))
      currentVehicles = index === 0 ? segmentTripsNeeded : Math.max(currentVehicles, segmentTripsNeeded)
      segmentLoadFactor = safeDiv(segmentVolume, currentVehicles * form.truck_capacity) * 100
      currentVehicles = segmentTripsNeeded
    }

    weightedLoadFactor += segmentLoadFactor * (segmentDistance / totalDistance)
  })

  return clamp(weightedLoadFactor, 0, 100)
}

export function calculateTruckCount(form: TruckChargingForm) {
  if (form.project_type === 'charging') return 0
  if (form.calc_mode === 'by_truck') return Math.max(1, Math.ceil(form.truck_count))

  // C3 载重率口径：单车年运力 = 单程载量 × 日往返次数 × 运营天数 × (1 + 回程带货率)，
  // 回程带货率为独立参数（不再用 return_factor×0.5 的复合系数）。
  const returnLoadMultiplier = 1 + clamp(form.return_load_factor, 0, 100) / 100

  if (form.route_mode === 'multi_segment') {
    const segments = enabledSegments(form).filter((seg) => seg.dailyVolume > 0)
    if (!segments.length) return 1
    const totalDistance = segments.reduce((sum, seg) => sum + (seg.distance || 0), 0)
    if (totalDistance <= 0) return 1

    const totalDailyVolume = segments.reduce((sum, seg) => sum + (seg.dailyVolume || 0), 0)
    const annualTons = totalDailyVolume * form.operating_days
    const loadPerTrip = form.truck_capacity * (form.load_factor / 100)
    const firstSegment = form.route_segments.find((seg) => seg.enabled)
    const lastSegment = [...form.route_segments].reverse().find((seg) => seg.enabled)
    let roundTripDistance = totalDistance * 2

    if (
      firstSegment?.start &&
      lastSegment?.end &&
      firstSegment.start.trim() === lastSegment.end.trim()
    ) {
      roundTripDistance = totalDistance
    } else {
      const returnDistance = form.route_segments
        .filter((seg) => seg.enabled && seg.dailyVolume === 0 && seg.distance > 0)
        .reduce((sum, seg) => sum + (seg.distance || 0), 0)
      roundTripDistance = returnDistance > 0 ? totalDistance + returnDistance : totalDistance * 2
    }

    const tripsPerDay = safeDiv(form.daily_mileage, roundTripDistance)
    const truckAnnualCapacity = loadPerTrip * tripsPerDay * form.operating_days * returnLoadMultiplier
    const firstSegmentVehicles = Math.ceil(safeDiv(firstSegment?.dailyVolume || 0, form.truck_capacity))
    const trucksNeeded = safeDiv(annualTons, truckAnnualCapacity)
    // 业务下限：车队至少 1 辆（这是业务约束，不是除零守卫）
    return Math.max(1, firstSegmentVehicles, Math.ceil(trucksNeeded))
  }

  const annualTons = form.daily_transport_volume * form.operating_days
  const loadPerTrip = form.truck_capacity * (form.load_factor / 100)
  const tripsPerDay = safeDiv(form.daily_mileage, form.avg_transport_distance * 2)
  const truckAnnualCapacity = loadPerTrip * tripsPerDay * form.operating_days * returnLoadMultiplier
  return Math.max(1, Math.ceil(safeDiv(annualTons, truckAnnualCapacity)))
}

export function allocateTrucks(form: TruckChargingForm): TruckAllocation {
  if (form.project_type === 'charging') return { owned: 0, affiliated: 0, outsourced: 0 }
  const totalTrucks = calculateTruckCount(form)
  if (form.operation_mode === 'owned') return { owned: totalTrucks, affiliated: 0, outsourced: 0 }
  if (form.operation_mode === 'affiliated') return { owned: 0, affiliated: totalTrucks, outsourced: 0 }
  if (form.operation_mode === 'outsourced') return { owned: 0, affiliated: 0, outsourced: totalTrucks }

  const owned = Math.floor(totalTrucks * (form.owned_truck_ratio / 100))
  const affiliated = Math.floor((totalTrucks - owned) * 0.5)
  return { owned, affiliated, outsourced: totalTrucks - owned - affiliated }
}

export function calculateAverageFreightRate(form: TruckChargingForm) {
  if (form.route_mode !== 'multi_segment') return form.freight_rate
  const segments = enabledSegments(form)
  const totalDistance = segments.reduce((sum, seg) => sum + (seg.distance || 0), 0)
  if (!segments.length || totalDistance <= 0) return form.freight_rate

  const totalVolume = segments.reduce((sum, seg) => sum + (seg.dailyVolume || 0), 0)
  if (totalVolume > 0) {
    const totalRevenue = segments.reduce((sum, seg) => sum + (seg.rate || 0) * (seg.dailyVolume || 0), 0)
    return (totalRevenue / totalVolume) / totalDistance
  }

  return segments.reduce((sum, seg) => sum + (seg.rate || 0), 0) / totalDistance
}

export function calculateAverageEnergyConsumption(form: TruckChargingForm) {
  // C2 电耗单源：简单线路由去程/返程电耗按回程系数加权，不再由 energy_cost_per_km / 1.5 反推
  if (form.route_mode !== 'multi_segment') {
    return (
      form.forward_energy_consumption * (1 - form.return_factor) +
      form.return_energy_consumption * form.return_factor
    )
  }
  const segments = enabledSegments(form)
  const totalDistance = segments.reduce((sum, seg) => sum + (seg.distance || 0), 0)
  if (!segments.length || totalDistance <= 0) return DEFAULT_SEGMENT_ENERGY
  return segments.reduce((sum, seg) => sum + (seg.energyConsumption || DEFAULT_SEGMENT_ENERGY) * (seg.distance || 0), 0) / totalDistance
}

/** C2 电耗单源：自有车公里电费成本（元/km）= 综合电耗(kWh/km) × (充电电价 + 服务费)，替代独立的 energy_cost_per_km 表单项 */
export function calculateEnergyCostPerKm(form: TruckChargingForm) {
  return calculateAverageEnergyConsumption(form) * (form.electricity_price + form.service_fee)
}

export function calculateDailyHighwayToll(form: TruckChargingForm) {
  if (form.route_mode !== 'multi_segment') return form.daily_highway_toll
  const segments = enabledSegments(form)
  let totalHighwayToll = 0
  let currentVehicles = 0

  segments.forEach((segment, index) => {
    const highwayDistance = segment.highwayDistance || 0
    const highwayTollRate = segment.highwayTollRate || 0
    if (highwayDistance <= 0 || highwayTollRate <= 0) return

    const segmentVolume = segment.dailyVolume || 0
    if (segmentVolume > 0) {
      const segmentTripsNeeded = Math.ceil(safeDiv(segmentVolume, form.truck_capacity))
      currentVehicles = index === 0 ? segmentTripsNeeded : Math.max(currentVehicles, segmentTripsNeeded)
    }
    totalHighwayToll += highwayDistance * highwayTollRate * currentVehicles
  })

  return totalHighwayToll
}

export function calculateDailyTotalCharging(form: TruckChargingForm) {
  // 纯充电站：充电量为对外服务量，由表单输入（站数为 0 则显式为 0，不再 Math.max(1,..) 兜底）
  if (form.project_type === 'charging') return form.daily_charging * Math.max(0, form.charging_station_count)
  const totalTrucks = calculateTruckCount(form)
  if (totalTrucks <= 0) return 0

  if (form.route_mode !== 'multi_segment') {
    // 电耗单源：与 calculateAverageEnergyConsumption 同一加权口径（C2）。
    // 口径修复（审查问题1）：车队日充电量 = 综合电耗 × 实际日行驶总里程（daily_mileage，往返总里程）×车数，
    // 不再固定按 avg_transport_distance×2 一个往返推——只改 daily_mileage 时充电量/站功率/购电成本同步变化。
    return calculateAverageEnergyConsumption(form) * form.daily_mileage * totalTrucks
  }

  const segments = enabledSegments(form)
  let totalEnergyConsumption = 0
  let currentVehicles = 0

  segments.forEach((segment, index) => {
    const segmentVolume = segment.dailyVolume || 0
    const segmentDistance = segment.distance || 0
    const segmentEnergyConsumption = segment.energyConsumption || DEFAULT_SEGMENT_ENERGY
    if (segmentDistance <= 0) return

    if (segmentVolume === 0) {
      totalEnergyConsumption += segmentEnergyConsumption * EMPTY_RUN_ENERGY_FACTOR * segmentDistance * currentVehicles
    } else {
      const segmentTripsNeeded = Math.ceil(safeDiv(segmentVolume, form.truck_capacity))
      currentVehicles = index === 0 ? segmentTripsNeeded : Math.max(currentVehicles, segmentTripsNeeded)
      const loadedEnergy = segmentEnergyConsumption * segmentDistance * segmentTripsNeeded
      const emptyEnergy = segmentEnergyConsumption * EMPTY_RUN_ENERGY_FACTOR * segmentDistance * Math.max(0, currentVehicles - segmentTripsNeeded)
      totalEnergyConsumption += loadedEnergy + emptyEnergy
    }
  })

  return totalEnergyConsumption
}

export function calculateDailyChargingPerStation(form: TruckChargingForm) {
  if (form.project_type === 'charging') return form.daily_charging
  return safeDiv(calculateDailyTotalCharging(form), form.charging_station_count)
}

export function calculateTotalChargingPower(form: TruckChargingForm) {
  if (form.project_type === 'truck') return 0
  // C2 功率反推：总功率 = 日充电量 / (日有效充电小时 × 功率利用率)，
  // 由电耗单源派生，删除原「daily_mileage × 1.5 × 1.1」魔数（充电损耗折入电耗参数口径）。
  return safeDiv(calculateDailyTotalCharging(form), CHARGING_HOURS_PER_DAY * POWER_UTILIZATION)
}

export function calculateChargingGunCount(form: TruckChargingForm) {
  if (form.project_type === 'truck') return 0
  const actualTruckCount = form.calc_mode === 'by_volume' ? calculateTruckCount(form) : form.truck_count
  return Math.ceil(actualTruckCount / 3)
}

export function calculateStationInvestment(form: TruckChargingForm) {
  if (form.project_type === 'truck') return 0
  const powerPerStation = safeDiv(calculateTotalChargingPower(form), form.charging_station_count)
  return form.station_cost_per_kw * powerPerStation / 10000
}

export function calculateTotalStationInvestment(form: TruckChargingForm) {
  if (form.project_type === 'truck') return 0
  return calculateStationInvestment(form) * form.charging_station_count + form.land_cost + form.other_construction
}

export function calculateOutsourcedRate(form: TruckChargingForm) {
  if (form.project_type === 'charging' || form.operation_mode === 'owned' || form.operation_mode === 'affiliated') return 0
  if (form.route_mode !== 'multi_segment') return form.outsourced_rate
  const segments = enabledSegments(form)
  const totalDistance = segments.reduce((sum, seg) => sum + (seg.distance || 0), 0)
  if (!segments.length || totalDistance <= 0) return form.outsourced_rate

  const totalVolume = segments.reduce((sum, seg) => sum + (seg.dailyVolume || 0), 0)
  if (totalVolume > 0) {
    const totalOutsourcedCost = segments.reduce((sum, seg) => sum + (seg.outsourced_price || 0) * (seg.dailyVolume || 0), 0)
    return (totalOutsourcedCost / totalVolume) / totalDistance
  }

  return segments.reduce((sum, seg) => sum + (seg.outsourced_price || 0), 0) / totalDistance
}

// E1 目标 IRR 反算运价：对 freight_rate 做二分搜索，使主模型 calculateTruckChargingInvestment
// 的资本金 IRR 收敛到 target_irr（容差 1e-4 个百分点），与主模型口径天然一致；
// 原「解析反推公式」（单一年份利润倒推）已删除。不收敛返回 { freight_rate: NaN, converged: false }。
export function solveFreightRateByTargetIrr(form: TruckChargingForm): TruckChargingFreightSolveResult {
  // 纯充电站/多段线路下 freight_rate 不驱动收入，无解可言
  if (form.project_type === 'charging' || form.route_mode === 'multi_segment') {
    return { freight_rate: NaN, converged: false }
  }

  const target = form.target_irr
  const irrAt = (rate: number) => {
    // 强制 by_price 避免递归；IRR 无定义（如资本金为 0）视为 -∞（无法收敛）
    const next: TruckChargingForm = {
      ...form,
      route_segments: form.route_segments.map((seg) => ({ ...seg })),
      profit_mode: 'by_price',
      freight_rate: rate
    }
    const irr = calculateTruckChargingInvestment(next).equity_irr
    return Number.isFinite(irr) ? irr : -Infinity
  }

  // IRR 随运价单调递增：先自适应扩张上界，再二分
  if (irrAt(0) >= target) return { freight_rate: 0, converged: true }
  let hi = Math.max(form.freight_rate, 0.5)
  let expand = 0
  while (irrAt(hi) < target) {
    hi *= 2
    expand += 1
    if (expand > 40 || !Number.isFinite(hi)) return { freight_rate: NaN, converged: false }
  }

  let lo = 0
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2
    const irr = irrAt(mid)
    if (Math.abs(irr - target) < 1e-4) return { freight_rate: mid, converged: true }
    if (irr < target) lo = mid
    else hi = mid
    if (hi - lo < 1e-10) break
  }

  const finalRate = (lo + hi) / 2
  return Math.abs(irrAt(finalRate) - target) < 1e-3
    ? { freight_rate: finalRate, converged: true }
    : { freight_rate: NaN, converged: false }
}

/** 兼容旧接口：返回反算运价数值（未收敛为 NaN）；推荐使用 solveFreightRateByTargetIrr 获取收敛标记 */
export function calculateFreightRateByTargetIrr(form: TruckChargingForm) {
  if (form.project_type === 'charging' || form.profit_mode !== 'by_rate') return form.freight_rate
  if (form.route_mode === 'multi_segment') return calculateAverageFreightRate(form)
  return solveFreightRateByTargetIrr(form).freight_rate
}

function calculateTransportRevenueAndCost(form: TruckChargingForm, allocation: TruckAllocation, effectiveFreightRate: number) {
  const totalVehicles = allocation.owned + allocation.affiliated + allocation.outsourced
  const revenueBreakdown: TruckChargingBreakdownRow[] = []
  const costBreakdown: TruckChargingBreakdownRow[] = []
  let annualRevenue = 0
  let managementFeeIncome = 0
  let affiliatedFreightRevenue = 0
  let affiliatedDriverAvgIncome = 0

  if (form.project_type === 'charging' || totalVehicles <= 0) {
    return { annualRevenue, transportCost: 0, revenueBreakdown, costBreakdown, managementFeeIncome, affiliatedFreightRevenue, affiliatedDriverAvgIncome }
  }

  const addRevenue = (item: string, amount: number) => {
    if (amount > 0) {
      annualRevenue += amount
      revenueBreakdown.push({ item, amount, ratio: 0 })
    }
  }
  const addCost = (item: string, amount: number) => {
    if (amount > 0) costBreakdown.push({ item, amount, ratio: 0 })
  }

  if (form.route_mode === 'multi_segment') {
    let ownedDailyRevenue = 0
    let affiliatedDailyRevenue = 0
    let outsourcedDailyRevenue = 0
    let outsourcedDailyCost = 0

    enabledSegments(form).forEach((segment) => {
      if (segment.dailyVolume <= 0 || segment.rate <= 0) return
      const ownedVolume = segment.dailyVolume * ratio(allocation.owned, totalVehicles)
      const affiliatedVolume = segment.dailyVolume * ratio(allocation.affiliated, totalVehicles)
      const outsourcedVolume = segment.dailyVolume * ratio(allocation.outsourced, totalVehicles)

      ownedDailyRevenue += ownedVolume * segment.rate
      affiliatedDailyRevenue += affiliatedVolume * segment.rate
      outsourcedDailyRevenue += outsourcedVolume * segment.rate
      outsourcedDailyCost += outsourcedVolume * (segment.outsourced_price || 0)
    })

    addRevenue('自有车辆运输收入', ownedDailyRevenue * form.operating_days / 10000)
    affiliatedFreightRevenue = affiliatedDailyRevenue * form.operating_days / 10000
    managementFeeIncome = affiliatedFreightRevenue * (form.management_fee_rate / 100)

    if (allocation.affiliated > 0) {
      addRevenue('挂靠费收入', allocation.affiliated * form.affiliated_fee_per_truck)
      addRevenue('挂靠车辆运费收入（含管理费）', affiliatedFreightRevenue)
      affiliatedDriverAvgIncome = safeDiv(affiliatedFreightRevenue - managementFeeIncome, allocation.affiliated)
      addCost('挂靠车辆运费支出', affiliatedFreightRevenue - managementFeeIncome)
    }

    addRevenue('外委运输收入', outsourcedDailyRevenue * form.operating_days / 10000)
    addCost('外委运输成本', outsourcedDailyCost * form.operating_days / 10000)
  } else {
    // 口径修复（审查问题4）：by_volume 模式下年运量由 daily_transport_volume × operating_days 派生，
    // 与 calculateTruckCount 的车队规模推算同源（避免只改日运量时车队变、运量收入不变的自相矛盾）；
    // by_truck 模式沿用独立的 annual_transport_volume 字段（万吨）。
    const annualTransportVolume = form.calc_mode === 'by_volume'
      ? form.daily_transport_volume * form.operating_days
      : form.annual_transport_volume * 10000
    // 口径修复（审查问题3）：daily_mileage 为往返总里程，运费只在载货里程上产生——
    // 载货里程 = 去程(daily_mileage/2) + 回程(daily_mileage/2 × return_load_factor)，
    // 与 calculateTruckCount 的「daily_mileage/(avg_transport_distance×2)」往返口径一致；
    // 默认 return_load_factor=0（回程空驶）时只有一半里程产生运费收入。
    const loadedDailyMileage = (form.daily_mileage / 2) * (1 + clamp(form.return_load_factor, 0, 100) / 100)
    const dailyFreightPerTruck =
      loadedDailyMileage * form.truck_capacity * (form.load_factor / 100) * effectiveFreightRate
    const ownedAnnualRevenue = allocation.owned * dailyFreightPerTruck * form.operating_days / 10000
    addRevenue('自有车辆运输收入', ownedAnnualRevenue)

    const totalDailyVolume = safeDiv(annualTransportVolume, form.operating_days)
    const affiliatedDailyVolume = totalDailyVolume * ratio(allocation.affiliated, totalVehicles)
    affiliatedFreightRevenue =
      affiliatedDailyVolume * effectiveFreightRate * form.avg_transport_distance * form.operating_days / 10000
    managementFeeIncome = affiliatedFreightRevenue * (form.management_fee_rate / 100)

    if (allocation.affiliated > 0) {
      addRevenue('挂靠费收入', allocation.affiliated * form.affiliated_fee_per_truck)
      addRevenue('挂靠车辆运费收入（含管理费）', affiliatedFreightRevenue)
      affiliatedDriverAvgIncome = safeDiv(affiliatedFreightRevenue - managementFeeIncome, allocation.affiliated)
      addCost('挂靠车辆运费支出', affiliatedFreightRevenue - managementFeeIncome)
    }

    const outsourcedDailyVolume = totalDailyVolume * ratio(allocation.outsourced, totalVehicles)
    const outsourcedRevenue = outsourcedDailyVolume * effectiveFreightRate * form.avg_transport_distance * form.operating_days / 10000
    const outsourcedCost = outsourcedDailyVolume * form.outsourced_rate * form.avg_transport_distance * form.operating_days / 10000
    addRevenue('外委运输收入', outsourcedRevenue)
    addCost('外委运输成本', outsourcedCost)
  }

  const transportCost = costBreakdown.reduce((sum, row) => sum + row.amount, 0)
  revenueBreakdown.forEach((row) => { row.ratio = ratio(row.amount, annualRevenue) })
  costBreakdown.forEach((row) => { row.ratio = ratio(row.amount, transportCost) })

  return {
    annualRevenue,
    transportCost,
    revenueBreakdown,
    costBreakdown,
    managementFeeIncome,
    affiliatedFreightRevenue,
    affiliatedDriverAvgIncome
  }
}

function buildDriverAnalysis(
  form: TruckChargingForm,
  allocation: TruckAllocation,
  managementFeeIncome: number,
  affiliatedDriverAvgIncome: number,
  derived: TruckChargingDerivedMetrics,
  effectiveFreightRate: number
) {
  const vehicleCount = form.operation_mode === 'owned' ? allocation.owned : allocation.affiliated
  const driverCostBreakdown: TruckChargingBreakdownRow[] = []
  if (vehicleCount <= 0) {
    return { avgIncome: 0, avgCost: 0, breakdown: driverCostBreakdown, incomeBreakdown: [] as TruckChargingBreakdownRow[] }
  }

  const add = (item: string, amount: number, description?: string) => {
    driverCostBreakdown.push({ item, amount, ratio: 0, description })
  }

  if (form.operation_mode !== 'owned') {
    add('年挂靠费', form.affiliated_fee_per_truck)
    if (allocation.affiliated > 0 && managementFeeIncome > 0) {
      add('年管理费', managementFeeIncome / allocation.affiliated)
    }
  }

  const dailyCharging = form.daily_charging > 0 ? form.daily_charging : derived.daily_charging_per_station
  add('年充电服务费', safeDiv(dailyCharging * form.service_fee * form.operating_days / 10000, vehicleCount))
  add('年充电电价', safeDiv(dailyCharging * form.electricity_price * form.operating_days / 10000, vehicleCount))
  add('年高速过路费', form.route_mode === 'multi_segment'
    ? safeDiv(derived.daily_highway_toll * form.operating_days / 10000, vehicleCount)
    : derived.daily_highway_toll * form.operating_days / 10000)
  add('维修保养', form.maintenance_cost)
  add('保险费用', form.insurance_cost)

  const truckLoanAmount = form.truck_price * (form.loan_ratio / 100)
  const annualLoanInterestPerTruck = truckLoanAmount * (form.loan_interest_rate / 100)
  const annualLoanPaymentPerTruck = annuityPayment(truckLoanAmount, form.loan_interest_rate, form.loan_term)
  add('年车辆贷款利息', annualLoanInterestPerTruck, '首年利息口径（后续逐年递减）')
  add('年车辆贷款本金', Math.max(0, annualLoanPaymentPerTruck - annualLoanInterestPerTruck))
  add('年工资', form.driver_salary)

  // 口径修复（审查问题3）：司机运费收入与主模型同口径——只按载货里程（去程 + 回程×带货率）计
  const loadedDailyMileage = (form.daily_mileage / 2) * (1 + clamp(form.return_load_factor, 0, 100) / 100)
  const avgIncome = form.operation_mode === 'owned'
    ? safeDiv(allocation.owned * loadedDailyMileage * form.truck_capacity * (form.load_factor / 100) * effectiveFreightRate * form.operating_days / 10000, vehicleCount)
    : affiliatedDriverAvgIncome
  // G2 司机税金：个体司机按小规模纳税人 1% 征收率简化（以运费销售额近似增值额口径），
  // 附加税按 12%；原「vat_rate(13%) × 1.12」把一般纳税人税率套在个体司机头上，严重高估。
  add('税金', avgIncome * DRIVER_SMALL_TAXPAYER_RATE * (1 + VAT_SURCHARGE_RATE))

  const avgCost = driverCostBreakdown.reduce((sum, row) => sum + row.amount, 0)
  driverCostBreakdown.forEach((row) => { row.ratio = ratio(row.amount, avgCost) })

  return {
    avgIncome,
    avgCost,
    breakdown: driverCostBreakdown,
    incomeBreakdown: [
      { item: form.operation_mode === 'owned' ? '司机个人平均收入' : '挂靠司机总收入', amount: avgIncome * vehicleCount, ratio: 0 },
      { item: form.operation_mode === 'owned' ? '司机成本' : '挂靠司机总成本', amount: avgCost * vehicleCount, ratio: 0 },
      { item: form.operation_mode === 'owned' ? '司机净收益' : '挂靠司机总利润', amount: (avgIncome - avgCost) * vehicleCount, ratio: 0 }
    ]
  }
}

export function getTruckChargingDerivedMetrics(form: TruckChargingForm): TruckChargingDerivedMetrics {
  return {
    total_distance: round(calculateTotalDistance(form), 2),
    daily_mileage: round(form.route_mode === 'multi_segment' ? calculateTotalDistance(form) : form.daily_mileage, 2),
    avg_freight_rate: round(calculateAverageFreightRate(form), 4),
    avg_energy_consumption: round(calculateAverageEnergyConsumption(form), 3),
    energy_cost_per_km: round(calculateEnergyCostPerKm(form), 3),
    load_factor: round(calculateLoadFactor(form), 2),
    daily_highway_toll: round(calculateDailyHighwayToll(form), 2),
    daily_charging_per_station: round(calculateDailyChargingPerStation(form), 2),
    daily_total_charging: round(calculateDailyTotalCharging(form), 2),
    total_charging_power: round(calculateTotalChargingPower(form), 2),
    charging_gun_count: calculateChargingGunCount(form),
    station_investment: round(calculateStationInvestment(form), 2),
    total_station_investment: round(calculateTotalStationInvestment(form), 2),
    outsourced_rate: round(calculateOutsourcedRate(form), 4)
  }
}

/** 逐年贷款还本付息计划（等额本息）：利息=期初余额×利率（逐年递减），本金=年金−利息，贷款期满本息归零（A1） */
function buildLoanSchedule(loanAmount: number, ratePercent: number, termYears: number, projectLife: number) {
  const schedule: Array<{ interest: number; principal: number }> = []
  const rate = ratePercent / 100
  const payment = annuityPayment(loanAmount, ratePercent, termYears)
  let balance = loanAmount
  for (let year = 1; year <= projectLife; year += 1) {
    if (year > termYears || balance <= 1e-9) {
      schedule.push({ interest: 0, principal: 0 })
      continue
    }
    const interest = balance * rate
    // 贷款末年清偿余额（消化浮点尾差），保证本金合计 = 贷款额；
    // 口径修复（审查问题2）：贷款期超过项目期（termYears > projectLife）时，
    // 剩余未偿本金在项目期末年一次性清偿计入现金流——债务不得在测算期外凭空消失（否则虚增 NPV/IRR）。
    const principal = year === termYears || year === projectLife ? balance : Math.min(payment - interest, balance)
    balance -= principal
    schedule.push({ interest, principal })
  }
  return schedule
}

export function calculateTruckChargingInvestment(form: TruckChargingForm): TruckChargingResult {
  const warnings: string[] = []
  const allocation = allocateTrucks(form)
  const totalTrucks = allocation.owned + allocation.affiliated + allocation.outsourced
  const derived = getTruckChargingDerivedMetrics(form)

  // E1：目标 IRR 反算运价（二分搜索）；不收敛时回退表单运价并显式提示，不产出伪数值
  let freightRateConverged: boolean | undefined
  let effectiveFreightRate: number
  if (form.route_mode === 'multi_segment') {
    effectiveFreightRate = calculateAverageFreightRate(form)
  } else if (form.profit_mode === 'by_rate' && form.operation_mode === 'owned' && form.project_type !== 'charging') {
    const solved = solveFreightRateByTargetIrr(form)
    freightRateConverged = solved.converged
    effectiveFreightRate = solved.converged ? solved.freight_rate : form.freight_rate
    if (!solved.converged) warnings.push('目标 IRR 反算运价未收敛，已回退为表单运价')
  } else {
    effectiveFreightRate = form.freight_rate
  }

  let totalInvestment = 0
  if (form.project_type !== 'charging') totalInvestment += allocation.owned * form.truck_price
  if (form.project_type !== 'truck') {
    totalInvestment += calculateStationInvestment(form) * form.charging_station_count + form.land_cost
  }
  totalInvestment += form.other_construction

  const transport = calculateTransportRevenueAndCost(form, allocation, effectiveFreightRate)
  let annualRevenue = transport.annualRevenue
  const revenueBreakdown = [...transport.revenueBreakdown]
  const costBreakdown = [...transport.costBreakdown]

  const addRevenue = (item: string, amount: number) => {
    if (amount > 0) {
      annualRevenue += amount
      revenueBreakdown.push({ item, amount, ratio: 0 })
    }
  }
  const addCost = (item: string, amount: number) => {
    if (amount > 0) costBreakdown.push({ item, amount, ratio: 0 })
  }

  // —— 充电站侧收入/成本门控（A2/A3/E3）——
  // 对外比例：纯充电站全部对外；一体化下自有车充电属内部交易（合并口径收入侧不计，
  // 成本侧只计一次购电成本），挂靠/外委/混合按非自有车比例计对外收入。
  const externalRatio = form.project_type === 'charging' ? 1 : safeDiv(allocation.affiliated + allocation.outsourced, totalTrucks)
  let chargingServiceRevenue = 0
  let electricityRevenue = 0
  let electricityPurchaseCost = 0
  if (form.project_type !== 'truck') {
    // 一体化项目充电量由车队电耗单源派生（C2）；纯站由表单输入
    const usedDailyChargingPerStation = form.project_type === 'charging' ? form.daily_charging : derived.daily_charging_per_station
    const annualChargingKwh = form.charging_station_count * usedDailyChargingPerStation * form.operating_days
    chargingServiceRevenue = annualChargingKwh * form.service_fee / 10000 * externalRatio
    // A3：电费收入不再受 operation_mode 门控 —— 对外充电电费平进平出（挂靠/外委/混合按比例，纯站全额）
    electricityRevenue = annualChargingKwh * form.electricity_price / 10000 * externalRatio
    electricityPurchaseCost = annualChargingKwh * form.electricity_price / 10000
    addRevenue('充电服务收入', chargingServiceRevenue)
    addRevenue('电费收入（平进平出）', electricityRevenue)

    addCost('充电站运维', form.charging_station_count * form.station_om_cost)
    addCost('人工成本', form.labor_cost)
    addCost('购电成本', electricityPurchaseCost)
    // C1 两部制基本电费：按充电站总功率 × 元/kW·月 × 12 计入年固定成本（demand_charge=0 不启用）
    if (form.demand_charge > 0) {
      addCost('基本电费（两部制）', calculateTotalChargingPower(form) * form.demand_charge * 12 / 10000)
    }
  }

  // 纯重卡项目：自有车在外部充电，公里电费成本由电耗单源派生（C2）；
  // 一体化项目该成本已含在充电站「购电成本」中（内部交易合并，避免重复计）。
  if (form.project_type === 'truck' && allocation.owned > 0) {
    addCost('自有车辆能耗成本', allocation.owned * form.daily_mileage * form.operating_days * calculateEnergyCostPerKm(form) / 10000)
  }

  if (allocation.owned > 0) {
    addCost('自有车辆司机工资', allocation.owned * form.driver_salary)
    const highwayCost = form.route_mode === 'multi_segment'
      ? derived.daily_highway_toll * form.operating_days / 10000
      : allocation.owned * form.daily_highway_toll * form.operating_days / 10000
    addCost('自有车辆高速过路费', highwayCost)
    addCost('自有车辆维修保养', allocation.owned * form.maintenance_cost)
    addCost('自有车辆保险费用', allocation.owned * form.insurance_cost)
  }

  // 此处 costBreakdown 仅含付现经营成本（含挂靠/外委支出），利息/本金/税金在逐年表内单列
  const operatingCost = costBreakdown.reduce((sum, row) => sum + row.amount, 0)

  // —— 增值税及附加最小接线（D1）——
  // 价税分离：运费类收入按 9% 销项、充电服务费/电费按 vat_rate（默认 13%）销项，
  // 购电成本按 vat_rate 进项抵扣；应纳增值税 = 销项 − 进项（为负不建模留抵结转，取 0）；
  // 附加税 = 增值税 × 12% 计入付现成本。vat_rate=0 视为不启用增值税链条。
  // 简化：挂靠费/管理费收入并入运费口径按 9% 计。
  const vatEnabled = form.vat_rate > 0
  const vr = form.vat_rate / 100
  const outputVat = vatEnabled
    ? transport.annualRevenue * FREIGHT_VAT_RATE / (1 + FREIGHT_VAT_RATE) +
      (chargingServiceRevenue + electricityRevenue) * vr / (1 + vr)
    : 0
  const inputVat = vatEnabled ? electricityPurchaseCost * vr / (1 + vr) : 0
  const vatPayable = Math.max(0, outputVat - inputVat)
  const vatSurcharge = vatPayable * VAT_SURCHARGE_RATE

  // —— 投资、融资与折旧口径 ——
  const loanAmount = totalInvestment * (form.loan_ratio / 100)
  const equity = totalInvestment - loanAmount
  const projectLife = Math.max(1, Math.round(form.project_life))
  const loanTermYears = Math.round(form.loan_term)
  const loanSchedule = buildLoanSchedule(loanAmount, form.loan_interest_rate, loanTermYears, projectLife)
  // 口径修复（审查问题2）：贷款期超过项目期时剩余本金在期末现金流一次性清偿（见 buildLoanSchedule），并显式提示
  if (loanAmount > 0 && loanTermYears > projectLife) {
    warnings.push(`贷款期（${loanTermYears} 年）超过项目期（${projectLife} 年）：剩余未偿本金已在期末现金流一次性清偿`)
  }

  // A4 土地不折旧：折旧基数 = 总投资 − 土地费用；折旧仅在折旧年限内计提（A5）
  const depreciationBase = Math.max(0, totalInvestment - (form.project_type !== 'truck' ? form.land_cost : 0))
  const annualDepreciation = safeDiv(depreciationBase * (1 - form.salvage_rate / 100), form.depreciation_years)
  // 期末残值 = 设备残值 + 土地原值回收（简化口径：土地按原值一次性收回）（A4/A7）
  const terminalSalvage = depreciationBase * (form.salvage_rate / 100) + (form.project_type !== 'truck' ? form.land_cost : 0)

  // G1 电池更换：对应年份计资本性支出（简化：资本化后不追加折旧，仅体现现金流出）
  const batteryYear = Math.round(form.battery_replacement_year)
  const batteryCapexTotal = allocation.owned * form.battery_replacement_cost

  // —— 逐年现金流表（A1/A5/G3 核心）：IRR/NPV/回收期/明细全部从这张表推出 ——
  // 各年收入与经营成本按首年水平平推（未建模增长率），逐年差异来自利息递减、本金偿还、
  // 折旧期限、所得税与电池更换资本性支出。
  const years: Array<{
    year: number
    revenue: number
    operatingCost: number
    interest: number
    principal: number
    depreciation: number
    vatAndSurcharge: number
    incomeTax: number
    batteryCapex: number
    salvage: number
    equityCashFlow: number
  }> = []
  for (let year = 1; year <= projectLife; year += 1) {
    const { interest, principal } = loanSchedule[year - 1]
    const depreciation = year <= form.depreciation_years ? annualDepreciation : 0
    const batteryCapex = year === batteryYear && batteryYear > 0 && batteryCapexTotal > 0 ? batteryCapexTotal : 0
    const salvage = year === projectLife ? terminalSalvage : 0
    // 所得税逐年计算：应税所得 = 收入（剔除应纳增值税及附加近似还原不含税口径）− 经营成本 − 折旧 − 利息；
    // 亏损年所得税为 0，亏损结转抵扣未建模（保守简化，注释标明）。
    const taxable = annualRevenue - vatPayable - vatSurcharge - operatingCost - depreciation - interest
    const incomeTax = taxable > 0 ? taxable * (form.tax_rate / 100) : 0
    const equityCashFlow =
      annualRevenue - operatingCost - vatPayable - vatSurcharge - interest - principal - incomeTax - batteryCapex + salvage
    years.push({
      year,
      revenue: annualRevenue,
      operatingCost,
      interest,
      principal,
      depreciation,
      vatAndSurcharge: vatPayable + vatSurcharge,
      incomeTax,
      batteryCapex,
      salvage,
      equityCashFlow
    })
  }

  // —— 指标：全部由逐年表推出 ——
  let equityIrr: number
  let npv: number
  let paybackPeriod: number
  if (equity <= 0) {
    // D2：贷款比例 ≥100% 时资本金为 0，IRR/NPV/回收期无定义，显式提示而非伪数值
    warnings.push('贷款比例达到 100%：资本金为 0，资本金 IRR/NPV/回收期无定义')
    equityIrr = NaN
    npv = NaN
    paybackPeriod = NaN
  } else {
    const cashFlows = [-equity, ...years.map((row) => row.equityCashFlow)]
    equityIrr = calculateIrr(cashFlows)

    // D3：折现率 0% 是合法输入（Number.isFinite 判空，而非 ||0.08 兜底）
    const discountRate = Number.isFinite(form.discount_rate) ? form.discount_rate / 100 : 0.08
    npv = -equity
    years.forEach((row) => { npv += row.equityCashFlow / (1 + discountRate) ** row.year })

    paybackPeriod = NaN
    let cumulative = -equity
    for (const row of years) {
      const previous = cumulative
      cumulative += row.equityCashFlow
      if (cumulative >= 0 && row.equityCashFlow > 0) {
        paybackPeriod = (row.year - 1) + (-previous / row.equityCashFlow)
        break
      }
    }
    if (!Number.isFinite(paybackPeriod)) warnings.push('项目期内资本金未回收，回收期无定义')
  }

  // —— 现金流明细表：覆盖全项目期（0..project_life），期末年含残值列（A7）——
  const cashFlow: TruckChargingCashFlowRow[] = []
  let cumulativeCashFlowTable = -equity
  cashFlow.push({
    year: 0, revenue: 0, cost: 0, interest: 0, principal: 0, depreciation: 0, tax: 0, salvage: 0,
    net_cash_flow: round(-equity), cumulative_cash_flow: round(-equity)
  })
  years.forEach((row) => {
    cumulativeCashFlowTable += row.equityCashFlow
    cashFlow.push({
      year: row.year,
      revenue: round(row.revenue),
      cost: round(row.operatingCost + row.batteryCapex),
      interest: round(row.interest),
      principal: round(row.principal),
      depreciation: round(row.depreciation),
      tax: round(row.vatAndSurcharge + row.incomeTax),
      salvage: round(row.salvage),
      net_cash_flow: round(row.equityCashFlow),
      cumulative_cash_flow: round(cumulativeCashFlowTable)
    })
  })

  // —— 首年口径的成本/利润快照（供指标卡与构成表展示）——
  const firstYear = years[0]
  if (firstYear.interest > 0) costBreakdown.push({ item: '贷款利息（首年）', amount: firstYear.interest, ratio: 0 })
  if (firstYear.principal > 0) costBreakdown.push({ item: '贷款本金（首年）', amount: firstYear.principal, ratio: 0 })
  if (firstYear.vatAndSurcharge > 0) costBreakdown.push({ item: '增值税及附加', amount: firstYear.vatAndSurcharge, ratio: 0 })
  if (firstYear.incomeTax > 0) costBreakdown.push({ item: '所得税（首年）', amount: firstYear.incomeTax, ratio: 0 })
  const annualCost = operatingCost + firstYear.interest + firstYear.vatAndSurcharge
  const netProfit = annualRevenue - annualCost - firstYear.depreciation - firstYear.incomeTax

  revenueBreakdown.forEach((row) => { row.ratio = ratio(row.amount, annualRevenue) })
  const fullCostTotal = costBreakdown.reduce((sum, row) => sum + row.amount, 0)
  costBreakdown.forEach((row) => { row.ratio = ratio(row.amount, fullCostTotal) })

  const driver = buildDriverAnalysis(form, allocation, transport.managementFeeIncome, transport.affiliatedDriverAvgIncome, derived, effectiveFreightRate)
  const affiliatedTotalIncome = allocation.affiliated * form.affiliated_fee_per_truck + transport.managementFeeIncome
  const affiliatedTotalRevenue = allocation.affiliated > 0 ? driver.avgIncome * allocation.affiliated : 0
  const affiliatedTotalCost = allocation.affiliated > 0 ? driver.avgCost * allocation.affiliated : 0

  return {
    success: true,
    actual_truck_count: totalTrucks,
    owned_truck_count: allocation.owned,
    affiliated_truck_count: allocation.affiliated,
    outsourced_truck_count: allocation.outsourced,
    calculated_freight_rate: round(form.route_mode === 'multi_segment' ? calculateAverageFreightRate(form) : effectiveFreightRate, 4),
    total_investment: round(totalInvestment),
    annual_revenue: round(annualRevenue),
    annual_cost: round(annualCost),
    annual_profit: round(netProfit),
    // IRR 保留 4 位小数：目标 IRR 反算需与 target_irr 在 1e-3 容差内可校验（E1）
    equity_irr: roundOrNaN(equityIrr, 4),
    payback_period: roundOrNaN(paybackPeriod),
    npv: roundOrNaN(npv),
    ...(freightRateConverged !== undefined ? { freight_rate_converged: freightRateConverged } : {}),
    warnings,
    revenue_breakdown: revenueBreakdown.map((row) => ({ ...row, amount: round(row.amount), ratio: round(row.ratio, 4) })),
    cost_breakdown: costBreakdown.map((row) => ({ ...row, amount: round(row.amount), ratio: round(row.ratio, 4) })),
    cash_flow: cashFlow,
    affiliated_fee_income: round(allocation.affiliated * form.affiliated_fee_per_truck),
    management_fee_income: round(transport.managementFeeIncome),
    affiliated_total_income: round(affiliatedTotalIncome),
    affiliated_income_breakdown: driver.incomeBreakdown.map((row) => ({ ...row, amount: round(row.amount), ratio: round(row.ratio, 4) })),
    affiliated_driver_avg_income: round(driver.avgIncome),
    affiliated_driver_cost: round(driver.avgCost),
    affiliated_driver_net_income: round(driver.avgIncome - driver.avgCost),
    affiliated_driver_cost_breakdown: driver.breakdown.map((row) => ({ ...row, amount: round(row.amount), ratio: round(row.ratio, 4) })),
    affiliated_total_revenue: round(affiliatedTotalRevenue),
    affiliated_total_cost: round(affiliatedTotalCost),
    affiliated_total_profit: round(affiliatedTotalRevenue - affiliatedTotalCost),
    derived
  }
}

export function runTruckChargingSensitivityAnalysis(form: TruckChargingForm): TruckChargingSensitivityResult {
  const base = calculateTruckChargingInvestment(form)
  const changes = [-20, -10, 0, 10, 20]

  // F4：只列对当前模式生效的参数，不再固定展示全部因子
  const allocation = allocateTrucks(form)
  const totalTrucks = allocation.owned + allocation.affiliated + allocation.outsourced
  const hasStation = form.project_type !== 'truck'
  const hasOwnedTrucks = allocation.owned > 0
  const externalRatio = form.project_type === 'charging' ? 1 : safeDiv(allocation.affiliated + allocation.outsourced, totalTrucks)
  const factors: Array<[keyof TruckChargingForm, string]> = []
  // 运价：纯站不适用；多段线路运价来自分段表，整体缩放 freight_rate 无效
  if (form.project_type !== 'charging' && form.route_mode !== 'multi_segment') factors.push(['freight_rate', '运输运价'])
  // 购电价格：有站（购电成本）或纯重卡自有车（派生能耗成本）时生效
  if (hasStation || hasOwnedTrucks) factors.push(['electricity_price', '购电价格'])
  // 服务费：对外充电收入（externalRatio>0）或纯重卡自有车能耗成本时生效；一体化+全自有为纯内部交易，不列
  if ((hasStation && externalRatio > 0) || (!hasStation && hasOwnedTrucks)) factors.push(['service_fee', '充电服务费'])
  if (form.project_type !== 'charging' && hasOwnedTrucks) factors.push(['truck_price', '车辆单价'])
  if (hasStation) factors.push(['station_cost_per_kw', '充电站造价'])
  factors.push(['operating_days', '运营天数'])

  const sensitivity_results: TruckChargingSensitivityResult['sensitivity_results'] = {}
  factors.forEach(([key, label]) => {
    const baseValue = Number(form[key]) || 0
    const values = changes.map((change) => {
      const next = {
        ...form,
        route_segments: form.route_segments.map((seg) => ({ ...seg })),
        [key]: baseValue * (1 + change / 100)
      } as TruckChargingForm
      return calculateTruckChargingInvestment(next).npv
    })
    sensitivity_results[label] = {
      changes,
      values,
      base_value: base.npv,
      // 归一化分母为 |基准 NPV|（为 0 时显式返回 0，不再用 Math.max(1,..) 静默兜底）
      sensitivity: round(safeDiv(Math.max(...values) - Math.min(...values), Math.abs(base.npv)), 4)
    }
  })

  return {
    base_npv: base.npv,
    base_irr: base.equity_irr,
    target_param: 'NPV',
    sensitivity_results
  }
}
