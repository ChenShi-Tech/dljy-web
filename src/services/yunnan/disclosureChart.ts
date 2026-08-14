export type DisclosureGranularity = 'day' | 'week' | 'month'

export interface DisclosurePeriodWindow {
  from: string
  to: string
  label: string
}

export const MAX_DISCLOSURE_CHUNKS = 16

export interface DisclosureWindowResolution {
  requested: DisclosurePeriodWindow
  window: DisclosurePeriodWindow
  chunks: DisclosurePeriodWindow[]
  requestedChunkCount: number
  retainedChunkCount: number
  retainedDays: number
  constrained: boolean
}

export interface DisclosureChartRow {
  operateDate?: string | null
  targetDate?: string | null
  date?: string | null
  timePoint?: string | null
  region?: string | null
  value?: number | null
  [key: string]: unknown
}

export interface ForecastActualPair {
  date: string
  timePoint: string
  region: string
  forecast: number
  actual: number
}

export interface IntradayEnvelopePoint {
  timePoint: string
  min: number
  mean: number
  max: number
  count: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function parseDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`无效日期: ${iso}`)
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new Error(`无效日期: ${iso}`)
  return date
}

export function addDisclosureDays(iso: string, days: number): string {
  const date = parseDate(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function periodLabel(granularity: DisclosureGranularity, from: string, to: string): string {
  if (granularity === 'day') return from
  if (granularity === 'month') return from.slice(0, 7)
  return `${from} ~ ${to}`
}

/** 以锚点计算日/周/月窗口；周一为周起始日。 */
export function getDisclosurePeriodWindow(anchor: string, granularity: DisclosureGranularity): DisclosurePeriodWindow {
  const date = parseDate(anchor)
  let from = anchor
  let to = anchor
  if (granularity === 'week') {
    const mondayOffset = (date.getUTCDay() + 6) % 7
    from = addDisclosureDays(anchor, -mondayOffset)
    to = addDisclosureDays(from, 6)
  } else if (granularity === 'month') {
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    from = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
    to = new Date(Date.UTC(year, month, daysInMonth(year, month))).toISOString().slice(0, 10)
  }
  return { from, to, label: periodLabel(granularity, from, to) }
}

/**
 * 将一个披露窗口拆成受控大小的回放分片。
 *
 * /api/real 的 limit 是整次请求生效的；月度多地区数据一旦超过 limit，尾部截断会让
 * 图表和预测-实际配对都只看到周期末数据。按粒度切片后，每片仍可带 limit 作为异常
 * 密度防御，但正常日/周/月窗口不会因为单次请求上限丢失整段周期。
 */
export function splitDisclosureWindow(
  from: string,
  to: string,
  granularity: DisclosureGranularity,
  monthChunkDays = 7
): DisclosurePeriodWindow[] {
  const start = parseDate(from)
  const end = parseDate(to)
  if (start.getTime() > end.getTime()) return []
  if (!Number.isInteger(monthChunkDays) || monthChunkDays < 1) throw new Error(`无效分片天数: ${monthChunkDays}`)

  const chunkDays = granularity === 'day' ? 1 : granularity === 'week' ? 7 : monthChunkDays
  const chunks: DisclosurePeriodWindow[] = []
  let cursor = from
  while (parseDate(cursor).getTime() <= end.getTime()) {
    const candidateTo = addDisclosureDays(cursor, chunkDays - 1)
    const chunkTo = candidateTo < to ? candidateTo : to
    chunks.push({ from: cursor, to: chunkTo, label: periodLabel(granularity, cursor, chunkTo) })
    cursor = addDisclosureDays(chunkTo, 1)
  }
  return chunks
}

/**
 * 为一次渲染限制分片规模；超限时只保留窗口尾部最近的分片。
 * 这样调用方可以显式告知用户发生了诚实降级，而不是静默发起整年洪峰请求。
 */
export function resolveDisclosureWindow(
  from: string,
  to: string,
  granularity: DisclosureGranularity,
  monthChunkDays = 7,
  maxChunks = MAX_DISCLOSURE_CHUNKS
): DisclosureWindowResolution {
  const requested: DisclosurePeriodWindow = { from, to, label: periodLabel(granularity, from, to) }
  if (!Number.isInteger(maxChunks) || maxChunks < 1) throw new Error(`无效分片上限: ${maxChunks}`)
  const allChunks = splitDisclosureWindow(from, to, granularity, monthChunkDays)
  const chunks = allChunks.length > maxChunks ? allChunks.slice(-maxChunks) : allChunks
  const window = chunks.length
    ? {
        from: chunks[0].from,
        to: chunks.at(-1)?.to ?? chunks[0].to,
        label: periodLabel(granularity, chunks[0].from, chunks.at(-1)?.to ?? chunks[0].to)
      }
    : requested
  const retainedDays = chunks.length
    ? Math.round((parseDate(window.to).getTime() - parseDate(window.from).getTime()) / DAY_MS) + 1
    : 0
  return {
    requested,
    window,
    chunks,
    requestedChunkCount: allChunks.length,
    retainedChunkCount: chunks.length,
    retainedDays,
    constrained: allChunks.length > maxChunks
  }
}

/** 翻页时按粒度平移标准周期。 */
export function shiftDisclosurePeriod(
  window: DisclosurePeriodWindow,
  granularity: DisclosureGranularity,
  direction: -1 | 1
): DisclosurePeriodWindow {
  const anchor = granularity === 'month' ? window.from : addDisclosureDays(window.from, granularity === 'week' ? 7 * direction : direction)
  if (granularity === 'month') {
    const date = parseDate(window.from)
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + direction, 1))
    return getDisclosurePeriodWindow(next.toISOString().slice(0, 10), granularity)
  }
  return getDisclosurePeriodWindow(anchor, granularity)
}

