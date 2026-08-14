// B2 风控阈值统一来源：把散落在 tradingLab.ts（风险判级）与 regionSpotProfiles.ts（价差/敞口画像）
// 的风控阈值收口到一处，供「风控阈值统一面板」红黄绿判级 + 各页对齐口径。缺省值与既有各处一致，
// 避免口径漂移。后续可按地区覆写（getRiskThresholds(regionId)）。

export type RiskThresholds = {
  // 敞口：套保率下限（中长期覆盖现货的比例）。≥ green 绿；[yellow, green) 黄；< yellow 红
  hedgeRatioGreen: number
  hedgeRatioYellow: number
  // 申报偏差考核：估算考核费（元）。≤ green 绿（含 0）；(green, red) 黄；≥ red 红
  deviationPenaltyGreenYuan: number
  deviationPenaltyRedYuan: number
  // 价差异动：实时-日前价差阈值（元/MWh）。0 告警=绿；< redCount 黄；≥ redCount 红
  spreadThresholdYuan: number
  spreadAlertRedCount: number
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  hedgeRatioGreen: 0.8,
  hedgeRatioYellow: 0.5,
  deviationPenaltyGreenYuan: 0,
  deviationPenaltyRedYuan: 5000,
  spreadThresholdYuan: 80,
  spreadAlertRedCount: 3,
}

// 按地区覆写（暂用缺省；各地区结算规则差异由 regionSettlementRules 在报表引擎注入，
// 此处仅作风控面板判级阈值，未列地区沿用缺省）。
export function getRiskThresholds(_regionId: string): RiskThresholds {
  return DEFAULT_RISK_THRESHOLDS
}

export type RiskLevel = 'green' | 'yellow' | 'red'

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  green: '安全',
  yellow: '关注',
  red: '越限',
}

export function hedgeRatioLevel(ratio: number, t: RiskThresholds = DEFAULT_RISK_THRESHOLDS): RiskLevel {
  if (ratio >= t.hedgeRatioGreen) return 'green'
  if (ratio >= t.hedgeRatioYellow) return 'yellow'
  return 'red'
}

export function deviationPenaltyLevel(yuan: number, t: RiskThresholds = DEFAULT_RISK_THRESHOLDS): RiskLevel {
  if (yuan <= t.deviationPenaltyGreenYuan) return 'green'
  if (yuan >= t.deviationPenaltyRedYuan) return 'red'
  return 'yellow'
}

export function spreadAlertLevel(count: number, t: RiskThresholds = DEFAULT_RISK_THRESHOLDS): RiskLevel {
  if (count <= 0) return 'green'
  if (count >= t.spreadAlertRedCount) return 'red'
  return 'yellow'
}
