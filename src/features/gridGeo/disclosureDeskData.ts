import { getGridDataset } from 'shared/schema/grid-dataset-catalog.mjs'
import { fetchCaptured } from '@/services/captured'
import { ApiError, apiGet } from '@/services/api'
import type { DateRange } from '@/services/market/captureCoverage'
import { readDisclosureDeskCached, type DeskCacheContext } from './disclosureDeskCache'
export type { DeskCacheContext } from './disclosureDeskCache'
import type { GridDisclosureCategory } from './types'

export type DeskThemeId = 'price' | 'load' | 'new-energy' | 'reserve' | 'maintenance' | 'transmission' | 'intervention'
export const DISCLOSURE_DESK_THEMES: Array<{ id: DeskThemeId; label: string; metricId: string; categories: GridDisclosureCategory[] }> = [
  { id: 'price', label: '市场电价', metricId: 'price', categories: [] },
  { id: 'load', label: '负荷与供需', metricId: 'load', categories: [] },
  { id: 'new-energy', label: '新能源与水电', metricId: 'new-energy', categories: [] },
  { id: 'reserve', label: '备用与调峰', metricId: 'reserve', categories: [] },
  { id: 'maintenance', label: '检修与停运', metricId: 'price', categories: ['maintenance', 'outage'] },
  { id: 'transmission', label: '联络线与断面', metricId: 'transmission', categories: ['congestion', 'constraint'] },
  { id: 'intervention', label: '人工干预', metricId: 'price', categories: ['intervention'] },
]

