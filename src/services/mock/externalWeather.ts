// 外部气象源演示应答（PRD C.24）。
//
// 天气预报页（/sjfx/tqyb）与 HomeConsole 天气回退链路直连 Open-Meteo / bigdatacloud
// 公网源；mock 会话按跨源护栏会被 502 拦截 → 整页「Open-Meteo 请求失败 502」。天气在
// PRD 里是「外部辅助数据」（不进 provenance 标注体系），演示账号直接供合成气象即可——
// 与其拦截报错，不如按 Open-Meteo 原始形状确定性供数（播种：同坐标恒同天气）。
// 只覆盖本项目实际调用的三个端点；其余外网域名维持拦截不变。

import { dateStr, mulberry32, seedOf } from './generators'

export const EXTERNAL_WEATHER_HOSTS = [
  'api.open-meteo.com',
  'geocoding-api.open-meteo.com',
  'api.bigdatacloud.net'
]

function weatherJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-data-mock': 'true' }
  })
}

const WMO_CODES = [0, 1, 2, 3, 45, 51, 61, 80, 95]

/** Open-Meteo /v1/forecast：current + daily(15) + hourly(15×24)，字段覆盖 BUNDLE 全集。 */
function mockOpenMeteoForecast(url: URL): Response {
  const lat = url.searchParams.get('latitude') ?? '37.87'
  const lon = url.searchParams.get('longitude') ?? '112.55'
  const rand = mulberry32(seedOf(`open-meteo:${lat}:${lon}`))
  const days = 15
  const baseTemp = 16 + rand() * 10
  const dailyTime = Array.from({ length: days }, (_, i) => dateStr(i))
  const daily = {
    time: dailyTime,
    weather_code: dailyTime.map(() => WMO_CODES[Math.floor(rand() * WMO_CODES.length)]),
    temperature_2m_max: dailyTime.map(() => Math.round((baseTemp + 8 + rand() * 8) * 10) / 10),
    temperature_2m_min: dailyTime.map(() => Math.round((baseTemp - 4 + rand() * 5) * 10) / 10),
    temperature_2m_mean: dailyTime.map(() => Math.round((baseTemp + 2 + rand() * 6) * 10) / 10),
    apparent_temperature_max: dailyTime.map(() => Math.round((baseTemp + 7 + rand() * 9) * 10) / 10),
    apparent_temperature_min: dailyTime.map(() => Math.round((baseTemp - 5 + rand() * 5) * 10) / 10),
    relative_humidity_2m_mean: dailyTime.map(() => Math.round(38 + rand() * 52)),
    precipitation_sum: dailyTime.map(() => Math.round(rand() * 12 * 10) / 10),
    rain_sum: dailyTime.map(() => Math.round(rand() * 11 * 10) / 10),
    snowfall_sum: dailyTime.map(() => 0),
    precipitation_hours: dailyTime.map(() => Math.round(rand() * 9)),
    wind_speed_10m_max: dailyTime.map(() => Math.round(8 + rand() * 30)),
    wind_gusts_10m_max: dailyTime.map(() => Math.round(15 + rand() * 45)),
    wind_direction_10m_dominant: dailyTime.map(() => Math.round(rand() * 360)),
    shortwave_radiation_sum: dailyTime.map(() => Math.round(12e6 + rand() * 14e6)),
    sunshine_duration: dailyTime.map(() => Math.round(18000 + rand() * 18000)),
    sunrise: dailyTime.map((d) => `${d}T06:${String(8 + Math.floor(rand() * 12)).padStart(2, '0')}`),
    sunset: dailyTime.map((d) => `${d}T18:${String(40 + Math.floor(rand() * 18)).padStart(2, '0')}`)
  }
  const hours = days * 24
  const hourlyTime: string[] = []
  const hourly = {
    temperature_2m: [] as number[],
    apparent_temperature: [] as number[],
    relative_humidity_2m: [] as number[],
    precipitation: [] as number[],
    rain: [] as number[],
    wind_speed_10m: [] as number[],
    wind_direction_10m: [] as number[],
    wind_gusts_10m: [] as number[],
    cloud_cover: [] as number[],
    weather_code: [] as number[]
  }
  for (let i = 0; i < hours; i++) {
    const hour = i % 24
    const t = Math.round((baseTemp + 6 + Math.sin(((hour - 6) / 24) * Math.PI * 2) * 7 + rand() * 2) * 10) / 10
    hourlyTime.push(`${dateStr(Math.floor(i / 24))}T${String(hour).padStart(2, '0')}:00`)
    hourly.temperature_2m.push(t)
    hourly.apparent_temperature.push(Math.round((t - 1 + rand()) * 10) / 10)
    hourly.relative_humidity_2m.push(Math.round(40 + rand() * 50))
    hourly.precipitation.push(rand() < 0.15 ? Math.round(rand() * 2 * 10) / 10 : 0)
    hourly.rain.push(rand() < 0.12 ? Math.round(rand() * 2 * 10) / 10 : 0)
    hourly.wind_speed_10m.push(Math.round(6 + rand() * 24))
    hourly.wind_direction_10m.push(Math.round(rand() * 360))
    hourly.wind_gusts_10m.push(Math.round(12 + rand() * 38))
    hourly.cloud_cover.push(Math.round(rand() * 100))
    hourly.weather_code.push(WMO_CODES[Math.floor(rand() * WMO_CODES.length)])
  }
  const nowHour = new Date().getHours()
  return weatherJson({
    current: {
      time: `${dateStr(0)}T${String(nowHour).padStart(2, '0')}:00`,
      temperature_2m: Math.round((baseTemp + 4 + rand() * 6) * 10) / 10,
      apparent_temperature: Math.round((baseTemp + 3 + rand() * 6) * 10) / 10,
      relative_humidity_2m: Math.round(40 + rand() * 50),
      wind_speed_10m: Math.round(6 + rand() * 24),
      weather_code: WMO_CODES[Math.floor(rand() * WMO_CODES.length)]
    },
    daily,
    hourly: { time: hourlyTime, ...hourly }
  })
}

export function mockExternalWeatherResponse(url: URL): Response | null {
  if (url.hostname === 'api.open-meteo.com' && url.pathname === '/v1/forecast') {
    return mockOpenMeteoForecast(url)
  }
  if (url.hostname === 'geocoding-api.open-meteo.com' && url.pathname === '/v1/search') {
    const name = (url.searchParams.get('name') || '太原').slice(0, 12)
    return weatherJson({
      results: [
        { name, latitude: 37.87, longitude: 112.55, admin1: '山西省', country: '中国' },
        { name: `${name}郊区`, latitude: 37.7, longitude: 112.4, admin1: '山西省', country: '中国' }
      ]
    })
  }
  if (url.hostname === 'api.bigdatacloud.net' && url.pathname === '/data/reverse-geocode-client') {
    return weatherJson({ city: '太原', locality: '太原', principalSubdivision: '山西省' })
  }
  return null
}
