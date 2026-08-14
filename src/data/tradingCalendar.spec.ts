import { describe, expect, it } from 'vitest'
import {
  TRADING_CALENDAR,
  defaultTargetDate,
  getTradingCalendar,
  shiftIsoDate,
  workdaySummary,
  workdayView
} from 'shared/trading-rules/trading-calendar.mjs'

describe('未登记地区诚实返回 null（不回落他省口径）', () => {
  it('云南（UI 默认地区）未登记 D+N 口径', () => {
    // 口径与时刻同理：编一个「今天做 D+几」比不给更危险——交易员照它建单。
    expect(getTradingCalendar('yunnan')).toBeNull()
    expect(defaultTargetDate('yunnan', '2026-08-15')).toBeNull()
  })

  it('未知地区同样为 null', () => {
    expect(getTradingCalendar('atlantis')).toBeNull()
  })

  it('已登记地区带口径依据且标注待复核', () => {
    const xj = getTradingCalendar('xinjiang')!
    expect(xj.source).toContain('2026-08-13')
    expect(xj.verify).toBe(true)
  })
})

describe('会议口径固化为新疆条目（2026-08-13 §3.4）', () => {
  it('今天做 D+2、现货可报 D+1/D+2、撮合 D+2、出清看 D-3', () => {
    const v = workdayView(TRADING_CALENDAR.xinjiang, '2026-08-15')
    expect(v.primarySpot).toEqual({ offset: 2, date: '2026-08-17' })
    expect(v.spotTargets.map((t) => t.offset)).toEqual([1, 2])
    expect(v.mltMatching).toEqual({ offset: 2, date: '2026-08-17' })
    expect(v.latestCleared).toEqual({ offset: -3, date: '2026-08-12' })
  })

  it('山西传统口径：今天报 D+1，撮合与可见出清偏移未登记', () => {
    const sx = TRADING_CALENDAR.shanxi
    const v = workdayView(sx, '2026-08-15')
    expect(v.primarySpot).toEqual({ offset: 1, date: '2026-08-16' })
    expect(v.spotTargets.map((t) => t.offset)).toEqual([1])
    expect(v.mltMatching).toBeNull()
    expect(v.latestCleared).toBeNull()
  })
})

describe('shiftIsoDate 的日算术', () => {
  it('跨月与跨年', () => {
    expect(shiftIsoDate('2026-08-31', 1)).toBe('2026-09-01')
    expect(shiftIsoDate('2026-12-31', 2)).toBe('2027-01-02')
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('闰年二月', () => {
    // 2028 是闰年：2 月 28 日 +1 天 = 2 月 29 日
    expect(shiftIsoDate('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('默认标的日按地区口径取值', () => {
  it('新疆默认 D+2、山西默认 D+1', () => {
    expect(defaultTargetDate('xinjiang', '2026-08-15')).toBe('2026-08-17')
    expect(defaultTargetDate('shanxi', '2026-08-15')).toBe('2026-08-16')
  })
})

describe('workdaySummary 摘要', () => {
  it('新疆摘要含 D+2 / D+1/D+2 / 撮合 / D-3 / 锁定', () => {
    const s = workdaySummary(TRADING_CALENDAR.xinjiang, '2026-08-15')
    expect(s).toContain('D+2')
    expect(s).toContain('D+1/D+2')
    expect(s).toContain('中长期撮合报 D+2')
    expect(s).toContain('D-3')
    expect(s).toContain('锁定不可调')
  })

  it('山西单标的省不输出「可报」段（只有一档）', () => {
    const s = workdaySummary(TRADING_CALENDAR.shanxi, '2026-08-15')
    expect(s).toContain('今天做 D+1')
    expect(s).not.toContain('现货可报')
    expect(s).not.toContain('撮合')
  })
})
