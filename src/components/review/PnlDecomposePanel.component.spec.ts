// 收益三层拆解面板组件测试（#2043 主路径：瀑布真数据 / 分时段 / 环比强制归因 / Top5 人填）
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/review/reviewPeriodClient', () => ({ fetchReviewRange: vi.fn() }))

import { fetchReviewRange } from '@/services/review/reviewPeriodClient'
import PnlDecomposePanel from './PnlDecomposePanel.vue'
import { mount } from '@/test/mount'
import type { SettlementRuleSpec } from '@/rules/types'

const spec = {
  regionId: 'test', version: 'v0', effectiveness: 'trial', deviationTolerancePct: 3,
  assessmentPriceBasis: 'da', assessmentPriceFloor: 0,
  timeSegmentFactors: [{ segment: '峰', hours: [11], factor: 1.2 }],
  recycleSubjects: [], notes: [], references: []
} as unknown as SettlementRuleSpec

function okDay(date: string, da: number, rt: number) {
  return {
    ok: true as const, date, declaredTotalMwh: 10, causeId: null, causeLabel: null,
    result: {
      deviation: { points: 1, total_abs_deviation_mwh: 1, assessed_mwh: 0, estimated_penalty_yuan: 0, tolerance_pct: 3, worst_point: { datetime: date, deviation: 0 } },
      detail: [
        { datetime: `${date} 00:15`, declared: 10, actual: 10, da_price: da, rt_price: rt },
        { datetime: `${date} 11:15`, declared: 5, actual: 5, da_price: da, rt_price: rt }
      ]
    }
  }
}

beforeEach(() => {
  vi.mocked(fetchReviewRange).mockReset()
})

async function settle(wrapper: ReturnType<typeof mount>) {
  for (let i = 0; i < 6; i++) await nextTick()
  return wrapper
}

describe('PnlDecomposePanel', () => {
  it('月度主路径：瀑布出真数（日前/实时增量）、分时段表、Top5 表（人填栏）', async () => {
    // 第一次调用=本月，第二次=上月（环比基线）
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 300, 310), okDay('2026-08-02', 500, 480)], missingDays: [] })
      .mockResolvedValueOnce({ days: [okDay('2026-07-01', 300, 310)], missingDays: [] })
    const wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    const text = wrapper.text()
    expect(text).toContain('收益三层拆解 · 分品种')
    expect(text).toContain('现货·日前')       // PnLWaterfall 真数据段
    expect(text).toContain('现货·实时增量')
    expect(text).toContain('中长期')           // 未接入标注行
    expect(text).toContain('分时段')
    expect(text).toContain('峰')
    expect(text).toContain('单笔 Top5 盈亏榜')
    expect(text).toContain('以日为笔')
    expect(text).toContain('主要成因')         // 人填栏
    expect(text).toContain('决策参考，非结算依据')
  })

  it('环比超 20% → 强制归因提示；上期无数据 → 不强制', async () => {
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 500, 500)], missingDays: [] })      // 本月 7500×2=15000×…大幅
      .mockResolvedValueOnce({ days: [okDay('2026-07-01', 100, 100)], missingDays: [] })      // 上月小
    let wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('变动超 20%')
    expect(wrapper.text()).toContain('必填')

    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 300, 310)], missingDays: [] })
      .mockResolvedValueOnce({ days: [], missingDays: [] })                                    // 上期无数据
    wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('上期无数据（不强制归因）')
  })

  it('本月无数据日 → 诚实空态', async () => {
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [], missingDays: [] })
      .mockResolvedValueOnce({ days: [], missingDays: [] })
    const wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('无可用数据日')
  })
})
