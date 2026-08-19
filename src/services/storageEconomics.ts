// 储能套利经济学与火电边际成本（批次D，经济学增强）。
//
// 用经济学口径替代实验室此前的"自由研究参数"：① 套利触发阈值应由储能度电循环成本 + 往返
// 效率损耗推导（盈亏平衡价差），而非凭空给默认值；② 火电主导省（如山西）报价合理性应对标
// 机组边际成本（煤价 → 度电煤耗成本 + 变动运维）。
//
// 纯函数、无运行时依赖：可被 verify 脚本裸 strip-types 直跑；视图直接 import 使用。

function round(value: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

// 储能套利盈亏平衡

export type StorageCostParams = {
  /** 充电效率 %（如 95） */
  chargeEfficiencyPct: number
  /** 放电效率 %（如 95） */
  dischargeEfficiencyPct: number
  /** 度电循环成本 元/MWh-吞吐：电池衰减摊销 + 变动运维（按放电量计） */
  cycleCostYuanPerMwh: number
}

export type StorageBreakeven = {
  /** 往返效率 = η_charge × η_discharge */
  roundTripEfficiency: number
  /** 往返效率损耗成本 元/MWh：以参考价计，为放出 1MWh 多充入的电量损耗 */
  efficiencyLossYuanPerMwh: number
  cycleCostYuanPerMwh: number
  /** 盈亏平衡净价差 元/MWh：套利的"放电价−充电价"需 ≥ 此值才盈利 */
  breakevenSpreadYuanPerMwh: number
}

/**
 * 储能套利盈亏平衡价差（纯函数）。
 * 为放出 1MWh 需充入 1/η_rt MWh，往返损耗 (1/η_rt − 1) MWh，以参考价计为效率损耗成本；
 * 叠加度电循环成本即盈亏平衡价差，低于它的"价差套利"实际亏损。
 */
export function storageBreakeven(params: StorageCostParams, referencePriceYuanPerMwh: number): StorageBreakeven {
  const rte = Math.max((params.chargeEfficiencyPct / 100) * (params.dischargeEfficiencyPct / 100), 0.01)
  const ref = Math.max(referencePriceYuanPerMwh, 0)
  const efficiencyLoss = ref * (1 / rte - 1)
  const cycle = Math.max(params.cycleCostYuanPerMwh, 0)
  return {
    roundTripEfficiency: round(rte, 4),
    efficiencyLossYuanPerMwh: round(efficiencyLoss),
    cycleCostYuanPerMwh: round(cycle),
    breakevenSpreadYuanPerMwh: round(efficiencyLoss + cycle)
  }
}

// 火电边际成本与报价偏离

export type ThermalCostParams = {
  /** 标煤到厂价 元/吨 */
  coalPriceYuanPerTon: number
  /** 供电煤耗 克标煤/kWh（典型煤电 ~300） */
  heatRateGcePerKwh: number
  /** 变动运维成本 元/MWh（不含燃料） */
  varOmYuanPerMwh: number
}

export type ThermalMarginalCost = {
  /** 燃料（煤耗）成本 元/MWh */
  fuelCostYuanPerMwh: number
  /** 边际成本 元/MWh = 燃料 + 变动运维 */
  marginalCostYuanPerMwh: number
}

/**
 * 火电机组边际成本（纯函数）。
 * 单位换算：供电煤耗 g/kWh 数值上等于 kg/MWh（×1000kWh/MWh ÷1000g/kg）；
 * 燃料成本 = (煤耗 kg/MWh) × (煤价 元/吨 ÷ 1000 元/kg)。
 */
export function thermalMarginalCost(params: ThermalCostParams): ThermalMarginalCost {
  const coalKgPerMwh = Math.max(params.heatRateGcePerKwh, 0) // g/kWh == kg/MWh（数值）
  const fuelCost = coalKgPerMwh * (Math.max(params.coalPriceYuanPerTon, 0) / 1000)
  return {
    fuelCostYuanPerMwh: round(fuelCost),
    marginalCostYuanPerMwh: round(fuelCost + Math.max(params.varOmYuanPerMwh, 0))
  }
}

export type BidDeviation = {
  /** 出清价 − 边际成本 元/MWh（正=高于边际成本有毛利空间，负=低于成本倒挂） */
  marginYuanPerMwh: number
  /** 毛利率 = margin / 边际成本 */
  marginPct: number
  /** 报价合理性提示 */
  signal: '高于边际成本' | '接近边际成本' | '低于边际成本(倒挂)'
}

/** 出清价 vs 边际成本的报价偏离评估（纯函数）。 */
export function bidDeviationHint(clearingPriceYuanPerMwh: number, marginalCostYuanPerMwh: number): BidDeviation {
  const margin = clearingPriceYuanPerMwh - marginalCostYuanPerMwh
  const marginPct = marginalCostYuanPerMwh > 0 ? margin / marginalCostYuanPerMwh : 0
  const signal: BidDeviation['signal'] =
    margin < 0 ? '低于边际成本(倒挂)' : marginPct < 0.08 ? '接近边际成本' : '高于边际成本'
  return { marginYuanPerMwh: round(margin), marginPct: round(marginPct, 4), signal }
}
