// 申报决策驾驶舱必须只展示当前页可执行的真实模型；旧 deep link / 建模残留的隐藏模型 ID 不得继续运行。
// 首载/切区目录的旧完成回调不能清空新地区模型或重复预测；覆盖 A→B→A 与卸载后的晚到响应。
// 组件测试只验证前端状态与传参，不访问真实网站、服务或浏览器。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

type RouteQuery = Record<string, string>
type BenchContext = { seq: number; modelId?: string; targetDate: string; trainDays: number }
type ForecastLeg = 'price' | 'load'
type MockForecastRequest = { model_type?: string; target?: ForecastLeg }
type MockForecastModel = {
  modelId: string
  name: string
  available: boolean
  supportedTargets?: ForecastLeg[]
  provenance: { basis: string; sourceType: string; mock: boolean; productionWrite: boolean }
  source?: string
  framework?: string
  capabilities?: { zeroShot?: boolean }
}
type RegionCatalog = {
  price: MockForecastModel[]
  load: MockForecastModel[]
  priceError?: string
  loadError?: string
}

const state = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    route: ref<RouteQuery>({}),
    latestBenchContext: ref<BenchContext | null>(null),
    currentRegionId: ref('yunnan'),
    priceModels: ref<MockForecastModel[]>([]),
    loadModels: ref<MockForecastModel[]>([]),
    priceCatalogError: ref(''),
    loadCatalogError: ref(''),
    regionCatalogs: ref<Record<string, RegionCatalog>>({}),
  }
})
const api = vi.hoisted(() => ({
  predict: vi.fn(),
  optimize: vi.fn(),
  risk: vi.fn(),
  advice: vi.fn(),
  cockpit: vi.fn(),
  clearing: vi.fn(),
  ensureCatalog: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: state.route.value }),
}))
vi.mock('@/services/forecast/forecastBenchContext', () => ({
  latestBenchContext: state.latestBenchContext,
}))
vi.mock('@/services/region/regionContext', () => ({
  currentRegion: computed(() => ({ id: state.currentRegionId.value, name: state.currentRegionId.value })),
}))
// 保留真实 onRegionChange 的 Vue watch，确保切区会走页面的真实目录重载流程。
vi.mock('@/services/region/regionModules', () => ({
  getRegionCapabilityForPath: () => ({ status: 'available' }),
}))
vi.mock('@/components/region/RegionDataBanner.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/CapabilitySupportBadge.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/spot/cockpit/CockpitRegionLockedCard.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataBasisBadge.vue', () => ({ default: { props: ['basis', 'prefix'], template: '<span>{{prefix}} {{basis}}</span>' } }))
vi.mock('@/components/common/TrustBadge.vue', () => ({ default: { props: ['basis', 'prefix'], template: '<span>{{prefix}} {{basis}}</span>' } }))
vi.mock('@/composables/useEChart', () => ({
  useEChart: () => ({ setOption: vi.fn() }),
}))
vi.mock('@/services/market/spotPrice', () => ({
  loadClearingCurve: (...args: unknown[]) => api.clearing(...args),
}))
vi.mock('@/services/forecast/forecastProviders', () => ({
  ensureForecastCatalog: (...args: unknown[]) => api.ensureCatalog(...args),
  forecastCatalogState: (target: ForecastLeg) => ({
    models: computed(() => state.regionCatalogs.value[state.currentRegionId.value]?.[target]
      ?? (target === 'price' ? state.priceModels.value : state.loadModels.value)),
    error: computed(() => state.regionCatalogs.value[state.currentRegionId.value]?.[`${target}Error`]
      ?? (target === 'price' ? state.priceCatalogError.value : state.loadCatalogError.value)),
  }),
  isPredictSupported: () => true,
  isModelSelectableForTarget: (model: MockForecastModel, target: ForecastLeg) =>
    model.available !== false && Array.isArray(model.supportedTargets) && model.supportedTargets.includes(target),
}))
vi.mock('@/services/forecast/mlForecastClient', () => ({
  runForecastPredict: (...args: unknown[]) => api.predict(...args),
  fetchOptimizeBid: (...args: unknown[]) => api.optimize(...args),
  fetchRiskQuantify: (...args: unknown[]) => api.risk(...args),
  fetchBidAdvice: (...args: unknown[]) => api.advice(...args),
  fetchCockpit: (...args: unknown[]) => api.cockpit(...args),
}))
vi.mock('@/services/chart/chartOptions', () => ({
  axisTooltip: () => ({}),
  chartToolbox: () => ({}),
  emptyOverlay: () => ({}),
  fmtNum: (value: number | null | undefined, digits = 0) =>
    value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits),
  insideZoom: () => ([]),
}))
vi.mock('@/services/chart/chartStyle', () => ({
  POWER: { positive: '#0a0', price: '#00f', deviation: '#f80', forecast: '#08f' },
  areaSeries: (..._args: unknown[]) => ({}),
  catAxis: (..._args: unknown[]) => ({}),
  grid: (..._args: unknown[]) => ({}),
  legend: (..._args: unknown[]) => ({}),
  lineSeries: (..._args: unknown[]) => ({}),
  stepSeries: (..._args: unknown[]) => ({}),
  tooltipStyle: () => ({}),
  valueAxis: (..._args: unknown[]) => ({}),
  withAlpha: (value: string) => value,
}))
vi.mock('lucide-vue-next', () => {
  const icon = { template: '<i />' }
  return {
    Activity: icon, ClipboardList: icon, Gauge: icon, LineChart: icon, Loader2: icon,
    RefreshCcw: icon, ShieldAlert: icon, SlidersHorizontal: icon, Sparkles: icon, TrendingUp: icon,
  }
})

