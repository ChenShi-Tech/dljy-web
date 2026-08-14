// 山西现货结算规则规格（P2 结算规则参数化首省）。
// 效力：industry-reference（行业转载待核验）—— 正式规则文本（山西电力现货市场
// 结算实施细则最新版）接入后更新 version/effectiveness 与各参数；在此之前，
// 本规格的价值是把散落在代码里的写死参数（复盘 tolerance 3%/penalty 100、
// quant deviationPenaltyPct 12% 等）收口到带版本与效力标注的单一对象。
import type { SettlementRuleSpec } from '../../types'

export const shanxiSettlementRuleSpec: SettlementRuleSpec = {
  regionId: 'shanxi',
  version: 'shanxi-draft-0.1',
  effectiveness: 'industry-reference',
  // 与现货回放数据口径一致的 ±3% 免考核带（公开资料口径，正式细则核验后更新）
  deviationTolerancePct: 3,
  // 偏差电量按实时价口径计（占位选型：偏差结算挂钩实时出清价；
  // 山西实际为"日清月结 + 偏差按规则价分摊"，正式文本接入后修正）
  assessmentPriceBasis: 'rt',
  assessmentPriceFloor: 0,
  // 分时段考核系数：结构就位、系数中性 1.0（不虚构差异化系数；
  // 正式文本明确尖峰/低谷差异后再填）
  timeSegmentFactors: [
    { segment: '高峰', hours: [8, 9, 10, 11, 17, 18, 19, 20, 21], factor: 1 },
    { segment: '平段', hours: [7, 12, 13, 14, 15, 16, 22], factor: 1 },
    { segment: '低谷', hours: [23, 0, 1, 2, 3, 4, 5, 6], factor: 1 }
  ],
  recycleSubjects: ['不平衡资金分摊与返还', '辅助服务费用分摊', '容量补偿分摊', '偏差考核费用返还'],
  notes: [
    '全部参数为行业公开口径占位，不得作为正式结算依据',
    '分时段系数当前中性 1.0：结构就位、待正式文本填值',
    '消费点：复盘中心免考核带默认值、申报风控、OODA/实验室结算对比参数'
  ],
  references: ['山西电力现货市场结算实施细则（待接入正式文本核验）', '山西电力市场信息披露公开资料']
}
