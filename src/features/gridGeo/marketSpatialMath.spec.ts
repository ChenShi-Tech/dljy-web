import { describe, expect, it } from 'vitest'
import { gridMarketRiskScore } from './marketSpatialMath'

describe('grid market spatial descriptive risk', () => {
  it('requires both exact price and output signals', () => {
    expect(gridMarketRiskScore(null, 12)).toBeNull()
    expect(gridMarketRiskScore(80, null)).toBeNull()
  })

  it('uses the published bounded formula', () => {
    expect(gridMarketRiskScore(40, 10)).toBe(40)
    expect(gridMarketRiskScore(-200, -40)).toBe(100)
    expect(gridMarketRiskScore(0, 0)).toBe(0)
  })
})