import Cockpit from './ForecastDecisionCockpitView.vue'

function model(overrides: Partial<MockForecastModel>): MockForecastModel {
  return {
    modelId: 'remote:model',
    name: '真实模型',
    available: true,
    supportedTargets: ['price', 'load'],
    provenance: { basis: 'real', sourceType: 'REAL', mock: false, productionWrite: false },
    ...overrides,
  }
}
function forecast(overrides: Record<string, unknown> = {}) {
  return {
    task: { region_id: 'yunnan', target: 'price', model_type: 'remote:price-ok', target_date: '2026-06-25' },
    points: [100, 110],
    lower: [90, 100],
    upper: [110, 120],
    basis: 'captured',
    metrics: { conformal: true },
    warnings: [],
    ...overrides,
  }
}
function optimizeResult() {
  return {
    optimize_bid: {
      frontier: [{ lambda: 1, total_declared_mwh: 20, expected_profit_yuan: 3000, cvar_loss_yuan: 400, risk_level: 'neutral', bid_curve_mw: [8, 12] }],
      note: '',
      n_scenarios: 40,
    },
    forecast: { points: [10, 12], lower: [9, 11], upper: [11, 13] },
    source_type: 'REAL',
    mock: false,
    productionWrite: false,
  }
}
function riskResult() {
  return {
    risk_quantification: {
      expected_penalty_yuan: 1,
      var_penalty_yuan: 2,
      cvar_penalty_yuan: 3,
      var_net_loss_yuan: 4,
      cvar_net_loss_yuan: 5,
      forecast_value_yuan_per_10pct_tighter: 6,
      n_scenarios: 1000,
      expected_revenue_yuan: 7,
      expected_net_yuan: 8,
      high_risk_slots: 1,
      tolerance_pct: 3,
      note: '',
      alpha: 0.95,
    },
    quantile_calibrated: true,
    source_type: 'REAL',
    mock: false,
    productionWrite: false,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => { resolve = done }), resolve }
}

function requestUsesModel(input: unknown, modelType: string): boolean {
  return (input as MockForecastRequest).model_type === modelType
}

// 跨地区共有的真实模型排在第二项，防止修复时以“自动选首项”掩盖原选择被清空。
function sharedRuntimeCatalog(): RegionCatalog {
  const models = [
    model({ modelId: 'ridge', name: '线性基线' }),
    model({ modelId: 'xgboost', name: '跨地区真实算法' }),
  ]
  return { price: models, load: models }
}

