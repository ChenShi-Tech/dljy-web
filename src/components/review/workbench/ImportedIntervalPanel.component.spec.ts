import { mount, flushPromises } from '@vue/test-utils'
import { metricTile } from '@/test/metricTile'
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
    expect(wrapper.find('.review-callout.mock').text()).toContain('模拟数据')
    expect(wrapper.find('.review-callout.mock').text()).toContain('仅供演练')
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
    expect(metricTile(wrapper, '净偏差')).toEqual({ value: '-11.8', unit: 'MWh' })
    expect(metricTile(wrapper, '绝对偏差')).toEqual({ value: '15.66', unit: 'MWh' })
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

  it('有资料目录时不显示「没有补充资料」，目录为空时才显示', async () => {
    // 单对象目录：合计入口不出现，但这不等于没有资料。
    const wrapper = create(); await open(wrapper)
    expect(wrapper.text()).not.toContain('当前范围没有补充资料')
    wrapper.unmount()
    api.analyzeImportedIntervals.mockResolvedValue({ ...catalog, choices: [] })
    const empty = create(); await open(empty)
    expect(empty.text()).toContain('当前范围没有补充资料')
    empty.unmount()
  })
  it('下拉框选中的对象恒在合计集合内，不能取消', async () => {
    api.analyzeImportedIntervals.mockResolvedValue(multiCatalog)
    const wrapper = create(); await open(wrapper)
    await wrapper.findAll('select').at(-1)!.setValue(JSON.stringify([choice.seriesKey, choice.objectId]))
    await flushPromises()
    const anchor = wrapper.findAll('input[type=checkbox]').find(box => (box.element as HTMLInputElement).value === choice.objectId)!
    expect((anchor.element as HTMLInputElement).disabled).toBe(true)
    expect((anchor.element as HTMLInputElement).checked).toBe(true)
    wrapper.unmount()
  })
  it('覆盖表列出参考期的有效基准与有效实际，说明为何没进跨期比较', async () => {
    const rollup = { objectIds: [choice.objectId, choiceB.objectId],
      current: { matchedIntervals: 4, observedIntervals: 4, objects: [{ objectId: choice.objectId, intervals: 4, baselineIntervals: 4, actualIntervals: 4 }, { objectId: choiceB.objectId, intervals: 4, baselineIntervals: 4, actualIntervals: 4 }] },
      reference: { matchedIntervals: 0, observedIntervals: 4, objects: [{ objectId: choice.objectId, intervals: 4, baselineIntervals: 4, actualIntervals: 4 }, { objectId: choiceB.objectId, intervals: 4, baselineIntervals: 3, actualIntervals: 0 }] } }
    api.analyzeImportedIntervals.mockResolvedValueOnce(multiCatalog).mockResolvedValue({ ...data, choices: multiCatalog.choices, rollup })
    const wrapper = create(); await open(wrapper)
    await wrapper.findAll('select').at(-1)!.setValue(JSON.stringify([choice.seriesKey, choice.objectId]))
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click'); await flushPromises()
    const header = wrapper.findAll('th').map(node => node.text())
    expect(header).toContain('参考期有效基准')
    expect(header).toContain('参考期有效实际')
    const row = wrapper.findAll('tr').find(node => node.text().startsWith(choiceB.objectId))!
    expect(row.findAll('td').map(node => node.text())).toEqual(['4', '4', '4', '4', '3', '0'])
    wrapper.unmount()
  })

  it('待核查时段用北京时间短格式呈现，不带秒和重复日期', async () => {
    api.analyzeImportedIntervals.mockResolvedValueOnce(catalog).mockResolvedValue(data)
    const wrapper = create(); await open(wrapper)
    await wrapper.findAll('select').at(-1)!.setValue(JSON.stringify([choice.seriesKey, choice.objectId]))
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click'); await flushPromises()
    const label = wrapper.findAll('details').find(node => node.find('summary').text().startsWith('选择待核查时段'))!.find('label').text()
    expect(label).toBe('05/31 00:00—00:15')
    wrapper.unmount()
  })
  it('重新打开时恢复上次的筛选、对象、合计勾选与待核查时段；换了复盘日期不套用', async () => {
    const saved = { context: JSON.stringify(['one', 'yunnan', 'generator', '2026-05-31']), topic: 'energy' as const, simulated: true, cadence: 'month' as const, date: '2026-05-31', manual: false, referenceStart: '', referenceEnd: '', deviationThreshold: 5, priceThreshold: '' as const, seriesKey: choice.seriesKey, objectId: choice.objectId, rollupIds: [choice.objectId, choiceB.objectId], selected: [point.start] }
    api.analyzeImportedIntervals.mockImplementation(async (_company: string, input: { seriesKey?: string }) => input.seriesKey ? data : multiCatalog)
    const wrapper = mount(ImportedIntervalPanel, { props: { ...props, expanded: true, selection: saved }, global: { stubs: { ReportEvidenceChart: true } } })
    await flushPromises()
    expect(api.analyzeImportedIntervals).toHaveBeenLastCalledWith('one', expect.objectContaining({ simulated: true, period: expect.objectContaining({ cadence: 'month' }), seriesKey: choice.seriesKey, objectIds: [choice.objectId, choiceB.objectId], thresholds: { absolutePct: 5 } }))
    expect((wrapper.findAll('input[type=checkbox]').at(-1)!.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.emitted('selection')?.at(-1)?.[0]).toEqual(saved)
    wrapper.unmount()
    api.analyzeImportedIntervals.mockClear()
    const moved = mount(ImportedIntervalPanel, { props: { ...props, date: '2026-06-01', expanded: true, selection: saved }, global: { stubs: { ReportEvidenceChart: true } } })
    await flushPromises()
    expect(api.analyzeImportedIntervals).toHaveBeenCalledTimes(1)
    expect(api.analyzeImportedIntervals).toHaveBeenLastCalledWith('one', expect.not.objectContaining({ seriesKey: expect.anything() }))
    expect(api.analyzeImportedIntervals).toHaveBeenLastCalledWith('one', expect.objectContaining({ simulated: false, period: expect.objectContaining({ cadence: 'day', date: '2026-06-01' }) }))
    moved.unmount()
  })
  it('资料修订后原待核查时段不在新结果里时不勾选', async () => {
    const saved = { context: JSON.stringify(['one', 'yunnan', 'generator', '2026-05-31']), topic: 'energy' as const, simulated: false, cadence: 'day' as const, date: '2026-05-31', manual: false, referenceStart: '', referenceEnd: '', deviationThreshold: '' as const, priceThreshold: '' as const, seriesKey: choice.seriesKey, objectId: choice.objectId, rollupIds: [choice.objectId], selected: ['2026-05-30T20:00:00Z'] }
    api.analyzeImportedIntervals.mockImplementation(async (_company: string, input: { seriesKey?: string }) => input.seriesKey ? data : catalog)
    const wrapper = mount(ImportedIntervalPanel, { props: { ...props, expanded: true, selection: saved }, global: { stubs: { ReportEvidenceChart: true } } })
    await flushPromises()
    expect(api.analyzeImportedIntervals).toHaveBeenLastCalledWith('one', expect.objectContaining({ seriesKey: choice.seriesKey, objectId: choice.objectId }))
    expect(wrapper.findAll('input[type=checkbox]').some(input => (input.element as HTMLInputElement).checked)).toBe(false)
    expect(wrapper.emitted('selection')?.at(-1)?.[0]).toMatchObject({ objectId: choice.objectId, selected: [] })
    wrapper.unmount()
  })
  it('恢复时统计临时失败不覆盖保存的勾选，重新统计成功后找回', async () => {
    const saved = { context: JSON.stringify(['one', 'yunnan', 'generator', '2026-05-31']), topic: 'energy' as const, simulated: false, cadence: 'day' as const, date: '2026-05-31', manual: false, referenceStart: '', referenceEnd: '', deviationThreshold: '' as const, priceThreshold: '' as const, seriesKey: choice.seriesKey, objectId: choice.objectId, rollupIds: [choice.objectId], selected: [point.start] }
    let failOnce = true
    api.analyzeImportedIntervals.mockImplementation(async (_company: string, input: { seriesKey?: string }) => {
      if (!input.seriesKey) return catalog
      if (failOnce) { failOnce = false; throw new Error('暂时不可用') }
      return data
    })
    const wrapper = mount(ImportedIntervalPanel, { props: { ...props, expanded: true, selection: saved }, global: { stubs: { ReportEvidenceChart: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('补充资料暂时无法统计')
    expect(wrapper.emitted('selection')).toBeUndefined()
    await wrapper.findAll('button').find(button => button.text() === '重新统计')!.trigger('click'); await flushPromises()
    expect((wrapper.findAll('input[type=checkbox]').at(-1)!.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.emitted('selection')?.at(-1)?.[0]).toEqual(saved)
    wrapper.unmount()
  })
})
