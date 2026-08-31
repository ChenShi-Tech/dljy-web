// 申报决策驾驶舱必须只展示当前页可执行的真实模型；旧 deep link / 建模残留的隐藏模型 ID 不得继续运行。
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
vi.mock('@/composables/useRegionReload', () => ({
  onRegionChange: vi.fn(),
}))
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
  forecastCatalogState: (target: string) => target === 'price'
    ? { models: state.priceModels, error: state.priceCatalogError }
    : { models: state.loadModels, error: state.loadCatalogError },
  isPredictSupported: () => true,
  isModelSelectableForTarget: (model: MockForecastModel, target: ForecastLeg) =>
    model.available !== false && (!model.supportedTargets || model.supportedTargets.includes(target)),
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
    state.route.value = { priceModel: 'fm:Chronos2', loadModel: 'remote:raw-load', date: '2026-06-25' }
    state.priceModels.value = [
      model({ modelId: 'fm:Chronos2', name: 'Chronos 2', supportedTargets: ['price'] }),
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
    expect(wrapper.text()).not.toContain('Chronos 2')
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
