import { describe, expect, it } from 'vitest'
import {
  arbitrageWindowList,
  dualCurveDecision,
  digestOf,
  driftAssessment,
  hourlyPointsOf,
  toHourlyQuantiles
} from '@/services/trading/priceDistribution'

/** 24 小时双峰 P50 + 固定带宽 40（P10=P50−20、P90=P50+20）。 */
const p50 = [
  58, 55, 52, 50, 52, 60, 95, 150, 210, 245, 260, 250,
  230, 218, 225, 240, 275, 330, 420, 445, 390, 300, 180, 96
]
const q = {
  p10: p50.map((v) => v - 20),
  p50: [...p50],
  p90: p50.map((v) => v + 20)
}

describe('toHourlyQuantiles：96 点 → 24 小时聚合与分位序校验', () => {
  it('96 点聚合为 24 小时且保持数值', () => {
    const lower96 = q.p10.flatMap((v) => [v, v, v, v])
    const mid96 = p50.flatMap((v) => [v, v, v, v])
    const upper96 = q.p90.flatMap((v) => [v, v, v, v])
    const r = toHourlyQuantiles(lower96, mid96, upper96)
    expect(r).not.toBeNull()
    expect(r!.p50).toHaveLength(24)
    expect(r!.p50[0]).toBeCloseTo(58, 5)
  })

  it('三条曲线长度不一致 / 少于 24 点 / 不能整除 24 → null', () => {
    expect(toHourlyQuantiles([1, 2], [1, 2], [1])).toBeNull()
    expect(toHourlyQuantiles(q.p10.slice(0, 20), p50.slice(0, 20), q.p90.slice(0, 20))).toBeNull()
    expect(toHourlyQuantiles([...q.p10, 1], [...p50, 1], [...q.p90, 1])).toBeNull()
  })

  it('分位序大面积错乱（P90 < P10）→ 判带不可信返回 null；个别违例（≤2 小时）容忍', () => {
    const badP90 = [...q.p90]
    for (let h = 0; h < 5; h++) badP90[h] = 0 // 5 小时 P90 被打穿
    expect(toHourlyQuantiles(q.p10, p50, badP90)).toBeNull()
    const slight = [...q.p90]
    slight[3] = 0 // 单点违例容忍
    expect(toHourlyQuantiles(q.p10, p50, slight)).not.toBeNull()
  })
})

describe('digestOf：分布摘要含不确定性形状', () => {
  it('峰谷位置与带宽（P90−P10 均值 40）', () => {
    const d = digestOf(q)
    expect(d.valleyHour).toBe(3)
    expect(d.peakHour).toBe(19)
    expect(d.spread).toBe(445 - 50)
    expect(d.avgBandWidth).toBe(40)
  })

  it('带宽不均匀时给最宽小时', () => {
    const uneven = {
      p10: [...q.p10],
      p50: [...p50],
      p90: q.p90.map((v, h) => (h === 19 ? v + 80 : v)) // 19 时带宽 +80
    }
    const d = digestOf(uneven)
    expect(d.widestBandHour).toBe(19)
    expect(d.widestBandWidth).toBe(120) // 基础带宽 40 + 额外 80
  })
})

describe('driftAssessment：只在客观判据成立时告警', () => {
  it('MASE>1 → 漂移告警', () => {
    const r = driftAssessment({ mase_vs_naive: 1.2, passes_gate: true })
    expect(r.drifted).toBe(true)
    expect(r.reasons[0]).toContain('MASE')
  })

  it('未过门禁 → 告警；两者皆非 → 不告警（宁可漏报不凭感觉）', () => {
    expect(driftAssessment({ mase_vs_naive: 0.8, passes_gate: false }).drifted).toBe(true)
    expect(driftAssessment({ mase_vs_naive: 0.8, passes_gate: true }).drifted).toBe(false)
    expect(driftAssessment(null).drifted).toBe(false)
  })
})

