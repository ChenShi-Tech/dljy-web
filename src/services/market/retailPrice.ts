/**
 * 工商业到户电价 / 售电套餐 / 国网代购电测算。
 *
 * 政策口径：
 * - 上网环节线损费用 = 电能量价格 × η/(1−η)，基数为购电电能量价格，
 *   不含售电利润与服务费（发改价格〔2023〕526号）。
 * - 两部制需量电价九折判据：月均用电量/变压器容量 ≥ 260 kWh/kVA（发改价格〔2023〕526号）。
 *
 * 未建模项与适用边界（使用前须知）：
 * 1. 省级输配电价配置表未建模——td_price/capacity_price/demand_price 仅内置示例档位，
 *    实际测算需按目标省份最新输配电价表覆盖输入；
 * 2. 偏差考核（偏差电量结算/考核费用）未建模——结果不含偏差考核成本，
 *    对偏差率较大的用户会低估综合到户成本。
 */
export type PricingType = 'single' | 'two-part'
export type VoltageLevel = 'below_1kv' | '1_10kv' | '35kv' | '110kv' | '220kv_plus'
export type CapacityChargeType = 'capacity' | 'demand'
export type TouType = 'standard' | 'sharp_deep'
export type RatioMode = 'ratio' | 'amount'
export type SalesPackageType = 'fixed' | 'ratio_share' | 'price_down' | 'price_down_ratio'

export type CommercialPriceForm = {
  province: string
  user_type: 'small' | 'medium' | 'large'
  pricing_type: PricingType
  voltage_level: VoltageLevel
  usage_type: 'general' | 'electric_heating'
  grid_price: number
  loss_rate: number
  td_price: number
  system_fee: number
  government_fee: number
  transformer_capacity: number
  max_demand: number
  capacity_charge_type: CapacityChargeType
  capacity_price: number
  demand_price: number
  electricity_amount: number
  enable_tou: boolean
  tou_type: TouType
  selected_month: number
  ratio_mode: RatioMode
  peak_price: number
  flat_price: number
  valley_price: number
  sharp_peak_price: number
  deep_valley_price: number
  sharp_peak_ratio: number
  peak_ratio: number
  flat_ratio: number
  valley_ratio: number
  deep_valley_ratio: number
  sharp_peak_amount: number
  peak_amount: number
  flat_amount: number
  valley_amount: number
  deep_valley_amount: number
  enable_sales_analysis: boolean
  sales_package_type: SalesPackageType
  service_fee: number
  reference_price: number
  price_down_amount: number
  company_share_ratio: number
  sharp_peak_sale_ratio: number
  peak_sale_ratio: number
  flat_sale_ratio: number
  valley_sale_ratio: number
  deep_valley_sale_ratio: number
  known_weighted_price: boolean
  weighted_avg_price: number
}

export type TimeSlotRatios = {
  sharp_peak_ratio: number
  peak_ratio: number
  flat_ratio: number
  valley_ratio: number
  deep_valley_ratio: number
}

export type PeriodCharge = {
  period: string
  unit_price: number
  amount: number
  fee: number
}

export type PriceBreakdownItem = {
  item: string
  unit_price: number
  amount: number
  ratio: number
  /**
   * 备注行（L466 修复）：金额仅供参考、不进入占比分母，占比恒为 0。
   * 售电公司利润已含在各时段零售电价中，若再计占比会双计，导致合计超 100%。
   */
  note?: boolean
}

export type CommercialPriceResult = {
  unit_price: number
  total_fee: number
  energy_fee: number
  basic_fee: number
  grid_loss_fee: number
  td_fee: number
  system_fee_amount: number
  government_fee_amount: number
  sales_profit: number
  purchase_cost: number
  sales_revenue: number
  capacity_charge_type?: CapacityChargeType
  demand_discount: boolean
  breakdown: PriceBreakdownItem[]
  periods: PeriodCharge[]
}

