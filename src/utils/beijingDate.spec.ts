// 北京时区「今天/本月」口径回归网：锚定 UTC+8 边界（北京 00:00 = UTC 前日 16:00），
// 防止新代码回退成裸 `new Date().toISOString().slice(0, 10)`（0–8 点返回昨天）。
import { describe, expect, it } from 'vitest'
import { beijingDay, currentMonthBeijing, todayBeijing } from '@/utils/beijingDate'

describe('beijingDate 北京时区业务日期', () => {
  it('北京零点后即翻日：UTC 前日 16:00（北京 00:00）已是新的一天', () => {
    // 2026-08-27T16:00:00Z = 北京 2026-08-28 00:00
    expect(todayBeijing(Date.UTC(2026, 7, 27, 16, 0, 0))).toBe('2026-08-28')
    // 一分钟前（UTC 15:59）仍是北京的 8-27
    expect(todayBeijing(Date.UTC(2026, 7, 27, 15, 59, 0))).toBe('2026-08-27')
  })

  it('北京 0–8 点窗口内不回退成 UTC 昨天（原病灶时段）', () => {
    // 2026-08-28T02:30:00Z = 北京 10:30，UTC 日期相同；再取 UTC 19:00（北京次日 03:00）
    expect(todayBeijing(Date.UTC(2026, 7, 28, 19, 0, 0))).toBe('2026-08-29')
  })

  it('月度默认：每月 1 日 0–8 点不回退成上月', () => {
    // 2026-08-31T17:00:00Z = 北京 2026-09-01 01:00，UTC 口径的 slice(0,7) 会给出 2026-08
    expect(currentMonthBeijing(Date.UTC(2026, 7, 31, 17, 0, 0))).toBe('2026-09')
  })

  it('beijingDay 往返与跨日偏移', () => {
    const t = Date.UTC(2026, 7, 27, 18, 0, 0) // 北京 2026-08-28 02:00
    expect(beijingDay(0, t)).toBe('2026-08-28')
    expect(beijingDay(-1, t)).toBe('2026-08-27')
    expect(beijingDay(1, t)).toBe('2026-08-29')
  })
})
