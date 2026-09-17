// 与 spec delta（spot-trading-date-defaults）三条 Scenario 一一对应的回归网。
import { describe, expect, it } from 'vitest'
import {
  latestOfDates,
  resolveCockpitInitialDate,
  resolveDefaultRunDate
} from '@/utils/spotDateDefaults'

describe('spotDateDefaults 默认日期解析', () => {
  describe('resolveDefaultRunDate（日前上报，优先级 深链 > 清单最新日 > 回退）', () => {
    it('场景一：URL 带日期参数时参数优先，忽略清单', () => {
      expect(resolveDefaultRunDate('2026-05-01', ['2026-06-01', '2026-06-04'], '2026-06-04')).toBe('2026-05-01')
    })

    it('场景二：无参数且清单可用时取最新可用日（乱序列表也取 max）', () => {
      expect(resolveDefaultRunDate('', ['2026-05-28', '2026-06-04', '2026-05-30'], '2026-01-01')).toBe('2026-06-04')
    })

    it('场景三：清单缺失/为空时回退已知常量', () => {
      expect(resolveDefaultRunDate('', [], '2026-06-04')).toBe('2026-06-04')
    })
  })

  describe('latestOfDates', () => {
    it('空列表返回 null（不编造日期）', () => {
      expect(latestOfDates([])).toBeNull()
    })
  })

  describe('resolveCockpitInitialDate（驾驶舱，覆盖区内取今天/区外取末日/未知回退常量）', () => {
    const FALLBACK = '2026-05-01'

    it('覆盖区包含今天 → 取今天', () => {
      expect(resolveCockpitInitialDate('2026-05-20', { start: '2025-07-01', end: '2026-07-01' }, FALLBACK)).toBe('2026-05-20')
    })

    it('今天超出覆盖区（回放滞后）→ 取覆盖区最后一天', () => {
      expect(resolveCockpitInitialDate('2026-09-17', { start: '2025-07-01', end: '2026-07-01' }, FALLBACK)).toBe('2026-07-01')
    })

    it('覆盖区间不可得 → 回退已知常量，不猜今天', () => {
      expect(resolveCockpitInitialDate('2026-09-17', null, FALLBACK)).toBe(FALLBACK)
      expect(resolveCockpitInitialDate('2026-09-17', { start: '2025-07-01', end: '' }, FALLBACK)).toBe(FALLBACK)
    })
  })
})