function prepareRegionCatalogs() {
  state.route.value = { model: 'xgboost', date: '2026-06-25' }
  state.regionCatalogs.value = {
    yunnan: { price: [], load: [] },
    shanxi: { price: [], load: [] },
  }
}

const wrappers: VueWrapper[] = []
async function render() {
  const wrapper = mount(Cockpit, {
    global: {
      stubs: {
        RegionDataBanner: true,
        CapabilitySupportBadge: true,
        CockpitRegionLockedCard: true,
        DataBasisBadge: { props: ['basis', 'prefix'], template: '<span>{{prefix}} {{basis}}</span>' },
        TrustBadge: { props: ['basis', 'prefix'], template: '<span>{{prefix}} {{basis}}</span>' },
        ElTag: { template: '<span class="el-tag"><slot /></span>' },
        ElInputNumber: { name: 'ElInputNumber', props: ['modelValue'], template: '<input />' },
        ElSlider: { name: 'ElSlider', props: ['modelValue'], template: '<div />' },
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  state.route.value = { priceModel: 'remote:price-ok', loadModel: 'remote:load-ok', date: '2026-06-25' }
  state.latestBenchContext.value = null
  state.currentRegionId.value = 'yunnan'
  state.priceCatalogError.value = ''
  state.loadCatalogError.value = ''
  state.regionCatalogs.value = {}
  state.priceModels.value = [model({ modelId: 'remote:price-ok', name: '价格真模型', supportedTargets: ['price'] })]
  state.loadModels.value = [model({ modelId: 'remote:load-ok', name: '负荷真模型', supportedTargets: ['load'] })]
  api.ensureCatalog.mockReset().mockResolvedValue(undefined)
  api.predict.mockReset().mockResolvedValue(forecast())
  api.optimize.mockReset().mockResolvedValue(optimizeResult())
  api.risk.mockReset().mockResolvedValue(riskResult())
  api.advice.mockReset().mockResolvedValue({ advice: { subject_type: 'retailer', basis: 'captured', valley_threshold: 100, peak_threshold: 500, retailer: { expected_cost_yuan: 1000, cost_range_yuan: [900, 1100] } } })
  api.cockpit.mockReset().mockResolvedValue({ basis: 'captured', price_forecast: { points: [100, 110] }, bid_advice: { retailer: { expected_cost_yuan: 1000 } }, deviation_risk: { worst_penalty_yuan: 50 }, midterm_trend: { daily_avg_price: [100, 110], horizon_days: 7 } })
  api.clearing.mockReset().mockResolvedValue(null)
})
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()) })

