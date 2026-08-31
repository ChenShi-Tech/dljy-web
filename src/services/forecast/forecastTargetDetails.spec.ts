import { describe, expect, it } from 'vitest'
import { forecastTargetDetails } from './forecastTargetDetails'
import { normalizeModelRegistryEntry } from './modelContract'

describe('台账目标声明', () => {
  it('去重但不隐藏未知目标，数量与列表一致', () => {
    const rows = forecastTargetDetails(['load', 'load', 'price_user_da_settlement', 'unregistered'])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ unit: 'MW', interval: '15分钟 / 每日96点' })
    expect(rows[1]).toMatchObject({ unit: '元/MWh', interval: '1小时 / 每日24点' })
    expect(rows[2].name).toContain('未登记目标')
  })

  it('目录明确空目标与未声明不同，不能都视为全目标', () => {
    expect(normalizeModelRegistryEntry({ modelId: 'explicit-none', supportedTargets: [] }, { target: 'load', regionId: 'yunnan' })?.supportedTargets).toEqual([])
    expect(normalizeModelRegistryEntry({ modelId: 'legacy' }, { target: 'load', regionId: 'yunnan' })?.supportedTargets).toBeUndefined()
  })
})
