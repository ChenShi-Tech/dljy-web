import type { ModuleAvailabilityItem, ModuleAvailabilityStatus, ModuleContractBasis, ModuleContractMeta } from './common'
import type { DataSourceBasis, SourceType } from '../types'

export const SPOT_DAY_AHEAD_REPORT_FAMILY = 'sdpt_zrqsb'
export const SPOT_DAY_AHEAD_ENERGY_FAMILY = 'sdpt_zptqx'
export const SPOT_DAY_AHEAD_ENERGY_MATCH = 'list'

export type SpotTradingAdapterMeta = Partial<Omit<
  ModuleContractMeta,
  'basis' | 'sourceType' | 'productionWrite' | 'data_availability'
>> & {
  basis?: DataSourceBasis
  sourceType?: SourceType | string
  productionWrite?: boolean
}

export type DayAheadReportGroupKey = 'dl' | 'jg' | 'jgc' | 'zcqjj' | 'jq' | 'jq2' | 'cl' | 'zxcl'

/**
 * sdpt 采集宽表点位取值：数值为主，保留字符串数字与空位（采集 JSON 未做数值保证，
 * 视图层既有 Number() 防御即为此）。
 */
export type SpotDayAheadPointValue = number | string | null

/**
 * sdpt_* 采集宽表原始行（p1..p96 + 汇总/口径字段）的窄类型，替换此前的
 * Record<string, unknown>（视图层曾因此整行 any）。字段按消费路径观测收敛；
 * 点位读取统一走 `p${number}` 键（PTS_96 / pointKey），出现新字段时在此登记。
 */
export type SpotDayAheadRow = {
  /** 宽表口径 type（字典键，见 DECLARATION_QTY/PRICE_TYPE_CODES） */
  type?: number | string
  /** 合计（日前上报行；预估行的合计在 total） */
  hj?: SpotDayAheadPointValue
  /** 96 个 15 分钟点位 p1..p96 */
  [point: `p${number}`]: SpotDayAheadPointValue | undefined
}

export type DayAheadReportRow = SpotDayAheadRow
export type DayAheadEnergyRow = SpotDayAheadRow & {
  /** 运行日（YYYY-MM-DD；契约层 type=4 归一行的必有字段，缺失行已被过滤） */
  date: string
  /** 售电公司 */
  sdgs?: string
  /** 日合计 */
  total?: SpotDayAheadPointValue
}

export type SpotDayAheadReportBlock = {
  key: 'day_ahead_report'
  label: '日前上报'
  status: ModuleAvailabilityStatus
  source: string | null
  date: string
  groups: Record<DayAheadReportGroupKey, DayAheadReportRow[]>
  notes: string[]
}

export type SpotDayAheadReportContract = ModuleContractMeta & {
  group: 'spot_trading'
  blocks: {
    day_ahead_report: SpotDayAheadReportBlock
  }
}

export type SpotDayAheadEnergyBlock = {
  key: 'day_ahead_energy'
  label: '日前电量预估'
  status: ModuleAvailabilityStatus
  source: string | null
  rows: DayAheadEnergyRow[]
  notes: string[]
}

export type SpotDayAheadEnergyContract = ModuleContractMeta & {
  group: 'spot_trading'
  blocks: {
    day_ahead_energy: SpotDayAheadEnergyBlock
  }
}

const REPORT_GROUPS: DayAheadReportGroupKey[] = ['dl', 'jg', 'jgc', 'zcqjj', 'jq', 'jq2', 'cl', 'zxcl']

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asPayloadRecord(payload: unknown): Record<string, unknown> {
  const body = asRecord(payload)
  const data = asRecord(body.data)
  return Object.keys(data).length ? data : body
}

function envelopeRows(payload: unknown): Array<Record<string, unknown>> {
  const body = asRecord(payload)
  const raw = Array.isArray(body.rows) ? body.rows : Array.isArray(body.data) ? body.data : Array.isArray(payload) ? payload : []
  return raw.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
}

