// @vitest-environment happy-dom
// ↑ 勿删：被测模块经 forecastProviders → api.ts → regionContext 在模块求值期读 window.localStorage，
// node project 无 DOM 会整文件 0 test 直接失败（与 modelTargetSelection.spec.ts 同款）。
// 标的清单与粒度由注册表驱动（dljy#2463 · Epic dljy#2455 4.3.09）。
// 断言「来自注册表」而不是「等于某个字面量清单」：改回硬编码即红。
import { describe, expect, it } from 'vitest'
import { FORECAST_TARGETS, FORECAST_TARGET_IDS, targetSlotsPerDay } from 'shared/forecast/target-registry.mjs'
import { FORECAST_TARGET_OPTIONS, nativeSlotsForTarget, granularityForTarget } from './forecastProviders'

describe('FORECAST_TARGET_OPTIONS 由注册表派生', () => {
  it('= 注册表里可供给且为日内曲线（15/60 分钟）的标的，顺序同注册表', () => {
    const expected = FORECAST_TARGETS
      .filter((t) => t.dataSource.status === 'available' && (t.granularity === '15min' || t.granularity === '60min'))
      .map((t) => t.id)
    expect(FORECAST_TARGET_OPTIONS.map((t) => t.id)).toEqual(expected)
    expect(expected.length).toBeGreaterThan(7) // 不再是 7 项硬编码
  })
  it('含用户侧结算电价（60 分钟 → 24 点）与水电，不含日频中长期价', () => {
    const byId = Object.fromEntries(FORECAST_TARGET_OPTIONS.map((t) => [t.id, t]))
    expect(byId.price_user_da_settlement?.slotsPerDay).toBe(24)
    expect(byId.price_user_da_settlement?.name).toBe('用户侧日前统一结算电价')
    expect(byId.hydro?.slotsPerDay).toBe(96)
    expect(byId.midlong_price).toBeUndefined()
    expect(FORECAST_TARGET_IDS).toContain('midlong_price') // 注册表有，只是不进工作台
  })
})

describe('粒度分流', () => {
  it('15 分钟标的按用户选择；60 分钟标的恒 24，不再聚合', () => {
    expect(nativeSlotsForTarget('price')).toBe(96)
    expect(nativeSlotsForTarget('price_user_rt_settlement')).toBe(24)
    expect(targetSlotsPerDay('price_user_rt_settlement')).toBe(24)
    expect(granularityForTarget('price', 24)).toBe(24)
    expect(granularityForTarget('price', 96)).toBe(96)
    expect(granularityForTarget('price_user_da_settlement', 96)).toBe(24)
    expect(granularityForTarget('price_user_da_settlement', 24)).toBe(24)
  })
  it('未登记标的按 96 处理（旧行为不回归）', () => {
    expect(nativeSlotsForTarget('no_such_target')).toBe(96)
  })
})