describe('arbitrageWindowList：谷段×其后峰段配对 + 保守口径判级', () => {
  it('双峰日给窗口且判级用保守口径（P10 峰 − P90 谷）', () => {
    const rows = arbitrageWindowList(q, 100)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    // 谷段在凌晨（≈2–4 时），峰段在 19 时附近
    expect(rows[0]!.chargeFrom).toBeLessThan(6)
    expect(rows[0]!.dischargeFrom).toBeGreaterThan(rows[0]!.chargeTo)
    // 保守价差 = 峰P50−20 − (谷P50+20) = P50价差 − 40
    expect(rows[0]!.conservativeSpread).toBe(rows[0]!.p50Spread - 40)
  })

  it('要求价差足够低 → execute（P90 口径超盈亏平衡×1.15 = 准备执行）', () => {
    const rows = arbitrageWindowList(q, 100)
    const best = rows.find((r) => r.verdict === 'execute')
    expect(best).toBeDefined()
    expect(best!.conservativeSpread).toBeGreaterThanOrEqual(115)
  })

  it('要求价差抬高 → 降为 needs_approval / skip', () => {
    const high = arbitrageWindowList(q, 320)
    expect(high.every((r) => r.verdict !== 'execute')).toBe(true)
  })

  it('平坦无窗口日 → 空清单；盈亏平衡缺失 → 空清单（没有判级依据不列窗口）', () => {
    const flat = { p50: new Array(24).fill(205), p10: new Array(24).fill(185), p90: new Array(24).fill(225) }
    expect(arbitrageWindowList(flat, 100)).toEqual([])
    expect(arbitrageWindowList(q, Number.NaN)).toEqual([])
  })
})

describe('hourlyPointsOf：P50 → quant 域点结构', () => {
  it('逐小时成点，复用 quant 链路', () => {
    const pts = hourlyPointsOf(q)
    expect(pts).toHaveLength(24)
    expect(pts[19]).toEqual({ hour: 19, price: 445 })
  })
})

describe('dualCurveDecision：日前 vs 中长期双曲线决策（#2006）', () => {
  const mlt = { dailyAvgPrice: [240, 242, 245, 241, 238, 236, 240], maseVsPersistence: 0.8 }

  it('日前贵 + 高置信 → 先现货（买卖立场语义双写）', () => {
    const d = dualCurveDecision({ mean: 320, avgBandWidth: 40 }, mlt)
    expect(d?.verdict).toBe('prefer_spot')
    expect(d?.daPremiumPct).toBeGreaterThan(3)
    expect(d?.hint).toContain('卖方先现货')
    expect(d?.hint).toContain('买方')
  })

  it('日前便宜 + 高置信 → 锁中长期', () => {
    const d = dualCurveDecision({ mean: 200, avgBandWidth: 30 }, mlt)
    expect(d?.verdict).toBe('prefer_mlt')
    expect(d?.hint).toContain('锁中长期')
  })

  it('带宽过宽（>25%）→ 低置信观望，不动作', () => {
    const d = dualCurveDecision({ mean: 320, avgBandWidth: 100 }, mlt)
    expect(d?.verdict).toBe('wait')
    expect(d?.hint).toContain('低置信')
  })

  it('中期 MASE>1（不如持久基线）→ 低置信观望', () => {
    const d = dualCurveDecision({ mean: 320, avgBandWidth: 40 }, { ...mlt, maseVsPersistence: 1.3 })
    expect(d?.verdict).toBe('wait')
    expect(d?.confidenceNote).toContain('MASE')
  })

  it('两曲线相当（±3% 内）→ wait（价差不足以驱动顺序）', () => {
    const d = dualCurveDecision({ mean: 242, avgBandWidth: 30 }, mlt)
    expect(d?.verdict).toBe('wait')
  })

  it('任一侧缺失 → null 不硬比', () => {
    expect(dualCurveDecision(null, mlt)).toBeNull()
    expect(dualCurveDecision({ mean: 300, avgBandWidth: 30 }, null)).toBeNull()
    expect(dualCurveDecision({ mean: 300, avgBandWidth: 30 }, { dailyAvgPrice: [], maseVsPersistence: 0.5 })).toBeNull()
  })
})
