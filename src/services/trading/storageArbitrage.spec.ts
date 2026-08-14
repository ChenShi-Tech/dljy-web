import { describe, expect, it } from 'vitest'
import { MARKET_TIMING } from 'shared/trading-rules/market-timing.mjs'
import {
  arbitrageVerdict,
  breakevenSpread,
  canDispatch,
  capacityPayment,
  checkDispatchConstraints,
  decisionUnitOf,
  expandToExecutionCurve,
  planDispatch,
  type BreakevenInput,
  type DispatchInput
} from 'shared/trading-rules/storage-arbitrage.mjs'

// 手册第七章默认参数：η_RT=0.870、a=71.560（线损 15.013 + 系统运行费 56.547）、
// C_cyc=110、c_cap=98（年循环 330 次）、c_as=0（保守）。
const DEFAULT_BE: BreakevenInput = {
  chargePriceYuanPerMwh: 0,
  roundTripEfficiency: 0.87,
  chargeAdderYuanPerMwh: 71.56,
  cycleCostYuanPerMwh: 110,
  cCapYuanPerMwh: 98,
  cAsYuanPerMwh: 0
}

describe('R1 · 套利决策单元由结算聚合算子推导，不写死', () => {
  it('小时算术平均结算 ⇒ 决策单元 24 个，单元内切换无收益', () => {
    const u = decisionUnitOf(MARKET_TIMING.xinjiang)
    expect(u.intervalMin).toBe(60)
    expect(u.unitsPerDay).toBe(24)
    expect(u.clearingPointsPerUnit).toBe(4)
    expect(u.intraUnitSwitchingProfitable).toBe(false)
    expect(u.reason).toContain('切换只增损耗')
  })

  it('15 分钟直接结算 ⇒ 决策单元 96 个，单元内价差真实存在', () => {
    const u = decisionUnitOf(MARKET_TIMING.shanxi)
    expect(u.intervalMin).toBe(15)
    expect(u.unitsPerDay).toBe(96)
    expect(u.clearingPointsPerUnit).toBe(1)
    expect(u.intraUnitSwitchingProfitable).toBe(true)
  })
})

describe('R11 · 容量电价折价（复现手册速查表）', () => {
  // 100 MW / 6h 项目，165 元/(kW·年)，运行口径 DOD 0.85
  const base = {
    ratedPowerKw: 100_000,
    standardYuanPerKwYear: 165,
    dischargeDurationH: 6,
    denominatorH: 6,
    usableCapacityMwh: 600,
    operatingDod: 0.85,
    inCapacityList: true
  }

  it('年循环 330 次 → c_cap ≈ 98 元/MWh（手册基准值）', () => {
    const r = capacityPayment({ ...base, cyclesPerYear: 330 })
    expect(r.annualRevenueYuan).toBe(16_500_000)
    expect(r.cCapYuanPerMwh).toBeCloseTo(98, 0)
  })

  it('年循环 200 次 → ≈162；500 次 → ≈65（循环越多，度电补贴越低）', () => {
    expect(capacityPayment({ ...base, cyclesPerYear: 200 }).cCapYuanPerMwh).toBeCloseTo(162, 0)
    expect(capacityPayment({ ...base, cyclesPerYear: 500 }).cCapYuanPerMwh).toBeCloseTo(65, 0)
  })

  it('反直觉性质成立：c_cap 与年循环次数严格反向', () => {
    const c200 = capacityPayment({ ...base, cyclesPerYear: 200 }).cCapYuanPerMwh
    const c330 = capacityPayment({ ...base, cyclesPerYear: 330 }).cCapYuanPerMwh
    const c500 = capacityPayment({ ...base, cyclesPerYear: 500 }).cCapYuanPerMwh
    expect(c200).toBeGreaterThan(c330)
    expect(c330).toBeGreaterThan(c500)
    // 因此「多循环能多拿容量补贴」是错的，不能作为增加循环的理由
  })

  it('未纳入清单管理 → c_cap 记 0，且给出商业模型提示', () => {
    const r = capacityPayment({ ...base, cyclesPerYear: 330, inCapacityList: false })
    expect(r.cCapYuanPerMwh).toBe(0)
    expect(r.note).toContain('盈亏平衡价差整体上移')
  })

  it('时长不足 6h 时按比例折算，但度电折价基本不变（分子分母同比例缩放）', () => {
    const h2 = capacityPayment({ ...base, dischargeDurationH: 2, usableCapacityMwh: 200, cyclesPerYear: 330 })
    expect(h2.ratio).toBeCloseTo(1 / 3, 4)
    expect(h2.cCapYuanPerMwh).toBeCloseTo(98, 0)
  })
})

