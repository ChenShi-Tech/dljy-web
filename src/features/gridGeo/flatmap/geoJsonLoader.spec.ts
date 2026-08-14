import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetBoundaryCacheForTest,
  ensureBoundaryForRegion,
  loadBoundaryByAdcode,
  mapNameForAdcode,
  peekCachedBoundary,
} from './geoJsonLoader'

vi.mock('echarts', () => ({ registerMap: vi.fn() }))
// auth 会链式引入 api.ts → regionContext.ts，后者在模块顶层读 window.localStorage，
// 在 node 测试环境下会直接抛错。这里只需要 token，直接打桩掉整条链路。
vi.mock('@/services/auth', () => ({ getToken: () => 'test-token' }))

const sampleGeoJson = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { adcode: 530100, name: '昆明市' }, geometry: { type: 'MultiPolygon', coordinates: [] } },
  ],
}

// 接口返回统一 BaseResponse 信封；测试同样按信封构造，避免与实现口径漂移。
function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, json: async () => ({ code: status, msg: 'ok', data: payload }) }) as unknown as Response)
}

describe('geoJsonLoader', () => {
  beforeEach(() => __resetBoundaryCacheForTest())
  afterEach(() => vi.unstubAllGlobals())

  it('derives a stable, unique echarts map name from adcode', () => {
    expect(mapNameForAdcode('530000')).toBe('boundary-530000')
    expect(mapNameForAdcode('530000')).not.toBe(mapNameForAdcode('140000'))
  })

  it('caches by adcode so a second load makes no network call', async () => {
    const fetchMock = mockFetchOnce(sampleGeoJson)
    vi.stubGlobal('fetch', fetchMock)

    const first = await loadBoundaryByAdcode('530000')
    const second = await loadBoundaryByAdcode('530000')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(peekCachedBoundary('530000')).toBe(first)
  })

  it('coalesces concurrent loads of the same adcode into one request', async () => {
    const fetchMock = mockFetchOnce(sampleGeoJson)
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([loadBoundaryByAdcode('530000'), loadBoundaryByAdcode('530000')])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('sends the bearer token so the boundary API can authorise the request', async () => {
    // 边界数据已从 public/ 迁到鉴权接口；不带 token 会被后端 401 挡掉。
    const fetchMock = mockFetchOnce(sampleGeoJson)
    vi.stubGlobal('fetch', fetchMock)
    await loadBoundaryByAdcode('530000')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/geo/boundary/530000')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
  })

  it('surfaces a login hint on 401 instead of a generic failure', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(null, false, 401))
    await expect(loadBoundaryByAdcode('530000')).rejects.toThrow(/登录/)
  })

  it('throws on HTTP failure rather than returning an empty collection', async () => {
    // 诚实失败：返回空 FeatureCollection 会让调用方以为加载成功、画出一张空地图。
    vi.stubGlobal('fetch', mockFetchOnce(null, false, 404))
    await expect(loadBoundaryByAdcode('530000')).rejects.toThrow(/530000/)
    expect(peekCachedBoundary('530000')).toBeNull()
  })

  it('rejects malformed payloads', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ type: 'Nonsense' }))
    await expect(loadBoundaryByAdcode('530000')).rejects.toThrow(/格式非法/)
  })

  it('does not cache a failed load, so a later retry can succeed', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(null, false, 500))
    await expect(loadBoundaryByAdcode('530000')).rejects.toThrow()

    vi.stubGlobal('fetch', mockFetchOnce(sampleGeoJson))
    await expect(loadBoundaryByAdcode('530000')).resolves.toMatchObject({ type: 'FeatureCollection' })
  })

  it('resolves region ids to a registered map, and returns null for template regions', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(sampleGeoJson))

    const resolved = await ensureBoundaryForRegion('yunnan')
    expect(resolved).toMatchObject({ adcode: '530000', mapName: 'boundary-530000' })
    expect(resolved?.geoJson.features).toHaveLength(1)

    // 模板地区无对应行政区，须返回 null 由调用方显空态，不回退他省。
    await expect(ensureBoundaryForRegion('generic')).resolves.toBeNull()
    await expect(ensureBoundaryForRegion(null)).resolves.toBeNull()
  })
})
