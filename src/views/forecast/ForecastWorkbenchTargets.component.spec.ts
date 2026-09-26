// 工作台目标下拉必须按「当前地区有可见已接入模型的目标」动态收敛，不能长期保留注册表全集。
// 此测试只验证前端目标发现/切区清理，不声称已在真实站点点击。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, reactive, ref, toValue, type MaybeRefOrGetter } from 'vue'
import type { ForecastProvider, UnifiedForecastResult } from '@/services/forecast/forecastProviders'

const route = reactive({ query: { date: '2026-06-25', target: 'price_user_da_settlement' } })
const api = vi.hoisted(() => ({ run: vi.fn(), load: vi.fn() }))
const providerRowsByKey = ref<Record<string, ForecastProvider[]>>({})
const loadingByKey = ref<Record<string, boolean>>({})
const errorByKey = ref<Record<string, string>>({})
const wrappers: VueWrapper[] = []

const keyOf = (regionId: string, target: string) => `${regionId}::${target}`
function writeRows(regionId: string, target: string, rows: ForecastProvider[]) {
  providerRowsByKey.value = { ...providerRowsByKey.value, [keyOf(regionId, target)]: rows }
}
function clearRows() {
  providerRowsByKey.value = {}
  loadingByKey.value = {}
  errorByKey.value = {}
}
function normalizeTargets(input: unknown): string[] {
  if (Array.isArray(input)) return [...new Set(input.map((item) => String(item ?? '').trim()).filter(Boolean))]
  const target = String(input ?? 'price').trim()
  return target ? [target] : ['price']
}

vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/services/forecast/forecastProviders', async (original) => {
  const actual = await original<typeof import('@/services/forecast/forecastProviders')>()
  return {
    ...actual,
    catalogModelsForTarget: (target: string, regionId?: string) =>
      (providerRowsByKey.value[keyOf(regionId ?? 'yunnan', target)] ?? [])
        .map((provider) => ({
          modelId: provider.id,
          namespace: 'remote',
          available: provider.available ?? true,
          supportedTargets: provider.supportedTargets,
          source: provider.source,
          framework: provider.framework,
          mock: provider.mock,
          lineage: provider.lineage,
          capabilities: provider.capabilities,
        })),
    isCatalogModelUsableForTarget: (model: { modelId?: string; available?: boolean; supportedTargets?: string[] }, target: string) =>
      model.available === true && Array.isArray(model.supportedTargets) && model.supportedTargets.includes(target),
    providersForTarget: (target: string, regionId?: string) =>
      (providerRowsByKey.value[keyOf(regionId ?? 'yunnan', target)] ?? [])
        .filter((provider) => provider.supportedTargets.includes(target)),
    ensureForecastCatalog: async (
      targetOrForce: string | readonly string[] | boolean = 'price',
      forceOrRegion?: boolean | string,
      regionIdArg?: string,
    ) => {
      const targets = typeof targetOrForce === 'boolean' ? ['price'] : normalizeTargets(targetOrForce)
      let regionId = 'yunnan'
      if (typeof forceOrRegion === 'string') regionId = forceOrRegion
      if (regionIdArg) regionId = regionIdArg
      const nextLoading = { ...loadingByKey.value }
      for (const target of targets) nextLoading[keyOf(regionId, target)] = true
      loadingByKey.value = nextLoading
      const nextErrors = { ...errorByKey.value }
      const nextLoadingDone = { ...loadingByKey.value }
      try {
        const loaded = await api.load(targets, regionId)
        for (const target of targets) {
          writeRows(regionId, target, Array.isArray(loaded) ? loaded : (loaded?.[target] ?? []))
          delete nextErrors[keyOf(regionId, target)]
          delete nextLoadingDone[keyOf(regionId, target)]
        }
      } catch (error) {
        for (const target of targets) {
          writeRows(regionId, target, [])
          nextErrors[keyOf(regionId, target)] = error instanceof Error ? error.message : '模型目录加载失败'
          delete nextLoadingDone[keyOf(regionId, target)]
        }
      }
      errorByKey.value = nextErrors
      loadingByKey.value = nextLoadingDone
    },
    forecastCatalogState: (
      targetsInput: MaybeRefOrGetter<string | readonly string[] | undefined> = 'price',
      regionIdInput?: MaybeRefOrGetter<string | undefined>,
    ) => ({
      models: computed(() => {
        const regionId = toValue(regionIdInput) || 'yunnan'
        return normalizeTargets(toValue(targetsInput)).flatMap((target) =>
          (providerRowsByKey.value[keyOf(regionId, target)] ?? []).map((provider) => ({ modelId: provider.id })))
      }),
      loading: computed(() => {
        const regionId = toValue(regionIdInput) || 'yunnan'
        return normalizeTargets(toValue(targetsInput)).some((target) => loadingByKey.value[keyOf(regionId, target)] === true)
      }),
      error: computed(() => {
        const regionId = toValue(regionIdInput) || 'yunnan'
        return normalizeTargets(toValue(targetsInput))
          .map((target) => errorByKey.value[keyOf(regionId, target)] ?? '')
          .filter(Boolean)
          .join('；')
      }),
    }),
  }
})
vi.mock('@/services/forecast/officialBaseline', async (original) => ({
  ...await original<typeof import('@/services/forecast/officialBaseline')>(),
  hasOfficialBaseline: () => false, officialMae: () => null, fetchOfficialBaseline: vi.fn(),
}))
vi.mock('@/services/forecast/forecastBenchContext', () => ({ publishBenchContext: vi.fn() }))

