// 中长期售电合同展示口径单测（dljy#2939）。
// 守什么不变量：未知不显示成 0；交割期结束不显示逾期；缺分解月份不显示为真实零持仓；
// 不可比价格口径不给统一均价；名义金额不完整时明示；切换公司后迟到响应被丢弃。
// 坏掉的症状：页面把缺价合同拉低均价、把结束合同标红成违约、把未分解月份画成 0 持仓、切公司后闪现上一家公司数据。
import { describe, expect, it } from 'vitest'
import {
  averagePriceLabel, confirmationTag, createLoadGuard, fmtPrice, fmtQuantity, fmtRatio, monthQuantityLabel,
  notionalAmountLabel, progressTag, qualityTags,
} from './midlongFormat'
import type { MidlongPositionMonth, MidlongPriceSummary } from './midlongTypes'

const price = (overrides: Partial<MidlongPriceSummary> = {}): MidlongPriceSummary => ({
  groups: [], comparable: true, averagePrice: null, knownPriceQuantity: '0', unknownPriceQuantity: '0', coverageRatio: null,
  knownNotionalAmount: null, notionalAmountComplete: false, environmentValue: null, ...overrides,
})

describe('数值展示', () => {
  it('未知电量/价格不显示 0；已知 0 正常显示', () => {
    expect(fmtQuantity(null)).toBe('未知')
    expect(fmtPrice(null)).toBe('待核对')
    expect(fmtPrice('0')).toBe('0')
    expect(fmtQuantity('12000.5')).toBe('12,000.5')
  })
  it('覆盖率分母为零显示「无分母」而不是 0%', () => {
    expect(fmtRatio(null)).toBe('无分母')
    expect(fmtRatio('0.5')).toBe('50%')
  })
})

describe('状态标签', () => {
  it('交割期已结束是中性状态，不出现逾期或违约', () => {
    const tag = progressTag('DELIVERY_ENDED')
    expect(tag.type).toBe('info')
    expect(tag.label).not.toMatch(/逾期|违约|结清/)
  })
  it('待核对为警示色、已确认为成功色', () => {
    expect(confirmationTag('PENDING_VERIFICATION')).toEqual({ label: '待核对', type: 'warning' })
    expect(confirmationTag('CONFIRMED').type).toBe('success')
  })
  it('阻止核验的缺口与一般提示区分', () => {
    const tags = qualityTags(['MISSING_EVIDENCE', 'MISSING_PRICE'])
    expect(tags.map((t) => [t.flag, t.blocksVerification])).toEqual([['MISSING_EVIDENCE', true], ['MISSING_PRICE', false]])
  })
})

describe('月度持仓展示', () => {
  const month = (formalQuantity: string, incomplete: boolean): MidlongPositionMonth => ({
    month: '2027-02', formalQuantity, contractCount: 1, incomplete, affectedContractIds: incomplete ? [1] : [], price: price(),
  })
  it('缺分解的月份不显示成真实零持仓', () => {
    expect(monthQuantityLabel(month('0', true))).toBe('未分解（非零持仓）')
    expect(monthQuantityLabel(month('800', true))).toBe('800（另有未分解）')
    expect(monthQuantityLabel(month('0', false))).toBe('0')
  })
  it('半数有价：均价取已知部分，名义金额标不完整', () => {
    const p = price({ averagePrice: '300', knownPriceQuantity: '500', unknownPriceQuantity: '500', coverageRatio: '0.5', knownNotionalAmount: '150000', notionalAmountComplete: false, groups: [{ currency: 'CNY', taxBasis: 'TAX_INCLUDED', priceComponent: 'ENERGY_ONLY', knownQuantity: '500', notionalAmount: '150000', averagePrice: '300' }] })
    expect(averagePriceLabel(p)).toBe('300 元/MWh')
    expect(notionalAmountLabel(p)).toBe('150,000 元（仅已知部分，总额不完整）')
  })
  it('口径不可比时不给统一均价与金额', () => {
    const p = price({ comparable: false })
    expect(averagePriceLabel(p)).toBe('口径不可比（见分组）')
    expect(notionalAmountLabel(p)).toBe('口径不可比（见分组）')
  })
})

describe('迟到响应守卫', () => {
  it('公司 A 的请求在切到公司 B 后返回，结果被丢弃', () => {
    const guard = createLoadGuard()
    const tokenA = guard.begin('comp-a|yunnan')
    const tokenB = guard.begin('comp-b|yunnan')
    expect(guard.isCurrent(tokenA, 'comp-b|yunnan')).toBe(false)
    expect(guard.isCurrent(tokenB, 'comp-b|yunnan')).toBe(true)
  })
  it('同一上下文较早发起的请求也被较新的请求作废', () => {
    const guard = createLoadGuard()
    const first = guard.begin('comp-a|yunnan|page1')
    guard.begin('comp-a|yunnan|page1')
    expect(guard.isCurrent(first, 'comp-a|yunnan|page1')).toBe(false)
  })
  it('上下文已变化但尚未发起新请求时，在途结果同样丢弃', () => {
    const guard = createLoadGuard()
    const token = guard.begin('comp-a|yunnan')
    expect(guard.isCurrent(token, 'comp-b|yunnan')).toBe(false)
  })
})
