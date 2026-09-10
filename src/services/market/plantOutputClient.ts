import { fetchCaptured } from '@/services/captured'
import { capturedAtFromProvenance } from '@/services/data/freshness'
import { isMockActive } from '@/services/mock/session'

export const PLANT_OUTPUT_FAMILY = 'yn_plant_output'
export const PLANT_OUTPUT_DATASET = 'yn_plant_output'
export const ALL_PLANTS = '__all__'
export const ALL_UNITS = '__all__'

// 本模块经 fetchCaptured 读取的 company 私有 capture 族（与后端 capture-families.mjs
// visibility='company' 定级一致）。供消费页把 RegionDataBanner 的 `families` opt-in
// 声明集中在数据加载层、避免各页内联字符串漂移（Sub-4 #520）。
export const PLANT_OUTPUT_PRIVATE_FAMILIES = ['yn_plant_output', 'yn_dim_plant', 'yn_dim_plant_node'] as const

export type PlantOutputRole = 'actual' | 'plan' | 'forecast' | 'available' | 'theoretical' | 'other'
export type PlantOutputDateRange = [string, string]
export type PlantOutputAggregation = 'slot' | 'day' | 'week' | 'month'

export interface PlantOutputRow {
  id: string
  date: string
  plant: string
  standardPlant?: string | null
  unitName?: string | null
  point: number
  timePoint: string
  dataType: string
  seriesRole: PlantOutputRole
  valueMw: number | null
}

export interface PlantDimRow {
  id: string
  standardName: string
  plantType?: string | null
  isActive?: number | null
}

export interface PlantNodeRow {
  id: string
  nodeName?: string | null
  standardName: string
  isActive?: number | null
}

export interface CapturedEnvelopeMeta {
  hasRealData: boolean
  mock: boolean
  sourceType: string
  updatedAt: string | null
  error?: string
}

export interface PlantOutputPayload {
  rows: PlantOutputRow[]
  plants: PlantDimRow[]
  nodes: PlantNodeRow[]
  meta: CapturedEnvelopeMeta
}

export interface PlantOutputCaptureSource {
  family: string
  dataset: string
  region: string
}

export interface PlantOutputSeries {
  times: string[]
  actual: Array<number | null>
  plan: Array<number | null>
  forecast: Array<number | null>
  target: Array<number | null>
  deviation: Array<number | null>
  completion: Array<number | null>
  actualSource: string
  forecastSource: string
  targetSource: string
  targetKind: 'plan' | 'forecast'
  aggregation: PlantOutputAggregation
}

export interface PlantOutputAnomaly {
  groupLabel?: string
  timePoint: string
  actualMw: number
  targetMw: number
  deviationMw: number
  deviationPct: number
  completionPct: number
}

export interface PlantOutputSummary {
  actualAvg: number | null
  targetAvg: number | null
  completionAvg: number | null
  maxAbsDeviation: number | null
  anomalyCount: number
  pointCount: number
}

type AnyEnvelope = {
  data?: unknown
  rows?: unknown
  mock?: boolean
  sourceType?: string
  productionWrite?: boolean
  provenance?: {
    sourceType?: string
    realDataConnected?: boolean
  }
}

export type PlantOutputLoadInput =
  | string
  | PlantOutputDateRange
  | {
      date?: string
      dateRange?: PlantOutputDateRange
    }

function pickRows<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  const data = (body as { data?: unknown } | null)?.data
  if (Array.isArray(data)) return data as T[]
  const rows = (body as { rows?: unknown } | null)?.rows
  if (Array.isArray(rows)) return rows as T[]
  return []
}

function envelopeMeta(body: unknown, error?: unknown): CapturedEnvelopeMeta {
  const env = (body ?? {}) as AnyEnvelope
  const prov = env.provenance
  const sourceType = prov?.sourceType ?? env.sourceType ?? (env.mock ? 'MOCK' : '')
  const mock = env.mock === true || sourceType === 'MOCK'
  return {
    hasRealData: prov?.realDataConnected === true,
    mock,
    sourceType,
    updatedAt: capturedAtFromProvenance(body),
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {})
  }
}

async function safeFetchRows<T>(family: string, match: string): Promise<{ rows: T[]; meta: CapturedEnvelopeMeta }> {
  try {
    const body = await fetchCaptured<unknown>(family, match, { region: 'yunnan' })
    const meta = envelopeMeta(body)
    return { rows: meta.hasRealData && !meta.mock ? pickRows<T>(body) : [], meta }
  } catch (error) {
    return { rows: [], meta: envelopeMeta(null, error) }
  }
}

export async function loadPlantOutputRangePayload(dateFrom: string, dateTo: string): Promise<PlantOutputPayload> {
  return loadPlantOutputPayload({ dateRange: [dateFrom, dateTo] })
}