import Workbench from './ForecastWorkbenchView.vue'
import { setCurrentRegionId } from '@/services/region/regionContext'

function result(): UnifiedForecastResult {
  return {
    points: Array(24).fill(150),
    actual: Array(24).fill(151),
    unit: '元/MWh',
    basis: 'captured',
    mock: false,
    granularity: 24,
    modelId: 'remote:test',
    evaluationMode: 'backtest',
    metrics: { mae: 1 },
  }
}
function provider(overrides: Partial<ForecastProvider> & Pick<ForecastProvider, 'id' | 'name'>): ForecastProvider {
  return {
    kind: overrides.kind ?? 'compute',
    tier: overrides.tier ?? 'deep',
    available: overrides.available ?? true,
    supportedTargets: overrides.supportedTargets ?? ['price'],
    paramsSchema: overrides.paramsSchema ?? [],
    run: overrides.run ?? api.run,
    ...overrides,
  }
}
function defineCatalog(regionId: string, rows: Record<string, ForecastProvider[]>) {
  api.load.mockImplementation(async (targets: string[], askedRegionId: string) => {
    if (askedRegionId !== regionId) return Object.fromEntries(targets.map((target) => [target, []]))
    return Object.fromEntries(targets.map((target) => [target, rows[target] ?? []]))
  })
}
const slot = { template: '<div><slot/></div>' }
async function render() {
  const wrapper = mount(Workbench, { global: { directives: { loading: () => {} }, stubs: {
    ElCard: slot, ElTabs: { name: 'ElTabs', props: ['modelValue'], emits: ['update:modelValue'], template: '<div><slot/></div>' }, ElTabPane: slot, ElTag: slot, ElDescriptions: slot, ElDescriptionsItem: slot,
    ElCheckboxGroup: { name: 'ElCheckboxGroup', props: ['modelValue'], emits: ['update:modelValue'], template: '<div><slot/></div>' },
    ElCheckbox: { name: 'ElCheckbox', props: ['modelValue', 'value', 'disabled', 'border', 'title'], template: '<label><slot/></label>' },
    ElRow: slot, ElCol: slot, ElRadioGroup: slot, ElRadioButton: slot,
    ElEmpty: { props: ['description'], template: '<p>{{description}}</p>' }, ElInputNumber: { name: 'ElInputNumber', props: ['modelValue'], template: '<input/>' },
    ElTable: { name: 'ElTable', props: ['data'], template: '<div />' }, ElTableColumn: true,
    ElDatePicker: { name: 'ElDatePicker', props: ['modelValue'], template: '<input/>' },
    ElSelect: { name: 'ElSelect', props: ['modelValue', 'disabled'], template: '<div class="stub-select"><slot/></div>' },
    ElOption: { name: 'ElOption', props: ['label', 'value'], template: '<span class="stub-option" :data-value="value">{{label}}</span>' },
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
function targetOptionsText(wrapper: VueWrapper) {
  return wrapper.find('.shared').findAll('.stub-select')[1].findAll('.stub-option').map((item) => item.text())
}
async function run(wrapper: VueWrapper) {
  await wrapper.findAll('button').find((button) => button.text() === '预测')!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  clearRows()
  route.query.date = '2026-06-25'
  route.query.target = 'price_user_da_settlement'
  setCurrentRegionId('yunnan')
  api.run.mockReset().mockResolvedValue(result())
  api.load.mockReset()
})
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()) })

describe('建模工作台目标发现', () => {
  it('无 query 冷启动时会默认选中第一个真实目标', async () => {
    route.query.target = undefined as unknown as string
    defineCatalog('yunnan', {
      load: [provider({ id: 'remote:load', name: '负荷模型', supportedTargets: ['load'] })],
    })

    const wrapper = await render()
    expect(targetOptionsText(wrapper)).toEqual(['统调负荷'])

    await run(wrapper)
    expect(api.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ regionId: 'yunnan', target: 'load', targetDate: '2026-06-25' }),
      expect.objectContaining({ train_days: 180 }),
    )
  })

  it('冷缓存 deep link 指向用户日前目标时，目录异步返回后仍保留该目标', async () => {
    defineCatalog('yunnan', {
      load: [provider({ id: 'remote:load', name: '负荷模型', supportedTargets: ['load'] })],
      price_user_da_settlement: [provider({ id: 'remote:user-da', name: '用户日前模型', supportedTargets: ['price_user_da_settlement'] })],
      temp: [provider({ id: 'remote:generic', name: '未登记通用算法', supportedTargets: [] })],
      renewable: [provider({ id: 'remote:zeroshot', name: '原始零样本', supportedTargets: ['renewable'], source: 'remote:zeroshot' })],
    })

    const wrapper = await render()
    expect(targetOptionsText(wrapper)).toEqual(['统调负荷', '用户侧日前统一结算电价'])
    expect(wrapper.text()).not.toContain('气象温度')
    expect(wrapper.text()).not.toContain('新能源出力')

    await run(wrapper)
    expect(api.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ regionId: 'yunnan', target: 'price_user_da_settlement', targetDate: '2026-06-25' }),
      expect.objectContaining({ train_days: 180 }),
    )
  })

  it('切地区后会清理失效旧目标，并按新地区目录运行新的目标', async () => {
    api.load.mockImplementation(async (targets: string[], regionId: string) => {
      const catalogs: Record<string, Record<string, ForecastProvider[]>> = {
        yunnan: {
          price_user_da_settlement: [provider({ id: 'remote:user-da', name: '用户日前模型', supportedTargets: ['price_user_da_settlement'] })],
          load: [provider({ id: 'remote:load', name: '负荷模型', supportedTargets: ['load'] })],
        },
        shanxi: {
          price: [provider({ id: 'remote:price', name: '山西价格模型', supportedTargets: ['price'] })],
        },
      }
      const rows = catalogs[regionId] ?? {}
      return Object.fromEntries(targets.map((target) => [target, rows[target] ?? []]))
    })

    const wrapper = await render()
    expect(targetOptionsText(wrapper)).toEqual(['统调负荷', '用户侧日前统一结算电价'])

    setCurrentRegionId('shanxi')
    await flushPromises()
    await flushPromises()
    await flushPromises()

    expect(targetOptionsText(wrapper)).toEqual(['现货出清电价'])
    expect(wrapper.text()).not.toContain('用户侧日前统一结算电价')

    await run(wrapper)
    expect(api.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ regionId: 'shanxi', target: 'price', targetDate: '2026-06-25' }),
      expect.objectContaining({ train_days: 180 }),
    )
  })

  it('切到空目录地区时清空旧目标选项，并提示暂无已接入模型', async () => {
    api.load.mockImplementation(async (targets: string[], regionId: string) => {
      const catalogs: Record<string, Record<string, ForecastProvider[]>> = {
        yunnan: {
          price_user_da_settlement: [provider({ id: 'remote:user-da', name: '用户日前模型', supportedTargets: ['price_user_da_settlement'] })],
        },
        shanxi: {},
      }
      const rows = catalogs[regionId] ?? {}
      return Object.fromEntries(targets.map((target) => [target, rows[target] ?? []]))
    })

    const wrapper = await render()
    expect(targetOptionsText(wrapper)).toEqual(['用户侧日前统一结算电价'])

    setCurrentRegionId('shanxi')
    await flushPromises()
    await flushPromises()

    expect(targetOptionsText(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('当前地区暂无已接入预测目标')
    expect(wrapper.text()).not.toContain('用户侧日前统一结算电价')
  })

  it('目录加载完全失败时清空旧目标选项，并上屏失败原因', async () => {
    api.load.mockImplementation(async (targets: string[], regionId: string) => {
      if (regionId === 'shanxi') throw new Error('catalog refused')
      return Object.fromEntries(targets.map((target) => [target, target === 'price_user_da_settlement'
        ? [provider({ id: 'remote:user-da', name: '用户日前模型', supportedTargets: ['price_user_da_settlement'] })]
        : []]))
    })

    const wrapper = await render()
    expect(targetOptionsText(wrapper)).toEqual(['用户侧日前统一结算电价'])

    setCurrentRegionId('shanxi')
    await flushPromises()
    await flushPromises()

    expect(targetOptionsText(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('预测目标目录加载失败：catalog refused')
    expect(wrapper.text()).not.toContain('用户侧日前统一结算电价')
  })
})
