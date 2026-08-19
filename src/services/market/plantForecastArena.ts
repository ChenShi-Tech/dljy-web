import type { PlantOutputRole, PlantOutputRow } from '@/services/market/plantOutputClient'

export interface PlantForecastArenaSource {
  source: string
  role: PlantOutputRole
  roleLabel: string
  mape: number | null
  rmseMw: number | null
  biasMw: number | null
  samples: number
  mapeSamples: number
}

export interface PlantForecastArenaTrend {
  source: string | null
  times: string[]
  actual: Array<number | null>
  forecast: Array<number | null>
}

export interface PlantForecastArena {
  hasData: boolean
  date: string
  sourceCount: number
  actualSource: string | null
  sources: PlantForecastArenaSource[]
  trends: Record<string, PlantForecastArenaTrend>
  trend: PlantForecastArenaTrend
}

const ACTUAL_PRIORITY = ['实际功率', '子站回传']

const ROLE_LABEL: Record<PlantOutputRole, string> = {
  actual: '实际',
  plan: '下发',
  forecast: '预测',
  available: '可用',
  theoretical: '理论',
  other: '其他'
}

type ActualPoint = {
  value: number
  source: string
  priority: number
}

type SourceAcc = {
  source: string
  role: PlantOutputRole
  samples: number
  mapeSamples: number
  absPctSum: number
  sqSum: number
  biasSum: number
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function pointToTime(point: number): string {
  const minutes = Math.max(0, Math.min(95, point - 1)) * 15
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function pointKey(row: PlantOutputRow): string | null {
  if (!row.plant || !Number.isFinite(Number(row.point))) return null
  return `${row.plant}|${Number(row.point)}`
}

function rowDedupKey(row: PlantOutputRow): string | null {
  if (!row.date || !row.plant || !row.dataType) return null
  const point = Number(row.point)
  if (!Number.isInteger(point) || point < 1 || point > 96) return null
  return `${row.date}|${row.plant}|${point}|${row.dataType}`
}

function dedupePlantOutputRows(rows: PlantOutputRow[]): PlantOutputRow[] {
  const byKey = new Map<string, PlantOutputRow>()
  rows.forEach((row, index) => {
    byKey.set(rowDedupKey(row) ?? `__row_${index}`, row)
  })
  return [...byKey.values()]
}

function sourcePriority(source: string): number {
  const index = ACTUAL_PRIORITY.indexOf(source)
  return index === -1 ? 99 : index
}

function buildActualIndex(rows: PlantOutputRow[]) {
  const actualByKey = new Map<string, ActualPoint>()
  const actualCounts = new Map<string, number>()

  for (const row of rows) {
    if (row.seriesRole !== 'actual') continue
    const key = pointKey(row)
    const value = finiteNumber(row.valueMw)
    if (!key || value === null || !row.dataType) continue

    const candidate = { value, source: row.dataType, priority: sourcePriority(row.dataType) }
    const current = actualByKey.get(key)
    if (!current || candidate.priority < current.priority) {
      actualByKey.set(key, candidate)
    }
  }

  for (const actual of actualByKey.values()) {
    actualCounts.set(actual.source, (actualCounts.get(actual.source) ?? 0) + 1)
  }

  const actualSource = [...actualCounts.entries()].sort((a, b) => {
    const p = sourcePriority(a[0]) - sourcePriority(b[0])
    if (p !== 0) return p
    return b[1] - a[1]
  })[0]?.[0] ?? null

  return { actualByKey, actualSource }
}

function sortSources(a: PlantForecastArenaSource, b: PlantForecastArenaSource): number {
  if (a.mape === null && b.mape !== null) return 1
  if (a.mape !== null && b.mape === null) return -1
  if (a.mape !== null && b.mape !== null && a.mape !== b.mape) return a.mape - b.mape
  if (a.rmseMw !== null && b.rmseMw !== null && a.rmseMw !== b.rmseMw) return a.rmseMw - b.rmseMw
  if (a.rmseMw === null && b.rmseMw !== null) return 1
  if (a.rmseMw !== null && b.rmseMw === null) return -1
  if (a.samples !== b.samples) return b.samples - a.samples
  return a.source.localeCompare(b.source, 'zh-CN')
}

function buildTrend(
  rows: PlantOutputRow[],
  actualByKey: Map<string, ActualPoint>,
  source: string | null
): PlantForecastArenaTrend {
  const times = Array.from({ length: 96 }, (_, i) => pointToTime(i + 1))
  const actual: Array<number | null> = Array(96).fill(null)
  const forecast: Array<number | null> = Array(96).fill(null)
  if (!source) return { source: null, times, actual, forecast }

  const byPoint = new Map<number, { actual: number; forecast: number; n: number }>()
  for (const row of rows) {
    if (row.dataType !== source) continue
    const point = Number(row.point)
    if (!Number.isInteger(point) || point < 1 || point > 96) continue
    const key = pointKey(row)
    const f = finiteNumber(row.valueMw)
    if (!key || f === null) continue
    const a = actualByKey.get(key)
    if (!a) continue

    const acc = byPoint.get(point) ?? { actual: 0, forecast: 0, n: 0 }
    acc.actual += a.value
    acc.forecast += f
    acc.n += 1
    byPoint.set(point, acc)
  }

  for (let point = 1; point <= 96; point += 1) {
    const acc = byPoint.get(point)
    if (!acc || acc.n === 0) continue
    actual[point - 1] = +acc.actual.toFixed(2)
    forecast[point - 1] = +acc.forecast.toFixed(2)
  }

  return { source, times, actual, forecast }
}

export function buildPlantForecastArena(rows: PlantOutputRow[], date: string): PlantForecastArena {
  const dedupedRows = dedupePlantOutputRows(rows)
  // 仅计 forecast 源（排除 actual 角色），与下方 sources 排行榜口径一致
  // 否则实际功率/子站回传等 actual dataType 会被算进「X 类出力源」文案虚高。
  const sourceCount = new Set(
    dedupedRows.filter((row) => row.dataType && row.seriesRole !== 'actual').map((row) => row.dataType)
  ).size
  const { actualByKey, actualSource } = buildActualIndex(dedupedRows)
  const accBySource = new Map<string, SourceAcc>()

  for (const row of dedupedRows) {
    if (!row.dataType || row.seriesRole === 'actual') continue
    const key = pointKey(row)
    const f = finiteNumber(row.valueMw)
    if (!key || f === null) continue
    const a = actualByKey.get(key)
    if (!a) continue

    const acc = accBySource.get(row.dataType) ?? {
      source: row.dataType,
      role: row.seriesRole,
      samples: 0,
      mapeSamples: 0,
      absPctSum: 0,
      sqSum: 0,
      biasSum: 0
    }
    const diff = f - a.value
    acc.samples += 1
    acc.sqSum += diff * diff
    acc.biasSum += diff
    // 近零实际值（<1 MW）排除，防 MAPE 爆炸，与 cockpitData.ts arenaMape 口径统一
    // （厂站低出力/停机爬坡时段 actual≈0，1e-9 阈值仅排除精确 0，会让 |diff|/0.05 单点
    // 放大到数千 %，使「精度擂台」排名失真）。
    if (Math.abs(a.value) >= 1) {
      acc.absPctSum += Math.abs(diff) / Math.abs(a.value)
      acc.mapeSamples += 1
    }
    accBySource.set(row.dataType, acc)
  }

  const sources = [...accBySource.values()]
    .map((acc) => ({
      source: acc.source,
      role: acc.role,
      roleLabel: ROLE_LABEL[acc.role] ?? ROLE_LABEL.other,
      mape: acc.mapeSamples ? +((acc.absPctSum / acc.mapeSamples) * 100).toFixed(2) : null,
      rmseMw: acc.samples ? +Math.sqrt(acc.sqSum / acc.samples).toFixed(2) : null,
      biasMw: acc.samples ? +(acc.biasSum / acc.samples).toFixed(2) : null,
      samples: acc.samples,
      mapeSamples: acc.mapeSamples
    }))
    .sort(sortSources)

  const bestForecastLike = sources.find((s) => ['forecast', 'plan'].includes(s.role) && s.mape !== null)
    ?? sources.find((s) => s.mape !== null)
    ?? null
  const trends = sources.reduce<Record<string, PlantForecastArenaTrend>>((acc, source) => {
    acc[source.source] = buildTrend(dedupedRows, actualByKey, source.source)
    return acc
  }, {})
  const trend = bestForecastLike?.source ? trends[bestForecastLike.source] ?? buildTrend(dedupedRows, actualByKey, bestForecastLike.source) : buildTrend(dedupedRows, actualByKey, null)

  return {
    hasData: Boolean(actualSource && sources.some((s) => s.samples > 0)),
    date,
    sourceCount,
    actualSource,
    sources,
    trends,
    trend
  }
}

export async function loadPlantForecastArena(date: string): Promise<PlantForecastArena> {
  const { loadPlantOutputPayload } = await import('@/services/market/plantOutputClient')
  const payload = await loadPlantOutputPayload(date)
  if (!payload.meta.hasRealData || payload.meta.mock) {
    return buildPlantForecastArena([], date)
  }
  return buildPlantForecastArena(payload.rows, date)
}
