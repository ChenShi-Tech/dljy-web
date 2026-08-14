import { describe, expect, it } from 'vitest'
import { applyBias, buildLoadCurve96, LOAD_SHAPE_LABEL, type LoadShapeId } from './loadShape'

const SHAPES = Object.keys(LOAD_SHAPE_LABEL) as LoadShapeId[]

describe('S3 申报曲线生成：总量守恒是硬约束', () => {
  it('任意形态下 96 点之和 = 给定总量（含舍入残差闭合）', () => {
    for (const shape of SHAPES) {
      const curve = buildLoadCurve96(1234.5678, shape)
      expect(curve).toHaveLength(96)
      const sum = curve.reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1234.5678, 3)
    }
  })

  it('形态真的不同：双峰的晚高峰点电量显著高于其低谷点，平坦形态逐点相等', () => {
    const dp = buildLoadCurve96(960, 'double-peak')
    // 19 时（第 76 点）是权重峰，03 时（第 12 点）在谷
    expect(dp[76]).toBeGreaterThan(dp[12] * 2)
    const flat = buildLoadCurve96(960, 'flat')
    expect(Math.max(...flat) - Math.min(...flat)).toBeLessThan(0.01)
  })

  it('总量非正返回全零，不编造默认电量', () => {
    expect(buildLoadCurve96(0, 'flat').every((v) => v === 0)).toBe(true)
    expect(buildLoadCurve96(-5, 'double-peak').every((v) => v === 0)).toBe(true)
  })

  it('偏置整体缩放：+10% 后总量放大 1.1 倍，形状比例不变', () => {
    const base = buildLoadCurve96(1000, 'double-peak')
    const biased = applyBias(base, 0.1)
    const sum = biased.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1100, 1)
    // 形状不变：任意两点比值保持
    expect(biased[76] / biased[12]).toBeCloseTo(base[76] / base[12], 3)
  })
})