type SourceSpec = { id: string; label: string; dataset: string; catalog: string; rowRegion?: 'province' | 'user-price' | 'transfer-section'; rowMetric?: string; dataType?: string; targetDate?: boolean; forecast?: boolean }
export type DeskMetric = {
  id: string; label: string; themeId: DeskThemeId; unit: string; nativeMinutes: number | null
  requiresChannel: boolean; family: string; sources: SourceSpec[]; difference?: { id: string; label: string }; textValue?: boolean; channelFields?: string[]; dailyFacts?: boolean
}
function metric(id: string, label: string, themeId: DeskThemeId, family: string, sources: SourceSpec[], requiresChannel = false, difference?: DeskMetric['difference']): DeskMetric {
  const spec = getGridDataset('csg', sources[0].catalog)
  return { id, label, themeId, family, sources, requiresChannel, difference, unit: spec?.unit === 'CNY/MWh' ? '元/MWh' : spec?.unit ?? '', nativeMinutes: spec?.intervalLabel === '1h' ? 60 : spec?.intervalLabel === '15m' ? 15 : null }
}
const forecast = 'yn_system_forecast'
const disclosure = 'yn_disclosure_metric'
export const DISCLOSURE_DESK_METRICS: DeskMetric[] = [
  metric('price', '用户侧统一电价', 'price', forecast, [
    { id: 'da', label: '日前用户侧统一电价', dataset: 'da_user_price', catalog: 'user_price_day_ahead', rowRegion: 'user-price' },
    { id: 'rt', label: '实时用户侧统一电价', dataset: 'rt_user_price', catalog: 'user_price_real_time', rowRegion: 'user-price' },
  ], false, { id: 'spread', label: '实时－日前价差' }),
  metric('load', '统调负荷', 'load', forecast, [
    { id: 'forecast', label: '负荷官方预测', dataset: 'load_forecast', catalog: 'load_forecast', rowRegion: 'province' },
    { id: 'actual', label: '负荷实际', dataset: 'load_actual', catalog: 'load_actual', rowRegion: 'province' },
  ], false, { id: 'deviation', label: '实际－预测偏差' }),
  metric('non-market', '非市场化电源出力', 'load', forecast, [
    { id: 'forecast', label: '非市场化电源预测', dataset: 'non_market_forecast', catalog: 'non_market_forecast', rowRegion: 'province', rowMetric: 'non_market_forecast', forecast: true },
    { id: 'actual', label: '非市场化电源实际', dataset: 'non_market_actual', catalog: 'non_market_actual', rowRegion: 'province', rowMetric: 'non_market_actual' },
  ], false, { id: 'deviation', label: '实际－预测偏差' }),
  metric('new-energy', '新能源出力', 'new-energy', forecast, [
    { id: 'forecast', label: '新能源官方 D-1 预测', dataset: 'new_energy_forecast_d1', catalog: 'new_energy_forecast', rowRegion: 'province', targetDate: true },
    { id: 'actual', label: '新能源实际', dataset: 'new_energy_actual', catalog: 'new_energy_actual', rowRegion: 'province' },
  ], false, { id: 'deviation', label: '实际－预测偏差' }),
  metric('reserve', '备用容量', 'reserve', disclosure, [{ id: 'value', label: '备用容量', dataset: 'forecast_reserve', catalog: 'forecast_reserve' }], true),
  metric('hydro', '水电实际出力', 'new-energy', forecast, [{ id: 'value', label: '水电实际出力', dataset: 'hydro_actual', catalog: 'hydro_generation_actual', rowRegion: 'province' }]),
  { ...metric('peak-regulation', '日前调峰需求', 'reserve', disclosure, [{ id: 'value', label: '是否开展调峰', dataset: 'forecast_peak_regulation_demand', catalog: 'forecast_peak_regulation_demand' }], true), textValue: true },
  metric('peak-reserve', '高峰正备用', 'reserve', disclosure, [{ id: 'value', label: '高峰正备用', dataset: 'actual_peak_reserve', catalog: 'actual_peak_reserve' }], true),
  metric('transmission', '省间联络线实际', 'transmission', disclosure, [{ id: 'value', label: '省间联络线实际', dataset: 'actual_interprov_tie_line', catalog: 'actual_interprov_tie_line' }], true),
  metric('key-channel', '关键通道实际输电', 'transmission', disclosure, [{ id: 'value', label: '关键通道实际输电', dataset: 'actual_key_channel_transmission', catalog: 'actual_key_channel_transmission' }], true),
  metric('key-line-transformer', '关键线路与变压器实际潮流', 'transmission', disclosure, [{ id: 'value', label: '关键线路与变压器实际潮流', dataset: 'actual_key_line_transformer_flow', catalog: 'actual_key_line_transformer_flow' }], true),
  { ...metric('section-constraint', '输电断面双向限值', 'transmission', disclosure, [
    { id: 'forward-limit', label: '断面正向限值', dataset: 'actual_transmission_section_constraint', catalog: 'actual_transmission_section_constraint', dataType: '正向限值' },
    { id: 'reverse-limit', label: '断面反向限值', dataset: 'actual_transmission_section_constraint', catalog: 'actual_transmission_section_constraint', dataType: '反向限值' },
  ], true), channelFields: ['channelName', 'regionName'] },
  { ...metric('interprov-forecast', '省间送受电预测', 'transmission', forecast, [
    { id: 'send', label: '省间送电预测', dataset: 'inter_provincial_forecast', catalog: 'inter_provincial_forecast', rowRegion: 'transfer-section', rowMetric: 'inter_provincial_send', forecast: true },
    { id: 'receive', label: '省间受电预测', dataset: 'inter_provincial_forecast', catalog: 'inter_provincial_forecast', rowRegion: 'transfer-section', rowMetric: 'inter_provincial_receive', forecast: true },
  ], true), channelFields: ['region'] },
  { ...metric('priority-limit', '省间优先送电电量下限', 'transmission', disclosure, [{ id: 'value', label: '优先送电电量下限', dataset: 'forecast_interprov_priority_limit', catalog: 'forecast_interprov_priority_limit', rowMetric: '送端电量下限' }], true), channelFields: ['categoryName'], dailyFacts: true },
  metric('transmission-plan', '区外联络线计划', 'transmission', disclosure, [{ id: 'value', label: '区外联络线计划', dataset: 'forecast_external_tie_line', catalog: 'forecast_external_tie_line' }], true),
  metric('channel-capacity', '通道最大可用容量', 'transmission', disclosure, [{ id: 'value', label: '通道最大可用容量', dataset: 'forecast_transmission_capacity', catalog: 'forecast_transmission_capacity' }], true),
  metric('section-load', '稳定断面最大负载率', 'transmission', disclosure, [{ id: 'value', label: '断面最大负载率', dataset: 'actual_stable_section', catalog: 'actual_stable_section' }], true),
  metric('maintenance-capacity', '南方区域机组检修总容量', 'maintenance', disclosure, [{ id: 'value', label: '南方区域机组检修总容量', dataset: 'forecast_unit_maintenance_capacity', catalog: 'forecast_unit_maintenance_capacity' }]),
]