export type StateGridForm = {
  province: string
  voltage_level: VoltageLevel
  agency_price: number
  td_price: number
  system_fee: number
  government_fee: number
  electricity_amount: number
  /** 上网环节线损率 η（%），默认参考值 1.6；线损费用 = 代理购电价 × η/(1−η)（发改价格〔2023〕526号） */
  loss_rate: number
}

export type StateGridResult = {
  unit_price: number
  total_fee: number
  breakdown: PriceBreakdownItem[]
}

const voltageTdPrices = {
  single: {
    below_1kv: { td_price: 0.1636 },
    '1_10kv': { td_price: 0.1606 },
    '35kv': { td_price: 0.1566 }
  },
  two_part: {
    '1_10kv': { td_price: 0.1204, capacity_price: 20.03, demand_price: 32 },
    '35kv': { td_price: 0.11, capacity_price: 20.03, demand_price: 32 },
    '110kv': { td_price: 0.0815, capacity_price: 19, demand_price: 30.4 },
    '220kv_plus': { td_price: 0.0486, capacity_price: 19, demand_price: 30.4 }
  }
} as const

export const voltageOptions: Array<{ label: string; value: VoltageLevel; pricing: PricingType[] }> = [
  { label: '不满1kV', value: 'below_1kv', pricing: ['single'] },
  { label: '1-10kV', value: '1_10kv', pricing: ['single', 'two-part'] },
  { label: '35kV', value: '35kv', pricing: ['single', 'two-part'] },
  { label: '110kV', value: '110kv', pricing: ['two-part'] },
  { label: '220kV及以上', value: '220kv_plus', pricing: ['two-part'] }
]

export function getDefaultCommercialPriceForm(): CommercialPriceForm {
  return applyVoltagePrices({
    province: 'xinjiang',
    user_type: 'large',
    pricing_type: 'two-part',
    voltage_level: '1_10kv',
    usage_type: 'general',
    grid_price: 0.25,
    loss_rate: 6.57,
    td_price: 0.1204,
    system_fee: 0.02,
    government_fee: 0.019,
    transformer_capacity: 6300,
    max_demand: 5000,
    capacity_charge_type: 'capacity',
    capacity_price: 20.03,
    demand_price: 32,
    electricity_amount: 100000,
    enable_tou: true,
    tou_type: 'sharp_deep',
    selected_month: 0,
    ratio_mode: 'ratio',
    peak_price: 0.42,
    flat_price: 0.28,
    valley_price: 0.16,
    sharp_peak_price: 0.56,
    deep_valley_price: 0.08,
    sharp_peak_ratio: 4.78,
    peak_ratio: 30.13,
    flat_ratio: 33.33,
    valley_ratio: 27.38,
    deep_valley_ratio: 4.38,
    sharp_peak_amount: 0,
    peak_amount: 0,
    flat_amount: 0,
    valley_amount: 0,
    deep_valley_amount: 0,
    enable_sales_analysis: true,
    sales_package_type: 'fixed',
    service_fee: 0.02,
    reference_price: 0.45,
    price_down_amount: 0.02,
    company_share_ratio: 50,
    sharp_peak_sale_ratio: 2,
    peak_sale_ratio: 1.75,
    flat_sale_ratio: 1,
    valley_sale_ratio: 0.25,
    deep_valley_sale_ratio: 0.1,
    known_weighted_price: false,
    weighted_avg_price: 0.32
  })
}

export function getDefaultStateGridForm(): StateGridForm {
  return {
    province: 'xinjiang',
    voltage_level: '1_10kv',
    agency_price: 0.38,
    td_price: 0.1606,
    system_fee: 0.02,
    government_fee: 0.019,
    electricity_amount: 100000,
    loss_rate: 1.6
  }
}

export function applyVoltagePrices<T extends CommercialPriceForm>(form: T): T {
  const bucket = form.pricing_type === 'two-part' ? voltageTdPrices.two_part : voltageTdPrices.single
  const data = bucket[form.voltage_level as keyof typeof bucket]
  if (data) {
    form.td_price = data.td_price
    if ('capacity_price' in data) {
      form.capacity_price = data.capacity_price
      form.demand_price = data.demand_price
    }
  }
  return form
}

