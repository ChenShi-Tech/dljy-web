import { describe, expect, it } from 'vitest'
import { analyzeClearing } from './clearingReview'

describe('S5 出清分析：中标率与逐时段偏差', () => {
  it('中标率 = 出清总量 / 申报总量', () => {
    const r = analyzeClearing([10, 10, 10, 10], [9, 10, 8, 9])
    expect(r.totalDeclaredMwh).toBe(40)
    expect(r.totalClearedMwh).toBe(36)
    expect(r.clearRate).toBe(0.9)
  })

  it('申报总量为 0 时中标率为 null，不除零', () => {
    const r = analyzeClearing([0, 0], [0, 0])
    expect(r.clearRate).toBeNull()
  })

  it('长度不一致必须抛错——错位对齐比报错更危险', () => {
    expect(() => analyzeClearing([1, 2, 3], [1, 2])).toThrow(/长度不一致/)
    expect(() => analyzeClearing([], [])).toThrow()
  })

  it('最坏时段按**绝对偏差量**排序，不是偏差率——小申报大偏率不如大申报中偏率疼', () => {
    // 时段0：申报0.1 偏差率300%（Δ0.3）；时段2：申报20 偏差率30%（Δ6）
    const r = analyzeClearing([0.1, 10, 20, 10], [0.4, 10, 14, 10])
    expect(r.worstSlots[0].slot).toBe(2)
    expect(r.worstSlots[0].deltaMwh).toBe(-6)
    expect(r.worstSlots[1].slot).toBe(0)
    // 无偏差时段不进最坏列表
    expect(r.worstSlots.map((w) => w.slot)).not.toContain(1)
  })

  it('实时调整判断卡在阈值边界：15% 不触发，越过才触发（默认阈值 0.15）', () => {
    const noAction = analyzeClearing([100], [85]) // 偏差率恰 -15%，不超过
    expect(noAction.needsRealtimeAction).toBe(false)
    const action = analyzeClearing([100], [84.9]) // -15.1%，越界
    expect(action.needsRealtimeAction).toBe(true)
    expect(action.triggeredSlots).toEqual([0])
  })

  it('阈值是管理参数，可按公司风控口径覆盖', () => {
    const strict = analyzeClearing([100], [92], { realtimeActionThreshold: 0.05 })
    expect(strict.needsRealtimeAction).toBe(true)
    const loose = analyzeClearing([100], [92], { realtimeActionThreshold: 0.1 })
    expect(loose.needsRealtimeAction).toBe(false)
  })

  it('未申报却中标：偏差率无从计算，但必须触发人工介入而非静默跳过', () => {
    const r = analyzeClearing([0, 10], [5, 10])
    expect(r.needsRealtimeAction).toBe(true)
    expect(r.triggeredSlots).toEqual([0])
    // 未申报且未中标的 0/0 时段不触发
    const quiet = analyzeClearing([0, 10], [0, 10])
    expect(quiet.needsRealtimeAction).toBe(false)
  })

  it('摘要落到业务语言：中标率、最大偏差位置、是否需实时调整三件事都在', () => {
    const r = analyzeClearing([10, 10], [10, 5])
    expect(r.summary).toContain('中标率 75.0%')
    expect(r.summary).toContain('第 2 时段')
    expect(r.summary).toContain('实时')
  })
})