export type DeskPoint = { time: string; value: number | null }
export type DeskSeries = { id: string; label: string; unit: string; nativeMinutes: number | null; step: 'end' | false; points: DeskPoint[]; forecast?: boolean }
export type DeskSeriesSummary = { id: string; label: string; unit: string; min: number | null; minAt: string | null; max: number | null; maxAt: string | null; mean: number | null; latest: number | null; validPoints: number; expectedPoints: number }
export type DeskFact = { label: string; value: string; time: string; unit?: string; reason?: string; sourceTable?: string; sourceFile?: string; objectName?: string }
export type DeskStatus = 'available' | 'partial' | 'missing' | 'not-configured' | 'error' | 'unauthorized' | 'selection-required'
export type DeskDataResult = { metric: DeskMetric; series: DeskSeries[]; channels: string[]; selectedChannel?: string; status: DeskStatus; reason: string; sourceType: string; latestAt: string | null; summary: DeskSeriesSummary[]; warnings: string[]; facts?: DeskFact[] }
export type DeskLoadParams = DeskCacheContext & { regionId: string; metricId: string; dateFrom: string; dateTo: string; channel?: string; preferredChannel?: string }
type Row = Record<string, unknown>
type Envelope = { data?: Row[]; rows?: Row[]; code?: number; accessDenied?: boolean; mock?: boolean; sourceType?: string; productionWrite?: boolean; region_served?: string; region_fallback?: boolean; provenance?: { sourceType?: string; realDataConnected?: boolean; region?: string; regionServed?: string; regionFallback?: boolean }; _filter?: { truncated?: boolean } }
const PROVINCES: Record<string, { code: string; names: string[] }> = {
  yunnan: { code: 'yn', names: ['云南', '云南省', 'yn'] }, guangdong: { code: 'gd', names: ['广东', '广东省', '广州', '深圳', 'gd'] },
  guangxi: { code: 'gx', names: ['广西', '广西壮族自治区', 'gx'] }, guizhou: { code: 'gz', names: ['贵州', '贵州省', 'gz'] }, hainan: { code: 'hn', names: ['海南', '海南省', 'hn'] },
}
const DAY = 86_400_000
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
function shiftDate(value: string, shift: number) { return new Date(Date.parse(`${value}T00:00:00Z`) + shift * DAY).toISOString().slice(0, 10) }
function days(from: string, to: string): string[] {
  if (!validDate(from) || !validDate(to) || from > to) throw new Error('请选择有效的起止日期')
  const count = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY + 1
  if (count > 31) throw new Error('趋势窗口最多 31 天，请缩小日期范围')
  return Array.from({ length: count }, (_, i) => shiftDate(from, i))
}
export function getDisclosureDeskMetric(id: string): DeskMetric | undefined { return DISCLOSURE_DESK_METRICS.find((item) => item.id === id) }
function channelOf(row: Row, metricSpec: DeskMetric): string {
  return (metricSpec.channelFields ?? ['channelName', 'sectionName', 'regionName', 'dataType']).map((key) => typeof row[key] === 'string' ? row[key].trim() : '').filter(Boolean).join(' · ')
}
function rowInScope(row: Row, source: SourceSpec, regionId: string): boolean {
  const province = PROVINCES[regionId]
  if (!province) return false
  if (source.rowMetric && row.metric !== source.rowMetric) return false
  if (source.dataType && row.dataType !== source.dataType) return false
  // 省间预测的 region 原字段表示断面名。只接受导入契约白名单或当前省明确命名断面，不能当省级合计。
  if (source.rowRegion === 'transfer-section') return typeof row.region === 'string' && (['云南总送出', '贵州总送出', '广东受西电', '广西受西电', '海南受西电'].includes(row.region) || row.region.includes(province.names[0]))
  if (source.rowRegion === 'user-price') return regionId === 'yunnan' && (row.region === 'all' || row.region === 'yn')
  if (source.rowRegion === 'province') return row.region === province.code
  const region = typeof row.regionName === 'string' ? row.regionName.trim() : ''
  // 无省份/全网口径只按其明确名称展示；不得把其他省行当云南备用。
  return !region || ['南方区域', '南方电网', '全网', '总调', '南方电网整体'].includes(region) || province.names.includes(region)
}
function timeOf(row: Row, source: SourceSpec, nativeMinutes: number | null): string | null {
  const date = source.targetDate ? row.targetDate : row.operateDate
  if (!validDate(date)) return null
  if (nativeMinutes === null) return `${date} 00:00`
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(row.timePoint ?? ''))
  if (!match) return null
  const minute = Number(match[1]) * 60 + Number(match[2])
  if (Number(match[1]) > 23 || Number(match[2]) > 59 || minute % nativeMinutes !== 0) return null
  return `${date} ${match[1].padStart(2, '0')}:${match[2]}`
}
function rowUnitMatches(row: Row, metricSpec: DeskMetric) {
  return typeof row.unit !== 'string' || !row.unit.trim() || row.unit === metricSpec.unit || (row.unit === 'CNY/MWh' && metricSpec.unit === '元/MWh')
}

