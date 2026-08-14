import { describe, expect, it } from 'vitest'
import {
  analyzePriceCurve,
  calculateKelly,
  defaultStorageParams,
  detectPeakValleyArbitrage,
  type PricePoint
} from './quant'

// 储能套利量化核心（quant.ts）纯函数回归锁：峰谷判定、时序可行套利、Kelly 仓位是
// OODA 决策的算法基座，改错即输出错误交易建议，故用可手算校验的确定性用例锁死。
const curve = (prices: number[]): PricePoint[] => prices.map((price, hour) => ({ hour, price }))

describe('analyzePriceCurve', () => {
  it('空曲线短路返回全零（避免 Math.min([])=Infinity 污染 KPI）', () => {
    expect(analyzePriceCurve([])).toEqual({
      mean: 0,
      min: 0,
      max: 0,
      stdDev: 0,
      peakHours: [],
      valleyHours: [],
      spread: 0
    })
  })

  it('给定曲线算出均价/极值/价差与峰谷时段', () => {
    // prices=[10,20,30]：mean=20，方差=200/3≈66.67，stdDev≈8.16
    // 默认 σ=0.65 → 峰阈=20+8.165*0.65≈25.31（仅 30 达标）、谷阈≈14.69（仅 10 达标）
    const stats = analyzePriceCurve(curve([10, 20, 30]))
    expect(stats.mean).toBe(20)
    expect(stats.min).toBe(10)
    expect(stats.max).toBe(30)
    expect(stats.spread).toBe(20)
    expect(stats.stdDev).toBeCloseTo(8.16, 2)
    expect(stats.peakHours).toEqual([2])
    expect(stats.valleyHours).toEqual([0])
  })
})

describe('detectPeakValleyArbitrage', () => {
  it('少于 2 个点无法套利返回 null', () => {
    expect(detectPeakValleyArbitrage(curve([50]), defaultStorageParams)).toBeNull()
  })

  it('价格单调下行无“先低后高”可行窗口返回 null（绝不回退时序不可行组合）', () => {
    expect(detectPeakValleyArbitrage(curve([100, 90, 80]), defaultStorageParams)).toBeNull()
  })

  it('识别时序可行的最大价差充放对并算出净收益', () => {
    // [50,40,100]：最优先低(hour1=40)后高(hour2=100)，价差 60，充电必早于放电
    const opp = detectPeakValleyArbitrage(curve([50, 40, 100]), defaultStorageParams)
    expect(opp).not.toBeNull()
    expect(opp!.chargeHour).toBe(1)
    expect(opp!.dischargeHour).toBe(2)
    expect(opp!.chargeHour).toBeLessThan(opp!.dischargeHour)
    expect(opp!.chargePrice).toBe(40)
    expect(opp!.dischargePrice).toBe(100)
    expect(opp!.spread).toBe(60)
    // usableEnergy=min(200*0.8, 100*1)=100（功率窗口约束生效）
    expect(opp!.energyMwh).toBe(100)
    // discharge=100MWh*95%*100元/1e4=0.95万；charge=100/95%*40元/1e4≈0.4211万
    expect(opp!.dischargeRevenueWan).toBeCloseTo(0.95, 4)
    expect(opp!.chargeCostWan).toBeCloseTo(0.4211, 4)
    expect(opp!.netRevenueWan).toBeCloseTo(0.5289, 4)
    expect(opp!.returnPct).toBeGreaterThan(0)
  })
})

describe('calculateKelly', () => {
  it('按 edge/赔率算 Kelly 仓位并被地区风险预算封顶', () => {
    // p=0.6, 赔率=2/1 → rawFraction=(2*0.6-0.4)/2=0.4；半 Kelly=0.2
    // riskBudgetPct=18% < 20% → riskAdjusted 被封到 18%
    const k = calculateKelly(0.6, 2, 1, defaultStorageParams)
    expect(k.rawFraction).toBe(40)
    expect(k.halfKellyFraction).toBe(20)
    expect(k.riskAdjustedFraction).toBe(18)
    expect(k.edge).toBeCloseTo(0.8, 4)
    expect(k.payoffRatio).toBe(2)
    // usableEnergy=200*0.8=160 → recommended=160*0.18=28.8
    expect(k.recommendedMwh).toBeCloseTo(28.8, 2)
  })

  it('胜率越界被夹到 [0,1]，风险预算仍封顶', () => {
    const k = calculateKelly(1.5, 2, 1, defaultStorageParams)
    expect(k.rawFraction).toBe(100)
    expect(k.riskAdjustedFraction).toBe(18)
  })

  it('负 edge（劣势下注）时仓位归零，不建议建仓', () => {
    const k = calculateKelly(0.3, 1, 1, defaultStorageParams)
    expect(k.rawFraction).toBe(0)
    expect(k.riskAdjustedFraction).toBe(0)
    expect(k.recommendedMwh).toBe(0)
  })
})
