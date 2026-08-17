// 复盘三问结论条组件测试（Epic #2033 · M1 · #2040）
// 验收：只读三问、空态齐全（无昨单/出清未登记/无昨日记录/立场未知中性措辞不猜）。
import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import ReviewThreeQuestions from './ReviewThreeQuestions.vue'
import { mount } from '@/test/mount'

const FULL = {
  reviewedDate: '2026-08-14',
  hasReviewed: true,
  clearRate: 0.92,
  deviationMwh: 12.5,
  deviationPct: 0.031,
  prevDeviationMwh: 20,
  prevReviewedDate: '2026-08-13',
  pnl: { daRevenueYuan: 123456, spreadPnlYuan: -2400 },
  position: null
}

describe('ReviewThreeQuestions（复盘三问结论条）', () => {
  it('三问齐全：中标率/偏差环比/回测收益，数字只读呈现', () => {
    const wrapper = mount(ReviewThreeQuestions, { props: { ...FULL } })
    const text = wrapper.text()
    expect(text).toContain('① 成交没成交')
    expect(text).toContain('92.0%')
    expect(text).toContain('② 偏差怎么样')
    expect(text).toContain('12.50 MWh')
    expect(text).toContain('3.10%')
    // 环比昨日：12.5-20 = -7.5（收窄，绿）
    expect(text).toContain('-7.50 MWh')
    expect(text).toContain('收窄')
    expect(text).toContain('③ 回测收益怎么样')
    expect(text).toContain('-2,400 元')
    expect(text).toContain('123,456 元')
  })

  it('立场两态：售电→购电成本措辞，电厂→售电收入措辞', () => {
    const retail = mount(ReviewThreeQuestions, { props: { ...FULL, position: 'RETAILER' } })
    expect(retail.text()).toContain('③ 购电成本怎么样')
    expect(retail.text()).toContain('购电支出')
    const gen = mount(ReviewThreeQuestions, { props: { ...FULL, position: 'GENERATOR' } })
    expect(gen.text()).toContain('③ 售电收入怎么样')
    expect(gen.text()).toContain('日前卖出优于实时')
  })

  it('身份未知（#2005 未接线）→ 中性措辞，不猜方向', () => {
    const wrapper = mount(ReviewThreeQuestions, { props: { ...FULL, position: null } })
    expect(wrapper.text()).toContain('③ 回测收益怎么样')
    expect(wrapper.text()).toContain('立场未接入')
  })

  it('空态：无昨单/出清未登记/昨日未记录/无回测', () => {
    const wrapper = mount(ReviewThreeQuestions, {
      props: { ...FULL, hasReviewed: false, clearRate: null, deviationMwh: null, deviationPct: null, prevDeviationMwh: null, pnl: null }
    })
    const text = wrapper.text()
    expect(text).toContain('无申报单，无从谈起')
    expect(text).toContain('无昨单，无基准')
    expect(text).toContain('回测未取到')
  })

  it('空态：有昨单但实际电量未取到 → 「实际电量未取到」', () => {
    const wrapper = mount(ReviewThreeQuestions, {
      props: { ...FULL, deviationMwh: null, deviationPct: null }
    })
    expect(wrapper.text()).toContain('实际电量未取到')
  })

  it('空态：偏差有值但昨日未记录 → 环比缺席', () => {
    const wrapper = mount(ReviewThreeQuestions, {
      props: { ...FULL, prevDeviationMwh: null }
    })
    expect(wrapper.text()).toContain('未记录，环比缺席')
  })

  it('偏差扩大走红字（环比方向相反）', () => {
    const wrapper = mount(ReviewThreeQuestions, {
      props: { ...FULL, deviationMwh: 30, prevDeviationMwh: 20 }
    })
    expect(wrapper.text()).toContain('+10.00 MWh')
    expect(wrapper.text()).toContain('扩大')
  })

  it('有昨单但出清未登记 → 中标率区显示「出清未登记」', () => {
    const wrapper = mount(ReviewThreeQuestions, { props: { ...FULL, clearRate: null } })
    expect(wrapper.text()).toContain('出清未登记')
  })
})
