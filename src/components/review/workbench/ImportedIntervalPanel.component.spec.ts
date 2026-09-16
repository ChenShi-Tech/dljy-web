import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImportedIntervalPanel from './ImportedIntervalPanel.vue'
const api = vi.hoisted(() => ({ analyzeImportedIntervals: vi.fn(), captureImportedIntervals: vi.fn() }))
vi.mock('@/services/review/importedIntervals', () => api)
const choice = { seriesKey: 'a'.repeat(64), objectId: '测试对象', basisLabel: '申报电量', actualLabel: '实际电量' }
const periods = { current: { start: '2026-05-31', end: '2026-05-31' }, reference: { start: '2026-05-24', end: '2026-05-24' } }
const choiceB = { ...choice, objectId: '第二个对象' }
const otherSeries = { seriesKey: 'b'.repeat(64), objectId: '别的口径对象', basisLabel: '综合预测电量', actualLabel: '实际电量' }
const catalog = { choices: [choice], periods, source: { mock: false, version: '一' }, notice: '人工资料', analysis: null }
const multiCatalog = { ...catalog, choices: [choice, choiceB, otherSeries] }
const point = { start: '2026-05-30T16:00:00Z', end: '2026-05-30T16:15:00Z' }
const data = { ...catalog, input: { scope: { objectId: 'imported:one' }, period: { date: '2026-05-31' } }, labels: ['申报电量', '实际电量'], analysis: { periods, energy: { netDeviationMwh: -1, absoluteDeviationMwh: 1 }, coverage: { comparableMinutes: 15, expectedMinutes: 1440 }, anomalies: [point], prices: {} } }
const props = { company: 'one', region: 'yunnan', view: 'generator' as const, date: '2026-05-31', topic: 'energy' as const }
const create = () => mount(ImportedIntervalPanel, { props, global: { stubs: { ReportEvidenceChart: true } } })
async function open(wrapper: ReturnType<typeof create>) { (wrapper.get('details').element as HTMLDetailsElement).open = true; await wrapper.get('details').trigger('toggle'); await flushPromises() }
beforeEach(() => { vi.resetAllMocks(); api.analyzeImportedIntervals.mockResolvedValue(catalog) })
describe('已导入分时资料分析', () => {
  it('人工参考期必须完整，填写后随统计请求提交', async () => {
    const wrapper = create(); await open(wrapper)
    await wrapper.findAll('input[type=checkbox]')[0]!.setValue(true)
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click')
    expect(wrapper.text()).toContain('请填写完整且顺序正确的参考日期')
    const dates = wrapper.findAll('input[type=date]')
    await dates[1]!.setValue('2026-05-01'); await dates[2]!.setValue('2026-05-07')
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click'); await flushPromises()
    expect(api.analyzeImportedIntervals).toHaveBeenLastCalledWith('one', expect.objectContaining({ referencePeriod: { start: '2026-05-01', end: '2026-05-07' } }))
    wrapper.unmount()
  })
  it('按当前公司读取目录，选择对象后重新统计，所选时段通过服务端取材', async () => {
    const wrapper = create(); expect(api.analyzeImportedIntervals).not.toHaveBeenCalled()
    await open(wrapper)
    expect(api.analyzeImportedIntervals).toHaveBeenCalledWith('one', expect.objectContaining({ region: 'yunnan', view: 'generator', simulated: false }))
    await wrapper.findAll('select')[2]!.setValue(JSON.stringify([choice.seriesKey, choice.objectId]))
    api.analyzeImportedIntervals.mockResolvedValue(data)
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('净偏差 -1')
    await wrapper.findAll('input[type=checkbox]').at(-1)!.setValue(true)
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
  it('显示有限小数，并将人工筛选门槛同时传给统计与取材', async () => {
    const wrapper = create(); await open(wrapper)
    await wrapper.findAll('select')[2]!.setValue(JSON.stringify([choice.seriesKey, choice.objectId]))
    await wrapper.get('input[type=number]').setValue('10')
    api.analyzeImportedIntervals.mockResolvedValue({ ...data, analysis: { ...data.analysis, energy: { netDeviationMwh: -11.800000000000004, absoluteDeviationMwh: 15.659999999999993 } } })
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click'); await flushPromises()
    expect(api.analyzeImportedIntervals).toHaveBeenLastCalledWith('one', expect.objectContaining({ thresholds: { absolutePct: 10 } }))
    expect(wrapper.text()).toContain('净偏差 -11.8 MWh')
    expect(wrapper.text()).toContain('绝对偏差 15.66 MWh')
    expect(wrapper.text()).not.toContain('000000000004')
    expect(wrapper.text()).toContain('待核查时段')
    api.captureImportedIntervals.mockResolvedValue({ id: 'material' })
    await wrapper.findAll('button').find(button => button.text().includes('加入报告'))!.trigger('click'); await flushPromises()
    expect(api.captureImportedIntervals).toHaveBeenLastCalledWith('one', expect.objectContaining({ thresholds: { absolutePct: 10 }, expectedVersion: '一' }))
    await wrapper.get('input[type=number]').setValue('-1')
    const calls = api.analyzeImportedIntervals.mock.calls.length
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click'); await flushPromises()
    expect(api.analyzeImportedIntervals).toHaveBeenCalledTimes(calls)
    expect(wrapper.text()).toContain('筛选门槛须为非负数字')
    expect(wrapper.find('report-evidence-chart-stub').exists()).toBe(false)
    wrapper.unmount()
  })


  it('同口径的多个对象可合计，请求改传对象集合', async () => {
    api.analyzeImportedIntervals.mockResolvedValue(multiCatalog)
    const wrapper = create(); await open(wrapper)
    const objectSelect = wrapper.findAll('select').at(-1)!
    await objectSelect.setValue(JSON.stringify([choice.seriesKey, choice.objectId]))
    await flushPromises()
    // 勾上同口径的第二个对象；不同口径的对象不出现在可合计清单里。
    const boxes = wrapper.findAll('input[type=checkbox]')
    const rollupBox = boxes.find(box => (box.element as HTMLInputElement).value === choiceB.objectId)!
    expect(boxes.some(box => (box.element as HTMLInputElement).value === otherSeries.objectId)).toBe(false)
    await rollupBox.setValue(true)
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click')
    await flushPromises()
    const last = api.analyzeImportedIntervals.mock.calls.at(-1)![1]
    expect(last.objectIds).toEqual([choice.objectId, choiceB.objectId])
    expect(last.objectId).toBeUndefined()
    wrapper.unmount()
  })
  it('价格专题不开放跨对象合计', async () => {
    api.analyzeImportedIntervals.mockResolvedValue(multiCatalog)
    const wrapper = mount(ImportedIntervalPanel, { props: { ...props, topic: 'price' as const }, global: { stubs: { ReportEvidenceChart: true } } })
    await open(wrapper as never)
    const objectSelect = wrapper.findAll('select').at(-1)!
    await objectSelect.setValue(JSON.stringify([choice.seriesKey, choice.objectId]))
    await flushPromises()
    // 多个对象的分时价格既不能相加也不该等权平均，合计入口不出现。
    expect(wrapper.text()).not.toContain('合计多个对象')
    wrapper.unmount()
  })
})
