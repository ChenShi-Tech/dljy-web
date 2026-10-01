import { describe, expect, it } from 'vitest'
import { todayOverviewOf } from '@/services/hedge/hedgeTodayModel'
import { calculationReason, hasGeneration, latestGenerationRange } from './hedgePresentation'

describe('套保日期与不可计算原因', () => {
  it('午夜水位对应前一天，两日窗口不越到下一日', () => {
    const data = todayOverviewOf({  legs: { rows: [{ key: 'ACTUAL', dataThrough: '2026-06-01T00:00:00+08:00' }] } })
    expect(latestGenerationRange(data)).toEqual({ fromDate: '2026-05-30', toDate: '2026-05-31' })
  })
  it('无实际水位不使用预测水位猜测历史日期', () => {
    expect(latestGenerationRange(todayOverviewOf({ legs: { rows: [{ key: 'FORECAST_VENDOR', dataThrough: '2026-06-01T00:00:00+08:00' }] } }))).toBeNull()
  })
  it('部分场站有数据仍可发现历史窗口，但不冒充公司已覆盖', () => {
    const data = todayOverviewOf({ intervals: [{ generation: { value: null, knownStationCount: 35 }, covered: false }] })
    expect(hasGeneration(data)).toBe(true)
    expect(calculationReason(data, false)).toContain('部分场站')
    expect(data.intervals[0].generation.value).toBeNull()
  })
  it('无数据与零分母分别解释', () => {
    expect(calculationReason(todayOverviewOf({}), false)).toContain('没有可用发电量')
    const data = todayOverviewOf({ intervals: [{ covered: true, generation: { value: '0' }, locked: { midlong: '0', mechanism: { value: null } } }] })
    expect(calculationReason(data, true)).toContain('合计为零')
  })
  it('含机制不可计算来自机制缺失，独立于仅中长期口径', () => {
    const data = todayOverviewOf({ intervals: [{ covered: true, generation: { value: '100' }, locked: { midlong: '0', mechanism: { value: null } } }] })
    expect(calculationReason(data, true)).toContain('机制电量未覆盖')
    expect(calculationReason(data, false)).not.toContain('登记')
  })
})