describe('申报决策驾驶舱模型入口清理', () => {
  it('隐藏 deep link 指向的占位、零样本和错腿模型，但不会静默改跑别的模型', async () => {
    state.route.value = { priceModel: 'tslib:DLinear', loadModel: 'remote:raw-load', date: '2026-06-25' }
    state.priceModels.value = [
      model({ modelId: 'tslib:DLinear', name: 'DLinear 兼容占位', supportedTargets: ['price'] }),
      model({ modelId: 'remote:load-only', name: '负荷专用旧模型', supportedTargets: ['load'] }),
      model({ modelId: 'remote:price-ok', name: '价格真模型', supportedTargets: ['price'] }),
    ]
    state.loadModels.value = [
      model({ modelId: 'remote:raw-load', name: '原始零样本负荷', supportedTargets: ['load'], source: 'remote:zeroshot' }),
      model({ modelId: 'remote:price-only', name: '价格专用旧模型', supportedTargets: ['price'] }),
      model({ modelId: 'remote:load-ok', name: '负荷真模型', supportedTargets: ['load'] }),
    ]
    const wrapper = await render()
    expect(wrapper.text()).toContain('价格真模型')
    expect(wrapper.text()).toContain('负荷真模型')
    expect(wrapper.text()).not.toContain('DLinear 兼容占位')
    expect(wrapper.text()).not.toContain('原始零样本负荷')
    expect(wrapper.text()).not.toContain('负荷专用旧模型')
    expect(wrapper.text()).not.toContain('价格专用旧模型')
    expect(wrapper.text()).toContain('当前价格预测模型不可用，请另选模型')
    expect(wrapper.findAll('option').some((item) => item.text() === '请选择模型')).toBe(true)
    expect(api.predict).not.toHaveBeenCalled()
    expect(api.optimize).not.toHaveBeenCalled()
  })

  it('工作台残留的隐藏模型 ID 会被清空，顶部 badge 和实际请求都不再出现该 ID', async () => {
    state.priceModels.value = [
      model({ modelId: 'remote:raw-weights', name: '原始权重电价', supportedTargets: ['price'], framework: 'zeroshot/chronos_bolt' }),
      model({ modelId: 'remote:price-ok', name: '价格真模型', supportedTargets: ['price'] }),
    ]
    state.loadModels.value = [
      model({ modelId: 'remote:raw-weights', name: '原始权重负荷', supportedTargets: ['load'], framework: 'zeroshot/chronos_bolt' }),
      model({ modelId: 'remote:load-ok', name: '负荷真模型', supportedTargets: ['load'] }),
    ]
    const wrapper = await render()
    api.predict.mockClear()
    api.optimize.mockClear()
    state.latestBenchContext.value = { seq: 1, modelId: 'remote:raw-weights', targetDate: '2026-06-25', trainDays: 180 }
    await flushPromises()
    expect(wrapper.text()).not.toContain('remote:raw-weights')
    expect(wrapper.text()).not.toContain('原始权重电价')
    expect(wrapper.text()).not.toContain('原始权重负荷')
    expect(wrapper.text()).not.toContain('共形校准')
    expect(api.predict.mock.calls.every(([input]) => !requestUsesModel(input, 'remote:raw-weights'))).toBe(true)
    expect(api.optimize.mock.calls.every(([input]) => !requestUsesModel(input, 'remote:raw-weights'))).toBe(true)
    expect(api.predict).not.toHaveBeenCalled()
    expect(api.optimize).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('当前价格预测模型不可用，请另选模型')
  })

  it('同上下文目录变化把当前价格模型隐藏后，不会自动切到新模型，旧在途预测结果也会被丢弃', async () => {
    const stale = deferred<ReturnType<typeof forecast>>()
    api.predict
      .mockReset()
      .mockReturnValueOnce(stale.promise)
    const wrapper = await render()
    expect(api.predict).toHaveBeenNthCalledWith(1, expect.objectContaining({ model_type: 'remote:price-ok' }))
    state.priceModels.value = [
      model({ modelId: 'remote:price-ok', name: '旧价格模型', supportedTargets: ['price'], capabilities: { zeroShot: true } }),
      model({ modelId: 'remote:new-price', name: '新价格模型', supportedTargets: ['price'] }),
    ]
    await flushPromises()
    stale.resolve(forecast({ task: { region_id: 'yunnan', target: 'price', model_type: 'remote:price-ok', target_date: '2026-06-25' } }))
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧价格模型')
    expect(wrapper.text()).toContain('新价格模型')
    expect(wrapper.text()).not.toContain('remote:price-ok')
    expect(wrapper.text()).not.toContain('共形校准')
    expect(api.predict).toHaveBeenCalledTimes(1)
    expect(api.optimize).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('当前价格预测模型不可用，请另选模型')
  })

  it.each([
    {
      caseName: '唯一价格候选被标成 zeroShot',
      nextPriceModels: [
        model({ modelId: 'remote:price-ok', name: '唯一价格模型', supportedTargets: ['price'], capabilities: { zeroShot: true } }),
      ],
    },
    {
      caseName: '已就绪价格目录变空',
      nextPriceModels: [],
    },
  ])('$caseName 时会清空选择、丢弃迟到结果且不再发新预测优化', async ({ nextPriceModels }) => {
    const stale = deferred<ReturnType<typeof forecast>>()
    state.priceModels.value = [
      model({ modelId: 'remote:price-ok', name: '唯一价格模型', supportedTargets: ['price'] }),
    ]
    api.predict
      .mockReset()
      .mockReturnValueOnce(stale.promise)
    const wrapper = await render()
    expect(api.predict).toHaveBeenNthCalledWith(1, expect.objectContaining({ model_type: 'remote:price-ok' }))
    state.priceModels.value = nextPriceModels
    await flushPromises()
    stale.resolve(forecast({ task: { region_id: 'yunnan', target: 'price', model_type: 'remote:price-ok', target_date: '2026-06-25' } }))
    await flushPromises()
    expect(wrapper.findAll('select')[0]?.element.value).toBe('')
    expect(wrapper.text()).not.toContain('共形校准')
    expect(wrapper.text()).toContain('当前价格预测模型不可用，请另选模型')
    expect(api.predict).toHaveBeenCalledTimes(1)
    expect(api.optimize).not.toHaveBeenCalled()
  })

  it('合法的非首项 deep link 会等目录异步到齐后保留原选择，不会被提前清空', async () => {
    state.route.value = { priceModel: 'remote:price-b', loadModel: 'remote:load-b', date: '2026-06-25' }
    state.priceModels.value = []
    state.loadModels.value = []
    api.ensureCatalog.mockReset().mockImplementation(async () => {
      state.priceModels.value = [
        model({ modelId: 'remote:price-a', name: '价格模型 A', supportedTargets: ['price'] }),
        model({ modelId: 'remote:price-b', name: '价格模型 B', supportedTargets: ['price'] }),
      ]
      state.loadModels.value = [
        model({ modelId: 'remote:load-a', name: '负荷模型 A', supportedTargets: ['load'] }),
        model({ modelId: 'remote:load-b', name: '负荷模型 B', supportedTargets: ['load'] }),
      ]
    })
    const wrapper = await render()
    expect(api.predict).toHaveBeenCalledWith(expect.objectContaining({ model_type: 'remote:price-b', target: 'price' }))
    expect(api.optimize).toHaveBeenCalledWith(expect.objectContaining({ model_type: 'remote:load-b', target: 'load' }))
    expect(wrapper.text()).toContain('价格模型 B')
    expect(wrapper.text()).toContain('负荷模型 B')
    expect(wrapper.text()).not.toContain('当前价格预测模型不可用，请另选模型')
  })
})

