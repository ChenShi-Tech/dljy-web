// 复盘天气上下文（清单 R7）：偏差归因的外生参考——「那天是不是特别冷/热导致用电超」。
// 铁律：纯展示，不进任何偏差考核/收益计算口径。
//
// 数据源为什么是 Open-Meteo Archive 而不是 weather.ts 的预报 API：
// 预报 API 的 past_days 上限 92 天，盖不住山西静态采集批（复盘覆盖窗 2026-04~05，
// 距今常超 92 天，整列将永远无数据）；Archive API（ERA5 再分析）是同一供应商的
// 历史实况、免费无 key，可回溯任意历史日（近期约 2~5 天延迟，缺的日如实留空）。
// 与 weather.ts 的外网直连同域纪律：外部辅助数据、不进 provenance 标注体系、
// 失败/缺日如实为 null，不合成「21°晴」类装饰值。
import { timeoutSignal } from '@/services/api'
import { WMO_TXT } from '@/services/weather'

const HISTORY_TIMEOUT_MS = 8000

/** 复盘天气取数的代表点：省级复盘用省会坐标（与 src/data/chinaCities.ts 同源）。 */
export const WEATHER_CITY_BY_REGION: Record<string, { city: string; lon: number; lat: number }> = {
  shanxi: { city: '太原', lon: 112.55, lat: 37.87 },
  yunnan: { city: '昆明', lon: 102.83, lat: 24.88 }
}

/** 未登记天气代表点的地区返回 null（调用方隐藏天气 UI，不出别的地区的数）。 */
export function regionWeatherCity(regionId: string): { city: string; lon: number; lat: number } | null {
  return WEATHER_CITY_BY_REGION[regionId] ?? null
}

export interface DayWeather {
  date: string
  wmo: number
  txt: string
  tMin: number
  tMax: number
}

/**
 * 逐日历史天气（闭区间）：按日聚合为 Map（key=YYYY-MM-DD）。
 * 源缺某日（如近 2~5 天再分析延迟）该日不入 Map；整体失败返回 null（区别于「部分缺日」）。
 */
export async function fetchDailyWeather(
  city: { lon: number; lat: number },
  startDate: string,
  endDate: string
): Promise<Map<string, DayWeather> | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) return null
  try {
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${city.lat}&longitude=${city.lon}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai`
    const res = await fetch(url, { signal: timeoutSignal(HISTORY_TIMEOUT_MS) })
    if (!res.ok) return null
    const j = await res.json()
    const times: unknown = j?.daily?.time
    if (!Array.isArray(times) || !times.length) return null
    const map = new Map<string, DayWeather>()
    times.forEach((t, i) => {
      const tMin = j.daily.temperature_2m_min?.[i]
      const tMax = j.daily.temperature_2m_max?.[i]
      if (tMin == null || tMax == null) return
      const date = String(t).slice(0, 10)
      const wmo = Number(j.daily.weather_code?.[i] ?? -1)
      map.set(date, { date, wmo, txt: WMO_TXT[wmo] ?? '', tMin: Math.round(Number(tMin)), tMax: Math.round(Number(tMax)) })
    })
    return map.size ? map : null
  } catch {
    return null
  }
}

/** 聚合表「天气」列单元格文本：无数据返回空串（留空，不出「—」冒充观测值）。 */
export function weatherCellText(w: DayWeather | undefined): string {
  if (!w) return ''
  return `${w.txt} ${w.tMin}~${w.tMax}°`
}

/** 头部 chip 文本：`阴 19~29°`。 */
export function weatherChipText(w: DayWeather): string {
  return `${w.txt} ${w.tMin}~${w.tMax}°`
}

/** chip 悬停全文：当日 vs 前一日（前一日缺数如实标注，不对比假数据）。 */
export function weatherChipTooltip(city: string, w: DayWeather, prev: DayWeather | undefined): string {
  const cur = `${city} ${w.date}：${w.txt}，${w.tMin}~${w.tMax}°C`
  const prevPart = prev
    ? `｜前一日 ${prev.date.slice(5)}：${prev.txt}，${prev.tMin}~${prev.tMax}°C`
    : '｜前一日无天气数据'
  return `${cur}${prevPart}｜天气仅作复盘参考，不进任何考核计算（Open-Meteo 历史再分析）`
}

/** WMO 码 → 图标分类（展示图标分类在各视图自理是 weather.ts 约定，这里供 chip 用）。 */
export type WeatherIconKind = 'sun' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'
export function weatherIconKind(wmo: number): WeatherIconKind {
  if (wmo >= 95) return 'storm'
  if ((wmo >= 71 && wmo <= 77) || wmo === 85 || wmo === 86) return 'snow'
  if ((wmo >= 51 && wmo <= 67) || (wmo >= 80 && wmo <= 82)) return 'rain'
  if (wmo === 45 || wmo === 48) return 'fog'
  if (wmo <= 1) return 'sun'
  return 'cloud'
}
