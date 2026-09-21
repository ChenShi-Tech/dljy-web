import { ApiError, apiGet } from '@/services/api'
import { fetchCaptured } from '@/services/captured'

export const UNIT_ROSTER_DATASET = 'forecast_must_run_stop_unit_list'
const FAMILY = 'yn_disclosure_metric'
const DAY = 86_400_000
const REGIONS: Record<string, string[]> = {
  yunnan: ['云南', '云南省', 'yn'], guangdong: ['广东', '广东省', 'gd'],
  guangxi: ['广西', '广西壮族自治区', 'gx'], guizhou: ['贵州', '贵州省', 'gz'], hainan: ['海南', '海南省', 'hn'],
}
type Row = Record<string, unknown>
type ReadStatus = 'available' | 'missing' | 'partial' | 'error' | 'unauthorized' | 'not-configured'
export type UnitRosterEntry = {
  key: string; identity: string; date: string; regionId: string; regionName: string
  plantName: string; unitName: string; state: string; reason: string
  sourceTable: string; sourceFile: string; sourceRecordId: string; importedAt: string; publishedAt: string
  qualityFlags: string[]
}
export type UnitRosterDay = { date: string; entries: UnitRosterEntry[] }
export type UnitRosterResult = {
  status: ReadStatus; reason: string; days: UnitRosterDay[]; baseline: UnitRosterDay | null
  comparisonStatus: ReadStatus; comparisonReason: string; coverage: { start: string; end: string } | null
}
export type UnitRosterChange = { kind: 'added' | 'removed' | 'changed'; entry: UnitRosterEntry; previous?: UnitRosterEntry }
export type UnitRosterComparison = { available: boolean; reason: string; previousDate: string | null; changes: UnitRosterChange[] }
export type UnitRosterParams = { regionId: string; dateFrom: string; dateTo: string }
type Envelope = {
  data?: Row[]; rows?: Row[]; code?: number; accessDenied?: boolean; mock?: boolean; productionWrite?: boolean
  sourceType?: string; region_served?: string; region_fallback?: boolean
  provenance?: { sourceType?: string; realDataConnected?: boolean; regionServed?: string; region?: string; regionFallback?: boolean }
  _filter?: { truncated?: boolean }
}
function text(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '' }
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
export function unitRosterDates(from: string, to: string): string[] {
  if (!validDate(from) || !validDate(to) || from > to) return []
  const count = (Date.parse(to) - Date.parse(from)) / DAY + 1
  if (count > 31) return []
  return Array.from({ length: count }, (_, index) => shiftDate(from, index))
}
function shiftDate(date: string, days: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10) }

/** 区域、电厂、机组共同标识对象；状态变化不能被误记成两个同名机组。 */
export function normalizeUnitRosterRows(rows: Row[], params: UnitRosterParams): { days: UnitRosterDay[]; incomplete: boolean } {
  const entries = new Map<string, UnitRosterEntry>()
  let incomplete = false
  for (const row of rows) {
    const date = row.operateDate
    const regionName = text(row.regionName)
    if (!REGIONS[params.regionId]?.includes(regionName)) continue
    if (!validDate(date)) { incomplete = true; continue }
    if (date < params.dateFrom || date > params.dateTo) continue
    const plantName = text(row.plantName), unitName = text(row.unitName), state = text(row.textValue)
    if (!plantName || !unitName || !state) { incomplete = true; continue }
    const identity = JSON.stringify([params.regionId, plantName, unitName])
    const key = JSON.stringify([date, params.regionId, plantName, unitName, state])
    entries.set(key, {
      key, identity, date, regionId: params.regionId, regionName, plantName, unitName, state,
      reason: text(row.noteText), sourceTable: text(row.sourceTable), sourceFile: text(row.sourceFile),
      sourceRecordId: text(row.sourceRecordId), importedAt: text(row.sourceImportedAt), publishedAt: text(row.publishedAt),
      qualityFlags: Array.isArray(row.qualityFlags) ? row.qualityFlags.filter((flag): flag is string => typeof flag === 'string') : [],
    })
  }
  const days = [...new Set([...entries.values()].map((entry) => entry.date))].sort().map((date) => ({
    date, entries: [...entries.values()].filter((entry) => entry.date === date).sort((a, b) => `${a.plantName}${a.unitName}${a.state}`.localeCompare(`${b.plantName}${b.unitName}${b.state}`, 'zh-CN')),
  }))
  return { days, incomplete }
}

export function compareUnitRosterDays(current: UnitRosterDay | null, previous: UnitRosterDay | null): UnitRosterComparison {
  const unavailable = (reason: string): UnitRosterComparison => ({ available: false, reason, previousDate: previous?.date ?? null, changes: [] })
  if (!current?.entries.length) return unavailable('当前日期没有可用名单，不推算新增或移除')
  if (!previous?.entries.length) return unavailable('没有上一可用日名单，暂不计算变化')
  if (previous.date >= current.date || [...current.entries, ...previous.entries].some((entry) => entry.regionId !== current.entries[0].regionId)) return unavailable('日期或地区口径不一致，暂不计算变化')
  const currentById = new Map(current.entries.map((entry) => [entry.identity, entry]))
  const previousById = new Map(previous.entries.map((entry) => [entry.identity, entry]))
  if (currentById.size !== current.entries.length || previousById.size !== previous.entries.length
    || [...current.entries, ...previous.entries].some(entry => entry.qualityFlags.includes('conflicting-status'))) return unavailable('同一机组存在多个状态，暂不计算名单变化')
  const changes: UnitRosterChange[] = []
  for (const entry of current.entries) {
    const prior = previousById.get(entry.identity)
    if (!prior) changes.push({ kind: 'added', entry })
    else if (prior.state !== entry.state) changes.push({ kind: 'changed', entry, previous: prior })
  }
  for (const entry of previous.entries) if (!currentById.has(entry.identity)) changes.push({ kind: 'removed', entry })
  return { available: true, reason: '', previousDate: previous.date, changes }
}