/** 完整时槽只用于显式 null 断线；数值不补齐、不插值，0 和负价保留。 */
export function buildDisclosureDeskSeries(metricSpec: DeskMetric, source: SourceSpec, rows: Row[], params: DeskLoadParams): DeskSeries {
  const dates = days(params.dateFrom, params.dateTo)
  const values = new Map<string, number | null>()
  for (const row of rows) {
    if (!rowInScope(row, source, params.regionId) || (metricSpec.requiresChannel && channelOf(row, metricSpec) !== params.channel)) continue
    if (!rowUnitMatches(row, metricSpec)) continue
    const time = timeOf(row, source, metricSpec.nativeMinutes)
    if (!time || time.slice(0, 10) < params.dateFrom || time.slice(0, 10) > params.dateTo) continue
    const value = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null
    // 同对象同槽若出现冲突值，留空待核验；不按返回顺序取最后一条制造确定事实。
    values.set(time, values.has(time) && values.get(time) !== value ? null : value)
  }
  const step = metricSpec.nativeMinutes ?? 1440
  const points = dates.flatMap((date) => Array.from({ length: 1440 / step }, (_, index) => {
    const minute = index * step
    const time = `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
    return { time, value: values.get(time) ?? null }
  }))
  return { id: source.id, label: source.label, unit: metricSpec.unit, nativeMinutes: metricSpec.nativeMinutes, step: metricSpec.nativeMinutes === 60 ? 'end' : false, points, ...(source.forecast ? { forecast: true } : {}) }
}

export function summarizeDisclosureDeskSeries(series: DeskSeries, from?: string, to?: string): DeskSeriesSummary {
  const start = from === undefined ? -Infinity : pointTime(from)
  const end = to === undefined ? Infinity : pointTime(to)
  const points = series.points.filter((point) => {
    const time = pointTime(point.time)
    if (start === null || end === null || time === null || start > end) return false
    // 时槽值适用于整个原生区间；例如框选10:15~10:45包含10:00的小时价。
    // 未声明时长的日级标量只能按记录时点选取，不能声称持续全天。
    return time <= end && (series.nativeMinutes === null ? time >= start : time + series.nativeMinutes * 60_000 > start)
  })
  const values = points.flatMap((point) => point.value !== null && Number.isFinite(point.value) ? [point.value] : [])
  const min = values.length ? Math.min(...values) : null
  const max = values.length ? Math.max(...values) : null
  return { id: series.id, label: series.label, unit: series.unit, min, minAt: min === null ? null : points.find((point) => point.value === min)?.time ?? null, max, maxAt: max === null ? null : points.find((point) => point.value === max)?.time ?? null, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, latest: values.at(-1) ?? null, validPoints: values.length, expectedPoints: points.length }
}

function pointTime(value: string): number | null {
  const canonical = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}:00+08:00`
    : /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value
  const time = Date.parse(canonical)
  return Number.isFinite(time) ? time : null
}

/** 悬停只读包含该时刻的原生时槽；不把上一小时/前一天的值带进缺测区。 */
export function findDisclosureDeskPointAt(series: DeskSeries, at: string): DeskPoint | undefined {
  const time = pointTime(at)
  if (time === null) return undefined
  let point: DeskPoint | undefined
  for (let index = series.points.length - 1; index >= 0; index -= 1) {
    const start = pointTime(series.points[index].time)
    if (start !== null && start <= time) { point = series.points[index]; break }
  }
  if (!point) return undefined
  const start = pointTime(point.time)!
  return series.nativeMinutes === null
    ? time === start ? point : undefined
    : time < start + series.nativeMinutes * 60_000 ? point : undefined
}

function difference(first: DeskSeries, second: DeskSeries, spec: NonNullable<DeskMetric['difference']>): DeskSeries {
  const secondByTime = new Map(second.points.map((point) => [point.time, point.value]))
  return { ...first, ...spec, forecast: false, points: first.points.map((point) => {
    const value = secondByTime.get(point.time)
    return { time: point.time, value: point.value !== null && value !== null && value !== undefined ? value - point.value : null }
  }) }
}
function empty(metricSpec: DeskMetric, status: DeskStatus, reason: string): DeskDataResult {
  return { metric: metricSpec, series: [], channels: [], status, reason, sourceType: '', latestAt: null, summary: [], warnings: [] }
}
type ReadFailure = 'unauthorized' | 'not-configured' | 'missing' | 'error'
function classifyReadFailure(error: unknown, family: string, dataset: string): ReadFailure {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return 'unauthorized'
    // 仅识别回放接口明确给出的当前数据族/数据集缺失；路由404或服务器异常仍是读取失败。
    if (error.status === 404 && error.message === `capture family not found: ${family}`) return 'not-configured'
    if (error.status === 404 && error.message === `no captured file in ${family} matching "${dataset}"`) return 'missing'
  }
  return 'error'
}
function readFailureReason(status: ReadFailure, metricSpec: DeskMetric): string {
  if (status === 'unauthorized') return '当前账号无读取权限'
  if (status === 'not-configured') return `当前地区尚未接入“${metricSpec.label}”数据`
  if (status === 'error') return '数据读取失败，请重试'
  return metricSpec.textValue ? '所选日期暂无调峰需求披露' : '所选日期暂无该口径数据，未补值或跨地区回退'
}
function availableChannels(metricSpec: DeskMetric, rowsBySource: Row[][], params: DeskLoadParams): string[] {
  const channels = new Map<string, Map<string, number | string | null>>()
  rowsBySource.forEach((rows, index) => {
    const source = metricSpec.sources[index]
    for (const row of rows) {
      if (!rowInScope(row, source, params.regionId) || !rowUnitMatches(row, metricSpec)) continue
      const time = timeOf(row, source, metricSpec.nativeMinutes)
      const channel = channelOf(row, metricSpec)
      if (!channel || !time || time.slice(0, 10) < params.dateFrom || time.slice(0, 10) > params.dateTo) continue
      const value = metricSpec.textValue
        ? typeof row.textValue === 'string' && row.textValue.trim() ? row.textValue.trim() : null
        : typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null
      const samples = channels.get(channel) ?? new Map<string, number | string | null>()
      const key = `${source.id}\0${time}`
      samples.set(key, samples.has(key) && samples.get(key) !== value ? null : value)
      channels.set(channel, samples)
    }
  })
  return [...channels].filter(([, samples]) => [...samples.values()].some((value) => value !== null)).map(([channel]) => channel).sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
function selectChannel(channels: string[], params: DeskLoadParams): string | undefined {
  if (params.channel && channels.includes(params.channel)) return params.channel
  if (params.preferredChannel && channels.includes(params.preferredChannel)) return params.preferredChannel
  const province = PROVINCES[params.regionId]
  return channels.find((channel) => province?.names.some((name) => /^[a-z]+$/.test(name) ? channel.split(' · ').includes(name) : channel.includes(name))) ?? channels[0]
}
function isRealEnvelope(body: Envelope, region: string): boolean {
  if (!body || typeof body !== 'object') return false
  const source = body.provenance?.sourceType ?? body.sourceType ?? ''
  const served = body.provenance?.region ?? body.provenance?.regionServed ?? body.region_served
  return (body.code === undefined || body.code === 200) && !body.accessDenied && body.mock !== true && source !== 'MOCK' && body.productionWrite !== true && body.region_fallback !== true && body.provenance?.regionFallback !== true && body.provenance?.realDataConnected !== false && (!served || served === region) && (['REAL', 'CAPTURE', 'IMPORT', 'DB', 'API'].includes(source) || body.provenance?.realDataConnected === true) && (Array.isArray(body.data) || Array.isArray(body.rows)) && body._filter?.truncated !== true
}

/** 全部请求显式绑定页面地区；旧 query 的未知 metric 不触发其他地区/数据源回退。 */
export async function loadDisclosureDeskSeries(params: DeskLoadParams): Promise<DeskDataResult> {
  const metricSpec = getDisclosureDeskMetric(params.metricId)
  if (!metricSpec) throw new Error('未登记的披露指标，请重新选择')
  if (!PROVINCES[params.regionId] || (params.metricId === 'price' && params.regionId !== 'yunnan')) return empty(metricSpec, 'not-configured', '当前地区未接入该口径，未回读其他地区')
  let dates: string[]
  try { dates = days(params.dateFrom, params.dateTo) } catch (error) { return empty(metricSpec, 'error', (error as Error).message) }
  const warnings: string[] = []
  const types = new Set<string>()
  const failures = new Set<ReadFailure>()
  // 日分片防止整月多通道长表触发全请求行数上限；最多四个请求并行。
  const jobs = metricSpec.sources.flatMap((source, sourceIndex) => dates.map((date) => ({ source, sourceIndex, date: source.targetDate ? shiftDate(date, -1) : date })))
  const rowsBySource: Row[][] = metricSpec.sources.map(() => [])
  const requests = new Map<string, Promise<Envelope>>()
  for (let offset = 0; offset < jobs.length; offset += 4) {
    const batch = jobs.slice(offset, offset + 4)
    const responses = await Promise.allSettled(batch.map((job) => {
      const key = `${job.source.dataset}\0${job.date}`
      let request = requests.get(key)
      if (!request) {
        request = readDisclosureDeskCached(params.regionId, params, ['raw', metricSpec.family, job.source.dataset, job.date, '12000'], () => fetchCaptured<Envelope>(metricSpec.family, job.source.dataset, { region: params.regionId, dateFrom: job.date, dateTo: job.date, limit: 12000 }), (body) => isRealEnvelope(body, params.regionId))
        requests.set(key, request)
      }
      return request
    }))
    responses.forEach((response, index) => {
      const job = batch[index]
      if (response.status === 'rejected') {
        const failure = classifyReadFailure(response.reason, metricSpec.family, job.source.dataset)
        failures.add(failure)
        warnings.push(`${job.source.label} ${job.date}：${failure === 'missing' ? '该指标尚无采集文件' : readFailureReason(failure, metricSpec)}`)
        return
      }
      const body = response.value
      if (body.accessDenied || body.code === 401 || body.code === 403) { failures.add('unauthorized'); warnings.push(`${job.source.label}：当前账号无读取权限`); return }
      if (body.code !== undefined && body.code >= 400) { failures.add('error'); warnings.push(`${job.source.label}：数据读取失败，请重试`); return }
      const sourceType = body.provenance?.sourceType ?? body.sourceType ?? ''
      const served = body.provenance?.region ?? body.provenance?.regionServed ?? body.region_served
      if (body.mock === true || sourceType === 'MOCK' || body.productionWrite === true || body.region_fallback === true || body.provenance?.regionFallback === true || (served && served !== params.regionId)) {
        warnings.push(`${job.source.label}：返回模拟或异地区数据，已停止展示`); return
      }
      if (!['REAL', 'CAPTURE', 'IMPORT', 'DB', 'API'].includes(sourceType) && body.provenance?.realDataConnected !== true) { warnings.push(`${job.source.label}：缺少真实数据来源标记`); return }
      if (sourceType) types.add(sourceType)
      if (body._filter?.truncated) warnings.push(`${job.source.label} ${job.date}：数据超过上限，当前结果不完整`)
      const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.rows) ? body.rows : []
      rowsBySource[job.sourceIndex].push(...rows.filter((row) => row && typeof row === 'object'))
    })
  }
  const emptyStatus: ReadFailure = failures.has('unauthorized') ? 'unauthorized' : failures.has('error') ? 'error' : failures.has('not-configured') ? 'not-configured' : 'missing'
  const channels = metricSpec.requiresChannel ? availableChannels(metricSpec, rowsBySource, params) : []
  const selectedChannel = metricSpec.requiresChannel ? selectChannel(channels, params) : undefined
  const selectedParams = selectedChannel ? { ...params, channel: selectedChannel } : params
  if (metricSpec.textValue) {
    const factsByDate = new Map<string, DeskFact>()
    for (const row of rowsBySource[0]) {
      if (!rowInScope(row, metricSpec.sources[0], params.regionId) || channelOf(row, metricSpec) !== selectedChannel || !validDate(row.operateDate) || row.operateDate < params.dateFrom || row.operateDate > params.dateTo || typeof row.textValue !== 'string' || !row.textValue.trim()) continue
      factsByDate.set(row.operateDate, { label: metricSpec.sources[0].label, value: row.textValue.trim(), time: row.operateDate })
    }
    const facts = [...factsByDate.values()].sort((a, b) => a.time.localeCompare(b.time))
    return { ...empty(metricSpec, facts.length ? facts.length < dates.length || warnings.length ? 'partial' : 'available' : emptyStatus, facts.length ? '按原文展示调峰需求；这是披露事项，不是连续功率曲线' : readFailureReason(emptyStatus, metricSpec)), facts, channels, selectedChannel, sourceType: [...types].join('+'), latestAt: facts.at(-1)?.time ?? null, warnings: [...new Set(warnings)] }
  }
  // “云南总送出”“广东受西电”等对象仅披露自身方向；未披露相反方向不等于该曲线缺测。
  // 保留实际存在的方向，即使其值全部为空；断面双向限值仍按两条既定口径确认覆盖。
  const disclosedDirections = metricSpec.id === 'interprov-forecast'
    ? metricSpec.sources.map((source, index) => rowsBySource[index].some((row) => rowInScope(row, source, params.regionId) && channelOf(row, metricSpec) === selectedChannel))
    : null
  const series = metricSpec.sources.flatMap((source, index) => disclosedDirections?.some(Boolean) && !disclosedDirections[index]
    ? [] : [buildDisclosureDeskSeries(metricSpec, source, rowsBySource[index], selectedParams)])
  if (metricSpec.difference && series.length === 2) series.push(difference(series[0], series[1], metricSpec.difference))
  const summary = series.map((item) => summarizeDisclosureDeskSeries(item))
  const facts = metricSpec.dailyFacts ? dailyDisclosureFacts(metricSpec, rowsBySource[0], selectedParams, series[0]) : undefined
  const count = summary.reduce((sum, item) => sum + item.validPoints, 0)
  const partial = summary.some((item) => item.validPoints < item.expectedPoints) || warnings.length > 0
  const status: DeskStatus = count ? partial ? 'partial' : 'available' : emptyStatus
  return { metric: metricSpec, series, channels, selectedChannel, status, reason: count ? partial ? '存在缺测或未发布时段，曲线按原生粒度留白' : '所选区间数据可用' : readFailureReason(emptyStatus, metricSpec), sourceType: [...types].join('+'), latestAt: series.flatMap((item) => item.points.filter((point) => point.value !== null).map((point) => point.time)).sort().at(-1) ?? null, summary, warnings: [...new Set(warnings)], ...(facts ? { facts } : {}) }
}

/** 日级数值的原因与来源按业务日汇总；不把原文原因编码成功率、不延长为全天曲线。 */
function dailyDisclosureFacts(metricSpec: DeskMetric, rows: Row[], params: DeskLoadParams, series: DeskSeries): DeskFact[] {
  const byDate = new Map<string, Row[]>()
  for (const row of rows) {
    if (!rowInScope(row, metricSpec.sources[0], params.regionId) || channelOf(row, metricSpec) !== params.channel || !validDate(row.operateDate) || row.operateDate < params.dateFrom || row.operateDate > params.dateTo) continue
    const items = byDate.get(row.operateDate) ?? []
    items.push(row)
    byDate.set(row.operateDate, items)
  }
  const strings = (items: Row[], field: string) => [...new Set(items.flatMap((item) => typeof item[field] === 'string' && item[field].trim() && item[field].trim() !== '空' ? [item[field].trim()] : []))].sort().join('；')
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => {
    const value = series.points.find((point) => point.time === `${date} 00:00`)?.value
    return { label: metricSpec.label, value: value === null || value === undefined ? '未提供或同日记录不一致' : String(value), time: date, unit: metricSpec.unit, reason: strings(items, 'noteText') || '未提供', sourceTable: strings(items, 'sourceTable') || metricSpec.sources[0].dataset, sourceFile: strings(items, 'sourceFile') || '未提供', objectName: params.channel }
  })
}

/** 只定位默认日期，用户手选日期不钳制；覆盖范围不表示其中每个时段完整。 */
export type DeskCoverage = DateRange & { partial?: boolean; reason?: string }
export async function loadDisclosureDeskCoverage(regionId: string, metricId = 'price', context: DeskCacheContext = {}): Promise<DeskCoverage | null> {
  const metricSpec = getDisclosureDeskMetric(metricId)
  if (!metricSpec || !PROVINCES[regionId]) return null
  if (metricId === 'price' && regionId !== 'yunnan') return null
  try {
    const response = await readCoverage(regionId, metricSpec.family, context)
    if (!validCoverage(response, regionId, metricSpec.family)) return null
    const datasets = response?.data?.datasets
    if (!Array.isArray(datasets)) return null
    const ranges = metricSpec.sources.flatMap((source) => {
      const item = datasets.find((entry) => entry.datasetKey === source.dataset)
      if (!item || !validDate(item.start) || !validDate(item.end)) return []
      return [{ start: source.targetDate ? shiftDate(item.start, 1) : item.start, end: source.targetDate ? shiftDate(item.end, 1) : item.end }]
    })
    if (!ranges.length) return null
    const start = ranges.map((range) => range.start).sort().at(-1)!
    const end = ranges.map((range) => range.end).sort()[0]
    if (ranges.length === metricSpec.sources.length && start <= end) return { start, end }
    const latest = ranges.sort((a, b) => b.end.localeCompare(a.end))[0]
    return { ...latest, partial: true, reason: '仅部分口径有数据或两侧日期未重叠，缺失曲线与偏差留白' }
  } catch { return null }
}

export type DeskThemeAvailability = Partial<Record<DeskThemeId, { available: number; total: number }>>
type CoverageDataset = { datasetKey: string; start: string | null; end: string | null; rows?: number }
type CoveragePayload = { family?: string; region?: string; datasets?: CoverageDataset[] }
type CoverageResponse = { code?: number; data?: CoveragePayload }
function validCoverage(body: CoverageResponse, region: string, family: string): boolean {
  if (!body || typeof body !== 'object') return false
  return (body.code === undefined || body.code === 200) && body.data?.family === family && body.data.region === region && Array.isArray(body.data.datasets)
}
function readCoverage(region: string, family: string, context: DeskCacheContext): Promise<CoverageResponse> {
  return readDisclosureDeskCached(region, context, ['coverage', family], () => apiGet<CoveragePayload>('/api/real-coverage', { family, region }), (body) => validCoverage(body, region, family))
}

/** 仅统计当前窗口内有覆盖登记的指标；日期边界不保证其中每个时段有样本。 */
export async function loadDisclosureDeskThemeAvailability(regionId: string, dateFrom: string, dateTo: string, context: DeskCacheContext = {}): Promise<DeskThemeAvailability> {
  if (!PROVINCES[regionId] || !validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) return {}
  const families = [...new Set(DISCLOSURE_DESK_METRICS.map((item) => item.family))]
  const responses = await Promise.allSettled(families.map((family) => readCoverage(regionId, family, context)))
  const coverageByFamily = new Map<string, CoverageDataset[]>()
  responses.forEach((response, index) => {
    if (response.status !== 'fulfilled') return
    const body = response.value
    // 此端点会回显 family/region。无法验证返回 scope 时不能把未知状态标成 0。
    if (!validCoverage(body, regionId, families[index])) return
    coverageByFamily.set(families[index], body.data!.datasets!)
  })
  const result: DeskThemeAvailability = {}
  for (const theme of DISCLOSURE_DESK_THEMES) {
    const metrics = DISCLOSURE_DESK_METRICS.filter((item) => item.themeId === theme.id)
    if (metrics.some((item) => !(item.id === 'price' && regionId !== 'yunnan') && !coverageByFamily.has(item.family))) continue
    const available = metrics.filter((item) => {
      if (item.id === 'price' && regionId !== 'yunnan') return false
      return item.sources.some((source) => coverageByFamily.get(item.family)!.some((dataset) => {
        if (!dataset || dataset.datasetKey !== source.dataset || !validDate(dataset.start) || !validDate(dataset.end) || dataset.start > dataset.end || dataset.rows === 0) return false
        const start = source.targetDate ? shiftDate(dataset.start, 1) : dataset.start
        const end = source.targetDate ? shiftDate(dataset.end, 1) : dataset.end
        return start <= dateTo && end >= dateFrom
      }))
    }).length
    result[theme.id] = { available, total: metrics.length }
  }
  return result
}
