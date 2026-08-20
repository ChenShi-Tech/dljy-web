import { describe, expect, it } from 'vitest'
import {
  computeRecovery,
  decideBias,
  deviationAlertOf,
  type BiasInput,
  type RecoveryInput
} from 'shared/trading-rules/demand-bias.mjs'

function bias(overrides: Partial<BiasInput> = {}) {
  return decideBias({
    priceSpreadYuanPerMwh: 0,
    confidenceScore: 80,
    managementBand: 0.2,
    exposureFactor: 1,
    ...overrides
  })
}

describe('R4 · 偏置规则表', () => {
  it('实时显著更贵 + 高置信 → 上偏至管理带上限 +20%', () => {
    expect(bias({ priceSpreadYuanPerMwh: 120 }).biasRatio).toBeCloseTo(0.2, 4)
  })

  it('实时显著更便宜 + 高置信 → 下偏至下限 −20%', () => {
    expect(bias({ priceSpreadYuanPerMwh: -120 }).biasRatio).toBeCloseTo(-0.2, 4)
  })

  it('价差在 ±30 元/MWh 内 → 中枢不下注', () => {
    expect(bias({ priceSpreadYuanPerMwh: 20 }).biasRatio).toBe(0)
    expect(bias({ priceSpreadYuanPerMwh: -20 }).biasRatio).toBe(0)
    expect(bias({ priceSpreadYuanPerMwh: 0 }).reason).toContain('方向不明不下注')
  })

  it('同样价差下，置信度中等要打折', () => {
    const high = bias({ priceSpreadYuanPerMwh: 120, confidenceScore: 85 }).biasRatio
    const mid = bias({ priceSpreadYuanPerMwh: 120, confidenceScore: 60 }).biasRatio
    expect(mid).toBeLessThan(high)
    expect(mid).toBeGreaterThan(0)
  })

  it('置信度不足 50 → 无论价差多大都回中枢', () => {
    const d = bias({ priceSpreadYuanPerMwh: 300, confidenceScore: 30 })
    expect(d.biasRatio).toBe(0)
    expect(d.confidence).toBe('low')
  })

  it('偏置绝不越管理带（管理带内收自法定带，留 10 个点吸收负荷预测误差）', () => {
    for (const dp of [-500, -100, -50, 0, 50, 100, 500]) {
      expect(Math.abs(bias({ priceSpreadYuanPerMwh: dp }).biasRatio)).toBeLessThanOrEqual(0.2 + 1e-9)
    }
  })
})

describe('R4 · 数据门禁裁剪偏置（与 S2/S16 联动）', () => {
  it('门禁「可参考」→ 暴露减半', () => {
    const d = bias({ priceSpreadYuanPerMwh: 120, exposureFactor: 0.5 })
    expect(d.tableRatio).toBeCloseTo(0.2, 4)
    expect(d.biasRatio).toBeCloseTo(0.1, 4)
    expect(d.reason).toContain('暴露按 0.5 折减')
  })

  it('门禁「仅展示」→ 偏置强制归零（R4 末行 / S16 降级）', () => {
    const d = bias({ priceSpreadYuanPerMwh: 300, exposureFactor: 0 })
    expect(d.biasRatio).toBe(0)
    expect(d.tableRatio).toBeCloseTo(0.2, 4) // 规则表仍给出档位，被门禁裁掉
    expect(d.reason).toContain('强制归零')
  })
})

// L0 不对称回收

function recovery(overrides: Partial<RecoveryInput> = {}) {
  return computeRecovery({
    declaredMwh: 100,
    actualMwh: 100,
    dayAheadPrice: 200,
    realtimePrice: 200,
    l0: 0.3,
    ...overrides
  })
}

describe('L0 回收的不对称性（最易实现错的一条）', () => {
  it('多报越带 + 实时更贵（方向有利）→ 回收超出部分', () => {
    // 实际 100，免罚上限 130，申报 150 → 超出 20；价差 +50
    const r = recovery({ declaredMwh: 150, realtimePrice: 250 })
    expect(r.recoveryYuan).toBeCloseTo(20 * 50, 2)
    expect(r.favorableDirection).toBe(true)
  })

  it('少报越带 + 实时更便宜（方向有利）→ 回收超出部分', () => {
    // 实际 100，免罚下限 70，申报 50 → 超出 20；价差 −50
    const r = recovery({ declaredMwh: 50, realtimePrice: 150 })
    expect(r.recoveryYuan).toBeCloseTo(20 * 50, 2)
    expect(r.favorableDirection).toBe(true)
  })

  it('**多报越带但实时更便宜（方向不利）→ 不回收**（已自负亏损，不叠加惩罚）', () => {
    const r = recovery({ declaredMwh: 150, realtimePrice: 150 })
    expect(r.outOfBand).toBe(true)
    expect(r.recoveryYuan).toBe(0)
    expect(r.reason).toContain('不叠加回收')
  })

  it('**少报越带但实时更贵（方向不利）→ 不回收**', () => {
    const r = recovery({ declaredMwh: 50, realtimePrice: 250 })
    expect(r.outOfBand).toBe(true)
    expect(r.recoveryYuan).toBe(0)
  })

  it('带内偏差一律不回收，哪怕价差很大', () => {
    expect(recovery({ declaredMwh: 129, realtimePrice: 500 }).recoveryYuan).toBe(0)
    expect(recovery({ declaredMwh: 71, realtimePrice: 40 }).recoveryYuan).toBe(0)
  })

  it('只对超出免罚带的**增量**回收，不是对全部偏差回收', () => {
    // 申报 140 超上限 130 只有 10；若按全部偏差 40 计会多算 4 倍
    const r = recovery({ declaredMwh: 140, realtimePrice: 300 })
    expect(r.recoveryYuan).toBeCloseTo(10 * 100, 2)
    expect(r.recoveryYuan).not.toBeCloseTo(40 * 100, 2)
  })

  it('L0 是收益封顶线而非风险封顶线：同样偏 50%，方向对才被罚', () => {
    const favorable = recovery({ declaredMwh: 150, realtimePrice: 300 })
    const unfavorable = recovery({ declaredMwh: 150, realtimePrice: 100 })
    expect(favorable.recoveryYuan).toBeGreaterThan(0)
    expect(unfavorable.recoveryYuan).toBe(0)
  })
})

describe('偏差率告警分级（S9 监盘矩阵）', () => {
  it('分档与手册一致：>15 蓝 / >22 黄 / >27 红 / ≥30 越硬线', () => {
    expect(deviationAlertOf(0.1)).toBe('ok')
    expect(deviationAlertOf(0.18)).toBe('blue')
    expect(deviationAlertOf(0.24)).toBe('yellow')
    expect(deviationAlertOf(0.28)).toBe('red')
    expect(deviationAlertOf(0.31)).toBe('breach')
  })

  it('正负偏差同等判级（取绝对值）', () => {
    expect(deviationAlertOf(-0.28)).toBe('red')
  })
})
