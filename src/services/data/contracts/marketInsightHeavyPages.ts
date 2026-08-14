import type { ModuleAvailabilityItem, ModuleAvailabilityStatus, ModuleContractBasis, ModuleContractMeta } from './common'
import type { DataSourceBasis, SourceType } from '../types'

export const MARKET_INSIGHT_ZSJFX_FAMILY = 'sdpt_zsjfx_idx'
export const MARKET_INSIGHT_ZSJFX_META_MATCH = 'zsjfx_meta'
export const MARKET_INSIGHT_PRICE_FAMILY = 'sdpt_zcqxhdl'
export const MARKET_INSIGHT_PRICE_MATCH = 'listrs_full'
export const MARKET_INSIGHT_CLEARING_MATCH = '__list__'
export const MARKET_INSIGHT_ACTUAL_LOAD_FAMILY = 'sdpt_actualLoad'
export const MARKET_INSIGHT_ACTUAL_LOAD_MATCH = 'query__'

export type MarketInsightAdapterMeta = Partial<Omit<
  ModuleContractMeta,
  'basis' | 'sourceType' | 'productionWrite' | 'data_availability'
>> & {
  basis?: DataSourceBasis
  sourceType?: SourceType | string
  productionWrite?: boolean
}

export type ZsjfxMetaViewModel = {
  dates: string[]
  goodDates: string[]
  groups: Record<string, string[]>
  typeAxis: Record<string, number>
  yzConfig: Array<Record<string, unknown>>
  colorMap: Record<string, string>
  defaults: string[]
}

export type ZsjfxDayViewModel = {
  date: string
  series: Record<string, Array<number | null>>
}

export type MarketInsightZsjfxBlock = {
  key: 'zsjfx'
  label: '综合数据分析'
  status: ModuleAvailabilityStatus
  source: string | null
  meta?: ZsjfxMetaViewModel
  day?: ZsjfxDayViewModel
  notes: string[]
}

export type MarketInsightZsjfxContract = ModuleContractMeta & {
  group: 'market_insight'
  blocks: {
    zsjfx: MarketInsightZsjfxBlock
  }
}

export type PriceMarket = 'rq' | 'ss'

export type PriceCurveViewModel = {
  market: PriceMarket
  label: string
  date: string
  points: Array<number | null>
  unit: 'yuan_per_mwh'
}

export type PriceDailyStatViewModel = {
  market: PriceMarket
  label: string
  date: string
  max: number | null
  min: number | null
  avg: number | null
  unit: 'yuan_per_mwh'
}

export type MarketInsightPriceAnalysisBlock = {
  key: 'price_analysis'
  label: '价格分析'
  status: ModuleAvailabilityStatus
  source: string | null
  dates: string[]
  averageCurves: PriceCurveViewModel[]
  dayCurves: PriceCurveViewModel[]
  dailyStats: PriceDailyStatViewModel[]
  notes: string[]
}

export type MarketInsightPriceAnalysisContract = ModuleContractMeta & {
  group: 'market_insight'
  blocks: {
    price_analysis: MarketInsightPriceAnalysisBlock
  }
}

export type ClearingSpotSeriesViewModel = {
  name: string
  yAxisIndex: number
  values: Array<number | null>
}

export type MarketInsightClearingSpotBlock = {
  key: 'clearing_spot'
  label: '出清现货电量分析'
  status: ModuleAvailabilityStatus
  source: string | null
  timePoints: string[]
  series: ClearingSpotSeriesViewModel[]
  notes: string[]
}

export type MarketInsightClearingSpotContract = ModuleContractMeta & {
  group: 'market_insight'
  blocks: {
    clearing_spot: MarketInsightClearingSpotBlock
  }
}

export type ActualLoadSourceKey = 'system' | 'misplace'
export type ActualLoadMetricKey = 'average' | 'min' | 'max'

export type ActualLoadSourceViewModel = {
  key: ActualLoadSourceKey
  label: string
  nameList: string[]
  years: string[]
  metrics: Record<ActualLoadMetricKey, Array<Array<number | null>>>
}

export type MarketInsightActualLoadBlock = {
  key: 'actual_load'
  label: '逐日系统负荷实际值'
  status: ModuleAvailabilityStatus
  source: string | null
  sources: Record<ActualLoadSourceKey, ActualLoadSourceViewModel | null>
  notes: string[]
}

export type MarketInsightActualLoadContract = ModuleContractMeta & {
  group: 'market_insight'
  blocks: {
    actual_load: MarketInsightActualLoadBlock
  }
}

