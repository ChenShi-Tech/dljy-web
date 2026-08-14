import { describe, expect, it } from 'vitest'
import {
  assessSlots,
  coalPriceToThermalAnchor,
  DEFAULT_REGIME_BANDS,
  exportCouplingImpact,
  historicalPriceBand,
  provincePriceCompare,
  regimeOf,
  summarizeDay,
  supplyDemandRatio,
  thermalAnchorVsPriceCenter,
  type SupplyDemandInput
} from 'shared/trading-rules/supply-demand.mjs'

function fundamentals(overrides: Partial<SupplyDemandInput> = {}): SupplyDemandInput {
  return {
    dispatchableMaxMw: 20_000,
    renewableForecastMw: 8_000,
    netImportMw: 0,
    systemLoadMw: 18_000,
    exportPlanMw: 6_000,
    reserveMw: 1_000,
    ...overrides
  }
}

describe('供需比：外送在分母，不在分子', () => {
  it('基础计算与手册口径一致', () => {
    // (20000+8000+0) / (18000+6000+1000) = 28000/25000 = 1.12
    expect(supplyDemandRatio(fundamentals())).toBeCloseTo(1.12, 4)
  })

  it('**外送增加会拉低供需比**（等价于省内净负荷增加）', () => {
    const base = supplyDemandRatio(fundamentals())
    const moreExport = supplyDemandRatio(fundamentals({ exportPlanMw: 8_000 }))
    expect(moreExport).toBeLessThan(base)
  })

  it('若把外送误放到分子，方向会整个反过来——用这条锁住分母位置', () => {
    const asDenominator = supplyDemandRatio(fundamentals({ exportPlanMw: 8_000 }))
    // 错误实现（外送当供给）会得到更大的比值；正确实现必须更小
    const wrongIfNumerator = (20_000 + 8_000 + 8_000) / (18_000 + 1_000)
    expect(asDenominator).toBeLessThan(wrongIfNumerator)
    expect(asDenominator).toBeLessThan(1.2)
  })

  it('分母非正时返回 NaN，调用方须走空态而非当 0 处理', () => {
    expect(Number.isNaN(supplyDemandRatio(fundamentals({ systemLoadMw: 0, exportPlanMw: 0, reserveMw: 0 })))).toBe(true)
  })
})

describe('五档映射', () => {
  it('分档边界与手册一致', () => {
    expect(regimeOf(1.4)!.regime).toBe('extreme_surplus')
    expect(regimeOf(1.25)!.regime).toBe('surplus')
    expect(regimeOf(1.15)!.regime).toBe('balanced')
    expect(regimeOf(1.05)!.regime).toBe('tight')
    expect(regimeOf(1.0)!.regime).toBe('scarce')
  })

  it('每档都带边际机组、价格中枢与两侧策略（缺一则 S2 的输出物不完整）', () => {
    for (const band of DEFAULT_REGIME_BANDS) {
      expect(band.marginalUnit).toBeTruthy()
      expect(band.priceCenter[0]).toBeLessThan(band.priceCenter[1])
      expect(band.storageStrategy).toBeTruthy()
      expect(band.retailStrategy).toBeTruthy()
    }
  })

  it('档位越紧价格中枢越高（单调性——否则映射自相矛盾）', () => {
    const centers = DEFAULT_REGIME_BANDS.map((b) => b.priceCenter[0])
    for (let i = 1; i < centers.length; i += 1) {
      expect(centers[i]).toBeGreaterThan(centers[i - 1])
    }
  })

  it('非有限供需比不猜档', () => {
    expect(regimeOf(Number.NaN)).toBeNull()
  })

  it('分档表可替换——换省换季度只换数据，判级逻辑不动', () => {
    const custom = [
      { ...DEFAULT_REGIME_BANDS[0], minRatio: 2.0 },
      { ...DEFAULT_REGIME_BANDS[4], minRatio: Number.NEGATIVE_INFINITY }
    ]
    expect(regimeOf(1.5, custom)!.regime).toBe('scarce')
    expect(regimeOf(2.5, custom)!.regime).toBe('extreme_surplus')
  })
})

