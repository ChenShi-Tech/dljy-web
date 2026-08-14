import { describe, expect, it } from 'vitest'
import {
  calculateCommercialPrice,
  calculateSalesPrices,
  calculateStateGridPrice,
  getDefaultCommercialPriceForm,
  getDefaultStateGridForm,
  getPeriodAmounts,
  type CommercialPriceForm
} from './retailPrice'

function form(overrides: Partial<CommercialPriceForm> = {}): CommercialPriceForm {
  return { ...getDefaultCommercialPriceForm(), ...overrides }
}

function totalAmount(input: CommercialPriceForm) {
  const amounts = getPeriodAmounts(input)
  return amounts.sharpPeak + amounts.peak + amounts.flat + amounts.valley + amounts.deepValley
}

describe('上网环节线损费用基数（L457）', () => {
  it('线损基数为购电电能量费用 × η/(1−η)，不含售电利润/服务费', () => {
    // 固定服务费套餐下零售价 = 购电价 + 0.02，若误用零售电费当基数会放大线损
    const input = form({ enable_tou: true, enable_sales_analysis: true, sales_package_type: 'fixed', service_fee: 0.02 })
    const result = calculateCommercialPrice(input)
    const expected = result.purchase_cost * input.loss_rate / (100 - input.loss_rate)
    expect(result.grid_loss_fee).toBeCloseTo(expected, 0)
    // 反证：不等于按含利润的电度电费计的线损
    expect(Math.abs(result.grid_loss_fee - result.energy_fee * input.loss_rate / (100 - input.loss_rate))).toBeGreaterThan(1)
  })
})

describe('比例套餐时段价归一化（L371）', () => {
  it('price_down 套餐：电量加权均价 = 承诺价（参考价 − 降价额）', () => {
    const input = form({ enable_tou: true, enable_sales_analysis: true, sales_package_type: 'price_down' })
    const sale = calculateSalesPrices(input)
    const amounts = getPeriodAmounts(input)
    const total = totalAmount(input)
    const weighted = (
      sale.sharpPeak * amounts.sharpPeak
      + sale.peak * amounts.peak
      + sale.flat * amounts.flat
      + sale.valley * amounts.valley
      + sale.deepValley * amounts.deepValley
    ) / total
    expect(weighted).toBeCloseTo(input.reference_price - input.price_down_amount, 9)
  })

  it('ratio_share 套餐：利润 = 价差空间 × 分成比例（归一化后不再放大）', () => {
    const input = form({ enable_tou: true, enable_sales_analysis: true, sales_package_type: 'ratio_share', company_share_ratio: 50 })
    const sale = calculateSalesPrices(input)
    const total = totalAmount(input)
    const margin = input.reference_price * total - sale.purchase
    expect(sale.profit).toBeCloseTo(margin * 0.5, 6)
  })
})

describe('构成占比（L466）', () => {
  it('售电公司利润为备注行，非备注行占比合计 = 100%', () => {
    const result = calculateCommercialPrice(form({ enable_tou: true, enable_sales_analysis: true, sales_package_type: 'fixed' }))
    const profitRow = result.breakdown.find((row) => row.item.includes('售电公司利润'))
    expect(profitRow?.note).toBe(true)
    expect(profitRow?.ratio).toBe(0)
    const ratioSum = result.breakdown.filter((row) => !row.note).reduce((sum, row) => sum + row.ratio, 0)
    expect(ratioSum).toBeCloseTo(1, 2)
  })
})

describe('需量九折月均口径（L390）', () => {
  it('全年电量按月均折算后再与 260 kWh/kVA 比较（发改价格〔2023〕526号）', () => {
    const base = form({
      pricing_type: 'two-part',
      capacity_charge_type: 'demand',
      transformer_capacity: 1000,
      selected_month: 0,
      enable_tou: false
    })
    // 年电量 300 万 kWh → 月均 250 kWh/kVA < 260：不打折（旧口径 3000 ≥ 260 会误打折）
    const noDiscount = calculateCommercialPrice({ ...base, electricity_amount: 3_000_000 })
    expect(noDiscount.demand_discount).toBe(false)
    // 年电量 330 万 kWh → 月均 275 kWh/kVA ≥ 260：打九折
    const discount = calculateCommercialPrice({ ...base, electricity_amount: 3_300_000 })
    expect(discount.demand_discount).toBe(true)
  })
})

