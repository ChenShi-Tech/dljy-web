import { describe, expect, it } from 'vitest'
import { assessContractGap, assessContractGapForPosition, kellyPositionCap, listingVsAnnualAverage, timingWithDistribution, volatilityGuard } from './contractGap'

describe('S6 中长期补仓：敞口评估（买方立场）', () => {
  it('敞口 = 预测 − 持仓；敞口率以预测为分母', () => {
    const r = assessContractGap({ forecastMwh: 1000, contractedMwh: 800, regime: 'balanced', direction: null })
    expect(r.gapMwh).toBe(200)
    expect(r.gapPct).toBeCloseTo(0.2, 4)
  })

  it('无有效预测：不动作且敞口率为 null——不能在没有分母的情况下给建议', () => {
    const r = assessContractGap({ forecastMwh: 0, contractedMwh: 500, regime: 'tight', direction: null })
    expect(r.suggestion).toBe('hold')
    expect(r.gapPct).toBeNull()
    expect(r.reason).toContain('S3')
  })

  it('观望带内不动作（默认 ±5%）：动仓的交易成本大于敞口损益', () => {
    const inside = assessContractGap({ forecastMwh: 1000, contractedMwh: 950, regime: 'tight', direction: null })
    expect(inside.suggestion).toBe('hold')
    // 越出观望带才给动作建议——同样是偏紧市，5% 和 6% 是两个建议
    const outside = assessContractGap({ forecastMwh: 1000, contractedMwh: 940, regime: 'tight', direction: null })
    expect(outside.suggestion).toBe('buy-urgent')
  })

  it('缺口 × 现货贵（tight/scarce）→ 尽快补仓：缺口按高价现货结算', () => {
    for (const regime of ['tight', 'scarce'] as const) {
      const r = assessContractGap({ forecastMwh: 1000, contractedMwh: 800, regime, direction: null })
      expect(r.suggestion).toBe('buy-urgent')
    }
  })

  it('缺口 × 现货便宜 → 默认刻意留敞口吃低价；S3 判增持才买', () => {
    const hold = assessContractGap({ forecastMwh: 1000, contractedMwh: 800, regime: 'surplus', direction: null })
    expect(hold.suggestion).toBe('hold')
    const buy = assessContractGap({ forecastMwh: 1000, contractedMwh: 800, regime: 'extreme_surplus', direction: 'add' })
    expect(buy.suggestion).toBe('buy')
  })

  it('缺口 × 平衡市或态势未知 → 按计划补齐（buy），未知时理由必须写明没有判断', () => {
    const balanced = assessContractGap({ forecastMwh: 1000, contractedMwh: 800, regime: 'balanced', direction: null })
    expect(balanced.suggestion).toBe('buy')
    const unknown = assessContractGap({ forecastMwh: 1000, contractedMwh: 800, regime: null, direction: null })
    expect(unknown.suggestion).toBe('buy')
    expect(unknown.reason).toContain('未产出')
  })

  it('超签 × 现货便宜 → 挂牌转让止损：低价回售必然亏合同均价', () => {
    const r = assessContractGap({ forecastMwh: 800, contractedMwh: 1000, regime: 'surplus', direction: null })
    expect(r.gapMwh).toBe(-200)
    expect(r.suggestion).toBe('sell')
  })

  it('超签 × 现货贵 → 默认不动（高价回售有利）；S3 判减持才趁高转让', () => {
    const hold = assessContractGap({ forecastMwh: 800, contractedMwh: 1000, regime: 'scarce', direction: null })
    expect(hold.suggestion).toBe('hold')
    const sell = assessContractGap({ forecastMwh: 800, contractedMwh: 1000, regime: 'tight', direction: 'reduce' })
    expect(sell.suggestion).toBe('sell')
  })

  it('超签 × 平衡市 → 不动：回售损益中性，转让还要付交易成本', () => {
    const r = assessContractGap({ forecastMwh: 800, contractedMwh: 1000, regime: 'balanced', direction: null })
    expect(r.suggestion).toBe('hold')
  })

  it('**方向反转敏感性**：同一缺口，把现货从贵换到便宜，建议必须从急买翻到观望', () => {
    // 这条是防「regime 参数被忽略」的变异哨兵：若实现无视 regime，两个断言必有一个红
    const expensive = assessContractGap({ forecastMwh: 1000, contractedMwh: 700, regime: 'scarce', direction: null })
    const cheap = assessContractGap({ forecastMwh: 1000, contractedMwh: 700, regime: 'extreme_surplus', direction: null })
    expect(expensive.suggestion).toBe('buy-urgent')
    expect(cheap.suggestion).toBe('hold')
  })
})

