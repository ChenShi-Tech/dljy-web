// 覆盖与共同样本类型（#2993）。
import type { NormalizedSeries, WindowLike } from './intervals.mjs'

export type DateRange = { start: string; end: string; days: number }
export type SeriesCoverage = {
  resolutionMinutes: number
  expectedSlots: number
  validSlots: number
  missingSlots: number
  conflictSlots: number
  excludedValues: number
  missingValueRows: number
  duplicateRows: number
  completeDates: string[]
  partialDates: string[]
  emptyDates: string[]
}
export type ObjectCoverage = {
  denominatorBasis: 'registered-asset-set' | 'authorized-observed-objects'
  expectedObjects: number | null
  observedObjects: number
  missingObjects: string[] | null
  unmappedNames: string[]
}
export type AnalysisCandidates = {
  dates: string[]
  ranges: DateRange[]
  discrete: boolean
  perInput: Array<{ sourceId: string; required: boolean; dates: number; ranges: DateRange[] }>
  reason: null | 'no-required-input' | 'no-common-window'
}
export declare function businessDates(window: WindowLike): string[]
export declare function seriesCoverage(series: NormalizedSeries, window: WindowLike): SeriesCoverage
export declare function objectCoverage(input: { registeredObjects?: string[] | null; observedObjects: string[]; unmappedNames?: string[] }): ObjectCoverage
export declare function commonObjectSample(left: Iterable<string>, right: Iterable<string>): { leftCount: number; rightCount: number; common: string[]; commonCount: number; onlyLeft: string[]; onlyRight: string[] }
export declare function dateRanges(dates: string[]): DateRange[]
export declare function analysisCandidates(inputs: {
  required: Array<{ sourceId: string; completeDates: string[] }>
  optional?: Array<{ sourceId: string; completeDates: string[] }>
}): AnalysisCandidates
