// 风险事件库与压力测试面板组件测试（#2047 主路径：触发清单/压测真引擎/评级/near_miss）
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/review/reviewPeriodClient', () => ({ fetchReviewRange: vi.fn() }))
vi.mock('@/services/quant/quantClient', () => ({ fetchCvar: vi.fn() }))
vi.mock('@/services/tradingMemory', () => ({ getRegionWinStats: vi.fn() }))
vi.mock('@/services/region/regionContext', () => ({ currentRegion: { value: { id: 'shanxi' } } }))

import { fetchReviewRange } from '@/services/review/reviewPeriodClient'
import { fetchCvar } from '@/services/quant/quantClient'
import { getRegionWinStats } from '@/services/tradingMemory'
import RiskReviewPanel from './RiskReviewPanel.vue'
import { mount } from '@/test/mount'

function okDay(date: string, spreadPnl: number | null, devPct = 0.02) {
  return {
    ok: true as const, date, declaredTotalMwh: 1000, causeId: null, causeLabel: null,
    result: {
      deviation: { points: 1, total_abs_deviation_mwh: devPct * 1000, assessed_mwh: 5, estimated_penalty_yuan: 500, tolerance_pct: 3, worst_point: { datetime: date, deviation: 1 } },
      backtest: { da_revenue_yuan: 1, avg_da_price: 1, da_rt_spread_pnl_yuan: spreadPnl ?? undefined, note: '' },
      detail: [
        { datetime: `${date} 00:15`, declared: 10, actual: 10, da_price: 100, rt_price: 105 },
        { datetime: `${date} 00:30`, declared: 10, actual: 10, da_price: 100, rt_price: 95 }
      ]
    }
  }
}

beforeEach(() => {
  vi.mocked(fetchReviewRange).mockReset()
  vi.mocked(fetchCvar).mockReset()
  vi.mocked(getRegionWinStats).mockReset()
})

async function settle(wrapper: ReturnType<typeof mount>) {
  for (let i = 0; i < 8; i++) await nextTick()
  return wrapper
}

describe('RiskReviewPanel', () => {
  it('触发清单+压测主路径：连续超标 red、CVaR 真引擎指标、评级选择', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({
      days: [okDay('2026-08-01', -100, 0.06), okDay('2026-08-02', -50, 0.07), okDay('2026-08-03', -80, 0.01), okDay('2026-08-04', null, 0.02)],
      missingDays: []
    })
    vi.mocked(fetchCvar).mockResolvedValue({
      var_95: 0.05, var_99: 0.08, cvar_95: 0.07, cvar_99: 0.1, max_drawdown: 0.12,
      volatility: 0.35, sharpe_ratio: 1.2, sortino_ratio: 1.5, tail_risk: 0.1,
      policy_source: '权威引擎：历史模拟法'
    })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    const wrapper = await settle(mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    const text = wrapper.text()
    expect(text).toContain('偏差率连续 2 日超 5%')
    expect(text).toContain('价差盈亏连续 3 日为负')
    expect(text).toContain('VaR95')
    expect(text).toContain('5.00%')
    expect(text).toContain('决策参考，非结算依据')
    expect(text).toContain('承受能力评级')
    expect(text).toContain('near_miss')
  })

  it('无越限：负例文案（未越限不生成待办）', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [okDay('2026-08-01', 100, 0.02)], missingDays: [] })
    vi.mocked(fetchCvar).mockResolvedValue({
      var_95: 0.05, var_99: 0.08, cvar_95: 0.07, cvar_99: 0.1, max_drawdown: 0.12,
      volatility: 0.35, sharpe_ratio: 1.2, sortino_ratio: 1.5, tail_risk: 0.1
    })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    const wrapper = await settle(mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('无越限触发')
    expect(wrapper.text()).toContain('止损仓位越限：待数据接入')
  })

  it('near_miss 登记草稿确认不落库', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [], missingDays: [] })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    const wrapper = await settle(mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    await wrapper.find('.rrp-save').trigger('click')
    expect(wrapper.text()).toContain('已记为本地草稿')
    expect(wrapper.text()).toContain('不计损失金额统计')
  })
})
