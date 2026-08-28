// 日历日期纯工具测试（?date= 守卫 + 连续判定断链同源）。
import { describe, expect, it } from 'vitest'
import { isRealCalendarDate, nextDayOf } from './calendarDate'

describe('isRealCalendarDate（形态+语义双守卫）', () => {
  it('合法日期通过：平年/闰年/跨月边界', () => {
    expect(isRealCalendarDate('2026-08-27')).toBe(true)
    expect(isRealCalendarDate('2024-02-29')).toBe(true) // 闰年
    expect(isRealCalendarDate('2026-12-31')).toBe(true)
  })

  it('伪日期拒绝：形态不符 / 非法月 / 非法日 / 非闰年 2-29', () => {
    expect(isRealCalendarDate('2026-8-27')).toBe(false) // 缺前导零
    expect(isRealCalendarDate('2026-13-01')).toBe(false) // 13 月
    expect(isRealCalendarDate('2026-00-10')).toBe(false) // 0 月
    expect(isRealCalendarDate('2026-02-30')).toBe(false) // 2 月 30 日不存在
    expect(isRealCalendarDate('2025-02-29')).toBe(false) // 非闰年
    expect(isRealCalendarDate('2026-08-32')).toBe(false)
    expect(isRealCalendarDate('abc')).toBe(false)
    expect(isRealCalendarDate('')).toBe(false)
  })
})

describe('nextDayOf（UTC 锚定逐日推进；非法返回 null）', () => {
  it('普通/跨月/跨年/闰年进位正确', () => {
    expect(nextDayOf('2026-08-27')).toBe('2026-08-28')
    expect(nextDayOf('2026-08-31')).toBe('2026-09-01') // 跨月
    expect(nextDayOf('2026-12-31')).toBe('2027-01-01') // 跨年
    expect(nextDayOf('2024-02-28')).toBe('2024-02-29') // 闰年
    expect(nextDayOf('2025-02-28')).toBe('2025-03-01') // 平年
  })

  it('形态/语义非法返回 null（调用方按断链处理）', () => {
    expect(nextDayOf('d1')).toBeNull() // 占位串
    expect(nextDayOf('2026-02-30')).toBeNull() // 伪日期
    expect(nextDayOf('2026-13-01')).toBeNull()
    expect(nextDayOf('')).toBeNull()
  })
})
