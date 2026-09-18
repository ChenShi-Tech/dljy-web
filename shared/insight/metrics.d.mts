// 指标定义、生效版本与排名资格类型（#2993）。
export type RuleKind = 'official' | 'analysis-default' | 'user'
export type RoundingMode = 'half-away-from-zero'
export type MetricEffective = { from: string | null; to: string | null; params: Record<string, unknown> }
export type MetricDefinition = {
  metricId: string
  version: string
  label: string
  unit: string
  places: number
  formula: string
  basis: string
  source?: string
  rounding: RoundingMode
  ruleKind: RuleKind
  eligibility: { minSamples: number; minCoverageRatio: string }
  effective: readonly MetricEffective[]
}
export declare const RULE_KINDS: readonly RuleKind[]
export declare const ROUNDING_MODES: readonly RoundingMode[]
export declare const INSIGHT_METRICS: readonly MetricDefinition[]
export declare function getMetricDefinition(metricId: string): MetricDefinition | null
export declare function validateMetricDefinitions(list?: readonly Partial<MetricDefinition>[]): string[]
export declare function resolveEffectiveSegments(
  metricOrId: string | Pick<MetricDefinition, 'effective'>,
  window: { start: string; end: string },
): Array<{ start: string; end: string; effective: MetricEffective | null; reason: null | 'no-historical-basis' }>
export declare function formatMetricValue(metricId: string, value: string | number | null | undefined): string | null
export declare function rankEligible(
  items: Array<{ objectId: string; value: string | null; samples: number; coverageRatio: string }>,
  options: { metricId: string; direction: 'asc' | 'desc' },
): {
  metricId: string
  definitionVersion: string
  eligibility: { minSamples: number; minCoverageRatio: string }
  ranked: Array<{ objectId: string; value: string; rank: number; tied: boolean }>
  ineligible: Array<{ objectId: string; reason: 'no-value' | 'insufficient-samples' | 'insufficient-coverage'; [key: string]: unknown }>
}
