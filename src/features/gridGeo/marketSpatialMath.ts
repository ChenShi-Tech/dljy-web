/** 描述性空间关注指数：两类信号缺一不可，避免缺测被解释为低风险。 */
export function gridMarketRiskScore(priceSpread: number | null, outputDeviationPercent: number | null) {
  if (priceSpread === null || outputDeviationPercent === null) return null
  const priceContribution = Math.min(50, Math.abs(priceSpread) / 2)
  const outputContribution = Math.min(50, Math.abs(outputDeviationPercent) * 2)
  return Math.min(100, priceContribution + outputContribution)
}
