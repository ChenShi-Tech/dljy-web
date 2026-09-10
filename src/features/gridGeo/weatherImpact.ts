import { fetchCaptured } from '@/services/captured'
import { capturedAtFromProvenance } from '@/services/data/freshness'
import { fetchNodePriceSeriesWithMeta, type SpotDataResult, type NodePriceSeries } from '@/services/market/spotClient'
import { buildPlantOutputSeries, loadPlantOutputSourcePayload } from '@/services/market/plantOutputClient'
import { fetchGridGeoPlantIntegrations } from './client'
import {
  mappingMatchesScope,
  mergeSourceTruthMetas,
  resolveGridSpatialPriceRegion,
  resolveGridSpatialWeatherSource,
  resolveScopedOutputSources,
} from './marketSpatialScope'
import { hourlyAverage, optionalCaptureOnNotFound, pearsonCorrelation } from './weatherImpactMath'
import { buildWeatherTracks, type WeatherAsOfRow } from './weatherTracks'
import { isMockActive } from '@/services/mock/session'
import type { GridGeoPlant } from './types'

type MeteoRow = { date: string; time: string; stationId: string; lat: number; lon: number; temp: number | null; humidity: number | null; windSpeed100: number | null; precipitation: number | null; cloudCover: number | null }
type IrradianceRow = { date: string; time: string; stationId: string; lat: number; lon: number; ghi: number | null }
type Envelope = { data?: unknown; rows?: unknown; mock?: boolean; sourceType?: string; accessDenied?: boolean; provenance?: { sourceType?: string; realDataConnected?: boolean } }

function rows<T>(body: unknown): T[] {
  const envelope = body as Envelope
  // 「来源必须证明真实」的治理门只约束真实账号；演示会话（PRD R1/R4）数据本就是
  // 合成来源，按 mock 接受，页面可信度徽章仍如实显示 mock。
  if (!isMockActive() && (envelope.mock || envelope.provenance?.sourceType === 'MOCK' || envelope.provenance?.realDataConnected !== true)) return []
  if (Array.isArray(envelope.data)) return envelope.data as T[]
  if (Array.isArray(envelope.rows)) return envelope.rows as T[]
  return []
}

function meta(body: unknown) {
  const envelope = body as Envelope
  const sourceType = envelope.provenance?.sourceType ?? envelope.sourceType ?? ''
  return {
    sourceType,
    mock: envelope.mock === true || sourceType === 'MOCK',
    hasRealData: envelope.provenance?.realDataConnected === true,
    accessDenied: envelope.accessDenied === true,
    updatedAt: capturedAtFromProvenance(body),
  }
}

export function mergeWeatherImpactSourceMeta(bodies: unknown[]) {
  return mergeSourceTruthMetas(bodies.map(meta))
}

function nearestStation<T extends { stationId: string; lat: number; lon: number }>(allRows: T[], plant: GridGeoPlant) {
  const stations = new Map<string, T>()
  allRows.forEach((row) => stations.set(row.stationId, row))
  return [...stations.values()].sort((a, b) => {
    const da = (a.lat - plant.location.latitude) ** 2 + (a.lon - plant.location.longitude) ** 2
    const db = (b.lat - plant.location.latitude) ** 2 + (b.lon - plant.location.longitude) ** 2
    return da - db
  })[0]?.stationId ?? null
}

function value(value: unknown) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
}

function byHour<T extends { time: string }>(allRows: T[], field: keyof T) {
  const result = Array<number | null>(24).fill(null)
  for (const row of allRows) {
    const hour = Number(String(row.time).slice(0, 2))
    if (hour >= 0 && hour < 24) result[hour] = value(row[field])
  }
  return result
}

function deviationRiskPercent(actual: Array<number | null>, target: Array<number | null>) {
  return actual.map((actualValue, hour) => {
    const targetValue = target[hour]
    if (actualValue === null || targetValue === null || Math.abs(targetValue) < 1e-9) return null
    return Math.abs(actualValue - targetValue) / Math.abs(targetValue) * 100
  })
}

