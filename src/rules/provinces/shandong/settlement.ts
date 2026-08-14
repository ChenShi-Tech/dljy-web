// 山东现货结算规则规格（P3 多省扩展）。
// 效力：industry-reference（行业转载待核验）。山东为全国负价频次与新能源渗透
// 最高的省份之一，参数结构与山西同构；正式文本接入后更新数值与效力。
import type { SettlementRuleSpec } from '../../types'

export const shandongSettlementRuleSpec: SettlementRuleSpec = {
  regionId: 'shandong',
  version: 'shandong-draft-0.1',
  effectiveness: 'industry-reference',
  deviationTolerancePct: 3,
  assessmentPriceBasis: 'rt',
  assessmentPriceFloor: 0,
  timeSegmentFactors: [
    { segment: '高峰', hours: [8, 9, 10, 17, 18, 19, 20, 21], factor: 1 },
    { segment: '平段', hours: [7, 11, 16, 22, 23], factor: 1 },
    // 午间深谷（光伏大发负价高发时段）单列，便于正式文本差异化填值
    { segment: '午间深谷', hours: [12, 13, 14, 15], factor: 1 },
    { segment: '低谷', hours: [0, 1, 2, 3, 4, 5, 6], factor: 1 }
  ],
  recycleSubjects: ['不平衡资金分摊与返还', '辅助服务费用分摊', '容量补偿分摊'],
  notes: [
    '全部参数为行业公开口径占位，不得作为正式结算依据',
    '山东负价时段多发于午间光伏大发，时段表已单列"午间深谷"待正式系数',
    '现货全电量结算与中长期差价返还口径待正式文本核验'
  ],
  references: ['山东电力现货市场交易规则（待接入正式文本核验）']
}
