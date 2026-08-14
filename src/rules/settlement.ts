// 结算规则规格注册表与计算助手（P2 结算规则参数化）。
// 消费点从这里读取当前地区的可执行结算参数；未沉淀规格的地区返回 null，
// 消费点必须保留可见的"未参数化"降级（不得静默用别省参数）。
import type { RuleDocumentStatus, SettlementRuleSpec } from './types'
import { shanxiSettlementRuleSpec } from './provinces/shanxi/settlement'
import { yunnanSettlementRuleSpec } from './provinces/yunnan/settlement'
import { shandongSettlementRuleSpec } from './provinces/shandong/settlement'
import { guangdongSettlementRuleSpec } from './provinces/guangdong/settlement'
import { gansuSettlementRuleSpec } from './provinces/gansu/settlement'

const SPECS: Record<string, SettlementRuleSpec> = {
  shanxi: shanxiSettlementRuleSpec,
  yunnan: yunnanSettlementRuleSpec,
  shandong: shandongSettlementRuleSpec,
  guangdong: guangdongSettlementRuleSpec,
  gansu: gansuSettlementRuleSpec
}

export function getSettlementRuleSpec(regionId: string): SettlementRuleSpec | null {
  return SPECS[regionId] ?? null
}

export function listSettlementRuleSpecs(): SettlementRuleSpec[] {
  return Object.values(SPECS)
}

/** 按规格口径计算考核基准价（元/MWh）。 */
export function assessmentPriceOf(spec: SettlementRuleSpec, daPrice: number, rtPrice: number): number {
  const da = Number(daPrice) || 0
  const rt = Number(rtPrice) || 0
  let basis: number
  switch (spec.assessmentPriceBasis) {
    case 'da':
      basis = da
      break
    case 'rt':
      basis = rt
      break
    case 'max_da_rt':
      basis = Math.max(da, rt)
      break
    case 'abs_spread':
      basis = Math.abs(rt - da)
      break
  }
  return Math.max(basis, spec.assessmentPriceFloor)
}

/** 某小时所属时段的考核系数（未命中任何时段返回 1）。 */
export function segmentFactorOf(spec: SettlementRuleSpec, hour: number): number {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  return spec.timeSegmentFactors.find((seg) => seg.hours.includes(h))?.factor ?? 1
}

export const EFFECTIVENESS_LABEL: Record<RuleDocumentStatus, string> = {
  official: '正式规则',
  consultation: '征求意见稿',
  trial: '试运行方案',
  'industry-reference': '行业转载待核验'
}
