// 市场洞察时间区间与聚合内核类型（#2993）。数值均为规范十进制字符串。

export declare const INTERNAL_PLACES: number
export type Slot = { startMs: number; endMs: number; value: string }
export type SeriesQuality = { missingValues: number; nonFinite: number; duplicates: number; conflicts: number[]; outOfWindow: number }
export type NormalizedSeries = { resolutionMinutes: number; slots: Map<number, Slot>; quality: SeriesQuality }
export type Bucket = { startMs: number; endMs: number; value: string | null; expectedSlots: number; validSlots: number; missingSlots: number; conflictSlots: number }
export type AggregatedSeries = { method: 'time-weighted-mean' | 'sum'; buckets: Bucket[] }
export type WindowLike = { start: string; end: string }

export declare function toBeijingIso(ms: number): string
export declare function businessDayRange(date: string): { startMs: number; endMs: number }
export declare function slotInterval(input: { date: string; time?: string | null; resolutionMinutes: number; slotLabel?: string }): { startMs: number; endMs: number }
export declare function expectedSlotStarts(window: WindowLike, resolutionMinutes: number): number[]
export declare function normalizeSeries(
  points: Array<{ date: string; time?: string | null; value: unknown }>,
  spec: { resolutionMinutes: number; slotLabel?: string; window?: WindowLike },
): NormalizedSeries
export declare function timeWeightedMean(items: Array<{ value: string | null | undefined; durationMinutes: number }>): string | null
export declare function aggregateSeries(series: NormalizedSeries, options: { targetMinutes: number; measureKind: string; window: WindowLike }): AggregatedSeries
export declare function powerToEnergy(series: NormalizedSeries, options: { powerSemantics: string }): Slot[]
export declare function commonSlots(
  a: NormalizedSeries | AggregatedSeries,
  b: NormalizedSeries | AggregatedSeries,
): { pairs: Array<{ startMs: number; endMs: number; a: string; b: string }>; aValid: number; bValid: number; common: number }
