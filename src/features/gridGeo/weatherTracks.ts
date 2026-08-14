export type WeatherTrackId = 'd2' | 'd1' | 'intraday' | 'actual'

export type WeatherAsOfRow = {
  provider?: string
  forecastRunId?: string
  modelVersion?: string
  featureVersion?: string
  forecastAt?: string
  validAt?: string
  ingestedAt?: string
  regionId?: string
  stationId?: string
  plantId?: string | null
  lat?: number
  lon?: number
  leadHours?: number
  values?: Record<string, unknown>
  windSpeed100?: number | null
  temp?: number | null
  ghi?: number | null
  sourceType?: string
  basis?: string
  mock?: boolean
  productionWrite?: boolean
  rawVersionId?: string
}

export type WeatherTrackPoint = {
  status: 'available' | 'missing' | 'outside-forecast-horizon'
  value: number | null
  validAt: string
  forecastAt: string | null
  ingestedAt: string | null
  sourceRef: string | null
  provider: string | null
  forecastRunId: string | null
  modelVersion: string | null
  featureVersion: string | null
  sourceType: string
  basis: string
  reason: string
}

export type WeatherTrack = {
  id: WeatherTrackId
  label: string
  eyebrow: string
  status: 'available' | 'partial' | 'unavailable'
  basis: 'captured-asof-forecast' | 'historical-actual'
  sourceType: string
  values: Array<number | null>
  points: WeatherTrackPoint[]
  providerCount: number
  providers: string[]
  forecastAt: string | null
  decisionAt: string | null
  ingestionMode: 'historical-backfill' | 'observed-result'
  availableHours: number
  expectedHours: number
  missingHours: number[]
  reason: string
  asOfSafeForDisplay: boolean
  asOfSafeForForecastBacktest: boolean
  divergence: { status: 'available' | 'unavailable'; comparedHours: number; meanSpread: number | null; reason: string }
}

export const WEATHER_TRACK_ORDER = Object.freeze<WeatherTrackId[]>(['d2', 'd1', 'intraday', 'actual'])

export function weatherPointEvidenceTitle(trackId: WeatherTrackId, status: WeatherTrackPoint['status']) {
  if (trackId === 'actual') return status === 'available' ? '实现后实况点（非 as-of 预报）' : '实况数据未采集'
  if (status === 'available') return '该点通过 as-of 时间门'
  return status === 'missing' ? '该点数据未采集' : '该点已在决策截止前实现'
}

const LABELS: Record<WeatherTrackId, Pick<WeatherTrack, 'label' | 'eyebrow'>> = {
  d2: { label: 'D-2 决策快照', eyebrow: 'T−2D AS-OF' },
  d1: { label: 'D-1 决策快照', eyebrow: 'T−1D AS-OF' },
  intraday: { label: '日内决策快照', eyebrow: 'T+0D AS-OF' },
  actual: { label: '实况 / 再分析', eyebrow: 'OBSERVED OUTCOME' },
}

const TRACK_DAYS_BEFORE: Record<Exclude<WeatherTrackId, 'actual'>, number> = { d2: 2, d1: 1, intraday: 0 }
const REAL_SOURCE_TYPES = new Set(['REAL', 'CAPTURED', 'API'])
const ZONED_ISO = /(?:Z|[+-]\d{2}:\d{2})$/i

function finite(value: unknown) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return null
  return Number(value)
}

function parseZoned(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text || !ZONED_ISO.test(text)) return null
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : null
}

function localDateHour(value: string) {
  const timestamp = parseZoned(value)
  if (timestamp === null) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) }
}

function validAtForHour(targetDate: string, hour: number) {
  return `${targetDate}T${String(hour).padStart(2, '0')}:00:00+08:00`
}