describe('外送耦合：档位是否被推翻才是要报的信号', () => {
  it('外送小幅变化不改档位时标记未推翻', () => {
    const r = exportCouplingImpact(fundamentals(), 200)
    expect(r.regimeShifted).toBe(false)
    expect(r.delta).toBeLessThan(0)
  })

  it('外送大增把平衡推到偏紧 → 标记档位推翻', () => {
    // 基准 1.12（平衡）；外送 +4000 → 28000/29000 ≈ 0.966（紧张）
    const r = exportCouplingImpact(fundamentals(), 4_000)
    expect(r.regimeBefore).toBe('balanced')
    expect(r.regimeShifted).toBe(true)
  })

  it('外送减少会抬升供需比', () => {
    const r = exportCouplingImpact(fundamentals(), -3_000)
    expect(r.ratioAfter!).toBeGreaterThan(r.ratioBefore!)
  })
})

describe('逐时段评估与全日摘要', () => {
  const slots: SupplyDemandInput[] = [
    fundamentals({ systemLoadMw: 14_000 }), // 松
    fundamentals({ systemLoadMw: 14_000 }),
    fundamentals({ systemLoadMw: 14_000 }),
    fundamentals({ systemLoadMw: 22_000 }) // 紧
  ]

  it('逐段给出供需比与档位', () => {
    const a = assessSlots(slots)
    expect(a).toHaveLength(4)
    expect(a[0].regime).not.toBe(a[3].regime)
  })

  it('主导态势取时段数最多的档', () => {
    const s = summarizeDay(assessSlots(slots))
    expect(s.dominantRegime).toBe(assessSlots(slots)[0].regime)
    expect(s.coverage).toBeCloseTo(0.75, 4)
    // 最紧时段仍被单独点名，不被主导档吞掉
    expect(s.tightestSlot!.slot).toBe(3)
  })

  it('**取众数而非平均**：多数时段偏紧 + 个别时段极松时，平均会谎报成宽松', () => {
    // 上一条断言在「众数与平均恰好同档」的夹具下没有区分力——改用平均照样绿。
    // 这里构造两者分离的一天：3 段 SR≈1.05（偏紧）+ 1 段 SR=2.0（极度宽松），
    // 平均 SR≈1.29 会落进「宽松」档，而交易员真正要防的是那 3 段偏紧。
    const mixed: SupplyDemandInput[] = [
      fundamentals({ systemLoadMw: 19_667 }),
      fundamentals({ systemLoadMw: 19_667 }),
      fundamentals({ systemLoadMw: 19_667 }),
      fundamentals({ systemLoadMw: 7_000 })
    ]
    const assessed = assessSlots(mixed)
    expect(assessed.filter((a) => a.regime === 'tight')).toHaveLength(3)
    expect(assessed[3].regime).toBe('extreme_surplus')

    const s = summarizeDay(assessed)
    expect(s.dominantRegime).toBe('tight')
    expect(s.dominantRegime).not.toBe('surplus') // 平均法会给出 surplus
  })

  it('价格中枢区间取全日各档的并集下上界', () => {
    const s = summarizeDay(assessSlots(slots))
    expect(s.priceCenterLow!).toBeLessThan(s.priceCenterHigh!)
  })

  it('输入不足时如实报「无法判断」，不猜档', () => {
    const s = summarizeDay(assessSlots([fundamentals({ systemLoadMw: 0, exportPlanMw: 0, reserveMw: 0 })]))
    expect(s.dominantRegime).toBeNull()
    expect(s.summary).toContain('不猜档')
  })
})

