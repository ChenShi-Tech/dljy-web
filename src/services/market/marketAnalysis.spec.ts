import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchCaptured = vi.hoisted(() => vi.fn())

vi.mock('@/services/captured', () => ({ fetchCaptured }))

import { loadMarketAnalysis } from './marketAnalysis'

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
      return { mock: true, sourceType: 'MOCK', data: [] }
    })

    const result = await loadMarketAnalysis(2026)

    expect(result.hasRealData).toBe(true)
    expect(result.publicDataReal).toBe(false)
    expect(result.retailPackagesReal).toBe(false)
    expect(result.retailPackagesPartialReal).toBe(true)
    expect(result.retailPackageMetricsReal).toBe(true)
  })
})
