import { describe, expect, it } from 'vitest'
import { calculateIRR } from '@/services/storage'
import {
  buildWindSolarCashFlowDetail,
  calculateWindSolarInvestment,
  calculateWindSolarLcoe,
  generationForYear,
  getWindSolarDefaultForm,
  runWindSolarSensitivityAnalysis,
  type WindSolarForm
} from './windSolar'

/** 无衰减、无增值税的简化表单，便于手算对拍 */
function plainForm(overrides: Partial<WindSolarForm> = {}): WindSolarForm {
  return {
    ...getWindSolarDefaultForm('solar'),
    degradation_rate: 0,
    first_year_degradation: 0,
    vat_rate: 0,
    vat_refund_rate: 0,
    ...overrides
  }
}

describe('calculateIRR 负值与无解语义（E2）', () => {
  it('亏损现金流的负 IRR 如实返回，不截断为 0', () => {
    // 投 100 只收回 90，IRR 必为负
    const irr = calculateIRR([-100, 30, 30, 30])
    expect(Number.isFinite(irr)).toBe(true)
    expect(irr).toBeLessThan(0)
  })

  it('现金流无变号（无实根）时返回 NaN 而非 0 哨兵', () => {
    expect(Number.isNaN(calculateIRR([-100, -10, -5]))).toBe(true)
    expect(Number.isNaN(calculateIRR([100, 10, 5]))).toBe(true)
  })

  it('正常项目仍返回正 IRR', () => {
    // [-100, 60, 60] 的 IRR 手算约 13.07%
    const irr = calculateIRR([-100, 60, 60])
    expect(irr).toBeGreaterThan(12)
    expect(irr).toBeLessThan(14)
  })
})

describe('calculateIRR 高 IRR 语义（#1351）', () => {
  it('低资本开支/高收入现金流返回真实高 IRR，不再误报无解', () => {
    // [-100, 10000]：1 倍投入、100 倍首期回收，IRR 手算恰为 9900%
    expect(calculateIRR([-100, 10000])).toBeCloseTo(9900, 3)
  })

  it('极端高收益现金流在扫掠上界内仍可解', () => {
    // [-1, 1000000]：IRR = 99999900%（倍增上界 1e8% 内）；1e6 量级下 NPV 消元的
    // 浮点噪声约万分位，用相对界断言而非绝对容差
    const irr = calculateIRR([-1, 1000000])
    expect(irr).toBeGreaterThan(99999800)
    expect(irr).toBeLessThan(100000000)
  })

  it('负 IRR 与同号无解语义不回归', () => {
    const irr = calculateIRR([-100, 30, 30, 30])
    expect(Number.isFinite(irr)).toBe(true)
    expect(irr).toBeLessThan(0)
    expect(Number.isNaN(calculateIRR([-100, -10, -5]))).toBe(true)
    expect(Number.isNaN(calculateIRR([100, 10, 5]))).toBe(true)
  })
})

describe('光伏衰减电量（C6）', () => {
  it('逐年电量 = 首年电量 × (1−首衰/100) × (1−年衰/100)^(y−1)', () => {
    const form = plainForm({ degradation_rate: 0.55, first_year_degradation: 2 })
    const base = form.capacity_mw * form.hours_per_year * 1000 * (1 - form.curtailment_rate / 100) / 10000
    expect(generationForYear(form, 1)).toBeCloseTo(base * 0.98, 6)
    expect(generationForYear(form, 3)).toBeCloseTo(base * 0.98 * 0.9945 ** 2, 6)
  })

  it('衰减使现金流收入逐年按 (1−年衰) 比例下降', () => {
    const form = plainForm({ degradation_rate: 0.55, first_year_degradation: 2 })
    const detail = buildWindSolarCashFlowDetail(form, 0.32)
    expect(detail.years[2].revenue / detail.years[1].revenue).toBeCloseTo(1 - 0.55 / 100, 9)
  })

  it('风电默认无衰减，逐年电量恒定', () => {
    const form = { ...getWindSolarDefaultForm('wind') }
    expect(generationForYear(form, 10)).toBeCloseTo(generationForYear(form, 1), 9)
  })
})

describe('增值税接线（E3）', () => {
  it('收入 = 含税电费价税分离 + 即征即退退税额', () => {
    const form = plainForm({ vat_rate: 13, vat_refund_rate: 50 })
    const lcoe = 0.32
    const gross = generationForYear(form, 1) * lcoe
    const net = gross / 1.13
    const refund = (gross - net) * 0.5
    const detail = buildWindSolarCashFlowDetail(form, lcoe)
    expect(detail.years[0].revenue).toBeCloseTo(net + refund, 6)
  })

  it('光伏默认即征即退比例为 50%（财税〔2013〕66号）', () => {
    expect(getWindSolarDefaultForm('solar').vat_refund_rate).toBe(50)
  })
})

