import { computed } from 'vue'
import { getRegionById } from '../data/regions'
import { getCurrentUser } from '@/services/auth'
import { currentRegion } from '@/services/region/regionContext'
import type { RegionRuleProfile, RuleUser, SubjectRuleFocus } from './types'
import { southernGridCommonRuleProfile, southernGridGenericFocus } from './common/southernGrid'
import { stateGridCommonRuleProfile } from './common/stateGrid'
import { yunnanSouthernGridRuleProfile } from './provinces/yunnan'

function buildFallbackProfile(regionId: string): RegionRuleProfile {
  const region = getRegionById(regionId)
  const gridProfile = region.gridOperator === 'china-southern-grid' ? southernGridCommonRuleProfile : undefined
  return {
    regionId: region.id,
    gridOperator: region.gridOperator,
    marketStage: '待定制',
    marketArchitecture: {
      title: `${region.name}规则框架待定制`,
      summary: `${region.name}已接入地区切换，但尚未沉淀专属现货规则。当前仅展示地区规则框架，避免误用云南或南网通用参数。`,
      items: ['等待接入省级现货细则', '等待补充交易时序和报价机制', '等待补充结算公式和风险参数', '可先使用通用规则做结构参考']
    },
    documents: gridProfile?.documents ?? [],
    participants: [
      { title: '待补主体范围', summary: '后续按该地区正式规则明确参与主体。', items: ['发电企业', '售电公司', '批发用户', '新型主体', '电网企业和市场运营机构'] }
    ],
    tradingProducts: [
      { title: '待补交易品种', summary: '保留中长期、日前、实时、辅助服务和结算管理的通用占位。', items: region.ruleSet.tradingModes }
    ],
    clearingTimeline: [
      { title: '待补出清时序', summary: '需按该地区现货规则确定日前/实时粒度、申报窗口和出清发布机制。', items: ['日前申报', '日前出清', '实时出清', '结果发布'] }
    ],
    pricingModel: [
      { title: '待补价格机制', summary: '需按该地区规则确定节点电价、统一结算点电价或其他价格机制。', items: ['发电侧价格口径待补', '用户侧价格口径待补', '限价参数待补'] }
    ],
    settlementModel: [
      { title: '待补结算机制', summary: '需按该地区结算细则配置中长期、日前、实时、分摊返还和不平衡资金。', items: ['中长期合约', '日前偏差', '实时偏差', '分摊返还', '不平衡资金'] }
    ],
    riskControls: [
      { title: '待补风险控制', summary: '需按该地区试运行方案和正式规则配置熔断、限价、市场干预和异常处置。', items: ['价格限值', '熔断机制', '市场干预', '异常结算'] }
    ],
    disclosureRules: [
      { title: '待补信息披露', summary: '需按该地区信息披露规则配置公开范围、发布周期和权限。', items: ['公众信息', '公开信息', '私有信息', '依申请披露信息'] }
    ],
    subjectFocus: [southernGridGenericFocus],
    developmentStatus: {
      title: '后续开发',
      summary: `${region.name}暂未实现专属规则模块。`,
      items: ['补充规则文件', '补充主体关注矩阵', '补充可计算结算公式', '补充数据适配器']
    }
  }
}

export function getRuleProfile(regionId: string): RegionRuleProfile {
  if (regionId === 'yunnan') return yunnanSouthernGridRuleProfile
  if (regionId === 'generic-csg') return southernGridCommonRuleProfile
  if (regionId === 'generic-sgcc') return stateGridCommonRuleProfile
  return buildFallbackProfile(regionId)
}

export function getSubjectRuleFocus(regionId: string, user: RuleUser): SubjectRuleFocus {
  const profile = getRuleProfile(regionId)
  return profile.subjectFocus.find((focus) => focus.roleCodes.includes(user.roleCode))
    ?? profile.subjectFocus.find((focus) => focus.subjectTypes.includes(user.subjectType))
    ?? profile.subjectFocus[0]
}

export function useRegionRules() {
  const profile = computed(() => getRuleProfile(currentRegion.value.id))
  const focus = computed(() => getSubjectRuleFocus(currentRegion.value.id, getCurrentUser()))
  const isFallback = computed(() => !['yunnan', 'generic-csg'].includes(currentRegion.value.id))

  return {
    profile,
    focus,
    isFallback
  }
}

export type { RegionRuleProfile, RuleDocument, RuleDocumentStatus, RuleSection, SubjectRuleFocus } from './types'
export type { SettlementPriceBasis, SettlementRuleSpec, SettlementTimeSegmentFactor } from './types'
export { assessmentPriceOf, EFFECTIVENESS_LABEL, getSettlementRuleSpec, listSettlementRuleSpecs, segmentFactorOf } from './settlement'
