// 扩展预测面板必须诚实处理超短期 unavailable/空结果/迟到响应，不访问真实服务或浏览器。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'

const api = vi.hoisted(() => ({
  runUltraShort: vi.fn(),
  runMidterm: vi.fn(),
  runDeviationRisk: vi.fn(),
}))
const chartState = vi.hoisted(() => {
  const instances: { setOption: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = []
  return {
    instances,
    init: vi.fn(() => {
      const instance = { setOption: vi.fn(), clear: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
      instances.push(instance)
      return instance
    }),
  }
})
const region = vi.hoisted(() => ({ setCurrentRegionId: vi.fn() }))

vi.mock('echarts', () => ({ init: chartState.init }))
vi.mock('@/services/region/regionContext', () => ({
  setCurrentRegionId: region.setCurrentRegionId,
}))
vi.mock('@/services/forecast/forecastProviders', () => ({
  nativeSlotsForTarget: (target: string) => (target === 'price_user_da_settlement' || target === 'price_user_rt_settlement' ? 24 : 96),
}))
vi.mock('@/services/forecast/mlForecastClient', () => ({
  runUltraShort: api.runUltraShort,
  runMidterm: api.runMidterm,
  runDeviationRisk: api.runDeviationRisk,
}))
vi.mock('../DataBasisBadge.vue', () => ({
  default: { props: ['basis'], template: '<span class="basis">{{basis}}</span>' },
}))

import Panel from './ForecastExtraPanel.vue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const stubs = {
  ElRow: { template: '<div><slot/></div>' },
  ElCol: { template: '<div><slot/></div>' },
  ElButton: {
    name: 'ElButton',
    props: ['disabled', 'loading', 'title'],
    emits: ['click'],
    template: '<button :disabled="disabled || loading" :title="title" @click="$emit(\'click\')"><slot/></button>',
  },
  ElAlert: { props: ['title'], template: '<p class="alert">{{title}}</p>' },
  ElInputNumber: { name: 'ElInputNumber', props: ['modelValue'], emits: ['update:modelValue'], template: '<input />' },
  ElDescriptions: { template: '<div><slot/></div>' },
  ElDescriptionsItem: { template: '<div><slot/></div>' },
  ElTag: { template: '<span><slot/></span>' },
}

const wrappers: VueWrapper[] = []
async function render(props = {}) {
  const wrapper = mount(Panel, {
    props: { regionId: 'yunnan', target: 'price', trainDays: 180, ...props },
    global: { stubs, directives: { loading: () => {} } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
async function clickUltra(wrapper: VueWrapper) {
  await wrapper.findAll('button')[0].trigger('click')
  await flushPromises()
}
async function clickMid(wrapper: VueWrapper) {
  await wrapper.findAll('button')[1].trigger('click')
  await flushPromises()
}

beforeEach(() => {
  api.runUltraShort.mockReset().mockResolvedValue({
    target: 'price',
    basis: 'captured',
    horizon: 'latest-history-day',
    points: [100, 102, 104],
  })
  api.runMidterm.mockReset().mockResolvedValue({
    basis: 'captured',
    horizon_days: 14,
    daily_avg_price: [100, 101],
    mae: 1.2,
    persistence_mae: 1.8,
    mase_vs_persistence: 0.67,
    beats_persistence: true,
    unit: 'MW',
  })
  api.runDeviationRisk.mockReset().mockResolvedValue({
    forecast: { points: [1], lower: [0.5], upper: [1.5], basis: 'captured', unit: 'MW', target: 'load' },
    deviation_risk: {
      expected_total_penalty_yuan: 10,
      worst_total_penalty_yuan: 10,
      high_risk_slots: 1,
      tolerance_pct: 3,
      assessment_price: 100,
      tolerance_band_mw: 1,
      ci_available: false,
    },
  })
  chartState.instances.splice(0)
  chartState.init.mockClear()
  region.setCurrentRegionId.mockReset()
})

afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()) })

describe('ForecastExtraPanel', () => {
  it('指定日传到后端并展示同日预测、实际、上一时段对照三条曲线和误差', async () => {
    api.runUltraShort.mockResolvedValueOnce({
      target: 'load', region_id: 'yunnan', target_date: '2026-06-25', basis: 'captured',
      mode: 'historical_one_step_replay', interval_minutes: 15, unit: 'MW', horizon: '1-step',
      points: Array(96).fill(101), actual: Array(96).fill(100), persistence: Array(96).fill(102),
      slots: Array.from({ length: 96 }, (_, i) => i), mae: 1, persistence_mae: 2, beats_persistence: true,
    })
    const wrapper = await render({ target: 'load', targetDate: '2026-06-25' })
    await clickUltra(wrapper)
    expect(api.runUltraShort).toHaveBeenCalledWith(expect.objectContaining({ target_date: '2026-06-25', target: 'load', data_source: 'auto' }))
    const option = chartState.instances[0].setOption.mock.calls[0][0]
    expect(option.series.map((s: { name: string }) => s.name)).toEqual(['滚动预测', '实际值', '上一时段对照'])
    expect(option.yAxis.name).toBe('MW')
    expect(wrapper.text()).toContain('平均绝对误差 1.00 MW')
  })

  it('指定日不接受旧后端缺日期的结果', async () => {
    const wrapper = await render({ targetDate: '2026-06-25' })
    await clickUltra(wrapper)
    expect(wrapper.text()).toContain('未展示错位曲线')
    expect(chartState.init).not.toHaveBeenCalled()
  })

  it('日期变化即清空曲线并作废在途结果', async () => {
    const pending = deferred<unknown>()
    api.runUltraShort.mockReturnValueOnce(pending.promise)
    const wrapper = await render({ targetDate: '2026-06-25' })
    await wrapper.findAll('button')[0].trigger('click')
    await wrapper.setProps({ targetDate: '2026-06-26' })
    pending.resolve({ target: 'price', basis: 'captured', points: [1], horizon: 'late' })
    await flushPromises()
    expect(chartState.init).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'ElButton' }).props('loading')).toBe(false)
  })
  it('扩展面板只保留三张卡，不再显示PatchTST序列入口或误差保证', async () => {
    const wrapper = await render()
    expect(wrapper.findAll('.ext-card')).toHaveLength(3)
    expect(wrapper.findAll('button')).toHaveLength(3)
    expect(wrapper.text()).not.toContain('PatchTST')
    expect(wrapper.text()).not.toContain('误差远低于')
    expect(wrapper.text()).toContain('超短期读取共享任务栏')
  })
  it('小时结算价目标会禁用超短期入口并提前说明原因', async () => {
    const wrapper = await render({ target: 'price_user_da_settlement' })
    expect(wrapper.text()).toContain('当前标的是小时结算价（24 点），不是 15 分钟目标')
    const ultraButton = wrapper.findAll('button')[0]
    expect((ultraButton.element as HTMLButtonElement).disabled).toBe(true)
    await ultraButton.trigger('click')
    expect(api.runUltraShort).not.toHaveBeenCalled()
  })

  it('超短期 HTTP200 unavailable 会清掉旧图并展示服务返回原因，不当作成功', async () => {
    const second = deferred<{ available: false; reason: string; mock: boolean; source_type: string; productionWrite: boolean }>()
    api.runUltraShort
      .mockResolvedValueOnce({ target: 'price', basis: 'captured', horizon: 'latest-history-day', points: [120] })
      .mockReturnValueOnce(second.promise)
    const wrapper = await render()

    await clickUltra(wrapper)
    expect(chartState.init).toHaveBeenCalledTimes(1)
    expect(chartState.instances[0]?.setOption).toHaveBeenCalledTimes(1)
    expect(chartState.instances[0]?.setOption.mock.calls[0]?.[0]?.xAxis?.data).toEqual(['第1步'])
    expect(chartState.instances[0]?.setOption.mock.calls[0]?.[0]?.series?.[0]?.showSymbol).toBe(true)
    expect(wrapper.text()).toContain('captured')

    await wrapper.findAll('button')[0].trigger('click')
    await nextTick()
    expect(chartState.instances[0]?.clear).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.basis').exists()).toBe(false)

    second.resolve({
      available: false,
      reason: '地区 yunnan 无真实回放训练数据（data_source=auto 不合成兜底）；如需合成链路验证请显式传 data_source=synthetic',
      mock: false,
      source_type: 'UNAVAILABLE',
      productionWrite: false,
    })
    await flushPromises()

    expect(wrapper.text()).toContain('地区 yunnan 无真实回放训练数据')
    expect(wrapper.find('.basis').exists()).toBe(false)
    expect(chartState.instances[0]?.setOption).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: 'NaN', points: [100, Number.NaN, 104] },
    { label: 'Infinity', points: [Infinity] },
    { label: 'null', points: [null] },
    { label: '字符串', points: ['100'] },
    { label: '空数组', points: [] },
  ])('超短期返回$label时拒绝绘图并提示原因', async ({ points }) => {
    api.runUltraShort.mockResolvedValueOnce({
      target: 'price',
      basis: 'captured',
      horizon: 'latest-history-day',
      points,
    })
    const wrapper = await render()

    await clickUltra(wrapper)

    expect(wrapper.text()).toContain('超短期暂无可展示的逐时段结果')
    expect(chartState.init).not.toHaveBeenCalled()
    expect(wrapper.find('.basis').exists()).toBe(false)
  })

  it('完整96点使用真实时段标签，不把非96点数据伪装为全天', async () => {
    api.runUltraShort.mockResolvedValueOnce({ target: 'price', basis: 'captured', horizon: 'history-day', points: Array(96).fill(100) })
    const wrapper = await render()
    await clickUltra(wrapper)
    const option = chartState.instances[0].setOption.mock.calls[0][0]
    expect(option.xAxis.data).toHaveLength(96)
    expect(option.xAxis.data[0]).toBe('00:00')
    expect(option.xAxis.data[95]).toBe('23:45')
  })

  it('切目标后旧失败不得覆盖新请求错误或解除新请求的加载态', async () => {
    const oldRequest = deferred<unknown>()
    const currentRequest = deferred<unknown>()
    api.runUltraShort.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(currentRequest.promise)
    const wrapper = await render()
    await wrapper.findAll('button')[0].trigger('click')
    await wrapper.setProps({ target: 'load' })
    await wrapper.findAll('button')[0].trigger('click')
    oldRequest.reject(new Error('旧任务错误'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧任务错误')
    expect(wrapper.findComponent({ name: 'ElButton' }).props('loading')).toBe(true)
    currentRequest.resolve({ target: 'load', basis: 'captured', horizon: 'history', points: [100] })
    await flushPromises()
    expect(chartState.init).toHaveBeenCalledTimes(1)
    expect(wrapper.findComponent({ name: 'ElButton' }).props('loading')).toBe(false)
  })

  it('历史窗口变化会作废在途超短期请求并清空加载状态', async () => {
    const pending = deferred<{ target: string; basis: string; horizon: string; points: number[] }>()
    api.runUltraShort.mockReturnValueOnce(pending.promise)
    const wrapper = await render()

    await wrapper.findAll('button')[0].trigger('click')
    expect(wrapper.findComponent({ name: 'ElButton' }).props('loading')).toBe(true)

    await wrapper.setProps({ trainDays: 90 })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ElButton' }).props('loading')).toBe(false)
    expect(wrapper.find('.basis').exists()).toBe(false)

    pending.resolve({ target: 'price', basis: 'captured', horizon: 'late', points: [1, 2, 3] })
    await flushPromises()
    expect(chartState.init).not.toHaveBeenCalled()
    expect(wrapper.find('.basis').exists()).toBe(false)
  })

  it('中长期失败会清掉旧结果，且不会覆盖超短期卡片自己的错误', async () => {
    api.runUltraShort.mockResolvedValueOnce({
      available: false,
      reason: '超短期缺真实历史',
      mock: false,
      source_type: 'UNAVAILABLE',
      productionWrite: false,
    })
    api.runMidterm
      .mockResolvedValueOnce({
        basis: 'captured',
        horizon_days: 14,
        daily_avg_price: [100, 101],
        mae: 1.2,
        persistence_mae: 1.8,
        mase_vs_persistence: 0.67,
        beats_persistence: true,
        unit: 'MW',
      })
      .mockRejectedValueOnce(new Error('中长期样本不足'))
    const wrapper = await render()

    await clickUltra(wrapper)
    expect(wrapper.text()).toContain('超短期缺真实历史')

    await clickMid(wrapper)
    expect(wrapper.text()).toContain('MAE 1.2 MW')

    await clickMid(wrapper)
    expect(wrapper.text()).toContain('中长期样本不足')
    expect(wrapper.text()).toContain('超短期缺真实历史')
    expect(wrapper.text()).not.toContain('MAE 1.2 MW')
  })

  it('中长期和偏差卡片遇到 HTTP200 available:false 时显示各自 reason 且不崩溃', async () => {
    api.runMidterm.mockResolvedValueOnce({ available: false, reason: '中长期缺真实样本' })
    api.runDeviationRisk.mockResolvedValueOnce({ available: false, reason: '偏差考核缺负荷分位带' })
    const wrapper = await render()

    await clickMid(wrapper)
    await wrapper.findAll('button')[2].trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('中长期缺真实样本')
    expect(wrapper.text()).toContain('偏差考核缺负荷分位带')
    expect(wrapper.text()).not.toContain('MAE 1.2 MW')
  })

  it.each([undefined, '   '])('不可用响应即使缺少原因（%s），中长期和偏差卡片也不会误当成功', async (reason) => {
    api.runMidterm.mockResolvedValueOnce({ available: false, reason })
    api.runDeviationRisk.mockResolvedValueOnce({ available: false, reason })
    const wrapper = await render()

    await clickMid(wrapper)
    await wrapper.findAll('button')[2].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.alert').map((item) => item.text())).toEqual([
      '当前预测能力暂不可用，服务未返回具体原因',
      '当前预测能力暂不可用，服务未返回具体原因',
    ])
    expect(wrapper.find('.basis').exists()).toBe(false)
    expect(chartState.init).not.toHaveBeenCalled()
  })

  it('组件卸载后会丢弃迟到的超短期响应', async () => {
    const pending = deferred<{ target: string; basis: string; horizon: string; points: number[] }>()
    api.runUltraShort.mockReturnValueOnce(pending.promise)
    const wrapper = await render()

    await wrapper.findAll('button')[0].trigger('click')
    wrapper.unmount()

    pending.resolve({ target: 'price', basis: 'captured', horizon: 'late', points: [1, 2, 3] })
    await flushPromises()
    expect(chartState.init).not.toHaveBeenCalled()
  })

  // #3605：远端 mock 标识与 warnings 展示
  describe('远端来源标识', () => {
    const ultra96 = (extra: Record<string, unknown> = {}) => ({
      target: 'load', region_id: 'yunnan', target_date: '2026-06-25', basis: 'captured',
      mode: 'historical_one_step_replay', interval_minutes: 15, unit: 'MW', horizon: '1-step',
      points: Array(96).fill(101), actual: Array(96).fill(100), persistence: Array(96).fill(102),
      slots: Array.from({ length: 96 }, (_, i) => i), mae: 1, persistence_mae: 2, beats_persistence: true,
      ...extra,
    })

    it('中长期 mock:true / sourceType:MOCK 显示「模拟数据」并把 warnings 折成短标签+悬浮提示', async () => {
      api.runMidterm.mockResolvedValueOnce({
        basis: 'illustrative', horizon_days: 14, daily_avg_price: [100, 101], mae: 1, persistence_mae: 2,
        mase_vs_persistence: 0.5, beats_persistence: true, unit: '元/MWh',
        mock: true, sourceType: 'MOCK', source_type: 'MOCK', productionWrite: false,
        warnings: ['远程模型为演示权重', '窗口内有泄漏风险'],
      })
      const wrapper = await render()
      await clickMid(wrapper)
      const card = wrapper.findAll('.ext-card')[1]
      expect(card.text()).toContain('模拟数据')
      const warn = card.findAll('.fp-warn')
      expect(warn).toHaveLength(1)
      expect(warn[0].text()).toBe('提示 2')
      expect(warn[0].attributes('title')).toContain('远程模型为演示权重')
      expect(warn[0].attributes('title')).toContain('窗口内有泄漏风险')
      // 未运行/其他卡片不受影响
      expect(wrapper.findAll('.ext-card')[0].text()).not.toContain('模拟数据')
    })

    it('超短期 mock:true 显示「模拟数据」；旧字段 source_type:MOCK 同样识别', async () => {
      api.runUltraShort.mockResolvedValueOnce(ultra96({ mock: false, source_type: 'MOCK', warnings: ['仅历史回放'] }))
      const wrapper = await render({ target: 'load', targetDate: '2026-06-25' })
      await clickUltra(wrapper)
      const card = wrapper.findAll('.ext-card')[0]
      expect(card.text()).toContain('模拟数据')
      expect(card.find('.fp-warn').text()).toBe('提示 1')
    })

    it('非 mock（REAL、warnings 为空）不显示任何标签', async () => {
      api.runUltraShort.mockResolvedValueOnce(ultra96({ mock: false, sourceType: 'REAL', productionWrite: false, warnings: [] }))
      api.runMidterm.mockResolvedValueOnce({
        basis: 'captured', horizon_days: 14, daily_avg_price: [100], mae: 1, persistence_mae: 2,
        mase_vs_persistence: 0.5, beats_persistence: true, unit: '元/MWh',
        mock: false, sourceType: 'REAL', productionWrite: false, warnings: [],
      })
      const wrapper = await render({ target: 'load', targetDate: '2026-06-25' })
      await clickUltra(wrapper)
      await clickMid(wrapper)
      expect(wrapper.find('.fp-tags').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('模拟数据')
    })

    it('旧后端无任何来源字段：默认响应正常渲染、无标签、不崩', async () => {
      const wrapper = await render()
      await clickMid(wrapper)
      expect(wrapper.text()).toContain('MAE 1.2 MW')
      expect(wrapper.find('.fp-tags').exists()).toBe(false)
    })

    it('warnings 非数组或含空串（异常形态）不崩，也不渲染空提示', async () => {
      api.runMidterm.mockResolvedValueOnce({
        basis: 'captured', horizon_days: 14, daily_avg_price: [100], mae: 1, persistence_mae: 2,
        mase_vs_persistence: 0.5, beats_persistence: true, unit: '元/MWh', warnings: '不是数组',
      })
      const wrapper = await render()
      await clickMid(wrapper)
      expect(wrapper.text()).toContain('MAE 1.0')
      expect(wrapper.find('.fp-warn').exists()).toBe(false)
    })

    it('中长期 UNAVAILABLE：空态「暂无可用预测」+ 原因，不是红色报错，也不画图', async () => {
      api.runMidterm.mockResolvedValueOnce({
        available: false, reason: '南洋无 yunnan 中长期模型', mock: false, sourceType: 'UNAVAILABLE', productionWrite: false,
      })
      const wrapper = await render()
      await clickMid(wrapper)
      const card = wrapper.findAll('.ext-card')[1]
      expect(card.find('.empty-state').text()).toContain('暂无可用预测')
      expect(card.find('.empty-state').text()).toContain('南洋无 yunnan 中长期模型')
      expect(card.find('.alert').exists()).toBe(false)
      expect(card.find('.basis').exists()).toBe(false)
      expect(chartState.init).not.toHaveBeenCalled()
    })

    it('超短期 UNAVAILABLE 走空态；随后重跑成功会清掉空态', async () => {
      api.runUltraShort.mockResolvedValueOnce({
        available: false, reason: '南洋无超短期模型', mock: false, source_type: 'UNAVAILABLE', productionWrite: false,
      })
      const wrapper = await render()
      await clickUltra(wrapper)
      const card = wrapper.findAll('.ext-card')[0]
      expect(card.find('.empty-state').text()).toContain('南洋无超短期模型')
      expect(card.find('.alert').exists()).toBe(false)
      await clickUltra(wrapper)
      expect(card.find('.empty-state').exists()).toBe(false)
    })
  })
})
