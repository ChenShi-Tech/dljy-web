// 市场洞察来源语义登记类型（#2993）。
import type { MarketPhase, PriceObject } from './contract.mjs'

export type MeasureKind = 'price' | 'power' | 'energy' | 'amount' | 'ratio' | 'capacity' | 'count' | 'flag' | 'list'
export type PowerSemantics = 'interval-average' | 'instant' | 'unknown'
export type BusinessScope = 'yunnan' | 'csg-aggregate' | 'csg-multi-region' | 'plant' | 'node'
export type AccessScope = 'public' | 'company'
export type VersionPolicy = 'single' | 'owner-latest' | 'status-axis'
export type FreshnessCadence = 'daily' | 'historical-package' | 'monthly-package' | 'unregistered'

export type SourceRead =
  | { kind: 'capture'; family: string; datasetKey: string; rowFilter?: Record<string, string> }
  | { kind: 'serving'; datasetId: string; region: string }
  | { kind: 'private-api'; resource: string; ownerCompanyId: string; dataset?: string; payloadFields?: Readonly<Record<string, string>> }

export type InsightSource = {
  sourceId: string
  title: string
  read: SourceRead
  businessScope: BusinessScope
  accessScope: AccessScope
  accessNote: string | null
  authority: string
  ingestChannel: string
  measure: { kind: MeasureKind; unit: string; inputUnit: string; factor: string; powerSemantics?: PowerSemantics; valueField?: string; fields?: readonly SourceField[] }
  /** targetDateField + leadDays：预测按目标日定位；ref_date（发布日）= 目标日 − leadDays。
   *  businessPeriod: 'month' —— 月周期资料（月结等），行日期是月份标记（如 2026-05），按月落窗与计覆盖 */
  time: { resolutionMinutes: 15 | 60 | 1440; slotLabel: 'interval-start' | 'business-day'; dateField?: string; timeField?: string; targetDateField?: string; leadDays?: number; businessPeriod?: 'month' }
  variant: 'actual' | 'forecast' | null
  marketPhase: MarketPhase | null
  priceObject: PriceObject | null
  knownAt: string | null
  dimensions: readonly string[]
  objectDimension: string | null
  precision: { places: number }
  versionPolicy: VersionPolicy
  freshness: FreshnessCadence
  /** 供需类别（系统曲线与送受电）；其他来源为 null */
  category: SupplyCategory | null
}

export type SupplyCategory = 'load' | 'hydro' | 'new-energy' | 'non-market' | 'total-generation' | 'transfer'
export declare const SUPPLY_CATEGORIES: readonly SupplyCategory[]
export type SourceField = { id: string; valueField: string; unit: string; kind: MeasureKind }
export declare function sourceFields(source: InsightSource): SourceField[]
export declare const MEASURE_KINDS: readonly MeasureKind[]
export declare const RECORD_KINDS: readonly MeasureKind[]
export declare const POWER_SEMANTICS: readonly PowerSemantics[]
export declare const BUSINESS_SCOPES: readonly BusinessScope[]
export declare const ACCESS_SCOPES: readonly AccessScope[]
export declare const VERSION_POLICIES: readonly VersionPolicy[]
export declare const FRESHNESS_CADENCES: readonly FreshnessCadence[]
export declare const INSIGHT_SOURCES: readonly InsightSource[]
export declare function getInsightSource(sourceId: string): InsightSource | null
export declare function listInsightSources(filter?: Partial<InsightSource>): InsightSource[]
export declare function validateInsightSources(sources?: readonly InsightSource[]): string[]
