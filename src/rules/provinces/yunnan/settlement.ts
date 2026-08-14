// 云南现货结算规则规格（征求意见稿口径）。
// 效力：consultation —— 依据云南电力市场结算实施细则（征求意见稿）方向性建模；
// 正式版发布后更新 version/effectiveness。2025 连续结算方案报审稿按行业转载
// 处理，不作为参数依据（见地区交易规则体系效力分级，历史文档已归档、git log 可追溯）。
import type { SettlementRuleSpec } from '../../types'

export const yunnanSettlementRuleSpec: SettlementRuleSpec = {
  regionId: 'yunnan',
  version: 'yunnan-consultation-0.2',
  effectiveness: 'consultation',
  // 三部制结算（§3.2.1/§5.1）：中长期合约全电量 + 日前偏差×日前价 + 实时偏差×实时价。
  // 云南现货按节点电价（发电侧）/统一结算点电价（用户侧）结算，无「峰谷系数乘子」。
  settlementMode: 'three_part',
  deviationTolerancePct: 3,
  // 偏差收益转移口径（§6.2）：用户侧事后按实时统一结算点电价计算价差收益转移
  assessmentPriceBasis: 'rt',
  assessmentPriceFloor: 0,
  // 用户侧偏差收益转移允许偏差比例 δ（§6.2，超出部分没收实时−日前价差收益，非固定罚率）。
  // 征求意见稿未固化数值（§3.2.7「由政府主管部门明确」），待正式文本/报审稿填值。
  deviationTransferTolerancePct: undefined,
  // 中长期偏差收益回收（§6.3/§6.4）：u% 最小签约 / v% 允许负偏差 / h 调整系数 / Pd 月度基准价。
  // 均待正式文本填值（征求意见稿为方向性条款，数值由政府审定）。
  midlongMinRatioPct: undefined,
  midlongNegTolerancePct: undefined,
  adjustmentFactor: undefined,
  monthlyDeviationBenchmarkPrice: undefined,
  // 注意：timeSegmentFactors 在云南现货结算中【非结算乘子】——现货按节点电价×偏差电量结算，
  // 不存在峰谷系数乘子。此处保留仅作「用户侧峰谷目录电价」分时展示参考（2024年5月起执行的
  // 零售电价机制，非批发现货结算），factor 全 1 占位。若后续正式文本明确现货分时系数再启用。
  timeSegmentFactors: [
    { segment: '高峰', hours: [9, 10, 11, 17, 18, 19, 20, 21, 22], factor: 1 },
    { segment: '平段', hours: [7, 8, 12, 13, 14, 15, 16, 23], factor: 1 },
    { segment: '低谷', hours: [0, 1, 2, 3, 4, 5, 6], factor: 1 }
  ],
  recycleSubjects: ['不平衡资金分摊与返还', '辅助服务费用分摊', '阻塞盈余返还', '运行补偿分摊'],
  notes: [
    '三部制结算（§3.2.1/§5.1）：C支出 = C中长期合约 + C日前偏差 + C实时偏差 + C分摊 + C返还；按节点电价/统一结算点电价结算',
    '两层偏差考核：①用户侧偏差收益转移（§6.2，δ 允许偏差外没收实时−日前价差收益）；②中长期偏差收益回收（§6.3/§6.4，u/v/h/Pd）',
    'δ/u/v/h/Pd 数值待云南正式结算规则文本/2024年10月报审稿填值（§3.2.7 由政府主管部门明确）',
    'timeSegmentFactors 非现货结算乘子（现货按节点电价），仅作峰谷目录电价分时展示参考',
    '丰枯季差异（云南水电主导）待正式文本明确后扩展季节维度'
  ],
  references: [
    '云南电力市场结算实施细则（征求意见稿）— 国家能源局云南监管办公室 https://ynb.nea.gov.cn/jflyfox/nengyuan/ueditor/file/20230728/20230728_162754_163256.pdf （§3.2.1 结算模式 / §5.1 用户侧公式 / §6.2 偏差收益转移 / §6.3 §6.4 中长期偏差回收）',
    '南方区域电力市场运行规则（2025年V1.0版）'
  ]
}
