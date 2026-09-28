import { describe, expect, it } from 'vitest'
import { PRICE_DRIVERS_PATH, resolvePriceDriversRedirect } from './priceDriversRedirect'

// 旧关系页 → 价格驱动分析跳转映射（dljy#3390）：预选 driver + 透传 date/days/mode 白名单，
// 旧页专属 view/cols 控件参数随散点矩阵删除而丢弃。
describe('resolvePriceDriversRedirect', () => {
  it('旧地址跳转保留 date/days/mode 并注入对应 driver', () => {
    expect(
      resolvePriceDriversRedirect('renewable', { date: '2026-05-01', days: '30', mode: 'realtime', view: 'matrix' })
    ).toEqual({ path: PRICE_DRIVERS_PATH, query: { date: '2026-05-01', days: '30', mode: 'realtime', driver: 'renewable' } })

    expect(
      resolvePriceDriversRedirect('load', { date: '2026-05-01', days: '7' })
    ).toEqual({ path: PRICE_DRIVERS_PATH, query: { date: '2026-05-01', days: '7', driver: 'load' } })
  })

  it('丢弃 view/cols 等不再适用的旧控件参数', () => {
    const target = resolvePriceDriversRedirect('renewable', { view: 'matrix', cols: '6', date: '2026-05-01' })
    expect(target).toEqual({
      path: PRICE_DRIVERS_PATH,
      query: { date: '2026-05-01', driver: 'renewable' }
    })
    const query = (target as { query: Record<string, string> }).query
    expect(query.view).toBeUndefined()
    expect(query.cols).toBeUndefined()
  })

  it('driver 覆盖透传的同名参数（旧路径决定驱动，不接受 query 覆盖）', () => {
    expect(
      resolvePriceDriversRedirect('load', { driver: 'renewable' })
    ).toEqual({ path: PRICE_DRIVERS_PATH, query: { driver: 'load' } })
  })

  it('空参数 / 数组参数 / null 容错：只保留非空标量', () => {
    expect(resolvePriceDriversRedirect('renewable', null)).toEqual({
      path: PRICE_DRIVERS_PATH,
      query: { driver: 'renewable' }
    })
    expect(resolvePriceDriversRedirect('renewable', undefined)).toEqual({
      path: PRICE_DRIVERS_PATH,
      query: { driver: 'renewable' }
    })
    // 同名多值（?a=1&a=2 在 vue-router query 里是数组）取首值，空串丢弃
    expect(
      resolvePriceDriversRedirect('renewable', { date: ['2026-05-01', '2026-05-02'], mode: '' })
    ).toEqual({ path: PRICE_DRIVERS_PATH, query: { date: '2026-05-01', driver: 'renewable' } })
  })
})