describe('R3 · 盈亏平衡价差（复现手册速查表）', () => {
  it('含容量电价：P_chg=40→100.2 / 100→109.2 / 200→124.1', () => {
    expect(breakevenSpread({ ...DEFAULT_BE, chargePriceYuanPerMwh: 40 }).requiredSpreadYuanPerMwh).toBeCloseTo(100.2, 1)
    expect(breakevenSpread({ ...DEFAULT_BE, chargePriceYuanPerMwh: 100 }).requiredSpreadYuanPerMwh).toBeCloseTo(109.2, 1)
    expect(breakevenSpread({ ...DEFAULT_BE, chargePriceYuanPerMwh: 200 }).requiredSpreadYuanPerMwh).toBeCloseTo(124.1, 1)
  })

  it('不含容量电价：P_chg=40→198.2 / 100→207.2（两表相差约 98）', () => {
    const noCap = { ...DEFAULT_BE, cCapYuanPerMwh: 0 }
    expect(breakevenSpread({ ...noCap, chargePriceYuanPerMwh: 40 }).requiredSpreadYuanPerMwh).toBeCloseTo(198.2, 1)
    expect(breakevenSpread({ ...noCap, chargePriceYuanPerMwh: 100 }).requiredSpreadYuanPerMwh).toBeCloseTo(207.2, 1)
  })

  it('充电侧刚性加价必须被计入——漏计会让门槛低估约 a/η（≈82 元/MWh）', () => {
    const withAdder = breakevenSpread({ ...DEFAULT_BE, chargePriceYuanPerMwh: 100 })
    const without = breakevenSpread({ ...DEFAULT_BE, chargePriceYuanPerMwh: 100, chargeAdderYuanPerMwh: 0 })
    expect(withAdder.requiredSpreadYuanPerMwh - without.requiredSpreadYuanPerMwh).toBeCloseTo(71.56 / 0.87, 1)
    expect(withAdder.chargeAdderLoadedYuanPerMwh).toBeCloseTo(82.25, 1)
  })

  it('参数敏感性与手册一致：η 降 1 个百分点，门槛升约 2.3 元/MWh', () => {
    const base = breakevenSpread({ ...DEFAULT_BE, chargePriceYuanPerMwh: 100 })
    const lower = breakevenSpread({ ...DEFAULT_BE, chargePriceYuanPerMwh: 100, roundTripEfficiency: 0.86 })
    expect(lower.requiredSpreadYuanPerMwh - base.requiredSpreadYuanPerMwh).toBeCloseTo(2.3, 1)
  })

  it('安全边际三档：≥1.15 执行 / [1.0,1.15) 需批准 / <1.0 不循环', () => {
    const req = 100
    expect(arbitrageVerdict(120, req).verdict).toBe('execute')
    expect(arbitrageVerdict(105, req).verdict).toBe('needs_approval')
    expect(arbitrageVerdict(90, req).verdict).toBe('skip')
  })
})

// ── R2 充放选择 ─────────────────────────────────────────────────────────────

/** 24 单元价格：0-7 低谷 60，8-17 平段 200，18-21 尖峰 420，22-23 回落 150。 */
function dayPrices(): number[] {
  return [
    60, 60, 60, 60, 60, 60, 60, 60,
    200, 200, 200, 200, 200, 200, 200, 200, 200, 200,
    420, 420, 420, 420,
    150, 150
  ]
}

function dispatchInput(overrides: Partial<DispatchInput> = {}): DispatchInput {
  return {
    unitPrices: dayPrices(),
    availablePowerMw: 100,
    // 100 MW / 600 MWh = 6 小时储能，对齐手册容量电价满额折算的典型配置
    capacityMwh: 600,
    socMin: 0.1,
    socMax: 0.9,
    socStart: 0.5,
    socTarget: 0.5,
    socTargetTolerance: 0.03,
    chargeEfficiency: 0.933,
    dischargeEfficiency: 0.933,
    lockedUnits: [],
    maxCyclesPerDay: 2,
    breakeven: DEFAULT_BE,
    secondCycleRatioThreshold: 1.3,
    ...overrides
  }
}

