// 手写类型面（与 registry.mjs 同步维护；TS 消费方：单测与后续 #2038/#2039 前端）

export type ReviewDimension = 'result' | 'strategy' | 'market' | 'deviation' | 'risk' | 'decision'
export type ReviewSubject = 'common' | 'storage' | 'retail' | 'renewable'
export type ReviewCadence = 'event' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'continuous'
export type AutomationTier = 'A' | 'B' | 'C'
export type ReadinessState = 'ready' | 'data_gap' | 'deferred'
export type FieldFill = 'auto' | 'human' | 'ai_suggest'

export interface ReviewSource {
  readonly id: string
  readonly kind: 'endpoint' | 'dataset' | 'service' | 'rules' | 'pg' | 'manual'
  readonly desc: string
}

export interface ReviewTemplateField {
  readonly key: string
  readonly label: string
  readonly fill: FieldFill
  readonly source?: string
  readonly required?: boolean
  readonly caliber?: 'self-computed'
}

export interface ReviewTemplate {
  readonly id: string
  readonly name: string
  readonly dimension: ReviewDimension
  readonly subject: ReviewSubject
  readonly cadences: readonly ReviewCadence[]
  readonly automation: AutomationTier
  readonly readiness: ReadinessState
  readonly trigger: string
  readonly deadline: string
  readonly roles: { readonly fill: string; readonly review: string }
  readonly retentionYears: number
  readonly slots24?: boolean
  readonly notes?: string
  readonly gapNote?: string
  readonly fields: readonly ReviewTemplateField[]
}

export declare const DIMENSIONS: Readonly<Record<ReviewDimension, string>>
export declare const SUBJECTS: Readonly<Record<ReviewSubject, string>>
export declare const CADENCES: readonly ReviewCadence[]
export declare const AUTOMATION_TIERS: readonly AutomationTier[]
export declare const READINESS_STATES: readonly ReadinessState[]
export declare const SOURCE_CATALOG: readonly ReviewSource[]
export declare const REVIEW_TEMPLATES: readonly ReviewTemplate[]
export declare const TEMPLATE_IDS: readonly string[]

export declare function templateById(id: string): ReviewTemplate | null
export declare function templatesByCadence(cadence: ReviewCadence): ReviewTemplate[]
export declare function templatesBySubject(
  subject: ReviewSubject,
  opts?: { includeCommon?: boolean },
): ReviewTemplate[]
export declare function templatesByDimension(dimension: ReviewDimension): ReviewTemplate[]
export declare function readinessSummary(): Readonly<{
  ready: number
  data_gap: number
  deferred: number
  total: number
}>
