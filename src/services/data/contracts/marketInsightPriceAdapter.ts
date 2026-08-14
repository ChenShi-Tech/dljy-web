import type { ModuleContractBasis, ModuleContractMeta, ModuleAvailabilityItem } from './common'
import type {
  MarketInsightPriceBlock,
  MarketInsightPriceContract,
  MarketInsightPriceCurve,
  MarketInsightPriceDailyStat
} from './marketInsight'
import type { DataSourceBasis, SourceType } from '../types'

export const MARKET_INSIGHT_PRICE_FAMILY = 'sdpt_zcqxhdl'
export const MARKET_INSIGHT_PRICE_MATCH = 'listrs_full'

export type ListrsFullRow = Record<string, unknown> & {
  type?: string | number
  date?: string
  drrq?: string
  jz?: unknown
}

export type ListrsFullPayload = {
  rjz?: ListrsFullRow[]
  rmx?: ListrsFullRow[]
  dmx?: ListrsFullRow[]
}

export type MarketInsightPriceAdapterMeta = Partial<Omit<
  ModuleContractMeta,
  'basis' | 'sourceType' | 'productionWrite' | 'data_availability'
>> & {
  basis?: DataSourceBasis
  sourceType?: SourceType | string
  productionWrite?: boolean
}

export type MarketInsightPriceAdapterInput = {
  payload: unknown
  date?: string
  meta?: MarketInsightPriceAdapterMeta
}

