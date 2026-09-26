import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchCaptured = vi.hoisted(() => vi.fn())

vi.mock('@/services/captured', () => ({ fetchCaptured }))

import { loadMarketAnalysis } from './marketAnalysis'

// 真实回放信封（IMPORT → captured）
function capturedRows(rows: unknown) {
  return { sourceType: 'IMPORT', data: rows }
}
// mock 兜底信封（绝不混入真实装配）
function mockEmpty() {
  return { mock: true, sourceType: 'MOCK', data: [] }
}

describe('loadMarketAnalysis 数据来源分域', () => {
  beforeEach(() => {
    fetchCaptured.mockReset()
  })

  it('仅套餐私有 KPI 真实时不把公共页签标成真实', async () => {
    fetchCaptured.mockImplementation(async (family: string, key: string) => {
      if (family === 'market_retail_packages' && key === 'market_retail_package_metrics') {
        return {
          sourceType: 'IMPORT',
          data: [{ tab: 'packages', label: '套餐毛利', value: 0.031, unit: '元/kWh', tone: 'orange' }]
        }
      }
      return mockEmpty()
    })

    const result = await loadMarketAnalysis(2026)

    expect(result.hasRealData).toBe(true)
    expect(result.publicDataReal).toBe(false)
    expect(result.retailPackagesReal).toBe(false)
    expect(result.retailPackagesPartialReal).toBe(true)
    expect(result.retailPackageMetricsReal).toBe(true)
  })

  // #2991 回归锚点：「任一数据集真实 → 其余字段回落示例」的旧实现在此用例下会失败——
  // 旧实现会把 318 家、856.2/286.4/116 求和出的 1258.6 亿kWh、示例份额顶着 captured 徽章返回。
  it('仅 market_price 真实时其余字段全部为空，不出现任何示例值', async () => {
    fetchCaptured.mockImplementation(async (family: string, key: string) => {
      if (family === 'market_analysis' && key === 'market_price') {
        return capturedRows([
          { month: '1月', mediumLongPrice: 0.37, spotPrice: 0.41, retailPrice: 0.44, deviation: 0 },
          { month: '2月', mediumLongPrice: 0.38, spotPrice: 0.42, retailPrice: 0.45, deviation: 0.04 }
        ])
      }
      return mockEmpty()
    })

    const result = await loadMarketAnalysis(2026)

    // 页面级：有真实数据 → captured，但逐数据集真实性必须只有 market_price 为真
    expect(result.hasRealData).toBe(true)
    expect(result.basis).toBe('captured')
    expect(result.realByKey.market_price).toBe(true)
    for (const key of [
      'market_trade_summary', 'market_monthly_trend', 'market_generation', 'market_sales',
      'market_storage', 'market_metrics', 'market_packages', 'market_retail_package_metrics'
    ]) {
      expect(result.realByKey[key]).toBe(false)
    }

    // 无真实数据的字段一律空，绝不回落示例
    expect(result.dataset.tradeSummary).toEqual([])
    expect(result.dataset.monthlyTrend).toEqual([])
    expect(result.dataset.powerTypes).toEqual([])
    expect(result.dataset.generationDetails).toEqual([])
    expect(result.dataset.salesCompanies).toEqual([])
    expect(result.dataset.storageProjects).toEqual([])
    expect(result.dataset.retailPackages).toEqual([])
    // hourData 从无真实来源：部分真实场景恒为空
    expect(result.dataset.hourData).toEqual([])
    for (const metrics of ['overviewMetrics', 'generationMetrics', 'salesMetrics', 'storageMetrics', 'packageMetrics'] as const) {
      expect(result.dataset[metrics]).toEqual([])
    }

    // 真实字段来自真实行
    expect(result.dataset.priceTrend).toHaveLength(2)
    expect(result.dataset.priceTrend[0]).toMatchObject({ month: '1月', mediumLongPrice: 0.37, spotPrice: 0.41 })

    // 整个结果不得出现硬编码示例值（318 家对手；856.2+286.4+116=1258.6 亿kWh 求和示例）
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('318')
    expect(serialized).not.toContain('1258.6')
    expect(serialized).not.toContain('856.2')
    expect(serialized).not.toContain('286.4')
    expect(serialized).not.toContain('116')

    // 页签口径：price captured；其余页签无真实数据 → empty（诚实空态，不是模拟数据，也不得用整页 basis 顶包）
    expect(result.sectionBasis.price).toBe('captured')
    expect(result.sectionBasis.overview).toBe('empty')
    expect(result.sectionBasis.generation).toBe('empty')
    expect(result.sectionBasis.sales).toBe('empty')
    expect(result.sectionBasis.storage).toBe('empty')
    expect(result.sectionBasis.packages).toBe('empty')
    expect(Object.values(result.sectionPartial).some(Boolean)).toBe(false)
  })

  it('全部公共键真实时各字段来自真实行，页面级 basis 为 captured', async () => {
    fetchCaptured.mockImplementation(async (family: string, key: string) => {
      if (family !== 'market_analysis') return mockEmpty()
      if (key === 'market_trade_summary') {
        return capturedRows([
          { tradeType: '中长期真实', quantity: 100, avgPrice: 0.4, tradeCount: 10 },
          { tradeType: '现货真实', quantity: 50, avgPrice: 0.5, tradeCount: 5 }
        ])
      }
      if (key === 'market_monthly_trend') {
        return capturedRows([{ month: '1月', quantity: 10, avgPrice: 0.4, mediumLong: 6, spot: 3, ancillary: 1 }])
      }
      if (key === 'market_generation') {
        return capturedRows([
          { name: '风电场X', quantity: 30, avgPrice: 0.38, count: 3, percentage: 0 },
          { name: '明细电厂X', quantity: 20, avgPrice: 0.4, count: 2, percentage: 0, category: 'detail' }
        ])
      }
      if (key === 'market_sales') return capturedRows([{ name: '售电公司X', quantity: 40, avgPrice: 0.45, count: 4, percentage: 0 }])
      if (key === 'market_storage') return capturedRows([{ name: '储能站X', quantity: 12, avgPrice: 0.55, count: 2, percentage: 0 }])
      if (key === 'market_price') return capturedRows([{ month: '1月', mediumLongPrice: 0.37, spotPrice: 0.41, retailPrice: 0.44, deviation: 0 }])
      if (key === 'market_metrics') {
        return capturedRows([{ tab: 'overview', label: '真实交易对手', value: 66, unit: '个', tone: 'purple' }])
      }
      return mockEmpty()
    })

    const result = await loadMarketAnalysis(2026)

    expect(result.hasRealData).toBe(true)
    expect(result.basis).toBe('captured')
    for (const key of [
      'market_trade_summary', 'market_monthly_trend', 'market_generation', 'market_sales',
      'market_storage', 'market_price', 'market_metrics'
    ]) {
      expect(result.realByKey[key]).toBe(true)
    }

    expect(result.dataset.tradeSummary.map((r) => r.tradeType)).toEqual(['中长期真实', '现货真实'])
    // withPercent 重算占比：100/(100+50)
    expect(result.dataset.tradeSummary[0].percentage).toBeCloseTo(66.7, 1)
    expect(result.dataset.powerTypes.map((r) => r.name)).toEqual(['风电场X'])
    expect(result.dataset.generationDetails.map((r) => r.name)).toEqual(['明细电厂X'])
    expect(result.dataset.salesCompanies.map((r) => r.name)).toEqual(['售电公司X'])
    expect(result.dataset.storageProjects.map((r) => r.name)).toEqual(['储能站X'])
    expect(result.dataset.monthlyTrend[0]).toMatchObject({ month: '1月', quantity: 10 })
    expect(result.dataset.priceTrend[0]).toMatchObject({ month: '1月', spotPrice: 0.41 })
    expect(result.dataset.overviewMetrics).toEqual([{ label: '真实交易对手', value: 66, unit: '个', tone: 'purple' }])
    // 套餐私有族无真实回放 → 空而不是示例；hourData 恒空
    expect(result.dataset.retailPackages).toEqual([])
    expect(result.dataset.packageMetrics).toEqual([])
    expect(result.dataset.hourData).toEqual([])

    // 公共页签 captured；套餐两键全缺但月度趋势真实 → captured + 部分缺失（套餐明细与 KPI 为空）
    expect(result.sectionBasis.overview).toBe('captured')
    expect(result.sectionBasis.generation).toBe('captured')
    expect(result.sectionBasis.sales).toBe('captured')
    expect(result.sectionBasis.storage).toBe('captured')
    expect(result.sectionBasis.price).toBe('captured')
    expect(result.sectionBasis.packages).toBe('captured')
    expect(result.sectionPartial.packages).toBe(true)
    expect(result.dataset.retailPackages).toEqual([])
  })

  it('全部数据集不真实时保持整页示例 + synthetic 旧行为', async () => {
    fetchCaptured.mockImplementation(async () => mockEmpty())

    const result = await loadMarketAnalysis(2026)

    expect(result.hasRealData).toBe(false)
    expect(result.basis).toBe('synthetic')
    expect(result.publicDataReal).toBe(false)
    // 整页示例完整返回（配合页面可见「模拟数据」提示，合规）
    expect(result.dataset.tradeSummary.length).toBeGreaterThan(0)
    expect(result.dataset.monthlyTrend.length).toBe(12)
    expect(result.dataset.overviewMetrics.some((m) => m.value === 318)).toBe(true)
    expect(result.dataset.hourData.length).toBe(24)
    // 逐键全 false，页签口径全 synthetic
    for (const real of Object.values(result.realByKey)) {
      expect(real).toBe(false)
    }
    for (const basis of Object.values(result.sectionBasis)) {
      expect(basis).toBe('synthetic')
    }
  })

  it('页签部分数据集真实时标 captured 并给出部分缺失标记，缺失部分为空', async () => {
    fetchCaptured.mockImplementation(async (family: string, key: string) => {
      if (family === 'market_analysis' && key === 'market_trade_summary') {
        return capturedRows([{ name: '中长期', quantity: 100, avgPrice: 0.4, count: 3, percentage: 0 }])
      }
      if (family === 'market_analysis' && key === 'market_price') {
        return capturedRows([{ month: '1月', mediumLongPrice: 0.37, spotPrice: 0.41, retailPrice: 0.44, deviation: 0 }])
      }
      return mockEmpty()
    })
    const result = await loadMarketAnalysis(2026)
    expect(result.sectionBasis.overview).toBe('captured')
    expect(result.sectionPartial.overview).toBe(true)
    expect(result.dataset.monthlyTrend).toEqual([])
    expect(result.dataset.overviewMetrics).toEqual([])
    expect(result.sectionBasis.price).toBe('captured')
    expect(result.sectionPartial.price).toBe(false)
    expect(result.sectionBasis.sales).toBe('empty')
    expect(result.sectionPartial.sales).toBe(false)
  })

  it('KPI 只到了部分页签、月度趋势缺失时，相关页签标部分缺失而不是全真实', async () => {
    fetchCaptured.mockImplementation(async (family: string, key: string) => {
      if (family !== 'market_analysis') return mockEmpty()
      if (key === 'market_generation') return capturedRows([{ name: '水电', quantity: 50, avgPrice: 0.3, count: 5, percentage: 0 }])
      if (key === 'market_metrics') return capturedRows([{ tab: 'overview', label: '真实交易对手', value: 66, unit: '个', tone: 'purple' }])
      return mockEmpty()
    })
    const result = await loadMarketAnalysis(2026)
    // 发电页签：分类真实，但本页签没有 KPI 行、月度趋势也没到 → captured + 部分缺失
    expect(result.sectionBasis.generation).toBe('captured')
    expect(result.sectionPartial.generation).toBe(true)
    expect(result.dataset.generationMetrics).toEqual([])
    expect(result.dataset.monthlyTrend).toEqual([])
    // 售电页签：只有别的页签的 KPI 行，自己什么都没有 → empty
    expect(result.sectionBasis.sales).toBe('empty')
  })
})