export async function loadWeatherImpact(
  plant: GridGeoPlant,
  date: string,
  scope: { companyId: string; regionId: string },
  decisionHour = 12,
) {
  if (!scope.companyId || !scope.regionId) throw new Error('当前公司或地区上下文缺失，已停止气象影响取数')
  const demoSession = isMockActive()
  const mapping = await fetchGridGeoPlantIntegrations(plant.plantId)
  if (!mappingMatchesScope(mapping, scope.companyId, scope.regionId)) {
    throw new Error('场站映射与当前公司或地区不一致，已拒绝跨域取数')
  }
  const outputSource = resolveScopedOutputSources([mapping], scope.companyId, scope.regionId)[0]
  const weatherSource = resolveGridSpatialWeatherSource(scope.regionId)
  const priceRegion = resolveGridSpatialPriceRegion(scope.regionId)
  const unavailableWeather = { rows: [], data: [], sourceType: 'NOT_CONFIGURED', mock: false }
  const unavailablePrice = { data: { series: [], points: 0 }, sourceType: 'NOT_CONFIGURED', mock: false, productionWrite: false } satisfies SpotDataResult<NodePriceSeries>
  const [asOfBody, meteoBody, irradianceBody, output, daResult, rtResult] = await Promise.all([
    scope.regionId === 'yunnan' || demoSession
      ? optionalCaptureOnNotFound(fetchCaptured<unknown>('weather_asof', 'open_meteo_previous_runs_hourly', { region: scope.regionId, dateFrom: date, dateTo: date }), unavailableWeather)
      : Promise.resolve(unavailableWeather),
    weatherSource
      ? fetchCaptured<unknown>(weatherSource.meteo.family, weatherSource.meteo.dataset, { region: weatherSource.region, dateFrom: date, dateTo: date })
      : Promise.resolve(unavailableWeather),
    weatherSource
      ? fetchCaptured<unknown>(weatherSource.irradiance.family, weatherSource.irradiance.dataset, { region: weatherSource.region, dateFrom: date, dateTo: date })
      : Promise.resolve(unavailableWeather),
    outputSource
      ? loadPlantOutputSourcePayload(outputSource, { date })
      : Promise.resolve({ rows: [], plants: [], nodes: [], meta: { hasRealData: false, mock: false, sourceType: 'NOT_CONFIGURED', updatedAt: null } }),
    mapping.identity.nodeName && priceRegion ? fetchNodePriceSeriesWithMeta(date, mapping.identity.nodeName, 'da', priceRegion).catch(() => unavailablePrice) : Promise.resolve(unavailablePrice),
    mapping.identity.nodeName && priceRegion ? fetchNodePriceSeriesWithMeta(date, mapping.identity.nodeName, 'rt', priceRegion).catch(() => unavailablePrice) : Promise.resolve(unavailablePrice),
  ])
  const asOfRows = rows<WeatherAsOfRow>(asOfBody).filter((row) => row.regionId === scope.regionId)
  const meteoRows = rows<MeteoRow>(meteoBody)
  const irradianceRows = rows<IrradianceRow>(irradianceBody)
  const stationCandidates = [...meteoRows, ...irradianceRows, ...asOfRows.filter((row): row is WeatherAsOfRow & { stationId: string; lat: number; lon: number } => Boolean(row.stationId) && Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)))]
  const stationId = nearestStation(stationCandidates, plant)
  const stationMeteo = meteoRows.filter((row) => row.stationId === stationId)
  const stationIrradiance = irradianceRows.filter((row) => row.stationId === stationId)
  const stationAsOf = asOfRows.filter((row) => row.stationId === stationId)
  const names = new Set(mapping.identity.plantNames)
  const outputRows = output.rows.filter((row) => names.has(row.standardPlant ?? '') || names.has(row.plant))
  const outputSeries = buildPlantOutputSeries(outputRows)
  const actualOutput = hourlyAverage(outputSeries.actual)
  const targetOutput = hourlyAverage(outputSeries.target)
  const daPrice = hourlyAverage((daResult.mock && !demoSession ? [] : daResult.data.series).map((point) => point.price))
  const rtPrice = hourlyAverage((rtResult.mock && !demoSession ? [] : rtResult.data.series).map((point) => point.price))
  const wind = byHour(stationMeteo, 'windSpeed100')
  const temperature = byHour(stationMeteo, 'temp')
  const precipitation = byHour(stationMeteo, 'precipitation')
  const ghi = byHour(stationIrradiance, 'ghi')
  const riskExposurePercent = deviationRiskPercent(actualOutput, targetOutput)
  const driver = plant.plantType === 'wind' ? wind : plant.plantType === 'solar' ? ghi : temperature
  const driverLabel = plant.plantType === 'wind' ? '100m 风速' : plant.plantType === 'solar' ? '短波辐照 GHI' : '气温'
  const alerts = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    items: [
      wind[hour] !== null && Number(wind[hour]) >= 20 ? '大风关注' : null,
      precipitation[hour] !== null && Number(precipitation[hour]) >= 10 ? '强降水关注' : null,
      temperature[hour] !== null && Number(temperature[hour]) >= 35 ? '高温关注' : null,
      ghi[hour] !== null && Number(ghi[hour]) >= 900 ? '强辐照关注' : null,
    ].filter((item): item is string => Boolean(item)),
  })).filter((item) => item.items.length)
  const weatherMeta = mergeWeatherImpactSourceMeta([meteoBody, irradianceBody])
  const weatherAsOfMeta = meta(asOfBody)
  const tracks = buildWeatherTracks({
    forecastRows: stationAsOf,
    actualValues: driver,
    actualSourceType: weatherMeta.sourceType,
    actualProvider: 'capture-weather',
    actualUpdatedAt: weatherMeta.updatedAt,
    plantType: plant.plantType,
    targetDate: date,
    regionId: scope.regionId,
    stationId,
    decisionHour,
  })
  return {
    date,
    plantId: plant.plantId,
    stationId,
    nodeName: mapping.identity.nodeName,
    driverLabel,
    hours: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`),
    decisionHour,
    series: { driver, wind, temperature, precipitation, ghi, actualOutput, targetOutput, daPrice, rtPrice, riskExposurePercent },
    correlations: {
      weatherOutput: pearsonCorrelation(driver, actualOutput),
      weatherPrice: pearsonCorrelation(driver, rtPrice),
      outputPrice: pearsonCorrelation(actualOutput, rtPrice),
    },
    alerts,
    tracks,
    sources: {
      weatherAsOf: { ...weatherAsOfMeta, basis: 'captured-asof-forecast', matchedRows: stationAsOf.length, ingestionMode: 'historical-backfill' as const },
      weather: { ...weatherMeta, basis: 'historical-actual', asOfSafeForForecastBacktest: false },
      output: { ...output.meta, basis: 'captured', matchedRows: outputRows.length, targetSource: outputSeries.targetSource, targetKind: outputSeries.targetKind },
      price: { sourceType: daResult.sourceType || rtResult.sourceType || 'UNKNOWN', basis: 'captured', mock: daResult.mock || rtResult.mock, productionWrite: daResult.productionWrite || rtResult.productionWrite, daPoints: daResult.data.points, rtPoints: rtResult.data.points },
      risk: { sourceType: output.meta.sourceType || 'NOT_COLLECTED', basis: 'derived-retrospective', mock: output.meta.mock, formula: '|实际出力−目标出力|/|目标出力|', productionWrite: false },
    },
    disclaimers: {
      retrospectiveCorrelationOnly: true,
      causalInference: false,
      productionForecastAccuracy: false,
      settlementBasis: false,
    },
  }
}

export type WeatherImpactResult = Awaited<ReturnType<typeof loadWeatherImpact>>