describe('R2 · 充放小时选择', () => {
  it('低谷充、尖峰放，且充电单元必须早于放电单元', () => {
    const plan = planDispatch(dispatchInput())
    expect(plan.pairs.length).toBeGreaterThan(0)
    for (const p of plan.pairs) {
      expect(p.chargeUnit).toBeLessThan(p.dischargeUnit)
      expect(p.chargePrice).toBeLessThan(p.dischargePrice)
    }
  })

  it('尖峰在前、低谷在后的一天不得成对（不能先放后充，SOC 因果不可逆）', () => {
    // 上一条断言在「低谷本就早于尖峰」的价格形态下没有区分力——去掉时序检查结果一样。
    // 只有把价格倒过来，才能真正检验时序可行性这一步是否存在：
    // 最高价在 index 0、最低价在 index 12，若不校验时序就会配出「12 点充、0 点放」的非法对。
    const inverted = [...new Array(12).fill(420), ...new Array(12).fill(60)]
    const plan = planDispatch(dispatchInput({ unitPrices: inverted }))
    expect(plan.pairs).toHaveLength(0)
    expect(plan.noArbitrageWindow).toBe(true)
  })

  it('辅助服务锁定的单元不得用于能量套利', () => {
    const plan = planDispatch(dispatchInput({ lockedUnits: [18, 19, 20, 21] }))
    const used = plan.pairs.flatMap((p) => [p.chargeUnit, p.dischargeUnit])
    expect(used).not.toContain(18)
    expect(used).not.toContain(21)
  })

  it('平坦价格 ⇒ 无套利窗口日，不硬凑循环', () => {
    const plan = planDispatch(dispatchInput({ unitPrices: new Array(24).fill(200) }))
    expect(plan.pairs).toHaveLength(0)
    expect(plan.noArbitrageWindow).toBe(true)
  })

  it('价差刚好不够覆盖门槛 ⇒ 不循环（而不是「差一点也做」）', () => {
    // 充 100 → 门槛约 109.2；放 200 时价差 100 < 109.2
    const flatish = [...new Array(12).fill(100), ...new Array(12).fill(200)]
    const plan = planDispatch(dispatchInput({ unitPrices: flatish }))
    expect(plan.noArbitrageWindow).toBe(true)
  })

  it('日循环次数受公司限值约束', () => {
    const plan = planDispatch(dispatchInput({ maxCyclesPerDay: 1 }))
    expect(plan.cycles).toBeLessThanOrEqual(1)
  })

  it('SOC 轨迹不可行时回退最后一对，而不是整体报错（R2 步骤 8）', () => {
    // 充放效率不对称：充进 1 MWh 只放得出 η_RT MWh，每多一对循环终止 SOC 就更低一截。
    // 默认夹具下双循环会让终止 SOC 落到目标带外 → 必须回退到单循环。
    const plan = planDispatch(dispatchInput())
    expect(plan.rolledBackPairs).toBeGreaterThan(0)
    expect(plan.rejectReason).toBeNull()
    expect(plan.pairs.length).toBeGreaterThan(0)
    const socEnd = plan.socTrajectory.at(-1)!
    expect(Math.abs(socEnd - 0.5)).toBeLessThanOrEqual(0.03 + 1e-9)
  })

  it('起始 SOC 贴近上限 ⇒ 充电顶穿，回退到不做循环', () => {
    const plan = planDispatch(dispatchInput({ socStart: 0.88, socTarget: 0.88 }))
    expect(plan.pairs).toHaveLength(0)
    expect(plan.noArbitrageWindow).toBe(true)
  })

  it('放宽终止 SOC 容差可救回被回退的那一对（对应「放宽容差需主管批准」的异常处置）', () => {
    const strict = planDispatch(dispatchInput())
    const relaxed = planDispatch(dispatchInput({ socTargetTolerance: 0.05 }))
    expect(relaxed.pairs.length).toBeGreaterThan(strict.pairs.length)
  })
})

describe('决策单元 → 执行粒度展开', () => {
  it('24 小时展开为 96 点，单元内功率恒定（满功率优先）', () => {
    const curve = expandToExecutionCurve([100, -100, 0], 4)
    expect(curve).toHaveLength(12)
    expect(curve.slice(0, 4)).toEqual([100, 100, 100, 100])
    expect(curve.slice(4, 8)).toEqual([-100, -100, -100, -100])
  })
})

describe('八项约束全量校验', () => {
  const plan = planDispatch(dispatchInput())

  function constraints(overrides: Record<string, unknown> = {}) {
    return checkDispatchConstraints({
      plan,
      availablePowerMw: 100,
      socMin: 0.1,
      socMax: 0.9,
      socTarget: 0.5,
      socTargetTolerance: 0.03,
      rampLimitMw: 200,
      maxCyclesPerDay: 2,
      monthlyChargeMwh: 1000,
      monthlyChargeQuotaMwh: 37_200,
      contractComplianceRatio: 1.0,
      complianceBand: [0.85, 1.15],
      identityMixed: false,
      ...overrides
    })
  }

  it('八条约束全部登记（缺一条即与手册不符）', () => {
    expect(constraints()).toHaveLength(8)
  })

  it('身份混用是阻断项——踩的是「不得以两种身份在同一标的交易」红线', () => {
    const checks = constraints({ identityMixed: true })
    const identity = checks.find((c) => c.id === 'identity')!
    expect(identity.passed).toBe(false)
    expect(identity.blocking).toBe(true)
    expect(canDispatch(checks)).toBe(false)
  })

  it('月度充电超限阻断下发', () => {
    const checks = constraints({ monthlyChargeMwh: 40_000, monthlyChargeQuotaMwh: 37_200 })
    expect(checks.find((c) => c.id === 'monthly_quota')!.passed).toBe(false)
    expect(canDispatch(checks)).toBe(false)
  })

  it('履约率越管理带只告警、不阻断（它靠中长期补正而非拦下发）', () => {
    const checks = constraints({ contractComplianceRatio: 1.3 })
    const compliance = checks.find((c) => c.id === 'compliance')!
    expect(compliance.passed).toBe(false)
    expect(compliance.blocking).toBe(false)
    expect(canDispatch(checks)).toBe(true)
  })

  it('爬坡能力不足时阻断（相邻单元满充切满放 = 2 倍额定功率）', () => {
    const checks = constraints({ rampLimitMw: 50 })
    expect(checks.find((c) => c.id === 'ramp')!.passed).toBe(false)
    expect(canDispatch(checks)).toBe(false)
  })

  it('全部阻断项通过时允许下发', () => {
    expect(canDispatch(constraints())).toBe(true)
  })
})
