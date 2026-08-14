import { describe, expect, it } from 'vitest'
import { blockReason, evaluateDeclarationChecks } from 'shared/trading-rules/declaration-checks.mjs'

function decl(overrides: Record<string, unknown> = {}) {
  return {
    capacityMw: 50,
    subjectType: 'RETAILER',
    basis: 'captured',
    quoteRationale: '成本锚：中长期均价 232、现货 P50 预测 248，价差 16 元/MWh',
    energyCurveMwh96: Array.from({ length: 96 }, () => 10),
    ...overrides
  }
}

const okExposure = { available: true, hedgeRatio: 0.85, sellExposureMwh: 0, buyExposureMwh: 1200 }
const flatForecast = Array.from({ length: 96 }, () => 10)

function run(d = decl(), inputs: Record<string, unknown> = {}) {
  return evaluateDeclarationChecks(d, { exposure: okExposure, forecastCurveMwh96: flatForecast, ...inputs })
}

function itemOf(result: ReturnType<typeof run>, id: string) {
  const found = result.checks.find((c) => c.checkId === id)
  if (!found) throw new Error(`检查项 ${id} 不存在`)
  return found
}

describe('十项恒在，且每项声明严重性', () => {
  it('全过时十项齐备、不阻断、L2', () => {
    const r = run()
    expect(r.checks).toHaveLength(10)
    expect(r.passed).toBe(true)
    expect(r.blocked).toBe(false)
    expect(r.gateLevel).toBe('L2')
  })

  it('不适用项也在列（不适用 ≠ 从清单消失）', () => {
    const r = run()
    // 售电立场没有储能资产，两项储能检查仍须出现
    expect(itemOf(r, 'socTrajectory').detail).toContain('不适用')
    expect(itemOf(r, 'breakeven').detail).toContain('不适用')
  })

  it('每项严重性取值合法', () => {
    for (const c of run().checks) {
      expect(['hard', 'overridable', 'warning']).toContain(c.severity)
    }
  })
})

describe('数据基线是硬门禁，但按可信度分档处置', () => {
  it('实盘决策级（captured/real）通过', () => {
    expect(itemOf(run(decl({ basis: 'captured' })), 'dataBasis').status).toBe('PASS')
    expect(itemOf(run(decl({ basis: 'real' })), 'dataBasis').status).toBe('PASS')
  })

  it('合成演示数据 → 硬约束阻断，任何人放行不了', () => {
    const r = run(decl({ basis: 'synthetic' }))
    expect(itemOf(r, 'dataBasis').severity).toBe('hard')
    expect(r.blocked).toBe(true)
    expect(blockReason(r)).toContain('数据可信度门禁')
  })

  it('特征示意（系统默认值）→ 可放行，不得硬拦（否则打死既有流程）', () => {
    const r = run(decl({ basis: 'illustrative' }))
    const item = itemOf(r, 'dataBasis')
    expect(item.status).toBe('FAIL')
    expect(item.severity).toBe('overridable')
    expect(r.blocked).toBe(false)
    expect(r.gateLevel).toBe('L3')
  })
})

describe('报价依据摘要：显式留空硬拦，存量缺字段升档', () => {
  it('已填写 → 通过', () => {
    expect(itemOf(run(), 'quoteRationale').status).toBe('PASS')
  })

  it('显式留空 → 硬约束阻断（监管质询时无法自证）', () => {
    const r = run(decl({ quoteRationale: '   ' }))
    expect(itemOf(r, 'quoteRationale').severity).toBe('hard')
    expect(r.blocked).toBe(true)
  })

  it('存量单无此字段 → UNAVAILABLE 升档，不拦死历史数据', () => {
    const legacy = decl()
    delete (legacy as Record<string, unknown>).quoteRationale
    const r = run(legacy)
    expect(itemOf(r, 'quoteRationale').status).toBe('UNAVAILABLE')
    expect(r.blocked).toBe(false)
    expect(r.gateLevel).toBe('L3')
  })
})

describe('用户侧偏置：越管理带可放行、越法定带硬拦', () => {
  it('偏置为 0 通过', () => {
    expect(itemOf(run(), 'bias').status).toBe('PASS')
  })

  it('+25%（越管理带未越法定带）→ 可双签放行', () => {
    const r = run(decl(), { forecastCurveMwh96: Array.from({ length: 96 }, () => 8) })
    const item = itemOf(r, 'bias')
    expect(item.status).toBe('FAIL')
    expect(item.severity).toBe('overridable')
    expect(r.blocked).toBe(false)
  })

  it('+42.9%（越法定带）→ 硬约束，任何人放行不了', () => {
    const r = run(decl(), { forecastCurveMwh96: Array.from({ length: 96 }, () => 7) })
    const item = itemOf(r, 'bias')
    expect(item.severity).toBe('hard')
    expect(item.detail).toContain('已越法定带')
    expect(r.blocked).toBe(true)
  })

  it('缺预测曲线 → UNAVAILABLE 升档，不伪装成通过', () => {
    const r = run(decl(), { forecastCurveMwh96: null })
    expect(itemOf(r, 'bias').status).toBe('UNAVAILABLE')
    expect(r.blocked).toBe(false)
  })

  it('非用户侧立场不适用', () => {
    const r = run(decl({ subjectType: 'GENERATOR' }), { forecastCurveMwh96: null })
    expect(itemOf(r, 'bias').status).toBe('PASS')
    expect(itemOf(r, 'bias').detail).toContain('不适用')
  })
})

