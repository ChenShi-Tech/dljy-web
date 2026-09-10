// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchCaptured } = vi.hoisted(() => ({ fetchCaptured: vi.fn() }))
vi.mock('@/services/captured', () => ({ fetchCaptured }))
import { platformProvider, platformTargetsForRegion, providersForTarget } from './forecastProviders'

describe('云南官方总览与算法入口共用严格来源', () => {
  beforeEach(() => fetchCaptured.mockReset())
  it('总览和台账只声明已核实的云南新能源目标', () => {
    expect(platformTargetsForRegion('yunnan')).toEqual(['renewable'])
    expect(providersForTarget('renewable', 'yunnan').find((p) => p.id === 'platform')?.supportedTargets).toEqual(['renewable'])
    expect(providersForTarget('load', 'yunnan').some((p) => p.id === 'platform')).toBe(false)
  })
  it('选定日的官方96点按原顺序进入统一图表结果', async () => {
    const rows = Array.from({ length: 96 }, (_, i) => ({
      region: 'yn', targetDate: '2026-06-25', operateDate: '2026-06-24',
      timePoint: `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
      value: 2000 + i,
    }))
    fetchCaptured.mockResolvedValue({ rows })
    const result = await platformProvider.run({ regionId: 'yunnan', target: 'renewable', targetDate: '2026-06-25', granularity: 96, historyDays: 180 }, {})
    expect(fetchCaptured).toHaveBeenCalledWith('yn_system_forecast', 'new_energy_forecast_d1', { region: 'yunnan', dateFrom: '2026-06-24', dateTo: '2026-06-25' })
    expect(result.points).toEqual(rows.map((row) => row.value))
    expect(result).toMatchObject({ basis: 'captured', mock: false, unit: 'MW', modelId: 'platform' })
  })
  it('缺数据明确失败，不替换成其他日期', async () => {
    fetchCaptured.mockResolvedValue({ rows: [] })
    await expect(platformProvider.run({ regionId: 'yunnan', target: 'renewable', targetDate: '2026-08-31', granularity: 96, historyDays: 180 }, {})).rejects.toThrow('未改用其他日期')
  })
})
