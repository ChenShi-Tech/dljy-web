import type { GridOperatorId } from '../data/regions'
import type { GovernanceUser, RoleCode, SubjectType } from '@/services/governance'

export type RuleDocumentStatus = 'official' | 'consultation' | 'trial' | 'industry-reference'

export type RuleDocument = {
  title: string
  issuer: string
  publishedAt: string
  status: RuleDocumentStatus
  url: string
  localPath?: string
}

export type RecommendedRoute = {
  title: string
  path: string
  reason: string
}

export type SubjectRuleFocus = {
  roleCodes: RoleCode[]
  subjectTypes: SubjectType[]
  title: string
  summary: string
  keyConcerns: string[]
  recommendedRoutes: RecommendedRoute[]
  riskWarnings: string[]
  ruleReferences: string[]
}

export type RuleSection = {
  title: string
  summary: string
  items: string[]
}

export type RegionRuleProfile = {
  regionId: string
  gridOperator: GridOperatorId
  marketArchitecture: RuleSection
  marketStage: string
  documents: RuleDocument[]
  participants: RuleSection[]
  tradingProducts: RuleSection[]
  clearingTimeline: RuleSection[]
  pricingModel: RuleSection[]
  settlementModel: RuleSection[]
  riskControls: RuleSection[]
  disclosureRules: RuleSection[]
  subjectFocus: SubjectRuleFocus[]
  developmentStatus: RuleSection
}

export type RuleProfileContext = {
  profile: RegionRuleProfile
  focus: SubjectRuleFocus
  isFallback: boolean
}

export type RuleUser = Pick<GovernanceUser, 'roleCode' | 'subjectType'>

// 可执行结算规则规格（P2 结算规则参数化）
// 与档案型 RegionRuleProfile.settlementModel（文字条款）互补：本规格是消费点
// （复盘考核、OODA/实验室默认参数、申报风控）直接读取的参数对象。
// 数值必须带 version + effectiveness 效力标注；正式规则文本接入前用
// 'industry-reference'（行业转载待核验）并在 notes 写明占位口径。

/** 考核价挂钩方式：日前价 / 实时价 / 两者较高 / 日前-实时绝对价差 */
export type SettlementPriceBasis = 'da' | 'rt' | 'max_da_rt' | 'abs_spread'

export type SettlementTimeSegmentFactor = {
  segment: string
  hours: number[]
  factor: number
}

export type SettlementRuleSpec = {
  regionId: string
  version: string
  effectiveness: RuleDocumentStatus
  /** 偏差免考核容差带 ±%（超出部分进入考核） */
  deviationTolerancePct: number
  assessmentPriceBasis: SettlementPriceBasis
  /** 考核价兜底下限 元/MWh（基准价过低时按此计） */
  assessmentPriceFloor: number
  timeSegmentFactors: SettlementTimeSegmentFactor[]
  // 三部制结算扩展（云南 §3.2.1/§5.1 + 两层偏差回收 §6.2/§6.3/§6.4；向后兼容 optional）
  // 正式数值（δ/u/v/h/Pd）待云南正式结算规则文本/报审稿填值，当前 consultation 占位。
  /** 结算模式：云南现货三部制（中长期全电量 + 日前偏差×日前价 + 实时偏差×实时价，§3.2.1/§5.1） */
  settlementMode?: 'three_part'
  /** 用户侧偏差收益转移允许偏差比例 δ（§6.2：超出部分没收实时−日前价差收益，非固定罚率） */
  deviationTransferTolerancePct?: number
  /** 中长期最小签约比例 u%（§6.3/§6.4：中长期成交电量 ≥ 实际用电量×u%） */
  midlongMinRatioPct?: number
  /** 中长期允许负偏差 v%（§6.3/§6.4：v% 内不回收收益） */
  midlongNegTolerancePct?: number
  /** 中长期偏差回收调整系数 h（§6.3/§6.4：度电回收价 = (基准价−加权综合电价)×h） */
  adjustmentFactor?: number
  /** 月度偏差电量基准价 Pd（§6.3/§6.4，元/MWh） */
  monthlyDeviationBenchmarkPrice?: number
  /** 回收返还科目（分摊/返还口径枚举） */
  recycleSubjects: string[]
  notes: string[]
  references: string[]
}
