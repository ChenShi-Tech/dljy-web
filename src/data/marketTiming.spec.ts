import { describe, expect, it } from 'vitest'
import {
  bidDeadlineUrgency,
  getMarketTiming,
  minutesUntil,
  settlementUnitHint,
  MARKET_TIMING
} from 'shared/trading-rules/market-timing.mjs'

function at(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(2026, 7, 10, h, m, 0, 0)
  return d
}

describe('未登记地区诚实返回 null', () => {
  it('云南（UI 默认地区）未登记市场时序，不回落他省时刻表', () => {
    // 一个错的申报截止时刻比没有时刻更危险——交易员会照着它排班。
    expect(getMarketTiming('yunnan')).toBeNull()
  })

  it('未知地区同样为 null', () => {
    expect(getMarketTiming('atlantis')).toBeNull()
  })

  it('已登记地区带规则依据且标注是否待复核', () => {
    const xj = getMarketTiming('xinjiang')!
    expect(xj.source).toContain('新疆')
    expect(xj.verify).toBe(true)
  })
})

describe('申报死线紧迫度由 rulepack 的三级提醒时刻驱动', () => {
  const xj = MARKET_TIMING.xinjiang // 截止 08:45，提醒 08:30/08:40/08:43

  it('提醒时刻前为常态', () => {
    expect(bidDeadlineUrgency(xj, at('07:30'))).toBe('normal')
  })

  it('依次跨过蓝/黄/红三级提醒', () => {
    expect(bidDeadlineUrgency(xj, at('08:31'))).toBe('notice')
    expect(bidDeadlineUrgency(xj, at('08:41'))).toBe('warning')
    expect(bidDeadlineUrgency(xj, at('08:44'))).toBe('critical')
  })

  it('过截止即 passed（不可挽回的死线）', () => {
    expect(bidDeadlineUrgency(xj, at('08:46'))).toBe('passed')
  })

  it('换省只换数据、判级逻辑不动：山西 09:30 截止走同一套判级', () => {
    const sx = MARKET_TIMING.shanxi
    // 同一个 08:41，新疆已进黄色预警，山西还在常态——证明时刻没有写死在逻辑里
    expect(bidDeadlineUrgency(xj, at('08:41'))).toBe('warning')
    expect(bidDeadlineUrgency(sx, at('08:41'))).toBe('normal')
    expect(bidDeadlineUrgency(sx, at('09:21'))).toBe('warning')
  })
})

describe('出清粒度与结算粒度必须分开建模', () => {
  it('山西 5 分钟实时出清 / 15 分钟结算，是两个独立字段', () => {
    const sx = MARKET_TIMING.shanxi
    expect(sx.rtClearingIntervalMin).toBe(5)
    expect(sx.settlementIntervalMin).toBe(15)
    expect(sx.rtClearingIntervalMin).not.toBe(sx.settlementIntervalMin)
  })

  it('新疆小时算术平均结算 ⇒ 套利决策单元被拉平到小时', () => {
    const hint = settlementUnitHint(MARKET_TIMING.xinjiang)
    expect(hint).toContain('4 个 15 分钟点算术平均')
    expect(hint).toContain('小时内充放切换无价差收益')
  })

  it('山西 15 分钟直接结算 ⇒ 决策单元就是 15 分钟', () => {
    const hint = settlementUnitHint(MARKET_TIMING.shanxi)
    expect(hint).toContain('决策单元 = 15 分钟')
  })
})

describe('minutesUntil', () => {
  it('未到为正、已过为负', () => {
    expect(minutesUntil('08:45', at('08:15'))).toBe(30)
    expect(minutesUntil('08:45', at('09:00'))).toBe(-15)
  })
})