function round(value: number, digits = 4) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function calculateMonthRatios(month: number): TimeSlotRatios {
  const isSharpPeakMonth = [1, 7, 8, 11, 12].includes(month)
  const isDeepValleyMonth = [5, 6, 7, 8].includes(month)
  if (isSharpPeakMonth && isDeepValleyMonth) {
    return { sharp_peak_ratio: 8.33, peak_ratio: 25, flat_ratio: 33.33, valley_ratio: 25, deep_valley_ratio: 8.33 }
  }
  if (isSharpPeakMonth) {
    return { sharp_peak_ratio: 8.33, peak_ratio: 25, flat_ratio: 33.33, valley_ratio: 33.33, deep_valley_ratio: 0 }
  }
  if (isDeepValleyMonth) {
    return { sharp_peak_ratio: 0, peak_ratio: 33.33, flat_ratio: 33.33, valley_ratio: 25, deep_valley_ratio: 8.33 }
  }
  return { sharp_peak_ratio: 0, peak_ratio: 33.33, flat_ratio: 33.33, valley_ratio: 33.33, deep_valley_ratio: 0 }
}

export function calculateYearRatios(): TimeSlotRatios {
  const daysInMonth: Record<number, number> = { 1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 }
  const sum = { sharp_peak_ratio: 0, peak_ratio: 0, flat_ratio: 0, valley_ratio: 0, deep_valley_ratio: 0 }
  let totalDays = 0
  Object.entries(daysInMonth).forEach(([monthText, days]) => {
    const ratios = calculateMonthRatios(Number(monthText))
    totalDays += days
    sum.sharp_peak_ratio += ratios.sharp_peak_ratio * days
    sum.peak_ratio += ratios.peak_ratio * days
    sum.flat_ratio += ratios.flat_ratio * days
    sum.valley_ratio += ratios.valley_ratio * days
    sum.deep_valley_ratio += ratios.deep_valley_ratio * days
  })
  return {
    sharp_peak_ratio: round(sum.sharp_peak_ratio / totalDays, 2),
    peak_ratio: round(sum.peak_ratio / totalDays, 2),
    flat_ratio: round(sum.flat_ratio / totalDays, 2),
    valley_ratio: round(sum.valley_ratio / totalDays, 2),
    deep_valley_ratio: round(sum.deep_valley_ratio / totalDays, 2)
  }
}

export function applyTouRatios(form: CommercialPriceForm, ratios: TimeSlotRatios) {
  form.sharp_peak_ratio = ratios.sharp_peak_ratio
  form.peak_ratio = ratios.peak_ratio
  form.flat_ratio = ratios.flat_ratio
  form.valley_ratio = ratios.valley_ratio
  form.deep_valley_ratio = ratios.deep_valley_ratio
}

/**
 * 解析当前生效的分时电量比例（口径修复，审查问题5）：
 * selected_month=1..12 且尖峰深谷分时（sharp_deep）时采用该月分时日历比例
 * （尖峰月 1/7/8/11/12、深谷月 5/6/7/8，见 calculateMonthRatios），不再沿用表单中的年均比例；
 * selected_month=0（全年）保持表单比例。amount 模式（直接录入各时段电量）不经过本函数，不受影响。
 */
export function resolveTouRatios(form: CommercialPriceForm): TimeSlotRatios {
  if (form.tou_type === 'sharp_deep' && form.selected_month >= 1 && form.selected_month <= 12) {
    return calculateMonthRatios(form.selected_month)
  }
  return {
    sharp_peak_ratio: form.sharp_peak_ratio,
    peak_ratio: form.peak_ratio,
    flat_ratio: form.flat_ratio,
    valley_ratio: form.valley_ratio,
    deep_valley_ratio: form.deep_valley_ratio
  }
}