function failure(cause: unknown): { status: ReadStatus; reason: string } {
  if (cause instanceof ApiError && [401, 403].includes(cause.status)) return { status: 'unauthorized', reason: '没有读取必开必停名单的权限' }
  if (cause instanceof ApiError && cause.status === 404) return { status: 'not-configured', reason: '必开必停名单尚未接入当前地区' }
  return { status: 'error', reason: '必开必停名单读取失败，请重试' }
}
async function readRange(params: UnitRosterParams): Promise<{ status: ReadStatus; reason: string; days: UnitRosterDay[] }> {
  try {
    const body = await fetchCaptured<Envelope>(FAMILY, UNIT_ROSTER_DATASET, { region: params.regionId, dateFrom: params.dateFrom, dateTo: params.dateTo, limit: 12000 })
    if (body.accessDenied || body.code === 401 || body.code === 403) return { status: 'unauthorized', reason: '没有读取必开必停名单的权限', days: [] }
    if (body.code !== undefined && body.code >= 400) return { status: 'error', reason: '必开必停名单读取失败，请重试', days: [] }
    const sourceType = String(body.provenance?.sourceType ?? body.sourceType ?? '').toUpperCase()
    const served = body.region_served ?? body.provenance?.regionServed ?? body.provenance?.region
    if (body.mock || sourceType === 'MOCK' || body.productionWrite || body.region_fallback || body.provenance?.regionFallback || (served && served !== params.regionId)
      || (!['REAL', 'CAPTURE', 'IMPORT', 'DB', 'API'].includes(sourceType) && body.provenance?.realDataConnected !== true)) {
      return { status: 'error', reason: '来源或地区无法确认，已停止展示名单', days: [] }
    }
    const { days, incomplete } = normalizeUnitRosterRows((Array.isArray(body.data) ? body.data : body.rows ?? []).filter((row) => row && typeof row === 'object'), params)
    return { days, status: body._filter?.truncated || incomplete ? 'partial' : days.length ? 'available' : 'missing',
      reason: body._filter?.truncated || incomplete ? '名单返回不完整，暂不计算变化' : days.length ? '' : '所选日期没有必开必停名单' }
  } catch (cause) { return { ...failure(cause), days: [] } }
}

/** 覆盖仅界定搜索范围；从实际行日期找上一有效日，不能把覆盖中的日期缺口当空名单。 */
export async function loadDisclosureUnitRoster(params: UnitRosterParams, isCurrent: () => boolean = () => true): Promise<UnitRosterResult> {
  const empty: UnitRosterResult = { status: 'missing', reason: '所选日期没有必开必停名单', days: [], baseline: null, comparisonStatus: 'missing', comparisonReason: '没有上一可用日名单，暂不计算变化', coverage: null }
  if (!REGIONS[params.regionId]) return { ...empty, status: 'not-configured', reason: '当前地区尚未接入必开必停名单' }
  if (!unitRosterDates(params.dateFrom, params.dateTo).length) return { ...empty, status: 'error', reason: '请选择 31 天以内的有效日期范围' }
  const [current, coverageRead] = await Promise.allSettled([
    readRange(params), apiGet<{ family: string; region: string; datasets: Array<{ datasetKey: string; start: string | null; end: string | null }> }>('/api/real-coverage', { family: FAMILY, region: params.regionId }),
  ])
  const result: UnitRosterResult = { ...empty, ...(current.status === 'fulfilled' ? current.value : failure(current.reason)) }
  if (coverageRead.status !== 'fulfilled') return { ...result, comparisonStatus: 'error', comparisonReason: '历史日期覆盖读取失败，暂不计算上一可用日变化' }
  const response = coverageRead.value
  if ((response.code !== undefined && response.code !== 200) || response.data?.region !== params.regionId || response.data?.family !== FAMILY || !Array.isArray(response.data?.datasets)) {
    return { ...result, comparisonStatus: 'error', comparisonReason: '历史日期覆盖无法确认，暂不计算上一可用日变化' }
  }
  const range = response.data.datasets.find((item) => item.datasetKey === UNIT_ROSTER_DATASET)
  if (!range || !validDate(range.start) || !validDate(range.end) || range.start > range.end) return result
  result.coverage = { start: range.start, end: range.end }
  if (!['available', 'missing'].includes(result.status)) return { ...result, comparisonStatus: result.status, comparisonReason: result.reason }
  let to = [shiftDate(params.dateFrom, -1), range.end].sort()[0]
  while (to >= range.start && isCurrent()) {
    const from = [shiftDate(to, -30), range.start].sort().at(-1)!
    const previous = await readRange({ ...params, dateFrom: from, dateTo: to })
    if (!['available', 'missing'].includes(previous.status)) return { ...result, comparisonStatus: previous.status, comparisonReason: '历史名单读取失败或不完整，暂不计算上一可用日变化' }
    const baseline = previous.days.at(-1)
    if (baseline) return { ...result, baseline, comparisonStatus: 'available', comparisonReason: '' }
    to = shiftDate(from, -1)
  }
  return result
}
