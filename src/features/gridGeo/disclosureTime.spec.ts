// Source-time parsing must not depend on the reader's browser timezone. dljy#2897.
import { describe, expect, it } from 'vitest'
import { disclosureEventWindow, disclosureMinuteText, parseDisclosureTime } from './disclosureTime'
import type { GridDisclosureEvent } from './types'

describe('披露时间口径', () => {
  it('空格或T分隔且未带时区均按北京时刻，有显式时区保持原始瞬间', () => {
    const expected = Date.parse('2026-07-01T02:15:30.125Z')
    for (const value of ['2026-07-01T10:15:30.125', '2026-07-01 10:15:30.125', '2026-07-01T10:15:30.125+08:00', '2026-06-30T19:15:30.125-07:00']) {
      expect(parseDisclosureTime(value)).toBe(expected)
      expect(disclosureMinuteText(value)).toBe('2026-07-01 10:15')
    }
    expect(parseDisclosureTime('2026-07-01T02:15:30.125Z')).toBe(expected)
  })
  it('严格拒绝非法日历日期/时间；日级记录需要显式许可', () => {
    for (const value of ['2026-02-30T10:00', '2026-07-01T24:00', '2026-07-01T12:60', '2026-07-01T12:00:60', '2026-07-01', 'bad']) expect(parseDisclosureTime(value)).toBeNull()
    expect(parseDisclosureTime('2024-02-29', true)).toBe(Date.parse('2024-02-28T16:00:00Z'))
    expect(parseDisclosureTime('2026-02-29', true)).toBeNull()
  })
  it('未知、非法开始不画线，异常结束仅保留可确认的开始点', () => {
    const event = { effectiveAt: '2026-07-01T10:00', expiresAt: '2026-07-01T11:00' } as GridDisclosureEvent
    expect(disclosureEventWindow(event)).toEqual({ from: event.effectiveAt, to: event.expiresAt })
    for (const effective of ['unknown', 'business-date'] as const) expect(disclosureEventWindow({ ...event, timeQuality: { effective } as GridDisclosureEvent['timeQuality'] })).toBeNull()
    expect(disclosureEventWindow({ ...event, effectiveAt: '2026-02-30T10:00' })).toBeNull()
    for (const expiresAt of ['bad', '2026-07-01T09:00', '2026-07-01']) expect(disclosureEventWindow({ ...event, expiresAt })).toEqual({ from: event.effectiveAt, to: null })
    expect(disclosureEventWindow({ ...event, timeQuality: { effective: 'source', issues: ['invalid-effective-time'] } as GridDisclosureEvent['timeQuality'] })).toBeNull()
  })
})
