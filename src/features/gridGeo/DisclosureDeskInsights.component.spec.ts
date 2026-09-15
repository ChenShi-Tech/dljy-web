import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DisclosureDeskInsights from './DisclosureDeskInsights.vue'
import { getDisclosureDeskMetric, type DeskDataResult } from './disclosureDeskData'

const { load } = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./disclosureDeskData', async (original) => ({ ...await original<typeof import('./disclosureDeskData')>(), loadDisclosureDeskSeries: load }))
const props = { regionId: 'yunnan', scopeKey: 'yunnan:company-a', dateFrom: '2026-07-01', dateTo: '2026-07-01', selection: null, refreshKey: 0 }
function data(id: string, value = 20): DeskDataResult { return { metric: getDisclosureDeskMetric(id)!, series: [{ id: id === 'price' ? 'spread' : 'deviation', label: '差值', nativeMinutes: id === 'price' ? 60 : 15, step: false, unit: id === 'price' ? '元/MWh' : 'MW', points: [{ time: '2026-07-01 10:00', value }] }], channels: [], status: 'available', reason: '', sourceType: 'DB', latestAt: null, summary: [], warnings: [] } }
beforeEach(() => { vi.resetAllMocks(); load.mockImplementation(({ metricId }) => Promise.resolve(data(metricId))) })

describe('选区摘要读取与定位', () => {
  it('选区变化复用样本不重读，点击发出原始指标与时段，刷新重新读取', async () => {
    const wrapper = mount(DisclosureDeskInsights, { props })
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(4)
    await wrapper.get('[data-testid="desk-insight-price:difference"]').trigger('click')
    expect(wrapper.emitted('focus')?.[0][0]).toMatchObject({ metricId: 'price', from: '2026-07-01T10:00:00.000+08:00', to: '2026-07-01T10:59:59.999+08:00' })
    await wrapper.setProps({ selection: { from: '2026-07-01T12:00:00+08:00', to: '2026-07-01T12:59:59+08:00' } })
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(load).toHaveBeenCalledTimes(4)
    await wrapper.setProps({ refreshKey: 1 }); await flushPromises()
    expect(load).toHaveBeenCalledTimes(8)
    wrapper.unmount()
  })
  it('公司或地区切换清空旧内容，旧响应无法覆盖新结果', async () => {
    const pending: Array<() => void> = []
    load.mockImplementation(({ metricId }) => new Promise((resolve) => pending.push(() => resolve(data(metricId, 999)))))
    const wrapper = mount(DisclosureDeskInsights, { props })
    load.mockImplementation(({ metricId }) => Promise.resolve(data(metricId, 7)))
    await wrapper.setProps({ scopeKey: 'yunnan:company-b' }); await flushPromises()
    expect(wrapper.text()).toContain('+7')
    pending.forEach((resolve) => resolve()); await flushPromises()
    expect(wrapper.text()).not.toContain('999')
    expect(wrapper.text()).toContain('+7')
    wrapper.unmount()
  })
  it('单项失败不丢掉其他摘要，缺少对齐样本与权限限制均明确说明', async () => {
    load.mockImplementation(({ metricId }) => metricId === 'price' ? Promise.reject(new Error('network')) : Promise.resolve(metricId === 'load' ? { ...data(metricId), series: [] } : metricId === 'non-market' ? { ...data(metricId), status: 'unauthorized', reason: '当前账号无权限' } : data(metricId)))
    const wrapper = mount(DisclosureDeskInsights, { props }); await flushPromises()
    expect(wrapper.findAll('button')).toHaveLength(1)
    expect(wrapper.text()).toContain('电价：读取失败')
    expect(wrapper.text()).toContain('当前账号无权限')
    expect(wrapper.text()).toContain('统调负荷：所选范围缺少可比较')
    wrapper.unmount()
  })
})