export function decisionAtForTrack(targetDate: string, trackId: Exclude<WeatherTrackId, 'actual'>, decisionHour = 12) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new Error('targetDate 必须为 YYYY-MM-DD')
  if (!Number.isInteger(decisionHour) || decisionHour < 0 || decisionHour > 23) throw new Error('decisionHour 必须为 0..23 的整数')
  const target = new Date(`${targetDate}T${String(decisionHour).padStart(2, '0')}:00:00+08:00`)
  target.setUTCDate(target.getUTCDate() - TRACK_DAYS_BEFORE[trackId])
  return target.toISOString()
}

function driverValue(row: WeatherAsOfRow, plantType: string) {
  const key = plantType === 'wind' ? 'wind_speed_100m' : plantType === 'solar' ? 'ghi' : 'temp'
  const camelKey = plantType === 'wind' ? 'windSpeed100' : key
  return finite(row.values?.[key] ?? row.values?.[camelKey] ?? row[camelKey as keyof WeatherAsOfRow])
}

export function selectWeatherRowsAsOf(rows: WeatherAsOfRow[], input: {
  decisionAt: string
  targetDate: string
  regionId: string
  stationId: string | null
}) {
  const decisionMs = parseZoned(input.decisionAt)
  if (decisionMs === null) throw new Error('decisionAt 必须是带时区的 ISO-8601 时间')
  const rejected = { invalidContract: 0, scopeMismatch: 0, nonReal: 0, futureForecastAt: 0, outsideHorizon: 0 }
  const latest = new Map<string, WeatherAsOfRow>()

  for (const row of rows) {
    const forecastMs = parseZoned(row.forecastAt)
    const validMs = parseZoned(row.validAt)
    const ingestedMs = parseZoned(row.ingestedAt)
    const local = row.validAt ? localDateHour(row.validAt) : null
    if (
      forecastMs === null || validMs === null || ingestedMs === null || !local ||
      !row.provider || !row.forecastRunId || !row.modelVersion || !row.featureVersion ||
      forecastMs > validMs || ingestedMs < forecastMs
    ) {
      rejected.invalidContract += 1
      continue
    }
    if (row.regionId !== input.regionId || input.stationId === null || row.stationId !== input.stationId || local.date !== input.targetDate) {
      rejected.scopeMismatch += 1
      continue
    }
    if (row.mock === true || !REAL_SOURCE_TYPES.has(String(row.sourceType ?? '').toUpperCase()) || String(row.basis ?? '').toLowerCase() !== 'captured') {
      rejected.nonReal += 1
      continue
    }
    if (forecastMs > decisionMs) {
      rejected.futureForecastAt += 1
      continue
    }
    if (validMs <= decisionMs) {
      rejected.outsideHorizon += 1
      continue
    }
    const key = `${row.provider}|${row.stationId}|${row.validAt}`
    const previous = latest.get(key)
    if (!previous || Date.parse(String(previous.forecastAt)) < forecastMs) latest.set(key, row)
  }

  return {
    selected: [...latest.values()].sort((left, right) => String(left.validAt).localeCompare(String(right.validAt)) || String(left.provider).localeCompare(String(right.provider))),
    rejected,
  }
}

