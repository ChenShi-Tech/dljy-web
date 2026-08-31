// 在线面板必须把选定日期送到后端，清除旧曲线并保留失败/模拟语义（dljy-web#54）。
// 内存组件测试，不访问网站或远端服务，不代替浏览器验收。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { ForecastModelCatalog, ForecastResult } from '@/services/forecast/mlForecastClient'

const api = vi.hoisted(() => ({ models: vi.fn(), predict: vi.fn() }))
vi.mock('@/services/forecast/mlForecastClient', async (original) => ({
  ...await original<typeof import('@/services/forecast/mlForecastClient')>(),
  fetchForecastModels: api.models, runForecastPredict: api.predict,
}))
import Panel from './TslibOnlineForecastPanel.vue'
import Chart from './UnifiedForecastChart.vue'

const target = 'price_user_da_settlement'
function catalog(region = 'yunnan', id = 'remote:test', available = true): ForecastModelCatalog {
  return { regionId: region, target, available: true, unavailableReason: null,
    models: [{ modelId: id, name: id, available, unavailableReason: available ? null : '缺权重' }] } as ForecastModelCatalog
}
function forecast(date = '2026-06-25'): ForecastResult {
  return { task: { region_id: 'yunnan', target, model_type: 'remote:test', target_date: date },
    points: Array(24).fill(100), actual: Array(24).fill(101), slots: Array.from({ length: 24 }, (_, i) => i),
    lower: [], upper: [], metrics: { mae: 1, rmse: 1, mase_vs_naive: 0.5, improve_vs_knn_pct: 50, passes_gate: false },
    baseline_metrics: { naive_mae: 2, knn_mae: 2 },
    baseline_curves: { naive: Array(24).fill(102) }, evaluation_mode: 'backtest',
    basis: 'captured', mock: false, unit: '元/MWh', warnings: [], model_version: 'v1' } as ForecastResult
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const stubs = {
  ElCard: { template: '<section><slot name="header"/><slot/></section>' },
  ElSelect: { name: 'ElSelect', props: ['modelValue'], template: '<div><slot/></div>' },
  ElOption: { name: 'ElOption', props: ['disabled', 'label', 'value'], template: '<span>{{label}}</span>' },
  ElDatePicker: { name: 'ElDatePicker', props: ['modelValue'], template: '<input />' },
  ElInputNumber: true, ElTag: { template: '<span><slot/></span>' },
  ElButton: { name: 'ElButton', props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot/></button>' },
  ElAlert: { props: ['title'], template: '<p class="alert">{{title}}</p>' },
  ElEmpty: { props: ['description'], template: '<p>{{description}}</p>' },
  DataBasisBadge: true, UnifiedForecastChart: true,
}
const wrappers: VueWrapper[] = []
async function render(props = {}) {
  const wrapper = mount(Panel, { props: { target, targetDate: '2026-06-25', regionId: 'yunnan', ...props }, global: { stubs } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
async function run(wrapper: VueWrapper) {
  await wrapper.find('button').trigger('click')
  await flushPromises()
}
beforeEach(() => { api.models.mockReset().mockResolvedValue(catalog()); api.predict.mockReset().mockResolvedValue(forecast()) })
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()) })

describe('在线面板真实请求与响应', () => {
  it('默认真实数据，显式传日期，图层得到24点、真值、基线和历史模式', async () => {
    const wrapper = await render()
    await run(wrapper)
    expect(api.predict).toHaveBeenCalledWith(expect.objectContaining({ target_date: '2026-06-25', data_source: 'auto', target, region_id: 'yunnan', model_type: 'remote:test' }))
    const value = wrapper.findComponent(Chart).props('results')[0].result
    expect(value).toMatchObject({ granularity: 24, evaluationMode: 'backtest', mock: false })
    expect(value.actual).toEqual(Array(24).fill(101))
    expect(value.baselines?.naive).toEqual(Array(24).fill(102))
    expect(wrapper.text()).toContain('未达到预测质量门槛')
  })
  it('无日期不自动改算默认日，HTTP200不可用也不会留下前次成功曲线', async () => {
    const wrapper = await render({ targetDate: '' })
    await run(wrapper)
    expect(api.predict).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请选择有效的目标日期')
    await wrapper.setProps({ targetDate: '2026-06-25' })
    await run(wrapper)
    expect(wrapper.findComponent(Chart).exists()).toBe(true)
    api.predict.mockResolvedValueOnce({ available: false, reason: '真实历史不足' })
    await run(wrapper)
    expect(wrapper.text()).toContain('真实历史不足')
    expect(wrapper.findComponent(Chart).exists()).toBe(false)
  })
  it('A→B→A切日期仍丢弃旧A请求', async () => {
    const pending = deferred<ForecastResult>()
    api.predict.mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    await run(wrapper)
    await wrapper.setProps({ targetDate: '2026-06-26' })
    await wrapper.setProps({ targetDate: '2026-06-25' })
    pending.resolve(forecast())
    await flushPromises()
    expect(wrapper.findComponent(Chart).exists()).toBe(false)
  })
  it('旧请求结束不会提前取消新请求加载状态', async () => {
    const first = deferred<ForecastResult>(), second = deferred<ForecastResult>()
    api.predict.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const wrapper = await render()
    await run(wrapper)
    await wrapper.setProps({ targetDate: '2026-06-26' })
    await run(wrapper)
    first.resolve(forecast())
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ElButton' }).props('loading')).toBe(true)
    second.resolve(forecast('2026-06-26'))
    await flushPromises()
    expect(wrapper.findComponent(Chart).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ElButton' }).props('loading')).toBe(false)
  })
  it('地区目录迟到不能覆盖新目录，不可用模型不留下选项', async () => {
    const pending = deferred<ForecastModelCatalog>()
    api.models.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(catalog('shanxi', 'remote:new', false))
    const wrapper = await render()
    await wrapper.setProps({ regionId: 'shanxi' })
    await flushPromises()
    pending.resolve(catalog())
    await flushPromises()
    expect(wrapper.text()).toContain('暂无符合条件的在线模型')
    expect(wrapper.text()).not.toContain('remote:new')
    expect(wrapper.text()).not.toContain('remote:test')
    expect(wrapper.findComponent({ name: 'ElButton' }).props('disabled')).toBe(true)
  })
  it('在线面板隐藏占位和可运行的原始权重，仅向保留的真实模型发送请求', async () => {
    const data = catalog()
    data.models.push(
      { ...data.models[0], modelId: 'tslib:TimesNet' },
      { ...data.models[0], modelId: 'remote:raw-weights', source: 'remote:zeroshot' },
      { ...data.models[0], modelId: 'remote:missing', available: false },
    )
    data.models.forEach((model) => { model.name = model.modelId })
    api.models.mockResolvedValueOnce(data)
    const wrapper = await render()
    const options = wrapper.findAllComponents({ name: 'ElOption' }).map((option) => option.props('value'))
    expect(options).toContain('remote:test')
    expect(options).not.toContain('tslib:TimesNet')
    expect(options).not.toContain('remote:raw-weights')
    expect(options).not.toContain('remote:missing')
    await run(wrapper)
    expect(api.predict).toHaveBeenCalledWith(expect.objectContaining({ model_type: 'remote:test' }))
    wrapper.findAllComponents({ name: 'ElSelect' })[0].vm.$emit('update:modelValue', 'tslib:TimesNet')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ElButton' }).props('disabled')).toBe(true)
    expect(wrapper.findComponent(Chart).exists()).toBe(false)
  })
  it('改数据源立即清除旧曲线，合成标签持续可见', async () => {
    const wrapper = await render()
    await run(wrapper)
    wrapper.findAllComponents({ name: 'ElSelect' })[1].vm.$emit('update:modelValue', 'synthetic')
    await nextTick()
    expect(wrapper.findComponent(Chart).exists()).toBe(false)
    expect(wrapper.text()).toContain('模拟或合成验证')
  })
})