describe('#1966：挂牌价 vs 年度均价', () => {
  it('低于年均价 → 补仓划算；高于 → 不补', () => {
    const below = listingVsAnnualAverage(260, 300)
    expect(below?.verdict).toBe('below')
    expect(below?.hint).toContain('划算')
    const above = listingVsAnnualAverage(330, 300)
    expect(above?.verdict).toBe('above')
  })

  it('±3% 内算无显著差异；缺输入 null', () => {
    expect(listingVsAnnualAverage(305, 300)?.verdict).toBe('comparable')
    expect(listingVsAnnualAverage(null, 300)).toBeNull()
    expect(listingVsAnnualAverage(300, 0)).toBeNull()
  })
})

describe('#1966：概率分布判时机', () => {
  const digest = { mean: 300, valley: 200, peak: 450 }
  it('挂牌价低于均值 5% 以上 → 锁价', () => {
    expect(timingWithDistribution(270, digest)?.verdict).toBe('lock_now')
  })
  it('高于均值 5% 以上 → 观望；±5% 内中性', () => {
    expect(timingWithDistribution(330, digest)?.verdict).toBe('wait')
    expect(timingWithDistribution(300, digest)?.verdict).toBe('neutral')
  })
  it('缺挂牌价或分布 → null', () => {
    expect(timingWithDistribution(null, digest)).toBeNull()
    expect(timingWithDistribution(300, null)).toBeNull()
  })
})

describe('#1966：波动守卫（>5% 暂停 + 对冲）', () => {
  it('超 ±5% → 暂停并给对冲建议', () => {
    const g = volatilityGuard(6.2)
    expect(g.paused).toBe(true)
    expect(g.hint).toContain('暂停补仓')
    expect(g.hint).toContain('对冲')
  })
  it('带内不暂停；未录入提示守卫不生效（不默认安全）', () => {
    expect(volatilityGuard(3).paused).toBe(false)
    const na = volatilityGuard(null)
    expect(na.paused).toBe(false)
    expect(na.hint).toContain('未录入')
  })
})

describe('#1966：凯利仓位上限', () => {
  const digest = { mean: 300, valley: 200 }
  it('胜率取 S3 置信度，半 Kelly × 风险预算封顶', () => {
    const k = kellyPositionCap({ confidencePct: 70, listingYuanPerMwh: 260, digest, riskBudgetPct: 18 })
    expect(k).not.toBeNull()
    expect(k!.winYuanPerMwh).toBe(40)
    expect(k!.lossYuanPerMwh).toBe(60)
    expect(k!.capPct).toBeGreaterThan(0)
    expect(k!.capPct).toBeLessThanOrEqual(18)
    expect(k!.note).toContain('半 Kelly')
  })
  it('置信度 50 以下（无把握）→ 上限趋零（低风险操作）', () => {
    const k = kellyPositionCap({ confidencePct: 40, listingYuanPerMwh: 299, digest })
    expect(k!.capPct).toBeLessThanOrEqual(1)
  })
  it('缺任一输入 → null', () => {
    expect(kellyPositionCap({ confidencePct: null, listingYuanPerMwh: 260, digest })).toBeNull()
    expect(kellyPositionCap({ confidencePct: 70, listingYuanPerMwh: null, digest })).toBeNull()
  })
})

describe('#2005：立场感知补仓口径', () => {
  const base = { forecastMwh: 1000, contractedMwh: 800, regime: 'tight' as const, direction: null }

  it('买方（售电）原口径不变', () => {
    const r = assessContractGapForPosition({ ...base, position: 'RETAILER' })
    expect(r.frame).toBe('buyer')
    expect(r.gapMwh).toBe(200)
    expect(r.suggestion).toBe('buy-urgent')
  })

  it('卖方（电厂）镜像：合同>预测发电=合同缺口，语义与建议翻转', () => {
    // 合同 1200 > 预测发电 1000 → 缺 200 需补；现货偏紧时买回贵 → 紧急处理
    const r = assessContractGapForPosition({ forecastMwh: 1000, contractedMwh: 1200, regime: 'tight', direction: null, position: 'GENERATOR' })
    expect(r.frame).toBe('seller')
    expect(r.gapMwh).toBe(200)
    expect(r.gapLabel).toContain('合同缺口')
    expect(r.reason).toContain('合同缺口')
  })

  it('卖方富余：现货便宜 → 多签锁价提示', () => {
    const r = assessContractGapForPosition({ forecastMwh: 1200, contractedMwh: 800, regime: 'surplus', direction: null, position: 'GENERATOR' })
    expect(r.gapMwh).toBe(-400)
    expect(r.reason).toContain('富余')
    expect(r.reason).toContain('锁价')
  })

  it('储能：明确不套买方逻辑（frame=storage，数字仅参考）', () => {
    const r = assessContractGapForPosition({ ...base, position: 'STORAGE' })
    expect(r.frame).toBe('storage')
    expect(r.reason).toContain('套利')
    expect(r.reason).toContain('不适用') // 直接包含或经说明——储能口径说明
  })
})