type ZsjfxRawMeta = Record<string, unknown> & {
  dates?: unknown
  goodDates?: unknown
  groups?: unknown
  typeAxis?: unknown
  yzConfig?: unknown
  colorMap?: unknown
  defaults?: unknown
}

type ZsjfxRawDay = Record<string, unknown> & {
  date?: unknown
  series?: unknown
}

type ListrsRow = Record<string, unknown> & {
  type?: unknown
  date?: unknown
}

type ListrsPayload = {
  rjz?: unknown
  rmx?: unknown
  dmx?: unknown
}

type ClearingPayload = {
  nameList?: unknown
  legend?: unknown
  yAxisIndexList?: unknown
  series?: unknown
}

type ActualLoadRawSource = {
  nameList?: unknown
  legendList?: unknown
  pjz?: unknown
  zxz?: unknown
  zdz?: unknown
}

type ActualLoadPayload = {
  system?: ActualLoadRawSource
  misplace?: ActualLoadRawSource
}

function asPayload<T extends Record<string, unknown>>(payload: unknown): T {
  const body = (payload ?? {}) as { data?: unknown }
  const data = body.data && typeof body.data === 'object' ? body.data : payload
  return (data ?? {}) as T
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

function numberArray(value: unknown): Array<number | null> {
  return Array.isArray(value) ? value.map(numberOrNull) : []
}

function numberMatrix(value: unknown): Array<Array<number | null>> {
  if (!Array.isArray(value)) return []
  return value.map((row) => Array.isArray(row) ? row.map((item) => numberOrNull(item)) : [])
}

function objectOfArrays(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, list]) => [key, stringArray(list)])
  )
}

function objectOfNumbers(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(raw)
    if (Number.isFinite(n)) out[key] = n
  }
  return out
}

function objectOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw !== null && raw !== undefined) out[key] = String(raw)
  }
  return out
}

function objectOfNumberArrays(value: unknown): Record<string, Array<number | null>> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, Array<number | null>> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = numberArray(raw)
  }
  return out
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeBasis(meta?: MarketInsightAdapterMeta): ModuleContractBasis {
  if (meta?.mock === true) return 'synthetic'
  return meta?.basis === 'real' || meta?.basis === 'captured' ? 'captured' : 'synthetic'
}

function sourceTypeOf(meta: MarketInsightAdapterMeta | undefined, mock: boolean): SourceType {
  if (mock) return 'MOCK'
  if (meta?.sourceType) return String(meta.sourceType).toUpperCase() as SourceType
  return 'CAPTURE'
}

function contractMeta(meta: MarketInsightAdapterMeta | undefined, availability: ModuleAvailabilityItem[]): ModuleContractMeta {
  const basis = normalizeBasis(meta)
  const mock = meta?.mock === true || basis === 'synthetic'
  return {
    schema_version: 1,
    basis: mock ? 'synthetic' : basis,
    sourceType: sourceTypeOf(meta, mock),
    mock,
    productionWrite: false,
    data_availability: availability,
    region_requested: meta?.region_requested,
    region_served: meta?.region_served ?? meta?.region_requested ?? 'unknown',
    region_fallback: meta?.region_fallback ?? false,
    generated_at: meta?.generated_at
  }
}

function statusFrom(hasData: boolean, meta?: MarketInsightAdapterMeta): ModuleAvailabilityStatus {
  if (!hasData) return 'missing'
  return meta?.mock === true || normalizeBasis(meta) === 'synthetic' ? 'mock' : 'real'
}

function zsjfxSource(match: string): string {
  return `${MARKET_INSIGHT_ZSJFX_FAMILY}/${match}`
}

function priceMarketOf(row: ListrsRow): PriceMarket | null {
  const raw = String(row.type ?? '').trim().toLowerCase()
  if (raw === '0' || raw.includes('日前') || raw === 'rq' || raw === 'da') return 'rq'
  if (raw === '1' || raw.includes('实时') || raw === 'ss' || raw === 'rt') return 'ss'
  return null
}

function priceLabel(market: PriceMarket): string {
  return market === 'rq' ? '日前价' : '实时价'
}

function priceCurveFromRow(row: ListrsRow, fallbackDate: string): PriceCurveViewModel | null {
  const market = priceMarketOf(row)
  if (!market) return null
  return {
    market,
    label: priceLabel(market),
    date: String(row.date || fallbackDate),
    unit: 'yuan_per_mwh',
    points: Array.from({ length: 96 }, (_, index) => numberOrNull(row[`p${index + 1}`]))
  }
}

