// 天气取数统一服务（外部辅助数据）。
// 从 HomeConsoleView / WeatherForecastView 的内联 fetch 收编：视图不得直接 fetch
// （DEVELOPMENT.md §3.1），且两个视图各自实现「和风优先 → Open-Meteo 回退」造成
// 双份漂移风险（WMO 码表、超时、回退顺序各一套）。收编后视图只留竞态守卫/缓存/防抖。
//
// 数据源纪律：
//   - 和风走平台代理 apiGet('/qweather')（鉴权/配额由 Node 面管理，其 401 不触发全局
//     登出——见 api.ts isBusinessProxy 白名单）；
//   - Open-Meteo / bigdatacloud 为公网免费源，直接 fetch + 短超时，仅作和风故障时的
//     外网回退链路；
//   - 外部辅助数据**不参与 provenance 标注**（非平台回放数据，不进 mock/真实标注体系）；
//   - 诚实空：全部源失败 → null / []，不合成「21°晴」类装饰值。
import { apiGet, timeoutSignal } from '@/services/api'

// Open-Meteo WMO 码 → 中文（仅外网回退链路用；展示图标分类在各视图自理）
export const WMO_TXT: Record<number, string> = {
  0: '晴', 1: '晴', 2: '少云', 3: '阴', 45: '雾', 48: '雾', 51: '小雨', 53: '小雨', 55: '中雨',
  56: '小雨', 57: '中雨', 61: '小雨', 63: '中雨', 65: '大雨', 66: '雨', 67: '大雨',
  71: '小雪', 73: '雪', 75: '大雪', 77: '雪', 80: '阵雨', 81: '阵雨', 82: '阵雨',
  85: '阵雪', 86: '阵雪', 95: '雷阵雨', 96: '雷阵雨', 99: '雷阵雨'
}

const CURRENT_TIMEOUT_MS = 3500
const DAILY15_TIMEOUT_MS = 4500
const GEO_TIMEOUT_MS = 5000
const BUNDLE_TIMEOUT_MS = 8000

export interface LiveWeather { temp: number; text: string }

// 实时天气：和风 now 优先，失败回退 Open-Meteo current；双败 → null（视图隐藏温度）。
export async function fetchCurrentWeather(lat: number, lon: number): Promise<LiveWeather | null> {
  try {
    const r: any = await apiGet<any>('/qweather', { path: '/v7/weather/now', location: `${lon},${lat}` })
    const now = r?.now
    if (now && now.temp != null) return { temp: Math.round(Number(now.temp)), text: String(now.text || '') }
  } catch { /* 和风失败 → 外网回退 */ }
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`,
      { signal: timeoutSignal(CURRENT_TIMEOUT_MS) }
    )
    const j = await res.json()
    return j?.current?.temperature_2m != null
      ? { temp: Math.round(Number(j.current.temperature_2m)), text: WMO_TXT[Number(j.current.weather_code)] || '' }
      : null
  } catch { return null }
}

// 15 日预报（逐城市）：和风 15d 优先，回退 Open-Meteo daily；双败 → []（视图出空网格）。
// 行形状对齐和风字段名（fxDate/textDay/high/low/humidity），回退链路做同构映射。
export async function fetchDaily15(lat: number, lon: number): Promise<Array<{ fxDate: string; textDay: string; high: number; low: number; humidity?: number }>> {
  try {
    const r: any = await apiGet<any>('/qweather', { path: '/v7/weather/15d', location: `${lon},${lat}` })
    if (Array.isArray(r?.daily) && r.daily.length) {
      return r.daily.map((d: any) => ({ fxDate: d.fxDate, textDay: d.textDay, high: d.tempMax, low: d.tempMin, humidity: d.humidity }))
    }
  } catch { /* 和风失败 → 外网回退 */ }
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean&timezone=Asia%2FShanghai&forecast_days=15`,
      { signal: timeoutSignal(DAILY15_TIMEOUT_MS) }
    )
    const j = await res.json()
    if (j?.daily?.time) {
      return j.daily.time.map((t: string, i: number) => ({
        fxDate: t,
        textDay: WMO_TXT[Number(j.daily.weather_code[i])] || '',
        high: j.daily.temperature_2m_max[i],
        low: j.daily.temperature_2m_min[i],
        humidity: j.daily.relative_humidity_2m_mean?.[i]
      }))
    }
  } catch { /* ignore */ }
  return []
}

