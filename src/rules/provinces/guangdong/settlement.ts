// 广东现货结算规则规格（P3 多省扩展）。
// 效力：industry-reference（行业转载待核验）。广东为南方区域统一出清价口径、
// 市场成熟度最高省份；正式文本（广东电力市场交易规则）接入后更新数值与效力。
import type { SettlementRuleSpec } from '../../types'

export const guangdongSettlementRuleSpec: SettlementRuleSpec = {
  regionId: 'guangdong',
  version: 'guangdong-draft-0.1',
  effectiveness: 'industry-reference',
  deviationTolerancePct: 3,
  // 南方区域口径：日前/实时分开结算，偏差按实时价口径计
  assessmentPriceBasis: 'rt',
  assessmentPriceFloor: 0,
  timeSegmentFactors: [
    { segment: '高峰', hours: [10, 11, 14, 15, 16, 17, 18, 19], factor: 1 },
    { segment: '平段', hours: [8, 9, 12, 13, 20, 21, 22, 23], factor: 1 },
    { segment: '低谷', hours: [0, 1, 2, 3, 4, 5, 6, 7], factor: 1 }
  ],
  recycleSubjects: ['不平衡资金分摊与返还', '辅助服务费用分摊', '阻塞盈余返还'],
  notes: [
    '全部参数为行业公开口径占位，不得作为正式结算依据',
    '广东统一出清价（非节点价）口径，价差结算与回收科目待正式文本核验'
  ],
  references: ['广东电力市场交易规则（待接入正式文本核验）', '南方区域电力市场运行规则（2025年V1.0版）']
}
