// 预测目录跨地区并发载入世代守卫回归（#1173）。
//
// 切地区 watch 每次强制刷新，快切即产生并发 in-flight 请求。无守卫时晚归的陈旧响应会覆盖
// mlCatalog 并认领 catalogRegion，导致目录残留他区 skill/quality 且被缓存锁死。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deferred: Array<{ regionId: string; resolve: (v: unknown) => void }> = []

vi.mock('@/services/forecast/mlForecastClient', () => ({
  fetchForecastModels: vi.fn((_target: string, regionId: string) =>
    new Promise((resolve) => { deferred.push({ regionId, resolve }) })),
  runForecastPredict: vi.fn(),
}))

vi.mock('@/services/captured', () => ({ fetchCaptured: vi.fn() }))

const selectRegion = vi.fn()
vi.mock('@/services/region/regionContext', async () => {
  const { computed, ref } = await import('vue')
  const id = ref('yunnan')
  selectRegion.mockImplementation((next: string) => { id.value = next })
  return {
    currentRegion: computed(() => ({ id: id.value, name: id.value })),
    selectedRegionId: id,
    selectRegion,
  }
})

vi.mock('@/services/region/regionModules', () => ({
  getRegionModuleCapabilities: () => ({ dataSupport: {} }),
}))

function modelsFor(regionId: string) {
  return {
    models: [{
      modelId: `${regionId}-model`,
      name: regionId,
      target: 'price',
      regionId,
      available: true,
      basisVersion: 'test',
      provenance: { basis: 'reference', mock: false },
    }],
  }
}

describe('#1173 预测目录并发载入世代守卫', () => {
  beforeEach(() => { deferred.length = 0; vi.resetModules() })

  it('陈旧响应晚归时不得覆盖新地区目录，也不得认领地区', async () => {
    const mod = await import('./forecastProviders')
    const { ensureForecastCatalog, forecastCatalogState } = mod
    const state = forecastCatalogState()

    // 两次并发载入：先 yunnan，再 shanxi（模拟快速切地区）
    const first = ensureForecastCatalog(true)
    const second = ensureForecastCatalog(true)
    expect(deferred).toHaveLength(2)

    // 后发的先归（新地区结果落地）
    deferred[1].resolve(modelsFor('shanxi'))
    await second
    const afterNewest = state.models.value.map((m) => m.modelId)

    // 先发的晚归（陈旧结果）——必须被丢弃
    deferred[0].resolve(modelsFor('yunnan'))
    await first

    expect(state.models.value.map((m) => m.modelId)).toEqual(afterNewest)
    expect(state.loading.value).toBe(false)
  })

  it('陈旧请求失败晚归时不得清空新地区已取回的结果', async () => {
    const mod = await import('./forecastProviders')
    const { ensureForecastCatalog, forecastCatalogState } = mod
    const state = forecastCatalogState()

    const stale = ensureForecastCatalog(true)
    const fresh = ensureForecastCatalog(true)

    deferred[1].resolve(modelsFor('shanxi'))
    await fresh
    expect(state.models.value.length).toBeGreaterThan(0)

    // 陈旧请求失败晚归：既不能清空目录，也不能写 error
    deferred[0].resolve(Promise.reject(new Error('stale failure')))
    await stale.catch(() => undefined)

    expect(state.models.value.length).toBeGreaterThan(0)
    expect(state.error.value).toBe('')
  })
})
