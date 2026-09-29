import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Tags from './ForecastProvenanceTags.vue'

const ElTag = { template: '<span class="el-tag"><slot /></span>' }
const render = (props: Record<string, unknown>) => mount(Tags, { props, global: { stubs: { ElTag } } })

describe('ForecastProvenanceTags', () => {
  it('mock 显示「模拟数据」，warnings 显示条数并把全文放悬浮提示', () => {
    const w = render({ provenance: { mock: true, sourceType: 'MOCK', warnings: ['甲', '乙'] } })
    expect(w.find('.fp-mock').text()).toBe('模拟数据')
    expect(w.find('.fp-warn').text()).toBe('提示 2')
    expect(w.find('.fp-warn').attributes('title')).toBe('甲\n乙')
  })
  it('hideWarnings 时只留来源标签', () => {
    const w = render({ provenance: { mock: true, warnings: ['甲'] }, hideWarnings: true })
    expect(w.find('.fp-mock').exists()).toBe(true)
    expect(w.find('.fp-warn').exists()).toBe(false)
  })
  it('MIXED 显示「混合来源」，但已是 mock 时不重复', () => {
    expect(render({ provenance: { sourceType: 'MIXED' } }).find('.fp-mixed').text()).toBe('混合来源')
    expect(render({ provenance: { mock: true, sourceType: 'MIXED' } }).find('.fp-mixed').exists()).toBe(false)
  })
  it('REAL/无字段/未传 provenance 时什么都不渲染', () => {
    for (const provenance of [{ mock: false, sourceType: 'REAL', warnings: [] }, {}, undefined, null]) {
      expect(render({ provenance }).find('.fp-tags').exists()).toBe(false)
    }
  })
})