describe('地区模型目录的完成回调隔离', () => {
  it('A 首载晚到时不清空仍在加载的 B 选择，B 就绪后只运行原选模型', async () => {
    prepareRegionCatalogs()
    const first = deferred<void>()
    const latest = deferred<void>()
    api.ensureCatalog.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise)
    const wrapper = await render()
    state.currentRegionId.value = 'shanxi'
    await flushPromises()
    expect(api.ensureCatalog).toHaveBeenCalledTimes(2)
    state.regionCatalogs.value.yunnan = sharedRuntimeCatalog()
    first.resolve()
    await flushPromises()
    expect(api.predict).not.toHaveBeenCalled()

    state.regionCatalogs.value.shanxi = sharedRuntimeCatalog()
    latest.resolve()
    await flushPromises()
    expect(wrapper.findAll('select')[0]?.element.value).toBe('xgboost')
    expect(wrapper.findAll('select')[1]?.element.value).toBe('xgboost')
    expect(api.predict).toHaveBeenCalledTimes(1)
    expect(api.predict).toHaveBeenCalledWith(expect.objectContaining({ region_id: 'shanxi', target: 'price', model_type: 'xgboost' }))
    expect(api.optimize).toHaveBeenCalledWith(expect.objectContaining({ region_id: 'shanxi', target: 'load', model_type: 'xgboost' }))
    expect(wrapper.text()).not.toContain('当前价格预测模型不可用')
    expect(api.ensureCatalog).toHaveBeenNthCalledWith(1, ['price', 'load'], false, 'yunnan')
    expect(api.ensureCatalog).toHaveBeenNthCalledWith(2, ['price', 'load'], true, 'shanxi')
  })

  it('A→B→A 期间旧 A 和旧 B 完成都不能把最新 A 提前标成就绪', async () => {
    prepareRegionCatalogs()
    const first = deferred<void>()
    const middle = deferred<void>()
    const latest = deferred<void>()
    api.ensureCatalog.mockReset()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(middle.promise).mockReturnValueOnce(latest.promise)
    const wrapper = await render()
    state.currentRegionId.value = 'shanxi'
    await flushPromises()
    state.currentRegionId.value = 'yunnan'
    await flushPromises()
    // 同地区旧批次数据由服务层丢弃，此处只让旧页面回调结束，最新目录仍在等待。
    first.resolve()
    middle.resolve()
    await flushPromises()
    expect(api.predict).not.toHaveBeenCalled()

    state.regionCatalogs.value.yunnan = sharedRuntimeCatalog()
    latest.resolve()
    await flushPromises()
    expect(wrapper.findAll('select')[0]?.element.value).toBe('xgboost')
    expect(wrapper.findAll('select')[1]?.element.value).toBe('xgboost')
    expect(api.predict).toHaveBeenCalledTimes(1)
    expect(api.predict).toHaveBeenCalledWith(expect.objectContaining({ region_id: 'yunnan', model_type: 'xgboost' }))
    expect(api.ensureCatalog).toHaveBeenNthCalledWith(3, ['price', 'load'], true, 'yunnan')
  })

  it('旧 A 目录失败晚到不覆盖 B 的成功状态，也不重复触发 B 预测', async () => {
    prepareRegionCatalogs()
    const first = deferred<void>()
    const latest = deferred<void>()
    api.ensureCatalog.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise)
    const wrapper = await render()
    state.currentRegionId.value = 'shanxi'
    await flushPromises()
    state.regionCatalogs.value.shanxi = sharedRuntimeCatalog()
    latest.resolve()
    await flushPromises()
    expect(api.predict).toHaveBeenCalledTimes(1)

    // ensureForecastCatalog 将取数失败写入对应地区的响应式错误状态，再正常完成 Promise。
    state.regionCatalogs.value.yunnan = { price: [], load: [], priceError: '旧地区目录读取失败', loadError: '旧地区目录读取失败' }
    first.resolve()
    await flushPromises()
    expect(api.predict).toHaveBeenCalledTimes(1)
    expect(api.optimize).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('select')[0]?.element.value).toBe('xgboost')
    expect(wrapper.text()).not.toContain('旧地区目录读取失败')
    expect(wrapper.text()).not.toContain('当前价格预测模型不可用')
  })

  it('卸载后目录才完成，不再触发预测或后续报价优化', async () => {
    prepareRegionCatalogs()
    const pending = deferred<void>()
    api.ensureCatalog.mockReset().mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    state.regionCatalogs.value.yunnan = sharedRuntimeCatalog()
    pending.resolve()
    await flushPromises()
    expect(api.predict).not.toHaveBeenCalled()
    expect(api.optimize).not.toHaveBeenCalled()
  })
})

