import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarketPriceAnalysisPanel from './MarketPriceAnalysisPanel.vue'
import type { MarketPriceResult } from '@/services/review/marketPrices'
const api = vi.hoisted(() => ({ fetchMarketPrices: vi.fn(), captureMarketPrices: vi.fn(), setOption: vi.fn() }))
vi.mock('@/services/review/marketPrices', () => api)
vi.mock('@/composables/useEChart', () => ({ useEChart: () => ({ setOption: api.setOption }) }))
const selection = { plant: '测试厂站', node: '测试节点' }
const point = (hour: string) => ({ start: `2026-05-31T${hour}:00:00+08:00`, end: `2026-05-31T${String(Number(hour) + 1).padStart(2, '0')}:00:00+08:00`, durationMinutes: 60, baselineMwh: null, actualMwh: null, differenceMwh: null, daPrice: 200, rtPrice: 100 })
const prices = { daAverage: 200, rtAverage: 100, spreadAverage: 100, comparableMinutes: 120 }
const result: MarketPriceResult = { periods: { current: { start: '2026-05-31', end: '2026-05-31' }, reference: { start: '2026-05-24', end: '2026-05-24' }, incomplete: false }, subjects: [selection], selection, notice: '小时节点资料，不扩为96点', analysis: {
  intervals: [point('00'), point('02')], anomalies: [], priceAnomalies: [point('00'), point('02')], prices, energy: { baselineMwh: null, actualMwh: null, netDeviationMwh: null, absoluteDeviationMwh: null, absoluteDeviationPct: null }, coverage: { expectedMinutes: 1440, observedMinutes: 120, comparableMinutes: 0, ratio: 0 }, notice: '', methodology: '', simulated: false,
  comparison: { coverage: { priceMinutes: 60, alignedMinutes: 60 }, current: { prices }, reference: { prices }, changes: { daPrice: 10, rtPrice: 5, spread: 5 } },
} }
beforeEach(() => {
  vi.resetAllMocks()
  api.fetchMarketPrices.mockImplementation(async (_company, input) => input.selection ? result : { ...result, selection: null, analysis: null })
  api.captureMarketPrices.mockResolvedValue({ id: 'saved-material' })
})
async function open() {
  const wrapper = mount(MarketPriceAnalysisPanel, { props: { company: 'company-a', region: 'yunnan', date: '2026-05-31' } })
  await flushPromises()
  await wrapper.get('select[aria-label="价格分析对象"]').setValue(JSON.stringify(selection))
  await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click'); await flushPromises()
  return wrapper
}
describe('独立价格资料专题', () => {
  it('必须选节点后统计，缺时段断线，取材使用已完成的同一范围', async () => {
    const wrapper = await open()
    expect(api.fetchMarketPrices.mock.calls[0][1]).not.toHaveProperty('selection')
    expect(wrapper.text()).toContain('日前均价')
    expect(api.setOption.mock.calls.at(-1)![0].series[0].data).toEqual([200, null, 200])
    await wrapper.findAll('button').find(button => button.text() === '加入复盘底稿')!.trigger('click'); await flushPromises()
    expect(api.captureMarketPrices).toHaveBeenCalledWith('company-a', expect.objectContaining({ selection, period: expect.objectContaining({ date: '2026-05-31' }) }))
    expect(wrapper.emitted('material')![0][0]).toEqual({ id: 'saved-material' })
  })
  it('多选异常重新请求所选时段，修改日期后不展示旧统计', async () => {
    const wrapper = await open()
    await wrapper.find('.intervals input[type=checkbox]').setValue(true); await flushPromises()
    expect(api.fetchMarketPrices).toHaveBeenLastCalledWith('company-a', expect.objectContaining({ selections: [point('00').start] }), expect.any(AbortSignal))
    await wrapper.get('input[aria-label="价格分析日期"]').setValue('2026-06-01')
    expect(wrapper.text()).not.toContain('日前均价')
    expect(wrapper.text()).not.toContain('加入复盘底稿')
  })
  it('独立打开后先核对授权节点，再恢复完整曲线和选区统计', async () => {
    const wrapper = mount(MarketPriceAnalysisPanel, { props: { company: 'company-a', region: 'yunnan', date: '2026-05-31', selection: { date: '2026-05-31', cadence: 'month', manual: false, referenceStart: '', referenceEnd: '', plant: selection.plant, node: selection.node, threshold: '0', intervals: [point('00').start] } } })
    await flushPromises()
    expect(api.fetchMarketPrices.mock.calls[0][1]).not.toHaveProperty('selection')
    expect(api.fetchMarketPrices.mock.calls[1][1]).not.toHaveProperty('selections')
    expect(api.fetchMarketPrices).toHaveBeenLastCalledWith('company-a', expect.objectContaining({ selection, selections: [point('00').start], thresholds: { spreadYuan: 0 }, period: expect.objectContaining({ cadence: 'month' }) }), expect.any(AbortSignal))
    expect(api.setOption.mock.calls.at(-1)![0].series[0].data).toEqual([200, null, 200])
    expect(wrapper.text()).toContain('清除所选时段')
  })
  it('公司切换后旧响应不回填，错误不展示内部信息', async () => {
    const wrapper = await open()
    let resolve!: (value: MarketPriceResult) => void
    api.fetchMarketPrices.mockImplementation(() => new Promise(done => { resolve = done }))
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click')
    await wrapper.setProps({ company: 'company-b' }); resolve(result); await flushPromises()
    expect(wrapper.text()).not.toContain('日前均价')
    api.fetchMarketPrices.mockRejectedValue(new Error('raw.capture_row'))
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).not.toContain('raw.capture_row')
    expect(wrapper.text()).toContain('价格统计未完成')
  })
})
