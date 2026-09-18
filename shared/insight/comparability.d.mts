// 可比性判定类型（#2993）。
import type { ComparabilityStatus, ComparabilityReason, ObjectRef } from './contract.mjs'

export type ComparisonPurpose = 'spread' | 'forecast-error' | 'basis' | 'sum' | 'correlation'
export type ComparableInput = string | { sourceId: string; objectRef?: ObjectRef | null } | Record<string, unknown>
export type ComparabilityResult = { status: ComparabilityStatus; reasons: ComparabilityReason[] }
export declare const COMPARISON_PURPOSES: readonly ComparisonPurpose[]
export declare function assessComparability(left: ComparableInput, right: ComparableInput, options: { purpose: ComparisonPurpose }): ComparabilityResult
export declare function assessAll(inputs: ComparableInput[], options: { purpose: ComparisonPurpose }): ComparabilityResult
