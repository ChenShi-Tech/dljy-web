// 工作台必须消费URL目标/日期，切日期后不能保留或接受旧曲线（dljy-web#54）。
// 此测试隔离模型计算，验证组件状态与传参；不声称已在真实网站点击。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import type { ForecastProvider, UnifiedForecastResult } from '@/services/forecast/forecastProviders'

const api = vi.hoisted(() => ({ run: vi.fn(), load: vi.fn() }))
const route = reactive({ query: { date: '2026-06-25', target: 'price_user_da_settlement' } })
const rows = ref<ForecastProvider[]>([])
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/services/forecast/forecastProviders', async (original) => ({
  ...await original<typeof import('@/services/forecast/forecastProviders')>(),
  providersForTarget: () => rows.value,
  ensureForecastCatalog: async () => { rows.value = await api.load() },
  forecastCatalogState: () => ({ error: ref('') }),
}))
vi.mock('@/services/forecast/officialBaseline', () => ({ hasOfficialBaseline: () => false, officialMae: () => null, fetchOfficialBaseline: vi.fn() }))
vi.mock('@/services/forecast/forecastBenchContext', () => ({ publishBenchContext: vi.fn() }))
import Workbench from './ForecastWorkbenchView.vue'
import { setCurrentRegionId } from '@/services/region/regionContext'

function result(): UnifiedForecastResult {
  return { points: Array(24).fill(150), actual: Array(24).fill(151), unit: '元/MWh', basis: 'captured', mock: false,
    granularity: 24, modelId: 'remote:test', evaluationMode: 'backtest', metrics: { mae: 1 } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => { resolve = done }), resolve: (value: T) => resolve(value) }
}
const slot = { template: '<div><slot/></div>' }
const wrappers: VueWrapper[] = []
async function render() {
  const wrapper = mount(Workbench, { global: { directives: { loading: () => {} }, stubs: {
    ElCard: slot, ElTabs: slot, ElTabPane: slot, ElTag: slot, ElDescriptions: slot, ElDescriptionsItem: slot,
    ElCheckboxGroup: slot, ElCheckbox: slot, ElRow: slot, ElCol: slot, ElRadioGroup: slot, ElRadioButton: slot,
    ElEmpty: true, ElInputNumber: { name: 'ElInputNumber', props: ['modelValue'], template: '<input/>' }, ElTable: true, ElTableColumn: true,
    ElDatePicker: { name: 'ElDatePicker', props: ['modelValue'], template: '<input/>' },
    ElSelect: { name: 'ElSelect', props: ['modelValue'], template: '<div><slot/></div>' },
    ElOption: { props: ['label'], template: '<span>{{label}}</span>' },
    ElButton: { props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot/></button>' },
    ElAlert: { props: ['title'], template: '<p>{{title}}</p>' }, DataBasisBadge: true, DynamicParamPanel: true,
    ForecastExtraPanel: { template: '<div/>', methods: { resize: () => {} } },
    UnifiedForecastChart: { name: 'UnifiedForecastChart', props: ['results'], template: '<div/>', methods: { resize: () => {} } },
  } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
async function run(wrapper: VueWrapper) {
  await wrapper.findAll('button').find((button) => button.text() === '预测')!.trigger('click')
  await flushPromises()
}
function chart(wrapper: VueWrapper) { return wrapper.findAllComponents({ name: 'UnifiedForecastChart' })[0] }
beforeEach(() => {
  rows.value = []; route.query.date = '2026-06-25'; route.query.target = 'price_user_da_settlement'
  setCurrentRegionId('yunnan')
  api.run.mockReset().mockResolvedValue(result())
  api.load.mockReset().mockResolvedValue([{ id: 'remote:test', name: '测试远端模型', kind: 'compute', tier: 'deep', available: true, supportedTargets: ['price_user_da_settlement'], paramsSchema: [], run: api.run }])
})
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()) })

describe('建模工作台的目标日上下文', () => {
  it('异步目录到达后可选模型，URL日期和用户结算价目标用于实际调用', async () => {
    const wrapper = await render()
    await run(wrapper)
    expect(api.run).toHaveBeenCalledWith({ regionId: 'yunnan', target: 'price_user_da_settlement', targetDate: '2026-06-25', granularity: 24, historyDays: 180 }, { train_days: 180 })
    expect(chart(wrapper).props('results')[0].result.actual).toEqual(Array(24).fill(151))
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', '2026-06-26')
    await flushPromises()
    expect(chart(wrapper).props('results')).toEqual([])
  })
  it('共享历史窗口不会被算法默认180天覆盖', async () => {
    const wrapper = await render()
    wrapper.findComponent({ name: 'ElInputNumber' }).vm.$emit('update:modelValue', 90)
    await flushPromises()
    await run(wrapper)
    expect(api.run).toHaveBeenLastCalledWith(expect.objectContaining({ historyDays: 90 }), expect.objectContaining({ train_days: 90 }))
  })
  it('日期A→B→A的旧响应不能再写回，失败重跑也不能保留旧成功', async () => {
    const pending = deferred<UnifiedForecastResult>()
    api.run.mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    await run(wrapper)
    route.query.date = '2026-06-26'; await flushPromises()
    route.query.date = '2026-06-25'; await flushPromises()
    pending.resolve(result()); await flushPromises()
    expect(chart(wrapper).props('results')).toEqual([])
    await run(wrapper)
    expect(chart(wrapper).props('results')).toHaveLength(1)
    api.run.mockRejectedValueOnce(new Error('真实数据不足'))
    await run(wrapper)
    expect(chart(wrapper).props('results')).toEqual([])
    expect(wrapper.text()).toContain('真实数据不足')
  })
  it('非法日期不调用模型，也不偷偷改算旧的固定日期', async () => {
    route.query.date = '2026-02-30'
    const wrapper = await render()
    await run(wrapper)
    expect(api.run).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请选择有效的预测日期')
  })
})
