import { describe, expect, it } from 'vitest'
import { POSITION_REVIEW_FOCUS, reviewFocusOf } from 'shared/trading-rules/position-review.mjs'

describe('立场复盘焦点（#2005）：三类身份目标正相反', () => {
  it('售电（用户侧）= 买方框架：成本最低 + 买没买到', () => {
    const f = reviewFocusOf('RETAILER')
    expect(f?.frame).toBe('buyer')
    expect(f?.goal).toContain('成本最低')
    expect(f?.reviewPoints.join()).toContain('买没买到')
    expect(f?.s6Scope).toBe('applicable')
  })

  it('电厂（电源侧）= 卖方框架：收入最高 + 卖没卖掉/合同敞口（镜像口径）', () => {
    const f = reviewFocusOf('GENERATOR')
    expect(f?.frame).toBe('seller')
    expect(f?.goal).toContain('收入最高')
    expect(f?.reviewPoints.join()).toContain('卖没卖掉')
    expect(f?.reviewPoints.join()).toContain('合同敞口')
    expect(f?.s6Scope).toBe('mirrored')
  })

  it('储能 = 套利框架：S6 明确不套买方缺口逻辑（not_primary）', () => {
    const f = reviewFocusOf('STORAGE')
    expect(f?.frame).toBe('storage')
    expect(f?.reviewPoints.join()).toContain('窗口吃到没')
    expect(f?.s6Scope).toBe('not_primary')
    expect(f?.s6Note).toContain('不套买方')
  })

  it('大用户与售电同框架（买方）；组合视角跟随立场；集团不作业', () => {
    expect(reviewFocusOf('LOAD')?.frame).toBe('buyer')
    expect(reviewFocusOf('TRADER')?.s6Scope).toBe('applicable')
    expect(reviewFocusOf('GROUP')?.frame).toBe('none')
  })

  it('未知/空立场返回 null，不猜', () => {
    expect(reviewFocusOf(null)).toBeNull()
    expect(reviewFocusOf('atlantis')).toBeNull()
  })

  it('六类立场全部登记（防漏配）', () => {
    expect(Object.keys(POSITION_REVIEW_FOCUS).sort()).toEqual(
      ['GENERATOR', 'GROUP', 'LOAD', 'RETAILER', 'STORAGE', 'TRADER'].sort()
    )
  })
})
