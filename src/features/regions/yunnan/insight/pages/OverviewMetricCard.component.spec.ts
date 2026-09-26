import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import OverviewMetricCard from './OverviewMetricCard.vue'

function render(mean: string, low: string, high: string) {
  return mount(OverviewMetricCard, { props: { card: {
    key: 'price', title: '用户侧实时价', eligibility: '有效覆盖 50%；不参与排名',
    rows: [
      { metricId: 'price.time-weighted-average', label: '均价', text: mean, unit: '元/MWh', note: '' },
      { metricId: 'price.minimum', label: '最低', text: low, unit: '元/MWh', note: '02:00 出现' },
      { metricId: 'price.maximum', label: '最高', text: high, unit: '元/MWh', note: '18:00 出现' },
    ],
  } } })
}

describe('总览区间呈现', () => {
  it('负值区间定位均值，极值出现时间留在默认收起的明细，资格常显', () => {
    const wrapper = render('0', '-100', '300')
    expect(wrapper.get('.overview-metric__track i').attributes('style')).toContain('25%')
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(wrapper.get('details').text()).toContain('02:00 出现')
    expect(wrapper.get('.overview-metric__eligibility').text()).toContain('不参与排名')
    wrapper.unmount()
  })
  it.each([['—', '0', '100'], ['50', '—', '100'], ['50', '100', '0']])('缺失或倒置区间不伪造可视化 %s/%s/%s', (mean, low, high) => {
    const wrapper = render(mean, low, high)
    expect(wrapper.find('.overview-metric__range').exists()).toBe(false)
    wrapper.unmount()
  })
  it('恒定区间居中，千位分隔正确解析', () => {
    const wrapper = render('1,000', '1,000', '1,000')
    expect(wrapper.get('.overview-metric__track i').attributes('style')).toContain('50%')
    wrapper.unmount()
  })
})