describe('段单调性对 96 点曲线结构不适用，如实标注', () => {
  it('报量不报价 → 无需校验', () => {
    expect(itemOf(run(), 'quotePrecision').status).toBe('PASS')
  })

  it('有价格曲线且精度合规 → UNAVAILABLE（段结构无从校验），而非伪装 PASS', () => {
    const r = run(decl({ priceCurve96: Array.from({ length: 96 }, () => 300) }), {
      priceCap: { floor: 0, cap: 1500 }
    })
    const item = itemOf(r, 'quotePrecision')
    expect(item.status).toBe('UNAVAILABLE')
    expect(item.detail).toContain('无从校验')
  })

  it('报价非整数 → 硬约束阻断', () => {
    const r = run(decl({ priceCurve96: Array.from({ length: 96 }, (_, i) => (i === 0 ? 300.5 : 300)) }), {
      priceCap: { floor: 0, cap: 1500 }
    })
    expect(itemOf(r, 'quotePrecision').status).toBe('FAIL')
    expect(r.blocked).toBe(true)
  })
})

describe('服务不可用只升档、不当作违规', () => {
  it('敞口服务不可用 → UNAVAILABLE + L3，但不阻断', () => {
    const r = run(decl(), { exposure: null })
    expect(itemOf(r, 'exposure').status).toBe('UNAVAILABLE')
    expect(itemOf(r, 'exposure').severity).toBe('overridable')
    expect(r.blocked).toBe(false)
    expect(r.gateLevel).toBe('L3')
  })

  it('敞口超限 → 可放行项不通过（升档而非拦死）', () => {
    const r = run(decl(), { exposure: { ...okExposure, buyExposureMwh: 500 } })
    expect(itemOf(r, 'exposure').status).toBe('FAIL')
    expect(r.blocked).toBe(false)
  })
})

describe('合规红线与功率约束是硬约束', () => {
  it('触碰红线即阻断', () => {
    const r = run(decl(), { redLinesTouched: ['R-2 身份混用'] })
    expect(r.blocked).toBe(true)
    expect(blockReason(r)).toContain('R-2')
  })

  it('申报功率超可用容量即阻断', () => {
    const r = run(decl({ capacityMw: 30 }))
    expect(itemOf(r, 'capacity').status).toBe('FAIL')
    expect(r.blocked).toBe(true)
  })
})

describe('储能立场专属两项', () => {
  const storage = () => decl({ subjectType: 'STORAGE' })

  it('未提供 SOC 结论 → UNAVAILABLE 升档', () => {
    const r = run(storage(), { forecastCurveMwh96: null, exposure: { ...okExposure, sellExposureMwh: 2000 } })
    expect(itemOf(r, 'socTrajectory').status).toBe('UNAVAILABLE')
    expect(r.blocked).toBe(false)
  })

  it('SOC 越界 → 硬约束阻断', () => {
    const r = run(storage(), {
      forecastCurveMwh96: null,
      exposure: { ...okExposure, sellExposureMwh: 2000 },
      soc: { trajectoryOk: false, endOk: true }
    })
    expect(itemOf(r, 'socTrajectory').status).toBe('FAIL')
    expect(r.blocked).toBe(true)
  })

  it('安全倍数不足 → 可放行项（主管批准后可执行）', () => {
    const r = run(storage(), {
      forecastCurveMwh96: null,
      exposure: { ...okExposure, sellExposureMwh: 2000 },
      soc: { trajectoryOk: true, endOk: true },
      safetyMultiple: 1.05
    })
    expect(itemOf(r, 'breakeven').status).toBe('FAIL')
    expect(itemOf(r, 'breakeven').severity).toBe('overridable')
    expect(r.blocked).toBe(false)
  })
})

describe('阻断原因可读', () => {
  it('无阻断时为 null', () => {
    expect(blockReason(run())).toBeNull()
  })

  it('多项阻断时逐项列出并说明不可放行', () => {
    const r = run(decl({ basis: 'synthetic', capacityMw: 30 }))
    const reason = blockReason(r)!
    expect(reason).toContain('任何人不得放行')
    expect(reason).toContain('功率约束')
    expect(reason).toContain('数据可信度门禁')
  })
})
