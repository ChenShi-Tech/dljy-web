// 规范结果、语义选区、交接与接收反馈类型（#2993）。
import type { AnalysisMode, MarketPhase, ObjectRef, PriceObject } from './contract.mjs'

export declare const HANDOFF_SCHEMA: 'insight-handoff/v1'
export declare const SELECTION_SCHEMA: 'insight-selection/v1'
export declare const RECEIPT_SCHEMA: 'insight-receipt/v1'
export declare const RESULT_DATA_SCHEMA: 'insight-result-data/v1'
export type ReceiptStatus = 'accepted' | 'partial' | 'rejected' | 'unavailable'
export type FieldDecision = 'accepted' | 'dropped' | 'rejected'
export type ActionIntent = 'read' | 'save'
export declare const RECEIPT_STATUSES: readonly ReceiptStatus[]
export declare const FIELD_DECISIONS: readonly FieldDecision[]
export declare const ACTION_INTENTS: readonly ActionIntent[]

export type ResultRef = { queryId: string; resultVersion: string; readSetRef: string; expiresAt: string | null }
export type TimeInterval = { start: string; end: string }
export type MetricRef = { id: string; definitionVersion: string }
export type InsightSelection = {
  schemaVersion: string
  resultRef: ResultRef
  regionId: string
  companyId: string | null
  objectRefs: ObjectRef[]
  timeIntervals: TimeInterval[]
  metricRefs: MetricRef[]
  recordRefs: string[]
  priceObject: PriceObject | null
  marketPhase: MarketPhase | null
  sourceIds: string[]
  contextVersion: number
}
export type InsightHandoff = {
  schemaVersion: string
  handoffId: string
  originModule: string
  actionId: string
  contextVersion: number
  resultRef: ResultRef | null
  scope: { regionId: string; companyId: string | null; objectRefs: ObjectRef[] }
  businessWindow: { start: string; end: string; timeZone?: string; nativeResolutionMinutes?: number }
  metricRefs: MetricRef[]
  priceObject: PriceObject | null
  marketPhase: MarketPhase | null
  sourceIds: string[]
  selection: InsightSelection | null
  analysisMode: AnalysisMode
  asOf: string | null
  evidenceRefs: string[]
  viewRef: string | null
  returnContext: { pageId: string; filters: Record<string, unknown>; viewState: Record<string, unknown> }
}
export type InsightReceipt = {
  schemaVersion: 'insight-receipt/v1'
  status: ReceiptStatus
  fieldDecisions: Array<{ field: string; decision: FieldDecision; reason?: string }>
  reason: string | null
  target: unknown
  returnContext: unknown
}
export type InsightAction = {
  actionId: string
  targetModule: string
  acceptedSchemas: readonly string[]
  requiredInputs: readonly string[]
  intent: ActionIntent
  available: boolean
  unavailableReason: string | null
}
export type ResultData = {
  schemaVersion: string
  dimensions: Array<{ id: string; kind: 'time' | 'object' | 'category'; unit?: string }>
  measures: Array<{ id: string; unit: string; metricRef?: string; precision?: number }>
  rows: Array<Record<string, unknown>>
  sampling?: { method: string; population: number; shown?: number }
}

export declare function assertSchemaVersion(value: unknown, expected: string): void
export declare function parseSelection(input: unknown): InsightSelection
export declare function isSelectionCurrent(selection: InsightSelection, current: { regionId: string; companyId?: string | null; contextVersion: number; resultVersion: string }): boolean
export declare function parseHandoff(input: unknown): InsightHandoff
export declare function buildReceipt(input: { status: ReceiptStatus; fieldDecisions?: Array<{ field: string; decision: FieldDecision; reason?: string }>; reason?: string | null; target?: unknown; returnContext?: unknown }): InsightReceipt
export declare function defineInsightAction(input: { actionId: string; targetModule: string; acceptedSchemas?: string[]; requiredInputs?: string[]; intent?: ActionIntent; available?: boolean; unavailableReason?: string | null }): InsightAction
export declare function checkActionInput(action: InsightAction, handoff: InsightHandoff): InsightReceipt | null
export declare function assertResultData(data: unknown): ResultData
