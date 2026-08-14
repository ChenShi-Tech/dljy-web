import type { ModuleAvailabilityItem, ModuleAvailabilityStatus, ModuleContractBasis, ModuleContractMeta } from './common'
import type { DataSourceBasis, SourceType } from '../types'

export const MARKET_INSIGHT_RELATION_FAMILY = 'sdpt_zcqxhdl'

export type MarketInsightRelationKind = 'renewable' | 'load'
export type MarketInsightRelationPriceMode = 'rq' | 'ss'

export type RelationScatterCell = [number, number]
export type RelationScatterRow = {
  date: string
  [point: string]: string | RelationScatterCell | null
}
export type RelationScatterLineRow = Record<string, number | null | undefined>

export type RelationScatterDataset = {
  xd: RelationScatterRow[]
  xnyzd: RelationScatterLineRow[]
  xnyg: RelationScatterLineRow[]
  xnygd: RelationScatterLineRow[]
}

export type RelationScatterDimension = {
  id: string
  title: string
  sourceKey: 'xnyzd' | 'xnyg' | 'xnygd'
}

export type MarketInsightRelationScatterBlock = {
  key: 'price_renewable_relation' | 'price_load_relation'
  label: '价格-新能源关系' | '价格-负荷关系'
  status: ModuleAvailabilityStatus
  source: string | null
  runDate: string
  days: number
  priceMode: MarketInsightRelationPriceMode
  xMetric: 'new_energy_actual' | 'load_actual'
  dataset: RelationScatterDataset
  dimensions: RelationScatterDimension[]
  notes: string[]
}

export type MarketInsightRelationScatterContract = ModuleContractMeta & {
  group: 'market_insight'
  blocks: {
    relation_scatter: MarketInsightRelationScatterBlock
  }
}

export type MarketInsightRelationScatterAdapterMeta = Partial<Omit<
  ModuleContractMeta,
  'basis' | 'sourceType' | 'productionWrite' | 'data_availability'
>> & {
  basis?: DataSourceBasis
  sourceType?: SourceType | string
  productionWrite?: boolean
}

export type MarketInsightRelationScatterAdapterInput = {
  kind: MarketInsightRelationKind
  payload: unknown
  runDate: string
  days: number
  priceMode: MarketInsightRelationPriceMode
  source?: string | null
  notes?: string[]
  meta?: MarketInsightRelationScatterAdapterMeta
}

function asPayload(payload: unknown): Record<string, unknown> {
  const body = (payload ?? {}) as { data?: unknown }
  const data = body.data && typeof body.data === 'object' ? body.data : payload
  return (data ?? {}) as Record<string, unknown>
}

function asRows(value: unknown): RelationScatterRow[] {
  return Array.isArray(value) ? value as RelationScatterRow[] : []
}

function asLineRows(value: unknown): RelationScatterLineRow[] {
  return Array.isArray(value) ? value as RelationScatterLineRow[] : []
}

function normalizeDataset(payload: unknown): RelationScatterDataset {
  const data = asPayload(payload)
  return {
    xd: asRows(data.xd),
    xnyzd: asLineRows(data.xnyzd),
    xnyg: asLineRows(data.xnyg),
    xnygd: asLineRows(data.xnygd)
  }
}

function hasScatterPoints(dataset: RelationScatterDataset): boolean {
  return dataset.xd.some((row) => {
    for (let hour = 1; hour <= 24; hour += 1) {
      const point = row[`p${hour}`]
      if (Array.isArray(point) && point.length >= 2) return true
    }
    return false
  })
}

function normalizeBasis(meta?: MarketInsightRelationScatterAdapterMeta): ModuleContractBasis {
  if (meta?.mock === true) return 'synthetic'
  return meta?.basis === 'real' || meta?.basis === 'captured' ? 'captured' : 'synthetic'
}

function sourceTypeOf(meta: MarketInsightRelationScatterAdapterMeta | undefined, mock: boolean): SourceType {
  if (mock) return 'MOCK'
  if (meta?.sourceType) return String(meta.sourceType).toUpperCase() as SourceType
  return 'CAPTURE'
}

function contractMeta(
  meta: MarketInsightRelationScatterAdapterMeta | undefined,
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

function relationStatus(dataset: RelationScatterDataset, meta?: MarketInsightRelationScatterAdapterMeta) {
  if (!hasScatterPoints(dataset)) return 'missing' as const
  return meta?.mock === true || normalizeBasis(meta) === 'synthetic' ? 'mock' as const : 'real' as const
}

function defaultSource(kind: MarketInsightRelationKind, runDate: string): string {
  return `${MARKET_INSIGHT_RELATION_FAMILY}/${kind === 'renewable' ? '_list24__' : 'fhlist24__'}${runDate}`
}

function blockKey(kind: MarketInsightRelationKind): MarketInsightRelationScatterBlock['key'] {
  return kind === 'renewable' ? 'price_renewable_relation' : 'price_load_relation'
}

function blockLabel(kind: MarketInsightRelationKind): MarketInsightRelationScatterBlock['label'] {
  return kind === 'renewable' ? '价格-新能源关系' : '价格-负荷关系'
}

function xMetric(kind: MarketInsightRelationKind): MarketInsightRelationScatterBlock['xMetric'] {
  return kind === 'renewable' ? 'new_energy_actual' : 'load_actual'
}

function dimensions(kind: MarketInsightRelationKind): RelationScatterDimension[] {
  if (kind === 'load') {
    return [{ id: 'zrxgx2.load', title: '统调负荷', sourceKey: 'xnyzd' }]
  }
  return [
    { id: 'zrxgx.xnyzd', title: '新能源最大出力', sourceKey: 'xnyzd' },
    { id: 'zrxgx.xnyg', title: '新能源高出力', sourceKey: 'xnyg' },
    { id: 'zrxgx.xnygd', title: '新能源高低出力差', sourceKey: 'xnygd' }
  ]
}

export function toMarketInsightRelationScatterContract(
  input: MarketInsightRelationScatterAdapterInput
): MarketInsightRelationScatterContract {
  const dataset = normalizeDataset(input.payload)
  const status = relationStatus(dataset, input.meta)
  const source = status === 'missing' ? null : input.source ?? defaultSource(input.kind, input.runDate)
  const availability: ModuleAvailabilityItem[] = [{
    key: `market_insight.${blockKey(input.kind)}`,
    label: blockLabel(input.kind),
    status,
    source,
    ...(status === 'missing' ? { note: '关系散点输入未提供可转换的 24 小时散点' } : {})
  }]
  const block: MarketInsightRelationScatterBlock = {
    key: blockKey(input.kind),
    label: blockLabel(input.kind),
    status,
    source,
    runDate: input.runDate,
    days: input.days,
    priceMode: input.priceMode,
    xMetric: xMetric(input.kind),
    dataset,
    dimensions: dimensions(input.kind),
    notes: input.notes ?? []
  }
  return {
    ...contractMeta(input.meta, availability),
    group: 'market_insight',
    blocks: { relation_scatter: block }
  }
}
