import { describe, expect, it } from 'vitest'
import {
  buildChecklist,
  evaluateRelease,
  type ChecklistInput,
  type OverrideRecord
} from 'shared/trading-rules/release-checklist.mjs'

function input(overrides: Partial<ChecklistInput> = {}): ChecklistInput {
  return {
    dailyVarYuan: 80_000,
    varLimitYuan: 100_000,
    socTrajectoryOk: true,
    socEndOk: true,
    safetyMultiple: 3.1,
    safetyMultipleThreshold: 1.15,
    maxBiasAbs: 0.12,
    biasManagementBand: 0.2,
    biasLegalBand: 0.3,
    complianceRatio: 1.0,
    complianceManagementBand: [0.85, 1.15],
    complianceLegalBand: [0.8, 1.2],
    quoteMonotonic: true,
    quoteIntegerPrice: true,
    minSegmentRatioOk: true,
    redLinesTouched: [],
    dataDeclarable: true,
    dataGateSummary: '八源齐备、完整率 100%，可作为申报依据',
    preparedBy: 'trader',
    reviewedBy: 'lead',
    ...overrides
  }
}

function validOverride(itemId: string): OverrideRecord {
  return {
    itemId,
    approvedBy: 'lead',
    cosignedBy: 'risk',
    reason: '尖峰确定性高，愿承担超限暴露',
    stopLossCondition: '实时价连续 2 点低于 250 即平仓',
    at: '2026-08-09T08:30:00+08:00'
  }
}

describe('清单结构', () => {
  it('恒为十项，不因立场不适用而少列', () => {
    const items = buildChecklist(input({ socTrajectoryOk: null, socEndOk: null, safetyMultiple: null, maxBiasAbs: null }))
    expect(items).toHaveLength(10)
    expect(items.map((i) => i.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('不适用项标记为通过并注明原因（不适用 ≠ 不通过）', () => {
    const items = buildChecklist(input({ socTrajectoryOk: null, socEndOk: null, safetyMultiple: null }))
    const soc = items.find((i) => i.id === 'soc')!
    expect(soc.passed).toBe(true)
    expect(soc.detail).toContain('本立场不适用')
  })

  it('全部满足 → 十项全过、允许提交', () => {
    const v = evaluateRelease(buildChecklist(input()))
    expect(v.allowed).toBe(true)
    expect(v.passedCount).toBe(10)
    expect(v.summary).toContain('十项全过')
  })
})

describe('硬约束：任何人不得放行', () => {
  it('触碰合规红线 → 阻断，且 override 无效', () => {
    const items = buildChecklist(input({ redLinesTouched: ['R-2 身份混用'] }))
    const v = evaluateRelease(items, [validOverride('redline')])
    expect(v.allowed).toBe(false)
    expect(v.blockers.map((b) => b.id)).toContain('redline')
  })

  it('自审自批不成立（编制人 = 复核人）', () => {
    const v = evaluateRelease(buildChecklist(input({ preparedBy: 'trader', reviewedBy: 'trader' })))
    expect(v.allowed).toBe(false)
    expect(v.blockers.some((b) => b.id === 'dualsign')).toBe(true)
  })

  it('数据门禁不允许申报 → 阻断', () => {
    const v = evaluateRelease(
      buildChecklist(input({ dataDeclarable: false, dataGateSummary: '含 D 级数据，不得作为申报依据' }))
    )
    expect(v.allowed).toBe(false)
    expect(v.blockers.some((b) => b.id === 'data')).toBe(true)
  })

  it('SOC 终止不达标 → 阻断（哪怕轨迹在带内）', () => {
    const v = evaluateRelease(buildChecklist(input({ socTrajectoryOk: true, socEndOk: false })))
    expect(v.allowed).toBe(false)
    expect(v.blockers.some((b) => b.id === 'soc')).toBe(true)
  })

  it('报价非单调或非整数 → 阻断', () => {
    expect(evaluateRelease(buildChecklist(input({ quoteMonotonic: false }))).allowed).toBe(false)
    expect(evaluateRelease(buildChecklist(input({ quoteIntegerPrice: false }))).allowed).toBe(false)
  })
})

describe('管理带 vs 法定带：越法定带就从可放行变成硬约束', () => {
  it('偏置只越管理带（20% < x ≤ 30%）→ 可双签放行', () => {
    const items = buildChecklist(input({ maxBiasAbs: 0.25 }))
    const bias = items.find((i) => i.id === 'bias')!
    expect(bias.passed).toBe(false)
    expect(bias.severity).toBe('overridable')
    expect(evaluateRelease(items, [validOverride('bias')]).allowed).toBe(true)
  })

  it('偏置越法定带（>30%）→ 硬约束，双签也放行不了', () => {
    const items = buildChecklist(input({ maxBiasAbs: 0.35 }))
    const bias = items.find((i) => i.id === 'bias')!
    expect(bias.severity).toBe('hard')
    expect(bias.detail).toContain('任何人不得放行')
    expect(evaluateRelease(items, [validOverride('bias')]).allowed).toBe(false)
  })

  it('履约率同理：越管理带可放行，越法定带不可', () => {
    const soft = buildChecklist(input({ complianceRatio: 1.18 }))
    expect(evaluateRelease(soft, [validOverride('compliance')]).allowed).toBe(true)

    const hard = buildChecklist(input({ complianceRatio: 1.25 }))
    expect(evaluateRelease(hard, [validOverride('compliance')]).allowed).toBe(false)
  })
})

describe('放行记录必须完整，否则不予采信', () => {
  const varOver = buildChecklist(input({ dailyVarYuan: 130_000 }))

  it('VaR 超限 + 完整双签放行记录 → 允许提交', () => {
    const v = evaluateRelease(varOver, [validOverride('var')])
    expect(v.allowed).toBe(true)
    expect(v.overridden.map((i) => i.id)).toContain('var')
  })

  it('缺第二签 → 不予采信（双签才成立）', () => {
    const o = { ...validOverride('var'), cosignedBy: undefined }
    expect(evaluateRelease(varOver, [o]).allowed).toBe(false)
  })

  it('两签为同一人 → 不予采信', () => {
    const o = { ...validOverride('var'), cosignedBy: 'lead' }
    expect(evaluateRelease(varOver, [o]).allowed).toBe(false)
  })

  it('缺止损条件 → 不予采信（「主管口头同意」不能变成免检通道）', () => {
    const o = { ...validOverride('var'), stopLossCondition: '  ' }
    expect(evaluateRelease(varOver, [o]).allowed).toBe(false)
  })

  it('缺超限理由 → 不予采信', () => {
    const o = { ...validOverride('var'), reason: '' }
    expect(evaluateRelease(varOver, [o]).allowed).toBe(false)
  })

  it('放行的是别的项 → 对本项无效', () => {
    expect(evaluateRelease(varOver, [validOverride('breakeven')]).allowed).toBe(false)
  })
})

describe('结论摘要给出可执行的下一步', () => {
  it('硬约束未过时点名是哪几项、并说明不可放行', () => {
    const v = evaluateRelease(buildChecklist(input({ redLinesTouched: ['R-3 裸卖空'], quoteMonotonic: false })))
    expect(v.summary).toContain('任何人不得放行')
    expect(v.blockers).toHaveLength(2)
  })

  it('仅差双签放行时提示需写明理由与止损', () => {
    const v = evaluateRelease(buildChecklist(input({ dailyVarYuan: 130_000 })))
    expect(v.summary).toContain('待双签放行')
    expect(v.summary).toContain('止损条件')
  })
})