export function getPeriodAmounts(form: CommercialPriceForm) {
  if (form.ratio_mode === 'amount') {
    // L485 修复：amount 模式下 standard（三时段）分时同样不存在尖峰/深谷，
    // 电量归零与 ratio 模式口径对齐，避免残留输入参与计费
    return {
      sharpPeak: form.tou_type === 'sharp_deep' ? form.sharp_peak_amount : 0,
      peak: form.peak_amount,
      flat: form.flat_amount,
      valley: form.valley_amount,
      deepValley: form.tou_type === 'sharp_deep' ? form.deep_valley_amount : 0
    }
  }
  const ratios = resolveTouRatios(form)
  return {
    sharpPeak: form.tou_type === 'sharp_deep' ? form.electricity_amount * ratios.sharp_peak_ratio / 100 : 0,
    peak: form.electricity_amount * ratios.peak_ratio / 100,
    flat: form.electricity_amount * ratios.flat_ratio / 100,
    valley: form.electricity_amount * ratios.valley_ratio / 100,
    deepValley: form.tou_type === 'sharp_deep' ? form.electricity_amount * ratios.deep_valley_ratio / 100 : 0
  }
}

export function calculateWeightedPurchasePrice(form: CommercialPriceForm) {
  if (!form.enable_tou) return form.grid_price
  const amount = getPeriodAmounts(form)
  const total = amount.sharpPeak + amount.peak + amount.flat + amount.valley + amount.deepValley
  if (total <= 0) return 0
  const purchase = form.sharp_peak_price * amount.sharpPeak
    + form.peak_price * amount.peak
    + form.flat_price * amount.flat
    + form.valley_price * amount.valley
    + form.deep_valley_price * amount.deepValley
  return purchase / total
}

export function inferTouPricesFromWeightedPrice(form: CommercialPriceForm) {
  const weighted = form.weighted_avg_price
  if (weighted <= 0) return
  // 与 getPeriodAmounts 同源（审查问题5）：反推权重与电量拆分使用同一套比例（含月度日历口径）
  const ratios = resolveTouRatios(form)
  const ratio = {
    sharpPeak: form.tou_type === 'sharp_deep' ? ratios.sharp_peak_ratio / 100 : 0,
    peak: ratios.peak_ratio / 100,
    flat: ratios.flat_ratio / 100,
    valley: ratios.valley_ratio / 100,
    deepValley: form.tou_type === 'sharp_deep' ? ratios.deep_valley_ratio / 100 : 0
  }
  const multiplier = {
    sharpPeak: 2,
    peak: 1.75,
    flat: 1,
    valley: 0.25,
    deepValley: 0.1
  }
  const weightedMultiplier = ratio.sharpPeak * multiplier.sharpPeak
    + ratio.peak * multiplier.peak
    + ratio.flat * multiplier.flat
    + ratio.valley * multiplier.valley
    + ratio.deepValley * multiplier.deepValley
  const flatPrice = weightedMultiplier > 0 ? weighted / weightedMultiplier : 0
  form.sharp_peak_price = flatPrice * multiplier.sharpPeak
  form.peak_price = flatPrice * multiplier.peak
  form.flat_price = flatPrice
  form.valley_price = flatPrice * multiplier.valley
  form.deep_valley_price = flatPrice * multiplier.deepValley
}

