import { describe, expect, it } from 'vitest'
import { buildSegmentDraft, segmentsToPriceCurve96, validateSegments } from '@/services/trading/segmentQuote'

/** 双峰 96 点（24 小时 ×4，值即小时电量 MWh/点的 4 倍量级差异） */
function curve96(): number[] {
  const hourly = [
    58, 55, 52, 50, 52, 60, 95, 150, 210, 245, 260, 250,
    230, 218, 225, 240, 275, 330, 420, 445, 390, 300, 180, 96
  ]
  return hourly.flatMap((v) => [v, v, v, v])
}

describe('buildSegmentDraft：段表生成', () => {
  it('3 段：份额 45/35/20、价格落中枢分位且严格递增、整数', () => {
    const rows = buildSegmentDraft(curve96(), 180, 280, 3)!
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.label)).toEqual(['基荷段', '腰荷段', '峰荷段'])
    // 价格：180 + 100×{0.25,0.55,0.9} → 205/235/270
    expect(rows.map((r) => r.priceYuanPerMwh)).toEqual([205, 235, 270])
    expect(rows[0]!.priceYuanPerMwh).toBeLessThan(rows[1]!.priceYuanPerMwh)
    expect(rows[1]!.priceYuanPerMwh).toBeLessThan(rows[2]!.priceYuanPerMwh)
    // 份额合计 100%（最后一段吃余量）
    const shareSum = rows.reduce((a, r) => a + r.sharePct, 0)
    expect(shareSum).toBeCloseTo(100, 0) // 各段 0.1% 舍入累积容差
    // 段电量合计 = 曲线总量（1e-1 内）
    const total = curve96().reduce((a, b) => a + b, 0)
    expect(rows.reduce((a, r) => a + r.energyMwh, 0)).toBeCloseTo(total, 1)
  })

  it('电量份额随段位递减（基荷大电量低价、峰荷小电量高价）', () => {
    const rows = buildSegmentDraft(curve96(), 180, 280, 3)!
    expect(rows[0]!.energyMwh).toBeGreaterThan(rows[1]!.energyMwh)
    expect(rows[1]!.energyMwh).toBeGreaterThan(rows[2]!.energyMwh)
  })

  it('缺价格中枢（S2 未产出）/缺曲线 → null 不硬编', () => {
    expect(buildSegmentDraft(curve96(), null, 280)).toBeNull()
    expect(buildSegmentDraft(curve96(), 280, 180)).toBeNull() // high<=low
    expect(buildSegmentDraft([], 180, 280)).toBeNull()
  })
})

describe('segmentsToPriceCurve96：段表 → 逐点价格曲线', () => {
  it('逐点价 = 该点段价；高价时点拿峰荷价、低价时点拿基荷价', () => {
    const rows = buildSegmentDraft(curve96(), 180, 280, 3)!
    const price = segmentsToPriceCurve96(rows, curve96())!
    expect(price).toHaveLength(96)
    // 19 时（445，峰荷）四点都是峰段价 270
    expect(price.slice(19 * 4, 20 * 4)).toEqual([270, 270, 270, 270])
    // 3 时（50，基荷）是基段价 205
    expect(price.slice(3 * 4, 4 * 4)).toEqual([205, 205, 205, 205])
    // 全曲线只用段表里的价格（无第四种价）
    expect(new Set(price).size).toBeLessThanOrEqual(3)
  })
})

describe('validateSegments：人工改动的硬约束', () => {
  const base = buildSegmentDraft(curve96(), 180, 280, 3)!

  it('草稿原生段表通过', () => {
    expect(validateSegments(base).ok).toBe(true)
  })

  it('倒挂/平价被拦（供给曲线性质）', () => {
    const bad = base.map((r, i) => (i === 1 ? { ...r, priceYuanPerMwh: 205 } : r))
    const v = validateSegments(bad)
    expect(v.ok).toBe(false)
    expect(v.problems.some((p) => p.includes('严格递增'))).toBe(true)
  })

  it('非整数价被拦（报价精度）', () => {
    const bad = base.map((r, i) => (i === 0 ? { ...r, priceYuanPerMwh: 205.5 } : r))
    expect(validateSegments(bad).ok).toBe(false)
  })

  it('超限价带被拦', () => {
    const v = validateSegments(base, { floor: 0, cap: 250 })
    expect(v.ok).toBe(false)
    expect(v.problems.some((p) => p.includes('限价带'))).toBe(true)
  })
})