/** 自定义日期窗口按当前粒度步进平移，保留用户窗口长度。 */
export function shiftDisclosureWindow(
  from: string,
  to: string,
  granularity: DisclosureGranularity,
  direction: -1 | 1
): DisclosurePeriodWindow {
  const fromDate = parseDate(from)
  const toDate = parseDate(to)
  const span = Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS))
  const offset = granularity === 'month' ? undefined : (granularity === 'week' ? 7 : 1) * direction
  if (offset !== undefined) {
    const nextFrom = addDisclosureDays(from, offset)
    const nextTo = addDisclosureDays(to, offset)
    return { from: nextFrom, to: nextTo, label: periodLabel(granularity, nextFrom, nextTo) }
  }
  const targetMonth = fromDate.getUTCMonth() + direction
  const targetYear = fromDate.getUTCFullYear() + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const clampedDay = Math.min(fromDate.getUTCDate(), daysInMonth(targetYear, normalizedMonth))
  const nextFrom = new Date(Date.UTC(targetYear, normalizedMonth, clampedDay)).toISOString().slice(0, 10)
  const nextTo = addDisclosureDays(nextFrom, span)
  return { from: nextFrom, to: nextTo, label: periodLabel(granularity, nextFrom, nextTo) }
}

export function disclosureRowDate(row: DisclosureChartRow): string | undefined {
  const date = row.targetDate ?? row.date ?? row.operateDate
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
}

/**
 * 质量文档按排除 id 后的业务字段签名判定重复；断面摄取存在同一物理点重复行。
 * 与现有 Map.set 的展示口径一致，本处保留最后一条。
 * 业务键为日期/targetDate、时点、断面和 metric，不能把同一断面的重复记录求和。
 */
export function dedupeInterProvincialForecastRows<T extends DisclosureChartRow>(rows: T[]): T[] {
  const deduped = new Map<string, T>()
  const withoutBusinessKey: T[] = []
  for (const row of rows) {
    const date = disclosureRowDate(row)
    if (!date || typeof row.timePoint !== 'string' || typeof row.region !== 'string' || typeof row.metric !== 'string') {
      withoutBusinessKey.push(row)
      continue
    }
    deduped.set(`${date}|${row.timePoint}|${row.region}|${row.metric}`, row)
  }
  return [...withoutBusinessKey, ...deduped.values()]
}

function numericRows(rows: DisclosureChartRow[], region: string): Map<string, DisclosureChartRow> {
  const map = new Map<string, DisclosureChartRow>()
  for (const row of rows) {
    if (row.region !== region || typeof row.timePoint !== 'string' || typeof row.value !== 'number' || !Number.isFinite(row.value)) continue
    const date = disclosureRowDate(row)
    if (date) map.set(`${date}|${row.timePoint}`, row)
  }
  return map
}

/** 按日期+时点配对；优先云南，云南不存在完整配对时回退全区域。 */
export function pairForecastActual(
  forecastRows: DisclosureChartRow[],
  actualRows: DisclosureChartRow[],
  preferredRegion = 'yn'
): ForecastActualPair[] {
  const pairRegion = (region: string): ForecastActualPair[] => {
    const result: ForecastActualPair[] = []
    const forecasts = numericRows(forecastRows, region)
    const actuals = numericRows(actualRows, region)
    for (const [key, forecast] of forecasts) {
      const actual = actuals.get(key)
      if (!actual) continue
      result.push({
        date: disclosureRowDate(forecast) as string,
        timePoint: forecast.timePoint as string,
        region,
        forecast: forecast.value as number,
        actual: actual.value as number
      })
    }
    return result
  }
  const preferred = pairRegion(preferredRegion)
  const result = preferred.length ? preferred : pairRegion('all')
  return result.sort((a, b) => `${a.date}|${a.timePoint}`.localeCompare(`${b.date}|${b.timePoint}`))
}

export function calculateDisclosureMape(pairs: ForecastActualPair[]): number | null {
  const valid = pairs.filter((pair) => Math.abs(pair.actual) >= 1 && Number.isFinite(pair.forecast) && Number.isFinite(pair.actual))
  if (!valid.length) return null
  const value = valid.reduce((sum, pair) => sum + Math.abs(pair.forecast - pair.actual) / Math.abs(pair.actual), 0) / valid.length
  return Number((value * 100).toFixed(2))
}

export interface EnvelopeRow {
  date?: string | null
  timePoint?: string | null
  region?: string | null
  value?: number | null
}

/**
 * 将跨天同一时点的价格聚合为 min/mean/max 日内形态包络。
 *
 * docs/data/spot-data-quality-status.md:103 已记录 da_user_price/rt_user_price 的重复业务键。
 * 依据该质量记录，先按日期/时点/地区去重并保留最后一条，与主曲线 Map.set 的口径一致，
 * 避免重复日期被当成额外一天参与 count 和跨天均值。
 */
export function aggregateIntradayEnvelope(rows: EnvelopeRow[]): IntradayEnvelopePoint[] {
  const deduped = new Map<string, EnvelopeRow>()
  for (const row of rows) {
    if (typeof row.date !== 'string' || typeof row.timePoint !== 'string') continue
    deduped.set(`${row.date}|${row.timePoint}|${row.region ?? ''}`, row)
  }
  const buckets = new Map<string, number[]>()
  for (const row of deduped.values()) {
    if (typeof row.timePoint !== 'string' || typeof row.value !== 'number' || !Number.isFinite(row.value)) continue
    const values = buckets.get(row.timePoint) ?? []
    values.push(row.value)
    buckets.set(row.timePoint, values)
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([timePoint, values]) => ({
    timePoint,
    min: Math.min(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: Math.max(...values),
    count: values.length
  }))
}