export function calculateSalesPrices(form: CommercialPriceForm) {
  const amount = getPeriodAmounts(form)
  const total = amount.sharpPeak + amount.peak + amount.flat + amount.valley + amount.deepValley
  const purchase = form.sharp_peak_price * amount.sharpPeak
    + form.peak_price * amount.peak
    + form.flat_price * amount.flat
    + form.valley_price * amount.valley
    + form.deep_valley_price * amount.deepValley
  if (!form.enable_sales_analysis || total <= 0) {
    return {
      sharpPeak: form.sharp_peak_price,
      peak: form.peak_price,
      flat: form.flat_price,
      valley: form.valley_price,
      deepValley: form.deep_valley_price,
      purchase,
      sales: purchase,
      profit: 0
    }
  }

  let base = 0
  if (form.sales_package_type === 'fixed') {
    const prices = {
      sharpPeak: form.sharp_peak_price + form.service_fee,
      peak: form.peak_price + form.service_fee,
      flat: form.flat_price + form.service_fee,
      valley: form.valley_price + form.service_fee,
      deepValley: form.deep_valley_price + form.service_fee
    }
    const sales = prices.sharpPeak * amount.sharpPeak + prices.peak * amount.peak + prices.flat * amount.flat + prices.valley * amount.valley + prices.deepValley * amount.deepValley
    return { ...prices, purchase, sales, profit: sales - purchase }
  }
  if (form.sales_package_type === 'ratio_share') {
    const margin = form.reference_price * total - purchase
    base = (margin * form.company_share_ratio / 100 + purchase) / total
  } else if (form.sales_package_type === 'price_down') {
    base = form.reference_price - form.price_down_amount
  } else {
    const margin = (form.reference_price - form.price_down_amount) * total - purchase
    base = (margin * form.company_share_ratio / 100 + purchase) / total
  }

  // L371 修复：时段零售价按电量加权归一，保证加权均价 = 承诺价 base。
  // 先算 Σ(sale_ratio_i × w_i)（w_i 为该时段电量占比），
  // 各时段价 = base × ratio_i / Σ(ratio_i × w_i)，
  // 与 inferTouPricesFromWeightedPrice 的归一化口径一致。
  const weightedRatio = (
    form.sharp_peak_sale_ratio * amount.sharpPeak
    + form.peak_sale_ratio * amount.peak
    + form.flat_sale_ratio * amount.flat
    + form.valley_sale_ratio * amount.valley
    + form.deep_valley_sale_ratio * amount.deepValley
  ) / total
  const normalizer = weightedRatio > 0 ? weightedRatio : 1
  const prices = {
    sharpPeak: base * form.sharp_peak_sale_ratio / normalizer,
    peak: base * form.peak_sale_ratio / normalizer,
    flat: base * form.flat_sale_ratio / normalizer,
    valley: base * form.valley_sale_ratio / normalizer,
    deepValley: base * form.deep_valley_sale_ratio / normalizer
  }
  const sales = prices.sharpPeak * amount.sharpPeak + prices.peak * amount.peak + prices.flat * amount.flat + prices.valley * amount.valley + prices.deepValley * amount.deepValley
  return { ...prices, purchase, sales, profit: sales - purchase }
}

function calculateBasicFee(form: CommercialPriceForm, effectiveAmount: number) {
  if (form.pricing_type !== 'two-part') return { fee: 0, demandDiscount: false }
  const months = form.selected_month === 0 ? 12 : 1
  if (form.capacity_charge_type === 'capacity') {
    return { fee: form.transformer_capacity * form.capacity_price * months, demandDiscount: false }
  }
  let demandPrice = form.demand_price
  let demandDiscount = false
  // L390 修复：260 kWh/kVA 九折判据按"月均用电量 / 变压器容量"口径
  // （发改价格〔2023〕526号），全年电量须先除以月份数再比较
  const monthlyPerKva = form.transformer_capacity > 0 ? effectiveAmount / months / form.transformer_capacity : 0
  if (monthlyPerKva >= 260) {
    demandPrice *= 0.9
    demandDiscount = true
  }
  return { fee: form.max_demand * demandPrice * months, demandDiscount }
}