function priceStatFromRow(row: ListrsRow): PriceDailyStatViewModel | null {
  const market = priceMarketOf(row)
  const date = typeof row.date === 'string' ? row.date : ''
  if (!market || !date) return null
  return {
    market,
    label: priceLabel(market),
    date,
    max: numberOrNull(row.p1),
    min: numberOrNull(row.p2),
    avg: numberOrNull(row.p3),
    unit: 'yuan_per_mwh'
  }
}

function listrsRows(value: unknown): ListrsRow[] {
  return Array.isArray(value) ? value as ListrsRow[] : []
}

function actualLoadSource(key: ActualLoadSourceKey, raw: ActualLoadRawSource | undefined): ActualLoadSourceViewModel | null {
  if (!raw) return null
  return {
    key,
    label: key === 'system' ? '系统负荷实际值' : '错位负荷实际值',
    nameList: stringArray(raw.nameList),
    years: stringArray(raw.legendList),
    metrics: {
      average: numberMatrix(raw.pjz),
      min: numberMatrix(raw.zxz),
      max: numberMatrix(raw.zdz)
    }
  }
}

export function toMarketInsightZsjfxMetaContract(input: {
  payload: unknown
  meta?: MarketInsightAdapterMeta
}): MarketInsightZsjfxContract {
  const raw = asPayload<ZsjfxRawMeta>(input.payload)
  const metaView: ZsjfxMetaViewModel = {
    dates: stringArray(raw.dates),
    goodDates: stringArray(raw.goodDates),
    groups: objectOfArrays(raw.groups),
    typeAxis: objectOfNumbers(raw.typeAxis),
    yzConfig: Array.isArray(raw.yzConfig) ? raw.yzConfig as Array<Record<string, unknown>> : [],
    colorMap: objectOfStrings(raw.colorMap),
    defaults: stringArray(raw.defaults)
  }
  const status = statusFrom(metaView.dates.length > 0, input.meta)
  const source = status === 'missing' ? null : zsjfxSource(MARKET_INSIGHT_ZSJFX_META_MATCH)
  const availability: ModuleAvailabilityItem[] = [{
    key: 'market_insight.zsjfx',
    label: '综合数据分析',
    status,
    source,
    ...(status === 'missing' ? { note: 'zsjfx_meta 未提供可用日期索引' } : {})
  }]
  return {
    ...contractMeta(input.meta, availability),
    group: 'market_insight',
    blocks: {
      zsjfx: {
        key: 'zsjfx',
        label: '综合数据分析',
        status,
        source,
        meta: metaView,
        notes: ['综合数据分析由 sdpt_zsjfx_idx meta/day 文档适配为按日曲线 view model。']
      }
    }
  }
}

export function toMarketInsightZsjfxDayContract(input: {
  payload: unknown
  date: string
  meta?: MarketInsightAdapterMeta
}): MarketInsightZsjfxContract {
  const raw = asPayload<ZsjfxRawDay>(input.payload)
  const day: ZsjfxDayViewModel = {
    date: String(raw.date || input.date),
    series: objectOfNumberArrays(raw.series)
  }
  const status = statusFrom(Object.keys(day.series).length > 0, input.meta)
  const match = `zsjfx_day__${input.date}`
  const source = status === 'missing' ? null : zsjfxSource(match)
  const availability: ModuleAvailabilityItem[] = [{
    key: 'market_insight.zsjfx.day',
    label: '综合数据分析-日曲线',
    status,
    source,
    ...(status === 'missing' ? { note: `${input.date} 未提供可用曲线` } : {})
  }]
  return {
    ...contractMeta(input.meta, availability),
    group: 'market_insight',
    blocks: {
      zsjfx: {
        key: 'zsjfx',
        label: '综合数据分析',
        status,
        source,
        day,
        notes: ['综合数据分析日曲线由 sdpt_zsjfx_idx day 文档适配。']
      }
    }
  }
}