function normalizeBasis(meta?: SpotTradingAdapterMeta): ModuleContractBasis {
  if (meta?.mock === true) return 'synthetic'
  return meta?.basis === 'real' || meta?.basis === 'captured' ? 'captured' : 'synthetic'
}

function sourceTypeOf(meta: SpotTradingAdapterMeta | undefined, mock: boolean): SourceType {
  if (mock) return 'MOCK'
  if (meta?.sourceType) return String(meta.sourceType).toUpperCase() as SourceType
  return 'CAPTURE'
}

function contractMeta(meta: SpotTradingAdapterMeta | undefined, availability: ModuleAvailabilityItem[]): ModuleContractMeta {
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

function statusFrom(hasData: boolean, meta?: SpotTradingAdapterMeta): ModuleAvailabilityStatus {
  if (!hasData) return 'missing'
  return meta?.mock === true || normalizeBasis(meta) === 'synthetic' ? 'mock' : 'real'
}

export function toSpotDayAheadReportContract(input: {
  payload: unknown
  date: string
  match: string
  meta?: SpotTradingAdapterMeta
}): SpotDayAheadReportContract {
  const raw = asPayloadRecord(input.payload)
  const groups = Object.fromEntries(
    REPORT_GROUPS.map((key) => [key, Array.isArray(raw[key]) ? raw[key] as DayAheadReportRow[] : []])
  ) as Record<DayAheadReportGroupKey, DayAheadReportRow[]>
  const hasData = REPORT_GROUPS.some((key) => groups[key].length > 0)
  const status = statusFrom(hasData, input.meta)
  const source = status === 'missing' ? null : `${SPOT_DAY_AHEAD_REPORT_FAMILY}/${input.match}`
  const availability: ModuleAvailabilityItem[] = [{
    key: 'spot.day_ahead_report',
    label: '日前上报',
    status,
    source,
    ...(status === 'missing' ? { note: '当前地区未提供可转换的日前上报曲线' } : {})
  }]
  return {
    ...contractMeta(input.meta, availability),
    group: 'spot_trading',
    blocks: {
      day_ahead_report: {
        key: 'day_ahead_report',
        label: '日前上报',
        status,
        source,
        date: input.date,
        groups,
        notes: [
          '日前上报由 sdpt_zrqsb 按日 hash 文档适配为 96 点电量/价格/策略分组。',
          '非 available 地区按能力注册表返回 missing 契约，不发起跨地区或 Mock 回放请求。'
        ]
      }
    }
  }
}

export function toSpotDayAheadEnergyContract(input: {
  payload: unknown
  meta?: SpotTradingAdapterMeta
}): SpotDayAheadEnergyContract {
  // 契约边界归一：type=4 之外的原始行不承诺 DayAheadEnergyRow 形状（如必有 date），
  // 过滤后才断言为预估行。
  const rows = envelopeRows(input.payload)
    .filter((row) => String(row.type) === '4')
    .map((row) => row as DayAheadEnergyRow)
  const status = statusFrom(rows.length > 0, input.meta)
  const source = status === 'missing' ? null : `${SPOT_DAY_AHEAD_ENERGY_FAMILY}/${SPOT_DAY_AHEAD_ENERGY_MATCH}`
  const availability: ModuleAvailabilityItem[] = [{
    key: 'spot.day_ahead_energy',
    label: '日前电量预估',
    status,
    source,
    ...(status === 'missing' ? { note: '当前地区未提供 type=4 预估电量行' } : {})
  }]
  return {
    ...contractMeta(input.meta, availability),
    group: 'spot_trading',
    blocks: {
      day_ahead_energy: {
        key: 'day_ahead_energy',
        label: '日前电量预估',
        status,
        source,
        rows,
        notes: [
          '日前电量预估由 sdpt_zptqx/list 过滤 type=4 行后适配为表格与 96 点曲线。',
          '非 available 地区按能力注册表返回 missing 契约，不发起跨地区或 Mock 回放请求。'
        ]
      }
    }
  }
}
