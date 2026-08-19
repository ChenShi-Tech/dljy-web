// weather.ts 收编守卫：两个视图（HomeConsole/WeatherForecast）天气取数的统一出口。
// 守的不变量：
// 1. 回退顺序固定：和风（平台代理 /qweather）优先 → Open-Meteo 公网回退 → 诚实空
// （null / []），绝不合成装饰值（首页曾写死「21°晴」）；
// 2. WMO 码 → 中文映射只存在于回退链路（和风链路直接用其 text）；
// 3. 外部辅助数据不参与 provenance 标注，本服务不得读取/写入 mock 标注体系；
// 4. fetchForecastBundle 是预报页全量拉取：非 ok 必须抛错（该页有整体错误态，
// 与挂件「隐藏温度」策略不同，静默空会渲染成永远空白页）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiGet = vi.hoisted(() => vi.fn())
vi.mock('@/services/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  timeoutSignal: vi.fn(() => 'timeout-signal-stub')
}))

import {
  fetchCurrentWeather, fetchDaily15, searchCityByQweather, lookupCityByCoords,
  searchCityByOpenMeteo, reverseGeocode, fetchForecastBundle, WMO_TXT
} from './weather'

const fetchMock = vi.fn()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  fetchMock.mockReset()
  apiGet.mockReset()
  vi.unstubAllGlobals()
})

