// S2 基本面库客户端：对接 /api/v1/market/fundamentals（PG market schema · 迁移 012）。
//
// 每个数值带来源（sourceKind）与可信度——这是"给 AI 的数据可信链"的前端一端：
// 展示时标来源徽章，注入 AI 上下文时按来源区分"数据"与"假设"。
import { apiGet, apiPut } from '@/services/api'

export type FundamentalField =
  | 'dispatchable_max_mw'
  | 'renewable_forecast_mw'
  | 'net_import_mw'
  | 'system_load_mw'
  | 'export_plan_mw'
  | 'reserve_mw'

export type SourceKind = 'dispatch' | 'capture' | 'company' | 'manual'

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  dispatch: '调度',
  capture: '采集',
  company: '公司口径',
  manual: '人工'
}

/** AI 上下文口径：只有 dispatch/capture 算"数据"，company/manual 算"假设/自报口径"。 */
export function isTrustedSource(kind: SourceKind | null | undefined): boolean {
  return kind === 'dispatch' || kind === 'capture'
}

export type FundamentalEntry = {
  slot_label: string
  field: FundamentalField
  value_mw: number
  source_kind: SourceKind
  credibility: 'A' | 'B' | 'C' | 'D'
  note: string | null
  entered_by: string
  entered_at: string
}

export async function fetchFundamentals(region: string, date: string): Promise<FundamentalEntry[]> {
  const res = await apiGet<{ data: { entries: FundamentalEntry[] } }>('/v1/market/fundamentals', { region, date })
  const data = (res as { data?: { entries?: FundamentalEntry[] } }).data
  return data?.entries ?? []
}

export type FundamentalUpsert = {
  slot: string
  field: FundamentalField
  valueMw: number
  sourceKind: SourceKind
  credibility?: 'A' | 'B' | 'C' | 'D'
  note?: string
}

export async function saveFundamentals(region: string, date: string, entries: FundamentalUpsert[]): Promise<number> {
  const res = await apiPut<{ data: { saved: number } }>('/v1/market/fundamentals', { region, date, entries })
  return (res as { data?: { saved?: number } }).data?.saved ?? 0
}
