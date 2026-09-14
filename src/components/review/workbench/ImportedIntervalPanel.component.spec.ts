import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImportedIntervalPanel from './ImportedIntervalPanel.vue'
const api = vi.hoisted(() => ({ analyzeImportedIntervals: vi.fn(), captureImportedIntervals: vi.fn() }))
vi.mock('@/services/review/importedIntervals', () => api)
const choice = { seriesKey: 'a'.repeat(64), objectId: '测试对象', basisLabel: '申报电量', actualLabel: '实际电量' }
const periods = { current: { start: '2026-05-31', end: '2026-05-31' }, reference: { start: '2026-05-24', end: '2026-05-24' } }
const catalog = { choices: [choice], periods, source: { mock: false, version: '一' }, notice: '人工资料', analysis: null }
const point = { start: '2026-05-30T16:00:00Z', end: '2026-05-30T16:15:00Z' }
const data = { ...catalog, input: { scope: { objectId: 'imported:one' }, period: { date: '2026-05-31' } }, labels: ['申报电量', '实际电量'], analysis: { periods, energy: { netDeviationMwh: -1, absoluteDeviationMwh: 1 }, coverage: { comparableMinutes: 15, expectedMinutes: 1440 }, anomalies: [point], prices: {} } }
const props = { company: 'one', region: 'yunnan', view: 'generator' as const, date: '2026-05-31', topic: 'energy' as const }
const create = () => mount(ImportedIntervalPanel, { props, global: { stubs: { ReportEvidenceChart: true } } })
async function open(wrapper: ReturnType<typeof create>) { (wrapper.get('details').element as HTMLDetailsElement).open = true; await wrapper.get('details').trigger('toggle'); await flushPromises() }
beforeEach(() => { vi.resetAllMocks(); api.analyzeImportedIntervals.mockResolvedValue(catalog) })
describe('已导入分时资料分析', () => {
  it('按当前公司读取目录，选择对象后重新统计，所选时段通过服务端取材', async () => {
    const wrapper = create(); expect(api.analyzeImportedIntervals).not.toHaveBeenCalled()
    await open(wrapper)
    expect(api.analyzeImportedIntervals).toHaveBeenCalledWith('one', expect.objectContaining({ region: 'yunnan', view: 'generator', simulated: false }))
    await wrapper.findAll('select')[2]!.setValue(JSON.stringify([choice.seriesKey, choice.objectId]))
    api.analyzeImportedIntervals.mockResolvedValue(data)
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('净偏差 -1')
    await wrapper.get('input[type=checkbox]').setValue(true)
    api.captureImportedIntervals.mockResolvedValue({ id: 'material' })
    await wrapper.findAll('button').find(button => button.text().includes('加入报告'))!.trigger('click'); await flushPromises()
    expect(api.captureImportedIntervals).toHaveBeenCalledWith('one', expect.objectContaining({ seriesKey: choice.seriesKey, objectId: choice.objectId, selections: [point.start] }))
    expect(wrapper.emitted('material')?.[0]).toEqual([{ id: 'material' }])
    wrapper.unmount()
  })
  it('切换公司后不接收上一个公司的迟到目录', async () => {
    let resolve!: (value: typeof catalog) => void
    api.analyzeImportedIntervals.mockImplementation(() => new Promise(done => { resolve = done }))
    const wrapper = create(); await open(wrapper)
    await wrapper.setProps({ company: 'two' }); resolve(catalog); await flushPromises()
    expect(wrapper.text()).not.toContain('测试对象')
    expect(wrapper.find('report-evidence-chart-stub').exists()).toBe(false)
    wrapper.unmount()
  })
  it('模拟模式醒目标记且不沿用业务资料目录', async () => {
    const wrapper = create(); await open(wrapper)
    await wrapper.findAll('select')[0]!.setValue('true')
    expect(wrapper.text()).toContain('模拟数据，仅供演练')
    expect(wrapper.text()).not.toContain('测试对象')
    wrapper.unmount()
  })
})
