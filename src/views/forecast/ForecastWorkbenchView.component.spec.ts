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
  providersForTarget: (target: string) => rows.value.filter((row) => row.supportedTargets.includes(target)),
  catalogModelsForTarget: (target: string) => rows.value
    .filter((row) => row.supportedTargets.includes(target))
    .map((row) => ({ modelId: row.id, namespace: 'remote', available: row.available ?? true, supportedTargets: row.supportedTargets })),
  isCatalogModelUsableForTarget: (model: { available?: boolean; supportedTargets?: string[] }, target: string) =>
    model.available === true && Array.isArray(model.supportedTargets) && model.supportedTargets.includes(target),
  ensureForecastCatalog: async () => { rows.value = await api.load() },
  forecastCatalogState: () => ({ error: ref(''), loading: ref(false), models: ref([]) }),
}))
vi.mock('@/services/forecast/officialBaseline', async (original) => ({
  ...await original<typeof import('@/services/forecast/officialBaseline')>(),
  hasOfficialBaseline: () => false, officialMae: () => null, fetchOfficialBaseline: vi.fn(),
}))
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
function provider(overrides: Partial<ForecastProvider> & Pick<ForecastProvider, 'id' | 'name'>): ForecastProvider {
  return {
    kind: overrides.kind ?? 'compute',
    tier: overrides.tier ?? 'deep',
    available: overrides.available ?? true,
    supportedTargets: overrides.supportedTargets ?? ['price_user_da_settlement'],
    paramsSchema: overrides.paramsSchema ?? [],
    run: overrides.run ?? api.run,
    ...overrides,
  }
}
const slot = { template: '<div><slot/></div>' }
const wrappers: VueWrapper[] = []
async function render() {
  const wrapper = mount(Workbench, { global: { directives: { loading: () => {} }, stubs: {
    ElCard: slot, ElTabs: { name: 'ElTabs', props: ['modelValue'], emits: ['update:modelValue'], template: '<div><slot/></div>' }, ElTabPane: slot, ElTag: slot, ElDescriptions: slot, ElDescriptionsItem: slot,
    ElCheckboxGroup: { name: 'ElCheckboxGroup', props: ['modelValue'], emits: ['update:modelValue'], template: '<div><slot/></div>' },
    ElCheckbox: { name: 'ElCheckbox', props: ['modelValue', 'value', 'disabled', 'border', 'title'], template: '<label><slot/></label>' },
    ElRow: slot, ElCol: slot, ElRadioGroup: slot, ElRadioButton: slot,
    ElEmpty: { props: ['description'], template: '<p>{{description}}</p>' }, ElInputNumber: { name: 'ElInputNumber', props: ['modelValue'], template: '<input/>' },
    ElTable: { name: 'ElTable', props: ['data'], template: '<div><span v-for="row in data" :key="row.id">{{row.name}}</span></div>' }, ElTableColumn: true,
    ElDatePicker: { name: 'ElDatePicker', props: ['modelValue'], template: '<input/>' },
    ElSelect: { name: 'ElSelect', props: ['modelValue'], template: '<div><slot/></div>' },
    ElOption: { props: ['label'], template: '<span>{{label}}</span>' },
    ElButton: { props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot/></button>' },
    ElAlert: { props: ['title'], template: '<p>{{title}}</p>' }, DataBasisBadge: true, DynamicParamPanel: true,
    ForecastExtraPanel: { template: '<div/>', methods: { resize: () => {} } },
    DailyDisclosureOverview: { name: 'DailyDisclosureOverview', props: ['regionId', 'date'], template: '<div>当日披露总览</div>', methods: { resize: () => {} } },
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
async function runCompare(wrapper: VueWrapper) {
  await wrapper.findAll('button').find((button) => button.text() === '运行对比')!.trigger('click')
  await flushPromises()
}
async function setCompareIds(wrapper: VueWrapper, ids: string[]) {
  wrapper.findComponent({ name: 'ElCheckboxGroup' }).vm.$emit('update:modelValue', ids)
  await flushPromises()
}
function chart(wrapper: VueWrapper) { return wrapper.findAllComponents({ name: 'UnifiedForecastChart' })[0] }
function compareChart(wrapper: VueWrapper) { return wrapper.findAllComponents({ name: 'UnifiedForecastChart' })[1] }
beforeEach(() => {
  rows.value = []; route.query.date = '2026-06-25'; route.query.target = 'price_user_da_settlement'
  setCurrentRegionId('yunnan')
  api.run.mockReset().mockResolvedValue(result())
  api.load.mockReset().mockResolvedValue([provider({ id: 'remote:test', name: '测试远端模型' })])
})
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()) })

describe('建模工作台的目标日上下文', () => {
  it('云南多目标总览接入全部披露，日期标明源记录日，不再用预测目标过滤', async () => {
    const wrapper = await render()
    expect(wrapper.findComponent({ name: 'DailyDisclosureOverview' }).exists()).toBe(false)
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'overview')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'DailyDisclosureOverview' }).props()).toMatchObject({ regionId: 'yunnan', date: '2026-06-25' })
    expect(wrapper.text()).toContain('披露记录日期')
    expect(wrapper.find('.shared').text()).not.toContain('历史范围')
    expect(wrapper.find('.shared').text()).not.toContain('预测目标')
    expect(wrapper.text()).not.toContain('加载平台官方总览')
    route.query.date = '2026-06-26'; await flushPromises()
    expect(wrapper.findComponent({ name: 'DailyDisclosureOverview' }).props('date')).toBe('2026-06-26')
    expect(api.run).not.toHaveBeenCalled()
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'single'); await flushPromises()
    expect(wrapper.find('.shared').text()).toContain('预测目标')
  })
  it('多算法区使用等宽网格清单，名称保持单行省略且不再显示第二行运行类型', async () => {
    const longName = '云南日前统一结算电价 Dynamic TMoE 协变量训练版本'
    api.load.mockResolvedValueOnce([
      provider({ id: 'remote:long-name', name: longName }),
      provider({ id: 'platform', name: '平台官方', kind: 'replay' }),
    ])
    const wrapper = await render()
    const group = wrapper.find('.compare-checkboxes')
    expect(group.attributes('aria-labelledby')).toBe('compare-algorithm-label')
    expect(wrapper.find('#compare-algorithm-label').text()).toBe('参与对比的算法')
    expect(group.findAll('.compare-model-name').map((item) => item.text())).toEqual([longName, '平台官方'])
    expect(group.findAll('.compare-model-kind')).toHaveLength(0)
    expect(wrapper.find('.compare-controls').findAll('button').map((item) => item.text())).toEqual(['运行对比'])
  })
  it('对比计算中锁定勾选，结束后恢复，避免当前选择与进行中的结果混淆', async () => {
    const pending = deferred<UnifiedForecastResult>()
    api.run.mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    await setCompareIds(wrapper, ['remote:test'])
    await runCompare(wrapper)
    expect(wrapper.find('.compare-checkboxes').findAllComponents({ name: 'ElCheckbox' }).map((item: VueWrapper) => item.props())).toEqual([expect.objectContaining({ disabled: true })])
    pending.resolve(result()); await flushPromises()
    expect(wrapper.find('.compare-checkboxes').findAllComponents({ name: 'ElCheckbox' }).map((item: VueWrapper) => item.props())).toEqual([expect.objectContaining({ disabled: false })])
    expect(compareChart(wrapper).props('results')).toHaveLength(1)
  })
  it('多算法对比串行执行、逐个回显进度，单个失败不中断后续且汇总失败原因（#3578）', async () => {
    api.load.mockResolvedValueOnce([
      provider({ id: 'm1', name: '算法一' }), provider({ id: 'm2', name: '算法二' }), provider({ id: 'm3', name: '算法三' }),
    ])
    const first = deferred<UnifiedForecastResult>()
    const third = deferred<UnifiedForecastResult>()
    api.run.mockReset()
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('预测耗时过长已超时，可稍后重试或减少同时对比的算法'))
      .mockReturnValueOnce(third.promise)
    const wrapper = await render()
    await setCompareIds(wrapper, ['m1', 'm2', 'm3'])
    await runCompare(wrapper)
    // 第一个未完成时后两个不得发出
    expect(api.run).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.compare-progress').text()).toBe('已完成 0/3')
    first.resolve(result()); await flushPromises()
    // 第二个立即失败 → 第三个才发出；进度含失败项
    expect(api.run).toHaveBeenCalledTimes(3)
    expect(wrapper.find('.compare-progress').text()).toBe('已完成 2/3')
    third.resolve(result()); await flushPromises()
    expect(wrapper.find('.compare-progress').exists()).toBe(false)
    expect(compareChart(wrapper).props('results').map((r: { provider: string }) => r.provider)).toEqual(['算法一', '算法三'])
    expect(wrapper.text()).toContain('算法二')
    expect(wrapper.text()).toContain('预测耗时过长已超时')
  })
  it('单算法、多算法和可见台账均不显示占位、未部署与原始零样本名称', async () => {
    api.load.mockResolvedValueOnce([
      provider({ id: 'tslib:DLinear', name: 'DLinear compat', mock: true }),
      provider({ id: 'remote:offline', name: '未部署远端模型', available: false }),
      provider({ id: 'remote:chronos-bolt-base', name: 'Chronos Bolt Base', capabilities: { zeroShot: true } as ForecastProvider['capabilities'] }),
      provider({ id: 'remote:test', name: '测试远端模型' }),
    ])
    const wrapper = await render()
    expect(wrapper.text()).toContain('测试远端模型')
    expect(wrapper.text()).not.toContain('DLinear compat')
    expect(wrapper.text()).not.toContain('未部署远端模型')
    expect(wrapper.text()).not.toContain('Chronos Bolt Base')
  })
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
  it('目录只剩占位或原始零样本时，禁预测并显示诚实空态', async () => {
    api.load.mockResolvedValueOnce([
      provider({ id: 'tslib:PatchTST', name: 'PatchTST compat', mock: true }),
      provider({ id: 'remote:chronos-bolt-base', name: 'Chronos Bolt Base', source: 'remote:zeroshot' }),
      provider({ id: 'remote:offline', name: '未部署远端模型', available: false }),
    ])
    const wrapper = await render()
    expect(api.run).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('当前地区暂无已接入预测目标')
    expect(wrapper.findAll('button').find((button) => button.text() === '预测')?.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').find((button) => button.text() === '运行对比')?.attributes('disabled')).toBeDefined()
  })
  it('没有目录绑定真模型时，KNN/平台官方这类可运行入口仍应保留目标下拉，不得误报当前地区暂无预测目标', async () => {
    route.query.target = undefined as unknown as string
    api.load.mockResolvedValue([
      provider({ id: 'knn', name: 'KNN 相似日（基线）', supportedTargets: ['price', 'load'] }),
      provider({ id: 'platform', name: '平台官方', kind: 'replay', tier: 'official', supportedTargets: ['price'] }),
    ])
    const wrapper = await render()
    expect(wrapper.text()).not.toContain('当前地区暂无已接入预测目标')
    await run(wrapper)
    expect(api.run).toHaveBeenCalledWith(
      expect.objectContaining({ regionId: 'yunnan', target: 'price', targetDate: '2026-06-25', granularity: 96 }),
      expect.objectContaining({ train_days: 180 }),
    )
  })
  it('同上下文目录变动后单算法旧模型会被清掉，迟到结果不能再回写，后续只执行新的可见模型', async () => {
    const pending = deferred<UnifiedForecastResult>()
    const oldRun = vi.fn().mockReturnValueOnce(pending.promise)
    const newRun = vi.fn().mockResolvedValue({
      ...result(),
      modelId: 'remote:new',
      points: Array(24).fill(188),
    })
    api.load
      .mockResolvedValueOnce([provider({ id: 'remote:old', name: '旧模型', run: oldRun })])
    const wrapper = await render()
    await run(wrapper)
    rows.value = [
      provider({ id: 'remote:old', name: '旧模型', capabilities: { zeroShot: true } as ForecastProvider['capabilities'], run: oldRun }),
      provider({ id: 'remote:new', name: '新模型', run: newRun }),
    ]
    await flushPromises()
    pending.resolve(result())
    await flushPromises()
    expect(chart(wrapper).props('results')).toEqual([])
    await run(wrapper)
    expect(oldRun).toHaveBeenCalledTimes(1)
    expect(newRun).toHaveBeenCalledWith(
      expect.objectContaining({ regionId: 'yunnan', target: 'price_user_da_settlement', targetDate: '2026-06-25' }),
      expect.objectContaining({ train_days: 180 }),
    )
    expect(wrapper.text()).toContain('新模型')
    expect(wrapper.text()).not.toContain('旧模型（')
  })
  it('同上下文目录变动会清掉已选对比模型，作废旧 compare 响应，手工注入隐藏ID也不能执行', async () => {
    const keepPending = deferred<UnifiedForecastResult>()
    const hiddenPending = deferred<UnifiedForecastResult>()
    const keepRun = vi.fn().mockReturnValueOnce(keepPending.promise)
    const hiddenRun = vi.fn().mockReturnValueOnce(hiddenPending.promise)
    api.load.mockResolvedValueOnce([
      provider({ id: 'remote:keep', name: '保留模型', run: keepRun }),
      provider({ id: 'remote:gone', name: '旧占位模型', run: hiddenRun }),
    ])
    const wrapper = await render()
    await setCompareIds(wrapper, ['remote:keep', 'remote:gone'])
    await runCompare(wrapper)
    // 串行（#3578）：第一个未结束时第二个不发出
    expect(keepRun).toHaveBeenCalledTimes(1)
    expect(hiddenRun).toHaveBeenCalledTimes(0)
    rows.value = [
      provider({ id: 'remote:keep', name: '保留模型', run: keepRun }),
      provider({ id: 'remote:gone', name: '旧占位模型', capabilities: { zeroShot: true } as ForecastProvider['capabilities'], run: hiddenRun }),
    ]
    await flushPromises()
    hiddenPending.resolve({ ...result(), modelId: 'remote:gone' })
    keepPending.resolve({ ...result(), modelId: 'remote:keep' })
    await flushPromises()
    expect(compareChart(wrapper).props('results')).toEqual([])
    await setCompareIds(wrapper, ['remote:gone'])
    await runCompare(wrapper)
    expect(hiddenRun).toHaveBeenCalledTimes(0)
    expect(keepRun).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('所有算法预测均失败')
  })
})