export function calculateCommercialPrice(form: CommercialPriceForm): CommercialPriceResult {
  const working = { ...form }
  applyVoltagePrices(working)
  if (working.known_weighted_price) inferTouPricesFromWeightedPrice(working)

  // L470/485 修复：amount 模式下总电量以 Σ时段电量为准，
  // 系统运行费、政府性基金、综合单价均以该口径计费
  let effectiveAmount = working.electricity_amount
  if (working.enable_tou && working.ratio_mode === 'amount') {
    const amounts = getPeriodAmounts(working)
    effectiveAmount = amounts.sharpPeak + amounts.peak + amounts.flat + amounts.valley + amounts.deepValley
  }

  const basic = calculateBasicFee(working, effectiveAmount)
  const lossFactor = working.loss_rate / Math.max(100 - working.loss_rate, 0.01)
  const breakdown: PriceBreakdownItem[] = []
  let energyFee = 0
  let gridLossFee = 0
  let tdFee = 0
  let purchaseCost = 0
  let salesRevenue = 0
  let salesProfit = 0
  const periods: PeriodCharge[] = []

  if (!working.enable_tou) {
    const gridLoss = working.grid_price * lossFactor
    const unitPrice = working.grid_price + gridLoss + working.td_price + working.system_fee + working.government_fee
    energyFee = unitPrice * working.electricity_amount
    gridLossFee = gridLoss * working.electricity_amount
    tdFee = working.td_price * working.electricity_amount
    purchaseCost = working.grid_price * working.electricity_amount
    salesRevenue = purchaseCost
    breakdown.push(
      { item: '上网电价', unit_price: working.grid_price, amount: purchaseCost, ratio: 0 },
      { item: '上网环节线损费用', unit_price: gridLoss, amount: gridLossFee, ratio: 0 },
      { item: '输配电价', unit_price: working.td_price, amount: tdFee, ratio: 0 }
    )
  } else {
    const amount = getPeriodAmounts(working)
    const sale = calculateSalesPrices(working)
    const price = working.enable_sales_analysis ? sale : {
      sharpPeak: working.sharp_peak_price,
      peak: working.peak_price,
      flat: working.flat_price,
      valley: working.valley_price,
      deepValley: working.deep_valley_price,
      purchase: sale.purchase,
      sales: sale.purchase,
      profit: 0
    }
    const isElectricHeating = working.usage_type === 'electric_heating'
    const periodConfigs = [
      { key: 'sharpPeak', label: '尖峰', unit: price.sharpPeak, amount: amount.sharpPeak, td: working.td_price },
      { key: 'peak', label: '高峰', unit: price.peak, amount: amount.peak, td: working.td_price },
      { key: 'flat', label: '平段', unit: price.flat, amount: amount.flat, td: working.td_price },
      { key: 'valley', label: '低谷', unit: price.valley, amount: amount.valley, td: isElectricHeating ? working.td_price * 0.5 : working.td_price },
      { key: 'deepValley', label: '深谷', unit: price.deepValley, amount: amount.deepValley, td: isElectricHeating ? working.td_price * 0.5 : working.td_price }
    ].filter((period) => period.amount > 0 || (period.key !== 'sharpPeak' && period.key !== 'deepValley'))

    periodConfigs.forEach((period) => {
      const fee = period.unit * period.amount
      const tdAmount = period.td * period.amount
      energyFee += fee
      tdFee += tdAmount
      periods.push({ period: period.label, unit_price: round(period.unit), amount: round(period.amount, 2), fee: round(fee, 2) })
      breakdown.push({ item: `${period.label}电价`, unit_price: round(period.unit), amount: round(fee, 2), ratio: 0 })
    })
    // L457 修复：上网环节线损费用 = 购电电能量价格 × η/(1−η)（发改价格〔2023〕526号），
    // 基数为分时购电电能量费用（sale.purchase），绝不含售电利润/服务费
    gridLossFee = sale.purchase * lossFactor
    purchaseCost = sale.purchase
    salesRevenue = sale.sales
    salesProfit = sale.profit
    breakdown.push(
      { item: '上网环节线损费用', unit_price: round(gridLossFee / Math.max(effectiveAmount, 1)), amount: round(gridLossFee, 2), ratio: 0 },
      { item: '输配电价', unit_price: round(tdFee / Math.max(effectiveAmount, 1)), amount: round(tdFee, 2), ratio: 0 }
    )
    if (working.enable_sales_analysis) {
      // L466 修复：利润已含在各时段零售价（能量电费）内，此处仅作备注行，不进占比分母
      breakdown.push({ item: '售电公司利润（备注，已含在时段电价中）', unit_price: round(salesProfit / Math.max(effectiveAmount, 1)), amount: round(salesProfit, 2), ratio: 0, note: true })
    }
  }

  const systemFeeAmount = working.system_fee * effectiveAmount
  const governmentFeeAmount = working.government_fee * effectiveAmount
  if (basic.fee > 0) breakdown.push({ item: '容量电费', unit_price: round(basic.fee / Math.max(effectiveAmount, 1)), amount: round(basic.fee, 2), ratio: 0 })
  breakdown.push(
    { item: '系统运行费用', unit_price: working.system_fee, amount: round(systemFeeAmount, 2), ratio: 0 },
    { item: '政府性基金及附加', unit_price: working.government_fee, amount: round(governmentFeeAmount, 2), ratio: 0 }
  )

  const totalFee = energyFee + basic.fee + (working.enable_tou ? gridLossFee + tdFee + systemFeeAmount + governmentFeeAmount : 0)
  const validBreakdown = breakdown.filter((item) => item.amount !== 0 || item.unit_price !== 0)
  validBreakdown.forEach((item) => {
    // 备注行不参与占比：其余各行占比合计恒为 100%
    if (item.note) return
    item.ratio = totalFee > 0 ? round(item.amount / totalFee, 4) : 0
  })

  return {
    unit_price: round(totalFee / Math.max(effectiveAmount, 1)),
    total_fee: round(totalFee, 2),
    energy_fee: round(energyFee, 2),
    basic_fee: round(basic.fee, 2),
    grid_loss_fee: round(gridLossFee, 2),
    td_fee: round(tdFee, 2),
    system_fee_amount: round(systemFeeAmount, 2),
    government_fee_amount: round(governmentFeeAmount, 2),
    sales_profit: round(salesProfit, 2),
    purchase_cost: round(purchaseCost, 2),
    sales_revenue: round(salesRevenue, 2),
    capacity_charge_type: basic.fee > 0 ? working.capacity_charge_type : undefined,
    demand_discount: basic.demandDiscount,
    breakdown: validBreakdown,
    periods
  }
}