function normalizeDateRange(input: PlantOutputLoadInput): PlantOutputDateRange {
  if (Array.isArray(input)) return [input[0], input[1]]
  if (typeof input === 'string') return [input, input]
  if (input.dateRange) return [input.dateRange[0], input.dateRange[1]]
  const date = input.date ?? '2026-05-01'
  return [date, date]
}

// 空间资产场景必须从已验证 integration 契约传入 family/dataset/region，不能默认读取
// 某一家公司的固定私有族。调用方还需用 capture registry 核对 ownerCompanyId。
export async function loadPlantOutputSourcePayload(
  source: PlantOutputCaptureSource,
  input: PlantOutputLoadInput = '2026-05-01',
): Promise<PlantOutputPayload> {
  const [dateFrom, dateTo] = normalizeDateRange(input)
  try {
    const body = await fetchCaptured<unknown>(source.family, source.dataset, {
      region: source.region,
      dateFrom,
      dateTo,
    })
    const meta = envelopeMeta(body)
    return {
      // 「hasRealData 且非 mock」是真实账号的 fail-closed 门；演示会话（PRD R1/R4）
      // 数据源本就是 mock router 合成行，按会话放行，可信度徽章仍如实展示。
      rows: (meta.hasRealData && !meta.mock) || isMockActive() ? pickRows<PlantOutputRow>(body) : [],
      plants: [],
      nodes: [],
      meta,
    }
  } catch (error) {
    return { rows: [], plants: [], nodes: [], meta: envelopeMeta(null, error) }
  }
}

export async function loadPlantOutputPayload(input: PlantOutputLoadInput = '2026-05-01'): Promise<PlantOutputPayload> {
  const [dateFrom, dateTo] = normalizeDateRange(input)
  const [output, plants, nodes] = await Promise.all([
    loadPlantOutputSourcePayload({ family: PLANT_OUTPUT_FAMILY, dataset: PLANT_OUTPUT_DATASET, region: 'yunnan' }, { dateRange: [dateFrom, dateTo] }),
    safeFetchRows<PlantDimRow>('yn_dim_plant', 'yn_dim_plant'),
    safeFetchRows<PlantNodeRow>('yn_dim_plant_node', 'yn_dim_plant_node')
  ])

  return {
    rows: output.rows,
    plants: plants.rows,
    nodes: nodes.rows,
    meta: output.meta
  }
}

function toNum(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => Number.isFinite(Number(v)))
  if (!nums.length) return null
  return nums.reduce((sum, v) => sum + v, 0) / nums.length
}

function preferredRowsByType(rows: readonly PlantOutputRow[], types: string[]): PlantOutputRow[] {
  for (const type of types) {
    const picked = rows.filter((r) => r.dataType === type && toNum(r.valueMw) !== null)
    if (picked.length) return picked
  }
  return rows.filter((r) => toNum(r.valueMw) !== null)
}

function meanRows(rows: readonly PlantOutputRow[]): number | null {
  return avg(rows.map((row) => toNum(row.valueMw)))
}

function sourceOf(rows: PlantOutputRow[], fallback: string): string {
  return rows.find((row) => row.dataType)?.dataType ?? fallback
}

export function availableForecastTypes(rows: readonly PlantOutputRow[]): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    if (row.seriesRole === 'forecast' && row.dataType) set.add(row.dataType)
  }
  return Array.from(set).sort((a, b) => {
    const order = ['超短期预测', '国能日新预测', '远景集团预测']
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    return a.localeCompare(b, 'zh-CN')
  })
}

function weekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

function bucketKey(date: string, aggregation: PlantOutputAggregation): string {
  if (aggregation === 'week') return weekKey(date)
  if (aggregation === 'month') return date.slice(0, 7)
  return date
}

function bucketLabel(key: string, aggregation: PlantOutputAggregation): string {
  if (aggregation === 'week') return `${key} 周`
  if (aggregation === 'month') return `${key} 月`
  return key
}

function targetArrays(actual: Array<number | null>, plan: Array<number | null>, forecast: Array<number | null>) {
  const hasPlan = plan.some((v) => v !== null)
  const target = hasPlan ? plan : forecast
  const targetKind = hasPlan ? 'plan' as const : 'forecast' as const
  const deviation = actual.map((v, index) => (v === null || target[index] === null ? null : v - Number(target[index])))
  const completion = actual.map((v, index) => {
    const t = target[index]
    if (v === null || t === null || Math.abs(t) < 1e-9) return null
    return (v / t) * 100
  })
  return { target, targetKind, deviation, completion }
}