function forecastTrack(
  id: Exclude<WeatherTrackId, 'actual'>,
  rows: WeatherAsOfRow[],
  input: { plantType: string; targetDate: string; regionId: string; stationId: string | null; decisionHour: number },
): WeatherTrack {
  const decisionAt = decisionAtForTrack(input.targetDate, id, input.decisionHour)
  const decisionMs = Date.parse(decisionAt)
  const selection = selectWeatherRowsAsOf(rows, { decisionAt, targetDate: input.targetDate, regionId: input.regionId, stationId: input.stationId })
  const providerHours = new Map<string, Map<number, WeatherAsOfRow>>()
  for (const row of selection.selected) {
    const local = localDateHour(String(row.validAt))
    const value = driverValue(row, input.plantType)
    if (!local || value === null) continue
    const provider = String(row.provider)
    const hours = providerHours.get(provider) ?? new Map<number, WeatherAsOfRow>()
    hours.set(local.hour, row)
    providerHours.set(provider, hours)
  }
  const providers = [...providerHours.keys()].sort((left, right) => {
    const coverage = (providerHours.get(right)?.size ?? 0) - (providerHours.get(left)?.size ?? 0)
    return coverage || left.localeCompare(right)
  })
  const primary = providers[0]
  const primaryHours = primary ? providerHours.get(primary) : undefined
  const points = Array.from({ length: 24 }, (_, hour): WeatherTrackPoint => {
    const validAt = validAtForHour(input.targetDate, hour)
    if (Date.parse(validAt) <= decisionMs) {
      return {
        status: 'outside-forecast-horizon', value: null, validAt, forecastAt: null, ingestedAt: null,
        sourceRef: null, provider: null, forecastRunId: null, modelVersion: null, featureVersion: null,
        sourceType: 'NOT_APPLICABLE', basis: 'captured-asof-forecast', reason: '该小时在决策截止时已经实现，不用事后实况回填预报轨。',
      }
    }
    const row = primaryHours?.get(hour)
    const value = row ? driverValue(row, input.plantType) : null
    if (!row || value === null) {
      return {
        status: 'missing', value: null, validAt, forecastAt: null, ingestedAt: null,
        sourceRef: null, provider: primary ?? null, forecastRunId: null, modelVersion: null, featureVersion: null,
        sourceType: primary ? 'REAL' : 'NOT_COLLECTED', basis: 'captured-asof-forecast', reason: '决策截止前没有采集到该小时的合规历史预报；保持空段，不插值、不合成。',
      }
    }
    return {
      status: 'available', value, validAt: String(row.validAt), forecastAt: String(row.forecastAt), ingestedAt: String(row.ingestedAt),
      sourceRef: String(row.rawVersionId || row.forecastRunId), provider: String(row.provider), forecastRunId: String(row.forecastRunId),
      modelVersion: String(row.modelVersion), featureVersion: String(row.featureVersion), sourceType: String(row.sourceType).toUpperCase(),
      basis: String(row.basis), reason: 'forecastAt 不晚于决策截止，且 validAt 严格晚于决策截止。',
    }
  })
  const values = points.map((point) => point.value)
  const availableHours = points.filter((point) => point.status === 'available').length
  const expectedHours = points.filter((point) => point.status !== 'outside-forecast-horizon').length
  const missingHours = points.flatMap((point, hour) => point.status === 'missing' ? [hour] : [])
  const status = availableHours === 0 ? 'unavailable' : missingHours.length ? 'partial' : 'available'
  const forecastTimes = points.flatMap((point) => point.forecastAt ? [point.forecastAt] : []).sort()
  const spreads: number[] = []
  for (let hour = 0; hour < 24; hour += 1) {
    const samples = providers.flatMap((provider) => {
      const row = providerHours.get(provider)?.get(hour)
      const value = row ? driverValue(row, input.plantType) : null
      return value === null ? [] : [value]
    })
    if (samples.length >= 2) spreads.push(Math.max(...samples) - Math.min(...samples))
  }
  const noFutureLeakage = points.every((point) => !point.forecastAt || Date.parse(point.forecastAt) <= decisionMs)
  const complete = expectedHours > 0 && availableHours === expectedHours
  const rejectionSuffix = selection.rejected.futureForecastAt
    ? ` 已拒绝 ${selection.rejected.futureForecastAt} 条截止后修订。`
    : ''
  return {
    id, ...LABELS[id], status, basis: 'captured-asof-forecast',
    sourceType: availableHours ? 'REAL' : 'NOT_COLLECTED', values, points,
    providerCount: providers.length, providers, forecastAt: forecastTimes.at(-1) ?? null, decisionAt,
    ingestionMode: 'historical-backfill', availableHours, expectedHours, missingHours,
    reason: availableHours
      ? `主轨 ${primary}，覆盖未来时段 ${availableHours}/${expectedHours}；同轨不跨 Provider 补洞。${rejectionSuffix}`
      : `该决策截止前没有采集到合规 Previous Runs 预报；不回退 ERA5 实况。${rejectionSuffix}`,
    asOfSafeForDisplay: availableHours > 0 && noFutureLeakage,
    asOfSafeForForecastBacktest: complete && noFutureLeakage,
    divergence: spreads.length
      ? { status: 'available', comparedHours: spreads.length, meanSpread: spreads.reduce((sum, value) => sum + value, 0) / spreads.length, reason: '仅比较同一决策截止、同一有效小时的多 Provider 驱动量。' }
      : { status: 'unavailable', comparedHours: 0, meanSpread: null, reason: '至少需要两个合规历史预报源在同一有效小时都有值。' },
  }
}

