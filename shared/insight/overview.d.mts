// 市场总览区块清单与重点事项规则类型（#3006）。
import type { InsightView } from './analyses.mjs'

export type OverviewBlock = { blockId: string; title: string; analysisId: string; view: InsightView; drilldownPageId?: string }
export type KeyItemRule = {
  ruleId: string
  title: string
  description: string
  ruleKind: 'analysis-default'
  thresholds: Readonly<Record<string, string>>
  drilldown: { analysisId: string; view: InsightView }
}
/** 结果 data.items 的单条重点事项 */
export type KeyItem = {
  itemId: string
  rank: number
  ruleId: string
  title: string
  ruleKind: 'analysis-default'
  statement: string
  object: Record<string, string>
  interval: { start: string; end: string }
  observation: { metricId: string; value: string; unit: string; [key: string]: unknown }
  baseline: { kind: 'threshold' | 'window-quantile' | 'previous-day-same-progress'; [key: string]: unknown }
  coverage: Record<string, string>
  severity: string
  drilldown: { analysisId: string; view: InsightView; window: { start: string; end: string } }
}
/** 结果 data.rules 的规则评估：没有触发也要能看到为什么 */
export type KeyItemRuleEvaluation = {
  ruleId: string
  title: string
  ruleKind: 'analysis-default'
  thresholds: Readonly<Record<string, string>>
  description: string
  status: 'triggered' | 'not-triggered' | 'insufficient-data' | 'not-applicable'
  reason: string | null
  triggered: number
}
export declare const OVERVIEW_BLOCKS: readonly OverviewBlock[]
export declare const KEY_ITEM_LIMIT: number
export declare const KEY_ITEM_RULES: readonly KeyItemRule[]
export declare function getKeyItemRule(ruleId: string): KeyItemRule | null