describe('煤价 → 火电边际成本锚（#1962）', () => {
  it('标煤折算与煤耗换算可逐步复核：850 元/吨(5500大卡)×300g/kWh', () => {
    // 标煤价 = 850 × 7000/5500 = 1081.8 → 取整 1082 元/吨标煤
    // 燃料 = 1082/1000 × 300 = 324.6 → total = 324.6 + 30 = 354.6
    const a = coalPriceToThermalAnchor(850)
    expect(a?.standardCoalYuanPerTon).toBe(1082)
    expect(a?.fuelYuanPerMwh).toBe(324.6)
    expect(a?.totalYuanPerMwh).toBe(354.6)
    expect(a?.assumptions).toContain('5500')
  })

  it('煤价升高 → 边际成本锚升高（方向锁死）', () => {
    const low = coalPriceToThermalAnchor(700)
    const high = coalPriceToThermalAnchor(1000)
    expect(high!.totalYuanPerMwh).toBeGreaterThan(low!.totalYuanPerMwh)
  })

  it('空值/非有限值返回 null（不猜锚）', () => {
    expect(coalPriceToThermalAnchor(null)).toBeNull()
    expect(coalPriceToThermalAnchor(Number.NaN)).toBeNull()
    expect(coalPriceToThermalAnchor(-5)).toBeNull()
  })

  it('贴边不算脱节：超出上界但在 5% 容差内仍算 within（280×1.05=294）', () => {
    expect(thermalAnchorVsPriceCenter(230, [180, 280])?.verdict).toBe('anchor_within')
    expect(thermalAnchorVsPriceCenter(290, [180, 280])?.verdict).toBe('anchor_within')
  })

  it('锚高于中枢上界超容差 → 提示上修', () => {
    const v = thermalAnchorVsPriceCenter(360, [180, 280])
    expect(v?.verdict).toBe('anchor_above_center')
    expect(v?.hint).toContain('上修')
  })

  it('锚低于中枢下界超容差 → 提示下修；缺输入返回 null 不硬比', () => {
    expect(thermalAnchorVsPriceCenter(120, [180, 280])?.verdict).toBe('anchor_below_center')
    expect(thermalAnchorVsPriceCenter(null, [180, 280])).toBeNull()
    expect(thermalAnchorVsPriceCenter(200, null)).toBeNull()
  })
})

describe('省内 vs 省外比价（#1962）', () => {
  it('省外明显更贵 → 先省内（买方语义由调用方解读）', () => {
    const r = provincePriceCompare(300, 330)
    expect(r?.side).toBe('domestic')
    expect(r?.diffPct).toBe(10)
  })

  it('省外明显更便宜 → 先省外', () => {
    expect(provincePriceCompare(300, 270)?.side).toBe('external')
  })

  it('差异小于阈值（默认 3%）→ 无显著差异', () => {
    expect(provincePriceCompare(300, 306)?.side).toBe('comparable')
  })

  it('任一侧缺失/非正 → null（不比）', () => {
    expect(provincePriceCompare(null, 300)).toBeNull()
    expect(provincePriceCompare(300, 0)).toBeNull()
  })
})

describe('供需比 → 历史价格区间映射（#1962）', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({
    ratio: 1.1 + (i % 3) * 0.01,
    priceYuanPerMwh: 200 + i * 5
  }))

  it('邻域样本充足 → 给 P10/P50/P90', () => {
    const r = historicalPriceBand(1.1, history)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.p10).toBeLessThanOrEqual(r.p50)
      expect(r.p50).toBeLessThanOrEqual(r.p90)
      expect(r.count).toBeGreaterThanOrEqual(8)
    }
  })

  it('样本不足 → insufficient（不硬给区间），无输入 → no_input', () => {
    const r = historicalPriceBand(1.5, history)
    expect(r.status).toBe('insufficient')
    expect(historicalPriceBand(1.1, []).status).toBe('no_input')
    expect(historicalPriceBand(Number.NaN, history).status).toBe('no_input')
  })
})