export function buildPlantOutputSeries(
  rows: readonly PlantOutputRow[],
  forecastType?: string,
  aggregation: PlantOutputAggregation = 'slot'
): PlantOutputSeries {
  const byPoint = new Map<number, PlantOutputRow[]>()
  const times: string[] = []
  const actual: Array<number | null> = []
  const plan: Array<number | null> = []
  const forecast: Array<number | null> = []
  let actualSource = '子站回传'
  let forecastSource = forecastType || availableForecastTypes(rows)[0] || '预测'

  if (aggregation === 'slot') {
    for (const row of rows) {
      if (!Number.isFinite(Number(row.point))) continue
      const point = Number(row.point)
      const list = byPoint.get(point) ?? []
      list.push(row)
      byPoint.set(point, list)
    }

    for (let point = 1; point <= 96; point += 1) {
      const list = byPoint.get(point) ?? []
      const timePoint = list[0]?.timePoint ?? pointToTime(point)
      times.push(timePoint)

      const actualRows = preferredRowsByType(list.filter((r) => r.seriesRole === 'actual'), ['子站回传', '实际功率'])
      const planRows = preferredRowsByType(list.filter((r) => r.seriesRole === 'plan'), ['最终下发'])
      const forecastRows = forecastType
        ? preferredRowsByType(list.filter((r) => r.dataType === forecastType), [forecastType])
        : preferredRowsByType(list.filter((r) => r.seriesRole === 'forecast'), ['超短期预测', '国能日新预测', '远景集团预测'])

      actualSource = sourceOf(actualRows, actualSource)
      forecastSource = sourceOf(forecastRows, forecastSource)
      actual.push(meanRows(actualRows))
      plan.push(meanRows(planRows))
      forecast.push(meanRows(forecastRows))
    }
  } else {
    const byBucket = new Map<string, PlantOutputRow[]>()
    for (const row of rows) {
      if (!row.date) continue
      const key = bucketKey(row.date, aggregation)
      const list = byBucket.get(key) ?? []
      list.push(row)
      byBucket.set(key, list)
    }

    for (const key of Array.from(byBucket.keys()).sort()) {
      const list = byBucket.get(key) ?? []
      times.push(bucketLabel(key, aggregation))

      const actualRows = preferredRowsByType(list.filter((r) => r.seriesRole === 'actual'), ['子站回传', '实际功率'])
      const planRows = preferredRowsByType(list.filter((r) => r.seriesRole === 'plan'), ['最终下发'])
      const forecastRows = forecastType
        ? preferredRowsByType(list.filter((r) => r.dataType === forecastType), [forecastType])
        : preferredRowsByType(list.filter((r) => r.seriesRole === 'forecast'), ['超短期预测', '国能日新预测', '远景集团预测'])

      actualSource = sourceOf(actualRows, actualSource)
      forecastSource = sourceOf(forecastRows, forecastSource)
      actual.push(meanRows(actualRows))
      plan.push(meanRows(planRows))
      forecast.push(meanRows(forecastRows))
    }
  }

  const { target, targetKind, deviation, completion } = targetArrays(actual, plan, forecast)
  const targetSource = targetKind === 'plan' ? '最终下发' : forecastSource

  return {
    times,
    actual,
    plan,
    forecast,
    target,
    deviation,
    completion,
    actualSource,
    forecastSource,
    targetSource,
    targetKind,
    aggregation
  }
}

export function summarizePlantOutput(series: PlantOutputSeries, anomalies: PlantOutputAnomaly[]): PlantOutputSummary {
  const absDeviation = series.deviation
    .filter((v): v is number => v !== null)
    .map((v) => Math.abs(v))
  return {
    actualAvg: avg(series.actual),
    targetAvg: avg(series.target),
    completionAvg: avg(series.completion),
    maxAbsDeviation: absDeviation.length ? Math.max(...absDeviation) : null,
    anomalyCount: anomalies.length,
    pointCount: series.actual.filter((v) => v !== null).length
  }
}

export function detectPlantOutputAnomalies(
  series: PlantOutputSeries,
  thresholds: { deviationPct: number; deviationMw: number },
  groupLabel?: string
): PlantOutputAnomaly[] {
  const out: PlantOutputAnomaly[] = []
  for (let i = 0; i < series.times.length; i += 1) {
    const actual = series.actual[i]
    const target = series.target[i]
    const deviation = series.deviation[i]
    const completion = series.completion[i]
    if (actual === null || target === null || deviation === null || completion === null || Math.abs(target) < 1e-9) continue
    const deviationPct = (deviation / target) * 100
    if (Math.abs(deviationPct) >= thresholds.deviationPct || Math.abs(deviation) >= thresholds.deviationMw) {
      out.push({
        ...(groupLabel ? { groupLabel } : {}),
        timePoint: series.times[i],
        actualMw: actual,
        targetMw: target,
        deviationMw: deviation,
        deviationPct,
        completionPct: completion
      })
    }
  }
  return out
}

export function pointToTime(point: number): string {
  const minutes = Math.max(0, Math.min(95, point - 1)) * 15
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