export function calculateStateGridPrice(form: StateGridForm): StateGridResult {
  // L503 修复：代购电到户价补上上网环节线损费用。
  // 到户价 = 代理购电价 × (1 + η/(1−η)) + 输配电价 + 系统运行费 + 政府性基金，
  // 其中线损费用 = 电能量价格 × η/(1−η)（发改价格〔2023〕526号）
  const lossFactor = form.loss_rate / Math.max(100 - form.loss_rate, 0.01)
  const gridLossPrice = form.agency_price * lossFactor
  const unitPrice = form.agency_price + gridLossPrice + form.td_price + form.system_fee + form.government_fee
  const totalFee = unitPrice * form.electricity_amount
  const breakdown: PriceBreakdownItem[] = [
    { item: '代理购电价格', unit_price: form.agency_price, amount: form.agency_price * form.electricity_amount, ratio: 0 },
    { item: '上网环节线损费用', unit_price: round(gridLossPrice), amount: gridLossPrice * form.electricity_amount, ratio: 0 },
    { item: '输配电价', unit_price: form.td_price, amount: form.td_price * form.electricity_amount, ratio: 0 },
    { item: '系统运行费用', unit_price: form.system_fee, amount: form.system_fee * form.electricity_amount, ratio: 0 },
    { item: '政府性基金及附加', unit_price: form.government_fee, amount: form.government_fee * form.electricity_amount, ratio: 0 }
  ]
  breakdown.forEach((item) => {
    item.amount = round(item.amount, 2)
    item.ratio = totalFee > 0 ? round(item.amount / totalFee, 4) : 0
  })
  return {
    unit_price: round(unitPrice),
    total_fee: round(totalFee, 2),
    breakdown
  }
}