export interface GeoCity { name: string; lat: number; lon: number; admin1?: string }

// 城市搜索（首页挂件）：和风 city lookup。
export async function searchCityByQweather(kw: string, count = 10): Promise<GeoCity[]> {
  const r: any = await apiGet<any>('/qweather', { path: '/geo/v2/city/lookup', location: kw, number: count })
  return (r?.location || []).map((x: any): GeoCity => ({ name: x.name, lat: Number(x.lat), lon: Number(x.lon), admin1: x.adm1 }))
}

// 经纬度反查城市（首页挂件定位）：和风 lookup，失败 → null（调用方仍按经纬度出天气）。
export async function lookupCityByCoords(lon: number, lat: number): Promise<GeoCity | null> {
  try {
    const r: any = await apiGet<any>('/qweather', { path: '/geo/v2/city/lookup', location: `${lon.toFixed(2)},${lat.toFixed(2)}` })
    const l0 = r?.location?.[0]
    return l0 ? { name: String(l0.name || ''), lat: Number(l0.lat), lon: Number(l0.lon), admin1: l0.adm1 || '' } : null
  } catch { return null }
}

// 城市搜索（预报页）：Open-Meteo geocoding（免费/无 key）。
export async function searchCityByOpenMeteo(q: string, count = 10): Promise<GeoCity[]> {
  const r = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${count}&language=zh`,
    { signal: timeoutSignal(GEO_TIMEOUT_MS) }
  )
  const j = await r.json()
  return (j.results || []).map((x: any): GeoCity => ({ name: x.name, lon: x.longitude, lat: x.latitude, admin1: x.admin1 }))
}

// 逆地理（预报页定位）：bigdatacloud，失败 → null（调用方回落「我的位置」+ 经纬度直出）。
export async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; admin1: string } | null> {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`,
      { signal: timeoutSignal(GEO_TIMEOUT_MS) }
    )
    const j = await r.json()
    return { name: j.city || j.locality || j.principalSubdivision || '', admin1: j.principalSubdivision || '' }
  } catch { return null }
}

// 预报页全量 bundle（Open-Meteo 直连，15 日 daily/hourly/current 一次拉全）。
// 非 ok / 网络失败 → 抛错（预报页对该页有整体错误态，与挂件的「隐藏温度」策略不同）。
const BUNDLE_DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean',
  'apparent_temperature_max', 'apparent_temperature_min', 'relative_humidity_2m_mean', 'precipitation_sum',
  'rain_sum', 'snowfall_sum', 'precipitation_hours', 'wind_speed_10m_max', 'wind_gusts_10m_max',
  'wind_direction_10m_dominant', 'shortwave_radiation_sum', 'sunshine_duration', 'sunrise', 'sunset'].join(',')
const BUNDLE_HOURLY = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'rain',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'cloud_cover', 'weather_code'].join(',')
const BUNDLE_CURRENT = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'wind_speed_10m', 'weather_code'].join(',')

export interface ForecastBundle { current: any; daily: any; hourly: any }

export async function fetchForecastBundle(lat: number, lon: number): Promise<ForecastBundle> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${BUNDLE_DAILY}&hourly=${BUNDLE_HOURLY}&current=${BUNDLE_CURRENT}&timezone=Asia%2FShanghai&forecast_days=15`
  const res = await fetch(url, { signal: timeoutSignal(BUNDLE_TIMEOUT_MS) })
  if (!res.ok) throw new Error('Open-Meteo 请求失败 ' + res.status)
  const j = await res.json()
  return { current: j.current, daily: j.daily, hourly: j.hourly }
}
