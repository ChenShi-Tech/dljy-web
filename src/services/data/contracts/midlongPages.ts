import type { ModuleAvailabilityItem, ModuleAvailabilityStatus, ModuleContractBasis, ModuleContractMeta } from './common'
import type { DataSourceBasis, SourceType } from '../types'

export const MIDLONG_INTER_PROVINCIAL_FAMILY = 'sdpt_zptjg'
export const MIDLONG_INTER_PROVINCIAL_MATCH = 'list_tag92_full'

export type MidlongPagesAdapterMeta = Partial<Omit<
  ModuleContractMeta,
  'basis' | 'sourceType' | 'productionWrite' | 'data_availability'
>> & {
  basis?: DataSourceBasis
  sourceType?: SourceType | string
  productionWrite?: boolean
}

export type MidlongInterProvincialPlanRow = {
  date: string
  importDate: string
  averageMwh: number | null
  totalMwh: number | null
  points96: Array<number | null>
}

export type MidlongInterProvincialBlock = {
  key: 'inter_provincial_tag92'
  label: '省间中长期交易电量计划'
  status: ModuleAvailabilityStatus
  source: string | null
  rows: MidlongInterProvincialPlanRow[]
  notes: string[]
}

export type MidlongInterProvincialContract = ModuleContractMeta & {
  group: 'midlong'
  blocks: {
    inter_provincial: MidlongInterProvincialBlock
  }
}

type RawPlanRow = Record<string, unknown> & {
  date?: unknown
  jyrq?: unknown
  drrq?: unknown
  jz?: unknown
  hj?: unknown
}

function asRows(payload: unknown): RawPlanRow[] {
  const body = (payload ?? {}) as { data?: unknown; rows?: unknown }
  const data = body.data && typeof body.data === 'object' ? body.data : payload
  if (Array.isArray(body.rows)) return body.rows as RawPlanRow[]
  if (Array.isArray(data)) return data as RawPlanRow[]
  if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)) {
    return (data as { rows: RawPlanRow[] }).rows
  }
  return []
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function stringOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function normalizeBasis(meta?: MidlongPagesAdapterMeta): ModuleContractBasis {
  if (meta?.mock === true) return 'synthetic'
  return meta?.basis === 'real' || meta?.basis === 'captured' ? 'captured' : 'synthetic'
}

function sourceTypeOf(meta: MidlongPagesAdapterMeta | undefined, mock: boolean): SourceType {
  if (mock) return 'MOCK'
  if (meta?.sourceType) return String(meta.sourceType).toUpperCase() as SourceType
  return 'CAPTURE'
}

function contractMeta(meta: MidlongPagesAdapterMeta | undefined, availability: ModuleAvailabilityItem[]): ModuleContractMeta {
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

function statusFrom(rows: MidlongInterProvincialPlanRow[], meta?: MidlongPagesAdapterMeta): ModuleAvailabilityStatus {
  if (!rows.length) return 'missing'
  return meta?.mock === true || normalizeBasis(meta) === 'synthetic' ? 'mock' : 'real'
}

function normalizeRow(row: RawPlanRow): MidlongInterProvincialPlanRow | null {
  const date = stringOf(row.date ?? row.jyrq)
  if (!date) return null
  return {
    date,
    importDate: stringOf(row.drrq),
    averageMwh: numberOrNull(row.jz),
    totalMwh: numberOrNull(row.hj),
    points96: Array.from({ length: 96 }, (_, index) => numberOrNull(row[`p${index + 1}`]))
  }
}

export function toMidlongInterProvincialContract(input: {
  payload: unknown
  meta?: MidlongPagesAdapterMeta
}): MidlongInterProvincialContract {
  const rows = asRows(input.payload)
    .map(normalizeRow)
    .filter((item): item is MidlongInterProvincialPlanRow => Boolean(item))
  const status = statusFrom(rows, input.meta)
  const source = status === 'missing' ? null : `${MIDLONG_INTER_PROVINCIAL_FAMILY}/${MIDLONG_INTER_PROVINCIAL_MATCH}`
  const availability: ModuleAvailabilityItem[] = [{
    key: 'midlong.inter_provincial_tag92',
    label: '省间中长期交易电量计划',
    status,
    source,
    ...(status === 'missing' ? { note: 'tag92 list_tag92_full 未提供可转换的 96 点省间计划行' } : {})
  }]
  return {
    ...contractMeta(input.meta, availability),
    group: 'midlong',
    blocks: {
      inter_provincial: {
        key: 'inter_provincial_tag92',
        label: '省间中长期交易电量计划',
        status,
        source,
        rows,
        notes: [
          'tag92 省间计划按地区隔离读取 sdpt_zptjg/list_tag92_full。',
          '云南该族由南网披露/现货派生产物支撑；契约层不回退山西口径。'
        ]
      }
    }
  }
}
