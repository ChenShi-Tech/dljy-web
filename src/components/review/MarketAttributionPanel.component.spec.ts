// 月度市场归因面板组件测试（#2046 主路径：四行呈现 / basis 标注 / 政策行无自动因果）
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/market/marketAnalysis', () => ({ loadMarketAnalysis: vi.fn() }))

import { loadMarketAnalysis } from '@/services/market/marketAnalysis'
import MarketAttributionPanel from './MarketAttributionPanel.vue'
import { mount } from '@/test/mount'
import type { MarketAnalysisResult } from '@/services/market/marketAnalysis'

const now = new Date()
const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
function prevMonthOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function fakeResult(basis: 'captured' | 'synthetic'): MarketAnalysisResult {
  return {
    basis,
    hasRealData: basis === 'captured',
    publicDataReal: basis === 'captured',
    retailPackagesReal: false,
    retailPackagesPartialReal: false,
    retailPackageDetailsReal: false,
    retailPackageMetricsReal: false,
    retailPackagesAccessDenied: false,
    dataset: {
      year: now.getFullYear(),
      overviewMetrics: [], generationMetrics: [], salesMetrics: [], storageMetrics: [], packageMetrics: [],
      tradeSummary: [], hourData: [], powerTypes: [], generationDetails: [], salesCompanies: [], storageProjects: [], retailPackages: [],
      monthlyTrend: [
        { month: prevMonthOf(curMonth), quantity: 1000, avgPrice: 400, mediumLong: 380, spot: 410, ancillary: 10 },
        { month: curMonth, quantity: 1200, avgPrice: 430, mediumLong: 385, spot: 445, ancillary: 12 }
      ],
      priceTrend: [
        { month: `${now.getFullYear()}-01`, mediumLongPrice: 380, spotPrice: 300, retailPrice: 320, deviation: 0 },
        { month: `${now.getFullYear()}-02`, mediumLongPrice: 380, spotPrice: 310, retailPrice: 330, deviation: 0 },
        { month: `${now.getFullYear()}-03`, mediumLongPrice: 380, spotPrice: 305, retailPrice: 325, deviation: 0 },
        { month: `${now.getFullYear()}-04`, mediumLongPrice: 380, spotPrice: 308, retailPrice: 328, deviation: 0 },
        { month: `${now.getFullYear()}-05`, mediumLongPrice: 380, spotPrice: 302, retailPrice: 322, deviation: 0 },
        { month: curMonth, mediumLongPrice: 380, spotPrice: 900, retailPrice: 920, deviation: 0 }
      ]
    }
  } as unknown as MarketAnalysisResult
}

beforeEach(() => {
  vi.mocked(loadMarketAnalysis).mockReset()
})

async function settle(wrapper: ReturnType<typeof mount>) {
  for (let i = 0; i < 6; i++) await nextTick()
  return wrapper
}

describe('MarketAttributionPanel', () => {
  it('四行主路径：价格/供需自动预填、政策行人工+无自动因果、异常事件识别', async () => {
    vi.mocked(loadMarketAnalysis).mockResolvedValue(fakeResult('captured'))
    const wrapper = await settle(mount(MarketAttributionPanel))
    const text = wrapper.text()
    expect(text).toContain('价格走势')
    expect(text).toContain('月现货均价 900.0')
    expect(text).toContain('供需形势')
    expect(text).toContain('量价齐升')
    expect(text).toContain('政策变化')
    expect(text).toContain('不做自动因果')
    expect(text).toContain('异常价格事件')
    expect(text).toContain(curMonth) // 异常月被点名
    expect(text).toContain('真实采集') // basis=captured 标注
  })

  it('synthetic 兜底 → 显式「不可作为复盘依据」', async () => {
    vi.mocked(loadMarketAnalysis).mockResolvedValue(fakeResult('synthetic'))
    const wrapper = await settle(mount(MarketAttributionPanel))
    expect(wrapper.text()).toContain('不可作为复盘依据')
  })

  it('取数失败 → 四行不出数不合成', async () => {
    vi.mocked(loadMarketAnalysis).mockRejectedValue(new Error('503 not_onboarded'))
    const wrapper = await settle(mount(MarketAttributionPanel))
    expect(wrapper.text()).toContain('取数失败')
    expect(wrapper.text()).toContain('不合成')
  })
})
