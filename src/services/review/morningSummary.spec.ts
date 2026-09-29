import { describe, expect, it } from 'vitest'
import {
  isOverdueAction,
  morningSummaryScopeKey,
  orderActions,
  toMorningSummaryState,
  type MorningSummaryState
} from './morningSummary'
import type { ImprovementActionSummary } from '@/services/review/reviewStoreApi'

const TODAY = '2026-09-28'

function action(overrides: Partial<ImprovementActionSummary>): ImprovementActionSummary {
  return {
    id: 'a1',
    action: '复核日前申报偏置档位',
    owner: '张三',
    dueDate: '2026-09-30',
    status: 'open',
    updatedAt: null,
    ...overrides
  }
}

describe('morningSummaryScopeKey', () => {
  it('三维 scope 任一不同则键不同', () => {
    const base = { companyId: 'c1', region: 'yunnan', targetDate: '2026-09-28' }
    expect(morningSummaryScopeKey(base)).toBe(morningSummaryScopeKey({ ...base }))
    expect(morningSummaryScopeKey(base)).not.toBe(morningSummaryScopeKey({ ...base, companyId: 'c2' }))
    expect(morningSummaryScopeKey(base)).not.toBe(morningSummaryScopeKey({ ...base, region: 'shanxi' }))
    expect(morningSummaryScopeKey(base)).not.toBe(morningSummaryScopeKey({ ...base, targetDate: '2026-09-27' }))
  })
})

describe('isOverdueAction', () => {
  it('回查日早于今日且仍 open/carried_over 才算过期未验证', () => {
    expect(isOverdueAction(action({ dueDate: '2026-09-27', status: 'open' }), TODAY)).toBe(true)
    expect(isOverdueAction(action({ dueDate: '2026-09-27', status: 'carried_over' }), TODAY)).toBe(true)
    expect(isOverdueAction(action({ dueDate: TODAY, status: 'open' }), TODAY)).toBe(false)
    expect(isOverdueAction(action({ dueDate: '2026-09-30', status: 'open' }), TODAY)).toBe(false)
  })

  it('无回查日不推算过期；已闭环状态不算过期', () => {
    expect(isOverdueAction(action({ dueDate: null, status: 'open' }), TODAY)).toBe(false)
    expect(isOverdueAction(action({ dueDate: '2026-09-01', status: 'done' }), TODAY)).toBe(false)
    expect(isOverdueAction(action({ dueDate: '2026-09-01', status: 'dropped' }), TODAY)).toBe(false)
  })
})

describe('orderActions', () => {
  it('过期未验证置顶，其余按回查日升序、无回查日垫后，同序稳定', () => {
    const overdueA = action({ id: 'overdue-a', dueDate: '2026-09-20' })
    const overdueB = action({ id: 'overdue-b', dueDate: '2026-09-19' })
    const soon = action({ id: 'soon', dueDate: '2026-09-29' })
    const later = action({ id: 'later', dueDate: '2026-10-05' })
    const noDue = action({ id: 'no-due', dueDate: null })
    const ordered = orderActions([noDue, later, overdueA, soon, overdueB], TODAY)
    expect(ordered.map((a) => a.id)).toEqual(['overdue-a', 'overdue-b', 'soon', 'later', 'no-due'])
    expect(ordered[0]?.overdue).toBe(true)
    expect(ordered[2]?.overdue).toBe(false)
  })
})

describe('toMorningSummaryState', () => {
  it('unauthorized 归无权限，endpoint-absent/unreachable 同归读取失败（不冒充空产物）', () => {
    expect(toMorningSummaryState({ available: false, reason: 'unauthorized' }, TODAY)).toEqual({ kind: 'unauthorized' })
    expect(toMorningSummaryState({ available: false, reason: 'endpoint-absent' }, TODAY)).toEqual({ kind: 'unavailable' })
    expect(toMorningSummaryState({ available: false, reason: 'unreachable' }, TODAY)).toEqual({ kind: 'unavailable' })
  })

  it('可用但无未闭环措施 = 诚实空态；有措施 = ok 且已排序', () => {
    expect(toMorningSummaryState({ available: true, actions: [] }, TODAY)).toEqual({ kind: 'empty' })
    const state: MorningSummaryState = toMorningSummaryState(
      { available: true, actions: [action({ id: 'x', dueDate: '2026-09-20' })] },
      TODAY
    )
    expect(state).toEqual({
      kind: 'ok',
      actions: [{ ...action({ id: 'x', dueDate: '2026-09-20' }), overdue: true }]
    })
  })

  it('缺 actions 字段的可用响应按空处理，不猜', () => {
    expect(toMorningSummaryState({ available: true }, TODAY)).toEqual({ kind: 'empty' })
  })
})
