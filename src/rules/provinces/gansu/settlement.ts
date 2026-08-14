// 甘肃现货结算规则规格（P3 多省扩展）。
// 效力：industry-reference（行业转载待核验）。甘肃为高风光渗透 + 外送主导省份，
// 负价与弃电风险并存；正式文本接入后更新数值与效力。
import type { SettlementRuleSpec } from '../../types'

export const gansuSettlementRuleSpec: SettlementRuleSpec = {
  regionId: 'gansu',
  version: 'gansu-draft-0.1',
  effectiveness: 'industry-reference',
  deviationTolerancePct: 3,
  assessmentPriceBasis: 'rt',
  assessmentPriceFloor: 0,
  timeSegmentFactors: [
    { segment: '高峰', hours: [18, 19, 20, 21, 22], factor: 1 },
    { segment: '平段', hours: [7, 8, 9, 10, 16, 17, 23], factor: 1 },
    { segment: '午间深谷', hours: [11, 12, 13, 14, 15], factor: 1 },
    { segment: '低谷', hours: [0, 1, 2, 3, 4, 5, 6], factor: 1 }
  ],
  recycleSubjects: ['不平衡资金分摊与返还', '辅助服务费用分摊', '新能源考核返还'],
  notes: [
    '全部参数为行业公开口径占位，不得作为正式结算依据',
    '外送通道约束对省内现货价影响显著，跨省结算科目待正式文本核验'
  ],
  references: ['甘肃电力现货市场结算实施细则（待接入正式文本核验）']
}