// #3605：/cockpit 带远端 mock/sourceType/warnings 时，概览必须可见「模拟数据」，且旧后端无字段时不崩。
describe('决策概览来源标识', () => {
  const overviewBase = {
    basis: 'captured',
    bid_advice: { retailer: { expected_cost_yuan: 1000 } },
    price_forecast: { points: [100, 110] },
    deviation_risk: { worst_penalty_yuan: 50 },
  }

  async function openOverview() {
    // 决策概览只在价格/负荷两腿同一模型时才发请求。
    state.route.value = { model: 'xgboost', date: '2026-06-25' }
    const shared = [model({ modelId: 'xgboost', name: '跨地区真实算法' })]
    state.priceModels.value = shared
    state.loadModels.value = shared
    const wrapper = await render()
    const btn = wrapper.findAll('button').find((b) => b.text() === '决策概览')
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()
    return wrapper
  }

  it('中长期分区 MOCK：概览标题旁与该卡片显示「模拟数据」，warnings 折成短标签+悬浮提示', async () => {
    api.cockpit.mockResolvedValueOnce({
      ...overviewBase,
      mock: true, sourceType: 'MOCK', productionWrite: false,
      warnings: ['[中长期] 远程模型为演示权重', '[日前电价] 样本偏少'],
      midterm_trend: { daily_avg_price: [100, 110], horizon_days: 7, mock: true, sourceType: 'MOCK', productionWrite: false },
    })
    const wrapper = await openOverview()
    const head = wrapper.find('.advice-head')
    expect(head.text()).toContain('模拟数据')
    expect(head.text()).toContain('合成验证')
    expect(head.text()).not.toContain('决策概览（真实）')
    const warn = head.findAll('.el-tag').find((t) => t.text().startsWith('提示'))
    expect(warn?.text()).toBe('提示 2')
    expect(warn?.attributes('title')).toContain('远程模型为演示权重')
    const midCard = wrapper.findAll('.risk-card').find((c) => c.text().includes('未来 7 天均价'))
    expect(midCard?.text()).toContain('模拟数据')
    // 未标 mock 的分区卡片不带标签
    const priceCard = wrapper.findAll('.risk-card').find((c) => c.text().includes('日均预测电价'))
    expect(priceCard?.text()).not.toContain('模拟数据')
  })

  it('全部 REAL 且 productionWrite:false：不显示模拟数据/提示标签', async () => {
    api.cockpit.mockResolvedValueOnce({
      ...overviewBase,
      mock: false, sourceType: 'REAL', productionWrite: false, warnings: [],
      price_forecast: { points: [100, 110], mock: false, sourceType: 'REAL' },
      deviation_risk: { worst_penalty_yuan: 50, mock: false, sourceType: 'REAL' },
      midterm_trend: { daily_avg_price: [100, 110], horizon_days: 7, mock: false, sourceType: 'REAL', warnings: [] },
    })
    const wrapper = await openOverview()
    expect(wrapper.find('.advice-head').text()).toContain('决策概览（真实）')
    expect(wrapper.text()).not.toContain('模拟数据')
    expect(wrapper.findAll('.el-tag').some((t) => t.text().startsWith('提示'))).toBe(false)
  })

  it('旧后端无 mock/sourceType/warnings 字段：正常渲染且不出标签', async () => {
    const wrapper = await openOverview()
    expect(wrapper.find('.advice-head').text()).toContain('决策概览（真实）')
    expect(wrapper.text()).toContain('未来 7 天均价')
    expect(wrapper.text()).not.toContain('模拟数据')
    expect(wrapper.text()).not.toContain('混合来源')
  })

  it('仅顶层 mock:true（分区缺字段）也照样标模拟数据，不漏标', async () => {
    api.cockpit.mockResolvedValueOnce({
      ...overviewBase, mock: true, sourceType: 'MOCK', productionWrite: false,
      midterm_trend: { daily_avg_price: [100], horizon_days: 7 },
    })
    const wrapper = await openOverview()
    expect(wrapper.find('.advice-head').text()).toContain('模拟数据')
  })

  it('中长期 UNAVAILABLE：显示「暂无南洋模型」空态，不当 0 均价、不报错，其余卡片照常', async () => {
    api.cockpit.mockResolvedValueOnce({
      ...overviewBase,
      mock: false, sourceType: 'REAL', productionWrite: false, warnings: [],
      midterm_trend: {
        daily_avg_price: [], horizon_days: 14, available: false, reason: '南洋无 yunnan 中长期模型',
        mock: false, sourceType: 'UNAVAILABLE', productionWrite: false,
      },
    })
    const wrapper = await openOverview()
    const midCard = wrapper.findAll('.risk-card').find((c) => c.text().includes('未来 14 天均价'))
    expect(midCard?.text()).toContain('暂无南洋模型')
    expect(midCard?.text()).not.toContain('NaN')
    expect(midCard?.text()).not.toContain('元/MWh')
    expect(midCard?.attributes('title')).toContain('南洋无 yunnan 中长期模型')
    expect(midCard?.text()).not.toContain('模拟数据')
    expect(wrapper.text()).toContain('日均预测电价')
    expect(wrapper.text()).toContain('偏差最坏风险')
    expect(wrapper.text()).not.toContain('决策概览失败')
  })
})