describe('敏感性分析弹性定义（E1）', () => {
  it('保留全部 7 个扰动点且弹性 = ((v(+30)−v(−30))/v(0))/0.6', () => {
    const result = runWindSolarSensitivityAnalysis(plainForm(), 'lcoe_to_irr')
    expect(result.target_param).toBe('IRR')
    for (const entry of Object.values(result.sensitivity_results)) {
      expect(entry.changes).toEqual([-30, -20, -10, 0, 10, 20, 30])
      expect(entry.values).toHaveLength(7)
      const [vLow, , , vBase, , , vHigh] = entry.values
      if (vLow !== null && vHigh !== null && vBase !== null && vBase !== 0) {
        expect(entry.sensitivity).not.toBeNull()
        expect(entry.sensitivity as number).toBeCloseTo(((vHigh - vLow) / vBase) / 0.6, 3)
      }
    }
  })

  it('无解点在曲线中置 null 而非丢点', () => {
    // 电价压到极低使部分扰动点 IRR 无实根
    const result = runWindSolarSensitivityAnalysis(plainForm({ lcoe: 0.01 }), 'lcoe_to_irr')
    for (const entry of Object.values(result.sensitivity_results)) {
      expect(entry.values).toHaveLength(entry.changes.length)
    }
  })
})

describe('LCOE 反推与哨兵治理（E4/E5）', () => {
  it('目标 IRR 超出 IRR 搜索上界（1e8%）时返回 NaN 而非 -1', () => {
    // #1351 后 IRR 搜索上界扩至 1e8%：target=1000（十万百分点）已真实可收敛，
    // 「高不可达」语义改用超出上界的 target=2e6（两亿百分点）验证
    const lcoe = calculateWindSolarLcoe(plainForm({ target_equity_irr: 2000000 }))
    expect(Number.isNaN(lcoe)).toBe(true)
  })

  it('目标 IRR 在扩展上界内（1000）可反推收敛（#1351 行为改进）', () => {
    const lcoe = calculateWindSolarLcoe(plainForm({ target_equity_irr: 1000 }))
    expect(Number.isFinite(lcoe)).toBe(true)
    expect(lcoe).toBeGreaterThan(0)
  })

  it('正常参数下反推收敛且验算 IRR 接近目标', () => {
    const form = plainForm({ target_equity_irr: 10 })
    const result = calculateWindSolarInvestment(form, 'irr_to_lcoe')
    expect(result.lcoe_converged).toBe(true)
    expect(result.lcoe).toBeGreaterThan(0)
    expect(result.actual_equity_irr).toBeCloseTo(10, 0)
  })

  it('项目期内未回本时 payback_reached=false 且回收期为 NaN（不再用 -1）', () => {
    const result = calculateWindSolarInvestment(plainForm({ lcoe: 0.01 }), 'lcoe_to_irr')
    expect(result.payback_reached).toBe(false)
    expect(Number.isNaN(result.payback_period)).toBe(true)
    expect(result.payback_period).not.toBe(-1)
  })
})

describe('现金流明细单一数据源（E6）', () => {
  it('明细表逐行等于现金流构建函数的分项输出', () => {
    const form = plainForm({ vat_rate: 13, vat_refund_rate: 50, degradation_rate: 0.55, first_year_degradation: 2 })
    const result = calculateWindSolarInvestment(form, 'lcoe_to_irr')
    const detail = buildWindSolarCashFlowDetail(form, form.lcoe)
    expect(result.cash_flow_schedule).toHaveLength(detail.years.length)
    result.cash_flow_schedule.forEach((row, index) => {
      const source = detail.years[index]
      expect(row.revenue).toBeCloseTo(source.revenue, 2)
      expect(row.om_cost).toBeCloseTo(source.om_cost, 2)
      expect(row.depreciation).toBeCloseTo(source.depreciation, 2)
      expect(row.loan_principal).toBeCloseTo(source.loan_principal, 2)
      expect(row.loan_interest).toBeCloseTo(source.loan_interest, 2)
      expect(row.income_tax).toBeCloseTo(source.income_tax, 2)
      expect(row.net_cash_flow).toBeCloseTo(source.net_cash_flow, 2)
      // 与 IRR/NPV 使用的现金流数组同源
      expect(row.net_cash_flow).toBeCloseTo(detail.cash_flows[index + 1], 2)
    })
  })
})

describe('年限边界（C5/C7）', () => {
  it('折旧年限与贷款年限超过项目寿命时按寿命 clamp', () => {
    const form = plainForm({ project_life: 20, depreciation_years: 40, loan_term: 35 })
    const result = calculateWindSolarInvestment(form, 'lcoe_to_irr')
    expect(result.cash_flow_schedule).toHaveLength(20)
    // 折旧被摊到 20 年：末年仍有折旧且各年折旧相同
    const lastRow = result.cash_flow_schedule[19]
    expect(lastRow.depreciation).toBeGreaterThan(0)
    expect(lastRow.depreciation).toBeCloseTo(result.cash_flow_schedule[0].depreciation, 2)
    // 贷款按 20 年摊还：末年仍在还本
    expect(lastRow.loan_principal).toBeGreaterThan(0)
  })
})