export function buildWeatherTracks(input: {
  forecastRows: WeatherAsOfRow[]
  actualValues: Array<number | null>
  actualSourceType: string
  actualProvider?: string
  actualUpdatedAt?: string | null
  plantType: string
  targetDate: string
  regionId: string
  stationId: string | null
  decisionHour?: number
}) {
  const decisionHour = input.decisionHour ?? 12
  const forecast = WEATHER_TRACK_ORDER.slice(0, 3).map((id) => forecastTrack(id as Exclude<WeatherTrackId, 'actual'>, input.forecastRows, { ...input, decisionHour }))
  const actualAvailable = input.actualValues.some((value) => value !== null)
  const actualPoints = Array.from({ length: 24 }, (_, hour): WeatherTrackPoint => ({
    status: input.actualValues[hour] === null || input.actualValues[hour] === undefined ? 'missing' : 'available',
    value: input.actualValues[hour] ?? null,
    validAt: validAtForHour(input.targetDate, hour), forecastAt: null, ingestedAt: input.actualUpdatedAt ?? null,
    sourceRef: actualAvailable ? input.actualProvider || input.actualSourceType || 'capture-weather' : null,
    provider: actualAvailable ? input.actualProvider || input.actualSourceType || 'capture-weather' : null,
    forecastRunId: null, modelVersion: null, featureVersion: null,
    sourceType: actualAvailable ? input.actualSourceType || 'CAPTURED' : 'NOT_COLLECTED', basis: 'historical-actual',
    reason: actualAvailable ? '历史实况/ERA5 再分析，仅作实现后结果轨，不是当时可得预报。' : '该小时实况数据未采集。',
  }))
  const actualHours = actualPoints.filter((point) => point.status === 'available').length
  const actual: WeatherTrack = {
    id: 'actual', ...LABELS.actual, status: actualHours === 0 ? 'unavailable' : actualHours === 24 ? 'available' : 'partial',
    basis: 'historical-actual', sourceType: actualAvailable ? input.actualSourceType || 'CAPTURED' : 'NOT_COLLECTED',
    values: actualPoints.map((point) => point.value), points: actualPoints,
    providerCount: actualAvailable ? 1 : 0, providers: actualAvailable ? [input.actualProvider || input.actualSourceType || 'capture-weather'] : [],
    forecastAt: null, decisionAt: null, ingestionMode: 'observed-result', availableHours: actualHours, expectedHours: 24,
    missingHours: actualPoints.flatMap((point, hour) => point.status === 'missing' ? [hour] : []),
    reason: actualAvailable ? `历史实况/再分析覆盖 ${actualHours}/24；只用于回顾性同小时观察。` : '当前运行日没有可用实况驱动序列。',
    asOfSafeForDisplay: false, asOfSafeForForecastBacktest: false,
    divergence: { status: 'unavailable', comparedHours: 0, meanSpread: null, reason: '实况轨不与历史预报源混作预报分歧。' },
  }
  return [...forecast, actual]
}
