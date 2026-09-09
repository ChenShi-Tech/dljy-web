import { describe, expect, it } from 'vitest'
import { reviewBusinessViews, reviewTopic, reviewView, settlementSelectionFromQuery, settlementSelectionQuery, type SettlementSelection } from './reviewTopics'
describe('专题业务视角与深链接', () => {
  it('周期、人工参考期、厂站多选展开后保留，关闭人工参考清除旧范围', () => {
    const selection: SettlementSelection = { date: '2026-05-31', cadence: 'month', manual: true, referenceStart: '2026-03-01', referenceEnd: '2026-03-31', plants: ['厂站一', '厂站二'] }
    expect(settlementSelectionFromQuery(settlementSelectionQuery(selection), '2026-06-01')).toEqual(selection)
    const query = settlementSelectionQuery({ ...selection, manual: false })
    expect(query.referenceStart).toBeUndefined()
    expect(query.referenceEnd).toBeUndefined()
  })
  it('三业务视角保留全部比较口径，未知主题不成为任意模块入口', () => {
    for (const view of Object.values(reviewBusinessViews)) expect(new Set(view.bases).size).toBe(3)
    expect(reviewView('storage')).toBe('storage')
    expect(reviewTopic('database')).toBe('settlement')
    expect(reviewTopic(undefined, true)).toBe('energy')
  })
})