function asPayload(payload: unknown): ListrsFullPayload {
  const body = (payload ?? {}) as { data?: unknown }
  const data = body.data && typeof body.data === 'object' ? body.data : payload
  return (data ?? {}) as ListrsFullPayload
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function pointToTime(point: number): string {
  const minutes = Math.max(0, Math.min(95, point - 1)) * 15
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function marketOf(row: ListrsFullRow): 'da' | 'rt' | null {
  const raw = String(row.type ?? row.jz ?? '').trim().toLowerCase()
  if (raw === '0' || raw.includes('日前') || raw === 'da' || raw.includes('day')) return 'da'
  if (raw === '1' || raw.includes('实时') || raw === 'rt' || raw.includes('real')) return 'rt'
  return null
}

function labelOf(market: 'da' | 'rt'): string {
  return market === 'da' ? '日前价' : '实时价'
}

function values96(row: ListrsFullRow): Array<number | null> {
  return Array.from({ length: 96 }, (_, index) => numberOrNull(row[`p${index + 1}`]))
}

function curveFromRow(row: ListrsFullRow, fallbackDate: string): MarketInsightPriceCurve | null {
  const market = marketOf(row)
  if (!market) return null
  return {
    market,
    label: labelOf(market),
    date: String(row.date || fallbackDate),
    unit: 'yuan_per_mwh',
    points: values96(row).map((value, index) => ({
      point: index + 1,
      time: pointToTime(index + 1),
      value
    }))
  }
}

function aggregateFromValues(values: Array<number | null>) {
  const nums = values.filter((v): v is number => Number.isFinite(Number(v)))
  if (!nums.length) {
    return { avg: null, max: null, min: null, spread: null, negativeSharePct: null, points: 0 }
  }
  const max = Math.max(...nums)
  const min = Math.min(...nums)
  return {
    avg: nums.reduce((sum, value) => sum + value, 0) / nums.length,
    max,
    min,
    spread: max - min,
    negativeSharePct: (nums.filter((value) => value < 0).length / nums.length) * 100,
    points: nums.length
  }
}

function dailyStatFromRow(row: ListrsFullRow, fallbackCurve?: MarketInsightPriceCurve): MarketInsightPriceDailyStat | null {
  const market = marketOf(row) ?? fallbackCurve?.market ?? null
  if (!market) return null
  const max = numberOrNull(row.p1)
  const min = numberOrNull(row.p2)
  const avg = numberOrNull(row.p3)
  const fromCurve = fallbackCurve ? aggregateFromValues(fallbackCurve.points.map((point) => point.value)) : null
  return {
    date: String(row.date || fallbackCurve?.date || ''),
    market,
    unit: 'yuan_per_mwh',
    avg: avg ?? fromCurve?.avg ?? null,
    max: max ?? fromCurve?.max ?? null,
    min: min ?? fromCurve?.min ?? null,
    spread: max !== null && min !== null ? max - min : fromCurve?.spread ?? null,
    negativeSharePct: fromCurve?.negativeSharePct ?? null,
    points: fromCurve?.points ?? 0
  }
}

function normalizeBasis(meta?: MarketInsightPriceAdapterMeta): ModuleContractBasis {
  if (meta?.mock === true) return 'synthetic'
  return meta?.basis === 'real' || meta?.basis === 'captured' ? 'captured' : 'synthetic'
}

function sourceTypeOf(meta: MarketInsightPriceAdapterMeta | undefined, mock: boolean): SourceType {
  if (mock) return 'MOCK'
  if (meta?.sourceType) return String(meta.sourceType).toUpperCase() as SourceType
  return 'CAPTURE'
}

function contractMeta(
  meta: MarketInsightPriceAdapterMeta | undefined,
  availability: ModuleAvailabilityItem[]
): ModuleContractMeta {
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

function priceStatus(curves: MarketInsightPriceCurve[], meta?: MarketInsightPriceAdapterMeta) {
  if (!curves.length) return 'missing' as const
  return meta?.mock === true || normalizeBasis(meta) === 'synthetic' ? 'mock' as const : 'real' as const
}

export function toMarketInsightPriceContract(input: MarketInsightPriceAdapterInput): MarketInsightPriceContract {
  const payload = asPayload(input.payload)
  const selectedDate = input.date
  const source = `${MARKET_INSIGHT_PRICE_FAMILY}/${MARKET_INSIGHT_PRICE_MATCH}`
  const dmxRows = Array.isArray(payload.dmx) ? payload.dmx : []
  const rjzRows = Array.isArray(payload.rjz) ? payload.rjz : []
  const rmxRows = Array.isArray(payload.rmx) ? payload.rmx : []
  const curveRows = selectedDate ? dmxRows.filter((row) => row.date === selectedDate) : rjzRows
  const fallbackDate = selectedDate ?? 'average'
  const curves = curveRows
    .map((row) => curveFromRow(row, fallbackDate))
    .filter((curve): curve is MarketInsightPriceCurve => Boolean(curve))
    .sort((a, b) => (a.market === b.market ? 0 : a.market === 'da' ? -1 : 1))

  const curveByKey = new Map(curves.map((curve) => [`${curve.date}:${curve.market}`, curve]))
  const summaryRows = selectedDate ? rmxRows.filter((row) => row.date === selectedDate) : rmxRows
  const daily = summaryRows
    .map((row) => dailyStatFromRow(row, curveByKey.get(`${String(row.date || fallbackDate)}:${marketOf(row) ?? ''}`)))
    .filter((item): item is MarketInsightPriceDailyStat => Boolean(item))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.market === b.market ? 0 : a.market === 'da' ? -1 : 1))

  const status = priceStatus(curves, input.meta)
  const availability: ModuleAvailabilityItem[] = [{
    key: 'market_insight.price',
    label: '市场洞察-价格',
    status,
    source: curves.length ? source : null,
    ...(status === 'missing' ? { note: 'listrs_full 未提供可转换的日前/实时 96 点价格曲线' } : {})
  }]
  const block: MarketInsightPriceBlock = {
    key: 'price',
    label: '价格',
    status,
    source: curves.length ? source : null,
    curves,
    daily,
    notes: [
      '山西由 sdpt_zcqxhdl/listrs_full 原始 {rjz,rmx,dmx} 适配。',
      '云南由 yn_node_price Parquet 派生的 sdpt_zcqxhdl/listrs_full__yn 适配，契约层不感知 PG/file 双轨。',
      'listrs_full 行 date 为真实标的日；drrq 仅为仿山西形状伴随字段，不参与标的日匹配。'
    ]
  }
  return {
    ...contractMeta(input.meta, availability),
    group: 'market_insight',
    blocks: { price: block }
  }
}
