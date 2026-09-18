// 读取版本集合与结果版本类型（#2993）。
import type { ExpectedResult } from './contract.mjs'

export type ReadSetSource = { sourceId: string; versionToken: string; window?: { start: string; end: string } | null; rowCount?: number | null }
export type ReadSet = {
  schema: 'insight-read-set/v1'
  sources: Required<ReadSetSource>[]
  mappingVersion: string | null
  metricVersions: Record<string, string>
  methodVersion: string
}
export type ExpectedVerdict = { status: 'match' | 'conflict' | 'expired' | 'unverifiable'; reason?: string }
export declare function canonicalJson(value: unknown): string
export declare function buildReadSet(input: { sources: ReadSetSource[]; mappingVersion?: string | null; metricVersions?: Record<string, string>; methodVersion: string }): ReadSet
export declare function resultVersionInput(input: { readSetRef: string; analysisId: string; analysisVersion: string; scope: unknown; filters: unknown; data: unknown }): Record<string, unknown>
export declare function checkExpectedResult(input: { expected: (ExpectedResult & { expiresAt?: string | null }) | null; current: { resultVersion?: string; readSetRef?: string } | null; now?: number }): ExpectedVerdict
export declare function assertExpectedResult(input: { expected: (ExpectedResult & { expiresAt?: string | null }) | null; current: { resultVersion?: string; readSetRef?: string } | null; now?: number }): ExpectedVerdict