export function toMarketInsightPriceAnalysisContract(input: {
  payload: unknown
  meta?: MarketInsightAdapterMeta
}): MarketInsightPriceAnalysisContract {
  const raw = asPayload<ListrsPayload>(input.payload)
  const averageCurves = listrsRows(raw.rjz)
    .map((row) => priceCurveFromRow(row, 'average'))
    .filter((item): item is PriceCurveViewModel => Boolean(item))
  const dayCurves = listrsRows(raw.dmx)
    .map((row) => priceCurveFromRow(row, String(row.date || '')))
    .filter((item): item is PriceCurveViewModel => item !== null && Boolean(item.date))
  const dailyStats = listrsRows(raw.rmx)
    .map(priceStatFromRow)
    .filter((item): item is PriceDailyStatViewModel => Boolean(item))
  const dates = [...new Set(dayCurves.map((curve) => curve.date).filter(Boolean))].sort()
  const status = statusFrom(dayCurves.length > 0 || averageCurves.length > 0 || dailyStats.length > 0, input.meta)
  const source = status === 'missing' ? null : `${MARKET_INSIGHT_PRICE_FAMILY}/${MARKET_INSIGHT_PRICE_MATCH}`
  const availability: ModuleAvailabilityItem[] = [{
    key: 'market_insight.price_analysis',
    label: '价格分析',
    status,
    source,
    ...(status === 'missing' ? { note: 'listrs_full 未提供可转换的价格分析曲线' } : {})
  }]
  return {
    ...contractMeta(input.meta, availability),
    group: 'market_insight',
    blocks: {
      price_analysis: {
        key: 'price_analysis',
        label: '价格分析',
        status,
        source,
        dates,
        averageCurves,
        dayCurves,
        dailyStats,
        notes: [
          'listrs_full 行 date 为真实标的日，drrq 仅为伴随字段；价格分析契约只按 date 归集。',
          '山西/云南均通过地区隔离的 sdpt_zcqxhdl/listrs_full view model 消费。'
        ]
      }
    }
  }
}

export function toMarketInsightClearingSpotContract(input: {
  payload: unknown
  meta?: MarketInsightAdapterMeta
}): MarketInsightClearingSpotContract {
  const raw = asPayload<ClearingPayload>(input.payload)
  const names = stringArray(raw.legend)
  const axis = Array.isArray(raw.yAxisIndexList) ? raw.yAxisIndexList.map((item) => Number(item)) : []
  const rawSeries = Array.isArray(raw.series) ? raw.series : []
  const series = names.map((name, index) => ({
    name,
    yAxisIndex: Number.isFinite(axis[index]) ? axis[index] : 0,
    values: numberArray(rawSeries[index])
  }))
  const timePoints = stringArray(raw.nameList)
  const status = statusFrom(timePoints.length > 0 && series.length > 0, input.meta)
  const source = status === 'missing' ? null : `${MARKET_INSIGHT_PRICE_FAMILY}/${MARKET_INSIGHT_CLEARING_MATCH}`
  const availability: ModuleAvailabilityItem[] = [{
    key: 'market_insight.clearing_spot',
    label: '出清现货电量分析',
    status,
    source,
    ...(status === 'missing' ? { note: '__list__ 未提供可转换的连续出清序列' } : {})
  }]
  return {
    ...contractMeta(input.meta, availability),
    group: 'market_insight',
    blocks: {
      clearing_spot: {
        key: 'clearing_spot',
        label: '出清现货电量分析',
        status,
        source,
        timePoints,
        series,
        notes: ['出清现货电量分析由 sdpt_zcqxhdl/__list__ 归一为时间点 + 语义序列。']
      }
    }
  }
}

export function toMarketInsightActualLoadContract(input: {
  payload: unknown
  meta?: MarketInsightAdapterMeta
}): MarketInsightActualLoadContract {
  const raw = asPayload<ActualLoadPayload>(input.payload)
  const system = actualLoadSource('system', raw.system)
  const misplace = actualLoadSource('misplace', raw.misplace)
  const status = statusFrom(Boolean(system?.nameList.length), input.meta)
  const source = status === 'missing' ? null : `${MARKET_INSIGHT_ACTUAL_LOAD_FAMILY}/${MARKET_INSIGHT_ACTUAL_LOAD_MATCH}`
  const availability: ModuleAvailabilityItem[] = [{
    key: 'market_insight.actual_load',
    label: '逐日系统负荷实际值',
    status,
    source,
    ...(status === 'missing' ? { note: 'query__ 未提供系统负荷日序列' } : {})
  }]
  return {
    ...contractMeta(input.meta, availability),
    group: 'market_insight',
    blocks: {
      actual_load: {
        key: 'actual_load',
        label: '逐日系统负荷实际值',
        status,
        source,
        sources: { system, misplace },
        notes: ['逐日系统负荷由 sdpt_actualLoad/query__ 归一为系统/错位负荷与均/小/大三类指标。']
      }
    }
  }
}
