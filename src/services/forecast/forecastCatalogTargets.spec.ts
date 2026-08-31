// #54：目录必须按地区和预测目标隔离；否则用户结算价/负荷模型漏载，或质量和可用性串用。
// 覆盖并行目标、同键竞态、切区在途请求和失败重试；只 mock 接口，不制造业务可用性。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deferred, fetchForecastModels, setCurrentRegionId } = vi.hoisted(() => {
  const deferred: Array<{ target: string; regionId: string; resolve: (v: unknown) => void }> = []
  return {
    deferred,
    fetchForecastModels: vi.fn((target: string, regionId: string) =>
      new Promise((resolve) => { deferred.push({ target, regionId, resolve }) })),
    setCurrentRegionId: vi.fn(),
  }
})

vi.mock('@/services/forecast/mlForecastClient', () => ({
  fetchForecastModels,
  runForecastPredict: vi.fn(),
}))

vi.mock('@/services/captured', () => ({ fetchCaptured: vi.fn() }))
vi.mock('@/services/region/regionModules', () => ({
  getRegionModuleCapabilities: () => [],
}))

function catalogModel(input: {
  modelId: string
  name?: string
  target: string
  regionId?: string
  supportedTargets?: string[]
  available?: boolean
  qualitySource?: 'full' | 'lag_only'
}) {
  return {
    modelId: input.modelId,
    name: input.name ?? input.modelId,
    target: input.target,
    regionId: input.regionId ?? 'yunnan',
    namespace: 'remote',
    tier: 'core',
    available: input.available ?? true,
    supportedTargets: input.supportedTargets ?? [input.target],
    provenance: { basis: 'real', sourceType: 'REAL', mock: false, productionWrite: false },
    quality: { passesSkillGate: true, sourceRun: input.qualitySource ?? 'full' },
  }
}

