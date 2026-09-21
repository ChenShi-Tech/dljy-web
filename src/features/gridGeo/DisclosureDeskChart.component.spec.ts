// 实际轴回调与原生采样边界：分类轴不是时间，缺测不能被补成零或全天常值。#2897
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DisclosureDeskChart from './DisclosureDeskChart.vue'
import type { DeskSeries } from './disclosureDeskData'
import type { GridDisclosureOverview } from './types'

const fake = vi.hoisted(() => ({
  handlers: {} as Record<string, (payload: unknown) => void>,
  zrHandlers: {} as Record<string, (payload: unknown) => void>,
  setOption: vi.fn(), dispatchAction: vi.fn(), dispose: vi.fn(), resize: vi.fn(),
  containPixel: vi.fn(), convertFromPixel: vi.fn(),
}))
vi.mock('echarts', () => ({ init: vi.fn(() => ({
  on: (name: string, handler: (payload: unknown) => void) => { fake.handlers[name] = handler },
  getZr: () => ({ on: (name: string, handler: (payload: unknown) => void) => { fake.zrHandlers[name] = handler } }),
  setOption: fake.setOption, dispatchAction: fake.dispatchAction, dispose: fake.dispose, resize: fake.resize,
  containPixel: fake.containPixel, convertFromPixel: fake.convertFromPixel,
})) }))

type ChartOption = {
  axisPointer: { label: { formatter: (item: { value: number | string; axisDimension?: string }) => string } }
  xAxis: Array<{ axisLabel: { formatter: (value: number) => string } }>
  yAxis: Array<{ data?: string[] }>
  series: Array<{ id: string; type: string; data: unknown[]; step?: string | false; showSymbol?: boolean; connectNulls?: boolean; tooltip?: { formatter: (item: { data: { from: string; to: string }; value: number[] }) => string } }>
}
function option(): ChartOption { return fake.setOption.mock.lastCall![0] as ChartOption }
function stamp(time: string) { return Date.parse(`2026-07-01T${time}+08:00`) }
function series(nativeMinutes: number | null = 60, points: DeskSeries['points'] = []): DeskSeries {
  return { id: 'value', label: '测试公开指标', unit: 'MW', nativeMinutes, step: nativeMinutes === 60 ? 'end' : false, points }
}
function railOverview(): GridDisclosureOverview {
  const none = { maintenance: 0, outage: 0, intervention: 0, congestion: 0, constraint: 0 }
  return {
    total: 10, dayOnlyCount: 4, dayOnlyCountsByCategory: { ...none, constraint: 4 },
    countsByCategory: { ...none, maintenance: 2, outage: 1, intervention: 3, constraint: 4 },
    bucket: 'hour', buckets: [
      { from: '2026-07-01T00:00:00+08:00', to: '2026-07-01T00:59:59+08:00', count: 2, countsByCategory: { ...none, maintenance: 2 } },
      { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59+08:00', count: 1, countsByCategory: { ...none, outage: 1 } },
      { from: '2026-07-01T22:00:00+08:00', to: '2026-07-01T22:59:59+08:00', count: 3, countsByCategory: { ...none, intervention: 3 } },
    ],
    coverage: { from: '2026-07-01', to: '2026-07-01', total: 10, timeBasis: 'businessDate', publishedTimeKnown: 0, sourceImportedTimeKnown: 10, effectiveTimeKnown: 6 },
    dataAvailability: { status: 'available', reason: '测试夹具', fallback: false },
  }
}
async function view(input: DeskSeries[], overview: GridDisclosureOverview | null = null) {
  const wrapper = mount(DisclosureDeskChart, { props: { series: input, overview, dateFrom: '2026-07-01', dateTo: '2026-07-01', selection: null } })
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.clearAllMocks()
  for (const name of Object.keys(fake.handlers)) delete fake.handlers[name]
  for (const name of Object.keys(fake.zrHandlers)) delete fake.zrHandlers[name]
  fake.containPixel.mockReturnValue(false)
  fake.convertFromPixel.mockReturnValue([])
})