describe('fetchCurrentWeather 回退链', () => {
  it('和风成功 → 用和风温度与文案，不打公网', async () => {
    apiGet.mockResolvedValue({ now: { temp: '21.6', text: '多云' } })

    await expect(fetchCurrentWeather(24.88, 102.83)).resolves.toEqual({ temp: 22, text: '多云' })

    expect(apiGet).toHaveBeenCalledWith('/qweather', { path: '/v7/weather/now', location: '102.83,24.88' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('和风缺 now.temp → 回退 Open-Meteo，WMO 码映射中文', async () => {
    apiGet.mockResolvedValue({ now: {} }) // 和风给了形状但缺温度（配额耗尽时）
    fetchMock.mockResolvedValue(json({ current: { temperature_2m: 18.4, weather_code: 61 } }))

    await expect(fetchCurrentWeather(1, 2)).resolves.toEqual({ temp: 18, text: WMO_TXT[61] })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('https://api.open-meteo.com/v1/forecast')
    expect(url).toContain('latitude=1&longitude=2')
    expect(url).toContain('current=temperature_2m,weather_code')
  })

  it('双败 → null（隐藏温度，不合成装饰值）；未知 WMO 码 → 空文案', async () => {
    apiGet.mockRejectedValue(new Error('qweather down'))
    fetchMock
      .mockRejectedValueOnce(new Error('public net blocked'))
      .mockResolvedValueOnce(json({ current: { weather_code: 9999 } })) // 未知码且无温度

    await expect(fetchCurrentWeather(1, 2)).resolves.toBeNull()
    await expect(fetchCurrentWeather(1, 2)).resolves.toBeNull()
  })
})

describe('fetchDaily15 回退链', () => {
  it('和风 15d 有数据 → 行形状对齐（fxDate/textDay/high/low/humidity）', async () => {
    apiGet.mockResolvedValue({ daily: [{ fxDate: '2026-08-15', textDay: '小雨', tempMax: '26', tempMin: '18', humidity: '80' }] })

    const rows = await fetchDaily15(24.88, 102.83)
    expect(rows).toEqual([{ fxDate: '2026-08-15', textDay: '小雨', high: '26', low: '18', humidity: '80' }])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('和风空数组/失败 → Open-Meteo daily 同构映射；双败 → []', async () => {
    apiGet
      .mockResolvedValueOnce({ daily: [] })            // 空 → 视为无效走回退
      .mockRejectedValueOnce(new Error('down'))        // 异常 → 走回退
      .mockRejectedValueOnce(new Error('down'))        // 双败用例
    fetchMock
      .mockResolvedValueOnce(json({
        daily: {
          time: ['2026-08-15', '2026-08-16'],
          weather_code: [0, 95],
          temperature_2m_max: [28, 24],
          temperature_2m_min: [17, 16],
          relative_humidity_2m_mean: [60, 88]
        }
      }))
      .mockResolvedValueOnce(json({ daily: {} }))
      .mockRejectedValueOnce(new Error('blocked'))

    await expect(fetchDaily15(1, 2)).resolves.toEqual([
      { fxDate: '2026-08-15', textDay: WMO_TXT[0], high: 28, low: 17, humidity: 60 },
      { fxDate: '2026-08-16', textDay: WMO_TXT[95], high: 24, low: 16, humidity: 88 }
    ])
    await expect(fetchDaily15(1, 2)).resolves.toEqual([])
    await expect(fetchDaily15(1, 2)).resolves.toEqual([])
  })
})

describe('城市检索与反查', () => {
  it('searchCityByQweather：走 /qweather lookup，映射 lat/lon/adm1', async () => {
    apiGet.mockResolvedValue({ location: [{ name: '昆明', lat: '24.88', lon: '102.83', adm1: '云南' }] })

    await expect(searchCityByQweather('昆明')).resolves.toEqual([
      { name: '昆明', lat: 24.88, lon: 102.83, admin1: '云南' }
    ])
    expect(apiGet).toHaveBeenCalledWith('/qweather', { path: '/geo/v2/city/lookup', location: '昆明', number: 10 })
  })

  it('lookupCityByCoords：命中首城；无结果/失败 → null（调用方仍按经纬度出天气）', async () => {
    apiGet
      .mockResolvedValueOnce({ location: [{ name: '曲靖', lat: '25.5', lon: '103.8', adm1: '云南' }] })
      .mockResolvedValueOnce({ location: [] })
      .mockRejectedValueOnce(new Error('down'))

    await expect(lookupCityByCoords(103.8, 25.5)).resolves.toEqual({ name: '曲靖', lat: 25.5, lon: 103.8, admin1: '云南' })
    await expect(lookupCityByCoords(0, 0)).resolves.toBeNull()
    await expect(lookupCityByCoords(0, 0)).resolves.toBeNull()
  })

  it('searchCityByOpenMeteo：geocoding URL 编码关键词；results 缺失 → []', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ name: '大理', longitude: 100.27, latitude: 25.61, admin1: '云南' }] }))
      .mockResolvedValueOnce(json({}))

    await expect(searchCityByOpenMeteo('大 理')).resolves.toEqual([{ name: '大理', lon: 100.27, lat: 25.61, admin1: '云南' }])
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain(`name=${encodeURIComponent('大 理')}`)
    await expect(searchCityByOpenMeteo('不存在')).resolves.toEqual([])
  })

  it('reverseGeocode：city/locality/principalSubdivision 逐级回落；失败 → null', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ city: '昆明', principalSubdivision: '云南' }))
      .mockResolvedValueOnce(json({ locality: '安宁', principalSubdivision: '云南' }))
      .mockResolvedValueOnce(json({ principalSubdivision: '云南' }))
      .mockRejectedValueOnce(new Error('blocked'))

    await expect(reverseGeocode(25, 102)).resolves.toEqual({ name: '昆明', admin1: '云南' })
    await expect(reverseGeocode(25, 102)).resolves.toEqual({ name: '安宁', admin1: '云南' })
    await expect(reverseGeocode(25, 102)).resolves.toEqual({ name: '云南', admin1: '云南' })
    await expect(reverseGeocode(25, 102)).resolves.toBeNull()
  })
})

describe('fetchForecastBundle', () => {
  it('URL 带 15 日三段字段与 Asia/Shanghai 时区；返回 current/daily/hourly 三块', async () => {
    fetchMock.mockResolvedValue(json({ current: { temperature_2m: 20 }, daily: { time: ['2026-08-15'] }, hourly: { time: [] } }))

    const bundle = await fetchForecastBundle(25.04, 102.71)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('latitude=25.04&longitude=102.71')
    expect(url).toContain('timezone=Asia%2FShanghai')
    expect(url).toContain('forecast_days=15')
    expect(url).toContain('sunrise') // daily 字段段齐全（渲染卡片依赖）
    expect(init.signal).toBe('timeout-signal-stub')
    expect(bundle).toEqual({
      current: { temperature_2m: 20 },
      daily: { time: ['2026-08-15'] },
      hourly: { time: [] }
    })
  })

  it('非 2xx 抛错（预报页整体错误态依赖此行为，静默空会渲染成空白页）', async () => {
    fetchMock.mockResolvedValue(new Response('rate limited', { status: 429 }))
    await expect(fetchForecastBundle(1, 2)).rejects.toThrow('Open-Meteo 请求失败 429')
  })
})