describe('amount 模式电量基数（L470/485）', () => {
  it('总电量以 Σ时段电量为准，standard 分时下尖峰/深谷电量归零', () => {
    const input = form({
      enable_tou: true,
      ratio_mode: 'amount',
      tou_type: 'standard',
      sharp_peak_amount: 500,
      peak_amount: 10000,
      flat_amount: 20000,
      valley_amount: 30000,
      deep_valley_amount: 800,
      electricity_amount: 999999
    })
    const amounts = getPeriodAmounts(input)
    expect(amounts.sharpPeak).toBe(0)
    expect(amounts.deepValley).toBe(0)
    const result = calculateCommercialPrice(input)
    // 系统运行费按 Σ时段电量（60000）计费，而非 electricity_amount
    expect(result.system_fee_amount).toBeCloseTo(input.system_fee * 60000, 2)
    expect(result.government_fee_amount).toBeCloseTo(input.government_fee * 60000, 2)
  })
})

describe('selected_month 分时日历生效（审查问题5）', () => {
  it('ratio 模式：7 月（尖峰+深谷月）按该月日历比例拆电量，账单与年均/普通月不同', () => {
    const july = form({ selected_month: 7 })
    const amounts = getPeriodAmounts(july)
    // 7 月既是尖峰月又是深谷月：尖峰/深谷各占 8.33%
    expect(amounts.sharpPeak).toBeCloseTo(july.electricity_amount * 8.33 / 100, 2)
    expect(amounts.deepValley).toBeCloseTo(july.electricity_amount * 8.33 / 100, 2)
    // 7 月与年均（selected_month=0，表单年均比例）口径的分时能量电费不同
    const julyResult = calculateCommercialPrice(july)
    const annualResult = calculateCommercialPrice(form({ selected_month: 0 }))
    expect(Math.abs(julyResult.energy_fee - annualResult.energy_fee)).toBeGreaterThan(1)
    // 与普通月（4 月：非尖峰非深谷）相比同样不同（尖峰/深谷电量占比差异传导到电费）
    const aprilResult = calculateCommercialPrice(form({ selected_month: 4 }))
    expect(Math.abs(julyResult.energy_fee - aprilResult.energy_fee)).toBeGreaterThan(1)
  })

  it('amount 模式不受 selected_month 影响（直接录入的时段电量为准）', () => {
    const base = form({
      ratio_mode: 'amount',
      sharp_peak_amount: 500,
      peak_amount: 10000,
      flat_amount: 20000,
      valley_amount: 30000,
      deep_valley_amount: 800
    })
    expect(getPeriodAmounts({ ...base, selected_month: 7 })).toEqual(getPeriodAmounts({ ...base, selected_month: 0 }))
    // 完整测算结果同样一致（对比同为单月口径的 4 月，排除基本电费月数差异）
    const julyResult = calculateCommercialPrice({ ...base, selected_month: 7 })
    const aprilResult = calculateCommercialPrice({ ...base, selected_month: 4 })
    expect(julyResult.energy_fee).toBeCloseTo(aprilResult.energy_fee, 6)
    expect(julyResult.total_fee).toBeCloseTo(aprilResult.total_fee, 6)
  })
})

describe('国网代购电线损（L503）', () => {
  it('到户价 = 代理购电价 × (1+η/(1−η)) + 输配 + 系统运行费 + 政府性基金', () => {
    const input = { ...getDefaultStateGridForm(), loss_rate: 1.6 }
    const result = calculateStateGridPrice(input)
    const expected = input.agency_price * (1 + 1.6 / 98.4) + input.td_price + input.system_fee + input.government_fee
    expect(result.unit_price).toBeCloseTo(expected, 4)
    const lossRow = result.breakdown.find((row) => row.item === '上网环节线损费用')
    expect(lossRow).toBeDefined()
    expect(lossRow!.unit_price).toBeCloseTo(input.agency_price * 1.6 / 98.4, 4)
  })
})