describe('披露图表轴回调与真实粒度', () => {
  it('分类和价格y轴保持原值，只有x轴格式化时间，无效时点不抛RangeError', async () => {
    const wrapper = await view([series()])
    const format = option().axisPointer.label.formatter
    expect(format({ axisDimension: 'y', value: '干预' })).toBe('干预')
    expect(format({ axisDimension: 'y', value: 150.148 })).toBe('150.148')
    expect(format({ axisDimension: 'x', value: stamp('10:15:00') })).toContain('10:15')
    expect(format({ axisDimension: 'x', value: '干预' })).toBe('—')
    expect(format({ axisDimension: 'x', value: Infinity })).toBe('—')
    expect(option().xAxis[0].axisLabel.formatter(NaN)).toBe('—')
    wrapper.unmount()
  })

  it('updateAxisPointer忽略y轴分类/数值，混合轴回调仅发北京时间x坐标', async () => {
    const wrapper = await view([series()])
    const pointer = fake.handlers.updateAxisPointer
    pointer({ axesInfo: [{ axisDim: 'y', value: '干预' }] })
    pointer({ axesInfo: [{ axisDim: 'y', value: 150.148 }] })
    pointer({ axesInfo: [{ axisDim: 'x', value: '干预' }, { axisDim: 'x', value: NaN }] })
    expect(wrapper.emitted('hover')).toBeUndefined()
    pointer({ axesInfo: [{ axisDim: 'y', value: 150.148 }, { axisDim: 'x', value: stamp('10:15:00') }] })
    expect(wrapper.emitted('hover')).toEqual([['2026-07-01T10:15:00+08:00']])
    fake.zrHandlers.globalout({})
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([null])
    wrapper.unmount()
  })

  it('每个有效小时延长至时槽末端，缺测保留null；最后一小时与真实0/负值均可见', async () => {
    const points = Array.from({ length: 24 }, (_, hour) => ({ time: `2026-07-01 ${String(hour).padStart(2, '0')}:00`, value: hour === 0 ? 0 : hour === 23 ? -20 : null }))
    const wrapper = await view([series(60, points)])
    const line = option().series.find((item) => item.type === 'line')!
    expect(line).toMatchObject({ step: 'end', connectNulls: false })
    expect(line.data).toHaveLength(26)
    expect(line.data.slice(0, 3)).toEqual([[stamp('00:00:00'), 0], [stamp('00:59:59.999'), 0], [stamp('01:00:00'), null]])
    expect(line.data).not.toContainEqual([stamp('01:59:59.999'), 0])
    expect(line.data.slice(-3)).toEqual([[stamp('22:00:00'), null], [stamp('23:00:00'), -20], [stamp('23:59:59.999'), -20]])
    expect(wrapper.find('[data-testid="desk-curve-empty"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('日级标量以有日期的读数展示，真实0保留且不进入全天line', async () => {
    const wrapper = await view([series(null, [{ time: '2026-07-01 00:00', value: 0 }])])
    expect(option().series.filter((item) => item.type === 'line')).toHaveLength(0)
    expect(option().series.filter((item) => item.type === 'scatter')).toHaveLength(5)
    const values = wrapper.get('[data-testid="desk-scalar-values"]')
    expect(values.text()).toContain('2026-07-01')
    expect(values.text()).toContain('测试公开指标')
    expect(values.get('strong').text()).toBe('0 MW')
    expect(wrapper.find('[data-testid="desk-curve-empty"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('日级调峰文字直接展示原文事项，不显示空图提示或伪造功率曲线', async () => {
    const wrapper = await view([])
    await wrapper.setProps({ textFacts: [{ label: '调峰需求 · 云南', time: '2026-07-01', value: '否' }] })
    expect(wrapper.get('[data-testid="desk-text-values"]').text()).toContain('2026-07-01 · 调峰需求 · 云南')
    expect(wrapper.get('[data-testid="desk-text-values"] strong').text()).toBe('否')
    expect(wrapper.find('[data-testid="desk-curve-empty"]').exists()).toBe(false)
    expect(option().series.filter((item) => item.type === 'line')).toHaveLength(0)
    wrapper.unmount()
  })

  it('15分钟孤立有效点显示symbol，保留两侧缺测与原始时点，不生成小时末端', async () => {
    const wrapper = await view([series(15, [
      { time: '2026-07-01 10:00', value: null }, { time: '2026-07-01 10:15', value: 20 }, { time: '2026-07-01 10:30', value: null },
    ])])
    const line = option().series.find((item) => item.type === 'line')!
    expect(line).toMatchObject({ step: false, showSymbol: true, connectNulls: false })
    expect(line.data).toEqual([[stamp('10:00:00'), null], [stamp('10:15:00'), 20], [stamp('10:30:00'), null]])
    wrapper.unmount()
  })

  it.each([60, 15])('键盘按%s分钟原始时槽移动，Home/End保持日边界，Escape解除', async (minutes) => {
    const wrapper = await view([series(minutes)])
    const chart = wrapper.get('[data-testid="desk-chart"]')
    await chart.trigger('keydown', { key: 'ArrowRight' })
    let selected = wrapper.emitted('select')!.at(-1)![0] as { from: string; to: string }
    expect(Date.parse(selected.from)).toBe(stamp('00:00:00') + minutes * 60_000)
    expect(Date.parse(selected.to) - Date.parse(selected.from)).toBe(minutes * 60_000 - 1000)
    await chart.trigger('keydown', { key: 'Home' })
    selected = wrapper.emitted('select')!.at(-1)![0] as typeof selected
    expect(Date.parse(selected.from)).toBe(stamp('00:00:00'))
    await chart.trigger('keydown', { key: 'End' })
    selected = wrapper.emitted('select')!.at(-1)![0] as typeof selected
    expect(Date.parse(selected.from)).toBe(stamp('23:59:59') + 1000 - minutes * 60_000)
    expect(Date.parse(selected.to)).toBe(stamp('23:59:59'))
    await chart.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('select')!.at(-1)![0]).toEqual(selected)
    await chart.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('clear')).toHaveLength(1)
    wrapper.unmount()
  })

  it('真实scatter配置保留类别与计数，点击回调发出事件焦点而非普通时间选区', async () => {
    const counts = { maintenance: 0, outage: 2, intervention: 0, congestion: 0, constraint: 0 }
    const bucket = { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59.999+08:00', count: 2, countsByCategory: counts }
    const overview: GridDisclosureOverview = {
      total: 2, dayOnlyCount: 0, dayOnlyCountsByCategory: { ...counts, outage: 0 }, countsByCategory: counts, buckets: [bucket], bucket: 'hour',
      coverage: { from: '2026-07-01', to: '2026-07-01', total: 2, timeBasis: 'businessDate', publishedTimeKnown: 0, sourceImportedTimeKnown: 2, effectiveTimeKnown: 2 },
      dataAvailability: { status: 'available', reason: '测试夹具', fallback: false },
    }
    const wrapper = await view([], overview)
    const scatter = option().series.find((item) => item.id === 'event-outage')!
    expect(scatter.data).toHaveLength(1)
    const data = scatter.data[0] as { from: string; to: string; value: number[] }
    const tooltip = scatter.tooltip!.formatter({ data, value: data.value })
    expect(tooltip).toContain('非计划停运 · 07/01 10:00 — 07/01 10:59')
    expect(tooltip).toContain('2 条相关披露记录')
    expect(tooltip).toContain('不代表新增事件数')
    expect(option().yAxis[1].data).toEqual(['检修计划', '非计划停运', '人工干预', '断面阻塞', '输电约束'])
    fake.handlers.click({ seriesType: 'scatter', data: scatter.data[0] })
    expect(wrapper.emitted('event-focus')).toEqual([[{ from: bucket.from, to: bucket.to, category: 'outage', count: 2 }]])
    expect(wrapper.emitted('select')).toBeUndefined()
    wrapper.unmount()
  })

  it('选区只高亮窗口，全天各类已知时刻圆点仍保留，业务日不伪装小时点', async () => {
    const overview = railOverview()
    const wrapper = await view([], overview)
    const before = option().series.filter((item) => item.type === 'scatter').map((item) => item.data)
    await wrapper.setProps({ selection: { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59+08:00' } })
    await flushPromises()
    expect(option().series.filter((item) => item.type === 'scatter').map((item) => item.data)).toEqual(before)
    for (const category of ['maintenance', 'outage', 'intervention']) expect(option().series.find((item) => item.id === `event-${category}`)!.data).toHaveLength(1)
    expect(option().series.find((item) => item.id === 'event-constraint')!.data).toEqual([])
    wrapper.unmount()
  })

  async function interactive(minutes = 60) {
    const wrapper = await view([series(minutes)])
    const chart = wrapper.get('[data-testid="desk-chart"]')
    vi.spyOn(chart.element, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 400, height: 390 } as DOMRect)
    Object.defineProperty(chart.element, 'clientWidth', { value: 400 })
    Object.defineProperty(chart.element, 'clientHeight', { value: 390 })
    fake.containPixel.mockImplementation((_finder, pixel: number[]) => pixel[0] >= 68 && pixel[0] <= 376 && pixel[1] >= 47 && pixel[1] <= 245)
    fake.convertFromPixel.mockImplementation((_finder, pixel: number[]) => [stamp('00:00:00') + (pixel[0] - 68) * 360_000, 0])
    return { wrapper, chart }
  }
  function pointer(type: string, x: number, options: Partial<PointerEventInit> = {}) {
    return new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', clientX: x + 10, clientY: 120, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, ...options })
  }

  it('画布边缘与事件轨道空白取消选择，主图空白仍选中时槽，图例和事件目标不取消', async () => {
    const { wrapper, chart } = await interactive()
    await wrapper.setProps({ selection: { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T10:59:59+08:00' } })
    const blankClick = fake.zrHandlers.click
    for (const payload of [
      { offsetX: 100, offsetY: 15, target: { type: 'legend' } },
      { offsetX: 100, offsetY: 300, target: { type: 'circle' } },
      { offsetX: 100, offsetY: 100, target: { type: 'polyline' } },
      { offsetX: 10, offsetY: 100, event: { button: 2 } },
    ]) blankClick(payload)
    expect(wrapper.emitted('clear')).toBeUndefined()
    await chart.trigger('click', { clientX: 102, clientY: 120, button: 0 })
    blankClick({ offsetX: 92, offsetY: 100, event: { button: 0 } })
    expect(wrapper.emitted('select')).toEqual([[{ from: '2026-07-01T02:00:00+08:00', to: '2026-07-01T02:59:59+08:00' }]])
    expect(wrapper.emitted('clear')).toBeUndefined()
    blankClick({ offsetX: 10, offsetY: 100, event: { button: 0 } })
    blankClick({ offsetX: 100, offsetY: 300, event: { button: 0 } })
    expect(wrapper.emitted('clear')).toHaveLength(2)
    wrapper.unmount()
  })

  it('图旁容器空白取消选择，右键不清空', async () => {
    const { wrapper } = await interactive()
    await wrapper.trigger('click', { button: 2 })
    expect(wrapper.emitted('clear')).toBeUndefined()
    await wrapper.trigger('click', { button: 0 })
    expect(wrapper.emitted('clear')).toHaveLength(1)
    wrapper.unmount()
  })

  it('拖选结束于画布或图旁空白，尾随点击不取消刚提交的选区', async () => {
    const { wrapper, chart } = await interactive()
    chart.element.dispatchEvent(pointer('pointerdown', 90))
    window.dispatchEvent(pointer('pointermove', 112))
    window.dispatchEvent(pointer('pointerup', 112, { clientY: 320 }))
    const trailingClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, clientX: 122, clientY: 320 })
    chart.element.dispatchEvent(trailingClick)
    fake.zrHandlers.click({ offsetX: 112, offsetY: 300, event: trailingClick })
    expect(trailingClick.defaultPrevented).toBe(true)
    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('clear')).toBeUndefined()
    chart.element.dispatchEvent(pointer('pointerdown', 90))
    window.dispatchEvent(pointer('pointermove', 112))
    window.dispatchEvent(pointer('pointerup', 112, { clientY: 500 }))
    await wrapper.trigger('click', { button: 0 })
    expect(wrapper.emitted('select')).toHaveLength(2)
    expect(wrapper.emitted('clear')).toBeUndefined()
    await wrapper.trigger('click', { button: 0 })
    expect(wrapper.emitted('clear')).toHaveLength(1)
    wrapper.unmount()
  })

  it('单击按鼠标所在位置锁定原始小时，轻微抖动不变成多时段拖选', async () => {
    const { wrapper, chart } = await interactive()
    chart.element.dispatchEvent(pointer('pointerdown', 90))
    window.dispatchEvent(pointer('pointermove', 92))
    window.dispatchEvent(pointer('pointerup', 92))
    await chart.trigger('click', { clientX: 102, clientY: 120, button: 0 })
    expect(wrapper.emitted('select')).toEqual([[{ from: '2026-07-01T02:00:00+08:00', to: '2026-07-01T02:59:59+08:00' }]])
    expect(wrapper.find('[data-testid="desk-drag-preview"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([[90, 112], [112, 90]])('左键从%s拖至%s预览多时段，松开才提交一次且不被尾随click覆盖', async (start, end) => {
    const { wrapper, chart } = await interactive()
    chart.element.dispatchEvent(pointer('pointerdown', start))
    window.dispatchEvent(pointer('pointermove', end))
    await flushPromises()
    expect(wrapper.find('[data-testid="desk-drag-preview"]').exists()).toBe(true)
    expect(wrapper.emitted('select')).toBeUndefined()
    window.dispatchEvent(pointer('pointerup', end))
    await chart.trigger('click', { clientX: end + 10, clientY: 120, button: 0 })
    expect(wrapper.emitted('select')).toEqual([[{ from: '2026-07-01T02:00:00+08:00', to: '2026-07-01T04:59:59+08:00' }]])
    expect(wrapper.find('[data-testid="desk-drag-preview"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('15分钟拖选按原始粒度取完整区间，拖出图外松开仍能提交并限制到交易日边界', async () => {
    const { wrapper, chart } = await interactive(15)
    chart.element.dispatchEvent(pointer('pointerdown', 90))
    window.dispatchEvent(pointer('pointermove', 112))
    window.dispatchEvent(pointer('pointerup', 112))
    expect(wrapper.emitted('select')?.at(-1)).toEqual([{ from: '2026-07-01T02:00:00+08:00', to: '2026-07-01T04:29:59+08:00' }])
    chart.element.dispatchEvent(pointer('pointerdown', 90))
    window.dispatchEvent(pointer('pointermove', -100))
    window.dispatchEvent(pointer('pointerup', -100))
    expect(wrapper.emitted('select')?.at(-1)).toEqual([{ from: '2026-07-01T00:00:00+08:00', to: '2026-07-01T02:14:59+08:00' }])
    wrapper.unmount()
  })

  it('右键、非主图区、触屏滚动不启用拖选，日期切换或指针取消丢弃旧手势', async () => {
    const { wrapper, chart } = await interactive()
    for (const options of [{ button: 2, buttons: 2 }, { pointerType: 'touch' }, { clientY: 380 }]) {
      chart.element.dispatchEvent(pointer('pointerdown', 90, options))
      window.dispatchEvent(pointer('pointermove', 112))
      window.dispatchEvent(pointer('pointerup', 112))
    }
    expect(wrapper.emitted('select')).toBeUndefined()
    chart.element.dispatchEvent(pointer('pointerdown', 90))
    window.dispatchEvent(pointer('pointermove', 112))
    window.dispatchEvent(pointer('pointercancel', 112))
    window.dispatchEvent(pointer('pointerup', 112))
    await chart.trigger('click', { clientX: 122, clientY: 120, button: 0 })
    expect(wrapper.emitted('select')).toBeUndefined()
    chart.element.dispatchEvent(pointer('pointerdown', 90))
    window.dispatchEvent(pointer('pointermove', 112))
    await wrapper.setProps({ dateFrom: '2026-07-02', dateTo: '2026-07-02' })
    window.dispatchEvent(pointer('pointerup', 112))
    await chart.trigger('click', { clientX: 122, clientY: 120, button: 0 })
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(fake.handlers.brushEnd).toBeUndefined()
    expect(fake.setOption.mock.lastCall?.[0].brush).toBeUndefined()
    expect(fake.setOption.mock.lastCall?.[0].toolbox.show).toBe(false)
    wrapper.unmount()
  })

  it('取消拖选后的尾随click不能恢复选区，鼠标选择后键盘从新时段继续', async () => {
    const { wrapper, chart } = await interactive()
    chart.element.dispatchEvent(pointer('pointerdown', 90))
    window.dispatchEvent(pointer('pointermove', 112))
    await chart.trigger('keydown', { key: 'Escape' })
    window.dispatchEvent(pointer('pointerup', 112))
    await chart.trigger('click', { clientX: 122, clientY: 120, button: 0 })
    expect(wrapper.emitted('select')).toBeUndefined()
    chart.element.dispatchEvent(pointer('pointerdown', 168))
    window.dispatchEvent(pointer('pointerup', 168))
    await chart.trigger('click', { clientX: 178, clientY: 120, button: 0 })
    await chart.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('select')?.at(-1)).toEqual([{ from: '2026-07-01T11:00:00+08:00', to: '2026-07-01T11:59:59+08:00' }])
    await wrapper.setProps({ selection: { from: '2026-07-01T15:00:00+08:00', to: '2026-07-01T15:59:59+08:00' } })
    await chart.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('select')?.at(-1)).toEqual([{ from: '2026-07-01T16:00:00+08:00', to: '2026-07-01T16:59:59+08:00' }])
    wrapper.unmount()
  })

  it('缩放后越界拖选以绘图区边缘计算终点，不提交屏外推算时段', async () => {
    const { wrapper, chart } = await interactive()
    fake.convertFromPixel.mockImplementation((_finder, pixel: number[]) => [stamp('06:00:00') + (pixel[0] - 68) / 308 * (6 * 3600_000 - 1), 0])
    chart.element.dispatchEvent(pointer('pointerdown', 100))
    window.dispatchEvent(pointer('pointermove', 1000))
    window.dispatchEvent(pointer('pointerup', 1000))
    expect(fake.convertFromPixel).toHaveBeenLastCalledWith({ gridIndex: 0 }, [376, 100])
    expect(wrapper.emitted('select')?.at(-1)).toEqual([{ from: '2026-07-01T06:00:00+08:00', to: '2026-07-01T11:59:59+08:00' }])
    wrapper.unmount()
  })
})
