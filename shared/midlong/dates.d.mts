// 中长期合同日期与交割期的类型侧伴随定义（#2938）。运行时见 dates.mjs。
import type { DeliveryProgress } from './contract.mjs'

export declare function isIsoDate(value: unknown): boolean
export declare function normalizeDate(value: unknown): string | null
export declare function isMonthKey(value: unknown): boolean
export declare function normalizeMonth(value: unknown): string | null
export declare function monthKeyOf(isoDate: string | null | undefined): string | null
export declare function monthFirstDay(monthKey: string): string | null
export declare function monthLastDay(monthKey: string): string | null
export declare function monthsBetween(startMonth: string, endMonth: string): string[]
export declare function deliveryMonths(deliveryStart: string | null | undefined, deliveryEnd: string | null | undefined): string[]
export declare function beijingToday(now?: number): string
export declare function nextDay(isoDate: string): string | null
export declare function beijingMidnightInstant(isoDate: string): string | null
export type BeijingInstantFailureReason = 'FORMAT' | 'MONTH' | 'DAY' | 'HOUR' | 'MINUTE' | 'SECOND' | 'OFFSET'
export declare function parseBeijingInstant(value: unknown): { ok: true; date: Date } | { ok: false; reason: BeijingInstantFailureReason }
export declare function deliveryInterval(deliveryStart: string, deliveryEnd: string): { startInclusive: string; endExclusive: string } | null
export declare function deliveryProgress(deliveryStart: string | null | undefined, deliveryEnd: string | null | undefined, today?: string): DeliveryProgress
export declare function rangesIntersect(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean
