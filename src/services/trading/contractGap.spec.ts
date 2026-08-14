import { describe, expect, it } from 'vitest'
import { assessContractGap } from './contractGap'

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