describe('forecast catalog target buckets (#54)', () => {
  beforeEach(() => {
    deferred.length = 0
    fetchForecastModels.mockClear()
    setCurrentRegionId.mockReset()
    vi.resetModules()
    // resetModules 不重建已缓存的 mock；每例使用独立地区 ref，避免旧模块 watch 串入新例。
    vi.doMock('@/services/region/regionContext', async () => {
      const { computed, ref } = await import('vue')
      const id = ref('yunnan')
      setCurrentRegionId.mockImplementation((next: string) => { id.value = next })
      return {
        currentRegion: computed(() => ({ id: id.value, name: id.value })),
        selectedRegionId: id,
        setCurrentRegionId,
        selectRegion: vi.fn((next: string) => { id.value = next }),
      }
    })
  })

  it('按 target 分桶：小时用户电价目录不会被 price 目录吞掉', async () => {
    const mod = await import('./forecastProviders')
    const task = mod.ensureForecastCatalog('price_user_da_settlement', true, 'yunnan')
    expect(fetchForecastModels).toHaveBeenCalledWith('price_user_da_settlement', 'yunnan')
    deferred[0].resolve({
      models: [catalogModel({ modelId: 'remote:user-da', target: 'price_user_da_settlement' })],
    })
    await task

    const hourlyProviders = mod.providersForTarget('price_user_da_settlement', 'yunnan')
    const priceProviders = mod.providersForTarget('price', 'yunnan')
    expect(hourlyProviders.some((p) => p.id === 'remote:user-da')).toBe(true)
    expect(priceProviders.some((p) => p.id === 'remote:user-da')).toBe(false)
    expect(mod.forecastCatalogState('price_user_da_settlement', 'yunnan').models.value.map((m) => m.modelId))
      .toEqual(['remote:user-da'])
  })

  it('同页 price/load 并存时，固定 provider 的 quality 不能串 target', async () => {
    const mod = await import('./forecastProviders')
    const task = mod.ensureForecastCatalog(['price', 'load'], true, 'yunnan')
    expect(fetchForecastModels).toHaveBeenNthCalledWith(1, 'price', 'yunnan')
    expect(fetchForecastModels).toHaveBeenNthCalledWith(2, 'load', 'yunnan')

    deferred.find((d) => d.target === 'price')!.resolve({
      models: [
        catalogModel({ modelId: 'knn', target: 'price', supportedTargets: ['price'], qualitySource: 'full' }),
        catalogModel({ modelId: 'remote:price-only', target: 'price' }),
      ],
    })
    deferred.find((d) => d.target === 'load')!.resolve({
      models: [
        catalogModel({ modelId: 'knn', target: 'load', supportedTargets: ['load'], qualitySource: 'lag_only' }),
        catalogModel({ modelId: 'remote:load-only', target: 'load' }),
      ],
    })
    await task

    const priceProviders = mod.providersForTarget('price', 'yunnan')
    const loadProviders = mod.providersForTarget('load', 'yunnan')
    expect(priceProviders.find((p) => p.id === 'knn')?.quality?.sourceRun).toBe('full')
    expect(loadProviders.find((p) => p.id === 'knn')?.quality?.sourceRun).toBe('lag_only')
    expect(priceProviders.some((p) => p.id === 'remote:load-only')).toBe(false)
    expect(loadProviders.some((p) => p.id === 'remote:price-only')).toBe(false)
  })

  it('provider保留零样本证据，预测中心能隐藏原始权重但不修改全量目录', async () => {
    const mod = await import('./forecastProviders')
    const { predictionModelExclusionReason } = await import('./predictionModelEligibility')
    const task = mod.ensureForecastCatalog('price', true, 'yunnan')
    deferred[0].resolve({ models: [
      { ...catalogModel({ modelId: 'remote:original', target: 'price' }),
        capabilities: { supportsQuantiles: true, supportsCovariates: false, supportsMultivariate: false, horizon: 96, zeroShot: true } },
      catalogModel({ modelId: 'remote:trained', target: 'price' }),
    ] })
    await task
    const all = mod.providersForTarget('price', 'yunnan')
    expect(all.find((model) => model.id === 'remote:original')?.capabilities?.zeroShot).toBe(true)
    expect(all.filter((model) => predictionModelExclusionReason(model) === null).map((model) => model.id))
      .toEqual(['knn', 'remote:trained'])
    expect(mod.forecastCatalogState('price', 'yunnan').models.value).toHaveLength(2)
  })

  it('同地区同 target 旧请求晚归时不得覆盖新目录', async () => {
    const mod = await import('./forecastProviders')
    const state = mod.forecastCatalogState('price', 'yunnan')

    const first = mod.ensureForecastCatalog('price', true, 'yunnan')
    const second = mod.ensureForecastCatalog('price', true, 'yunnan')
    expect(deferred).toHaveLength(2)

    deferred[1].resolve({ models: [catalogModel({ modelId: 'remote:newest', target: 'price' })] })
    await second
    deferred[0].resolve({ models: [catalogModel({ modelId: 'remote:stale', target: 'price' })] })
    await first

    expect(state.models.value.map((m) => m.modelId)).toEqual(['remote:newest'])
    expect(state.error.value).toBe('')
  })

  it('旧地区请求在途时，页面对新地区显式重发同 target 后，旧响应不得把新地区留空', async () => {
    const mod = await import('./forecastProviders')
    const shanxiState = mod.forecastCatalogState('price', 'shanxi')

    const stale = mod.ensureForecastCatalog('price', true, 'yunnan')
    expect(fetchForecastModels).toHaveBeenNthCalledWith(1, 'price', 'yunnan')

    const fresh = mod.ensureForecastCatalog('price', true, 'shanxi')
    expect(fetchForecastModels).toHaveBeenNthCalledWith(2, 'price', 'shanxi')

    deferred.find((d) => d.regionId === 'shanxi' && d.target === 'price')!.resolve({
      models: [catalogModel({ modelId: 'remote:shanxi-price', target: 'price', regionId: 'shanxi' })],
    })
    await fresh
    expect(shanxiState.models.value.map((m) => m.modelId)).toEqual(['remote:shanxi-price'])

    deferred.find((d) => d.regionId === 'yunnan' && d.target === 'price')!.resolve({
      models: [catalogModel({ modelId: 'remote:yunnan-price', target: 'price', regionId: 'yunnan' })],
    })
    await stale
    expect(shanxiState.models.value.map((m) => m.modelId)).toEqual(['remote:shanxi-price'])
  })

  it('首载尚未完成就切地区时，自动重载在途目标且立即隐藏旧地区数据', async () => {
    const mod = await import('./forecastProviders')
    const { nextTick } = await import('vue')
    const state = mod.forecastCatalogState('load')
    const stale = mod.ensureForecastCatalog('load')
    setCurrentRegionId('shanxi')
    await nextTick()
    const { selectedRegionId } = await import('@/services/region/regionContext')
    expect(selectedRegionId.value).toBe('shanxi')
    expect(state.models.value).toEqual([])
    expect(deferred.map(({ target, regionId }) => [target, regionId]))
      .toEqual([['load', 'yunnan'], ['load', 'shanxi']])
    deferred[1].resolve({ models: [catalogModel({ modelId: 'new-load', target: 'load', regionId: 'shanxi' })] })
    await vi.waitFor(() => expect(state.models.value.map((m) => m.modelId)).toEqual(['new-load']))
    deferred[0].resolve({ models: [catalogModel({ modelId: 'old-load', target: 'load' })] })
    await stale
    expect(state.models.value.map((m) => m.modelId)).toEqual(['new-load'])
  })

  it('同模型ID在不同目标的可用性保持独立，失败只清理自己的桶且允许重试', async () => {
    const mod = await import('./forecastProviders')
    const both = mod.ensureForecastCatalog(['price', 'load'])
    deferred[0].resolve({ models: [catalogModel({ modelId: 'shared', target: 'price', available: false,
      supportedTargets: ['price', 'load'] })] })
    deferred[1].resolve({ models: [catalogModel({ modelId: 'shared', target: 'load', available: true,
      supportedTargets: ['price', 'load'] })] })
    await both
    expect(mod.providersForTarget('price').find((p) => p.id === 'shared')?.available).toBe(false)
    expect(mod.providersForTarget('load').find((p) => p.id === 'shared')?.available).toBe(true)
    const loadState = mod.forecastCatalogState('load')
    const failed = mod.ensureForecastCatalog('load', true)
    deferred[2].resolve(Promise.reject(new Error('load catalog failed')))
    await failed
    expect(loadState.models.value).toEqual([])
    expect(loadState.error.value).toBe('load catalog failed')
    expect(mod.forecastCatalogState('price').models.value).toHaveLength(1)
    const retry = mod.ensureForecastCatalog('load')
    expect(deferred).toHaveLength(4)
    deferred[3].resolve({ models: [catalogModel({ modelId: 'recovered', target: 'load' })] })
    await retry
    expect(loadState.error.value).toBe('')
    expect(loadState.models.value.map((m) => m.modelId)).toEqual(['recovered'])
  })
})
