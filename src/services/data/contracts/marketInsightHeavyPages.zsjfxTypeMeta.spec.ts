import { describe, expect, it } from 'vitest'
import { toMarketInsightZsjfxMetaContract } from './marketInsightHeavyPages'

// ZW-02/D8（Epic #3591 S1 / #3592）：zsjfx meta 新增可选 typeMeta（来源+粒度）。
// 旧响应不带 typeMeta 时 view model 字段缺省（向后兼容）；带typeMeta 时逐项透传且容错。
const basePayload = {
  dates: ['2026-09-18'],
  goodDates: ['2026-09-18'],
  groups: { 预测: ['日前负荷预测'], 天气: ['辐照'] },
  typeAxis: { 日前负荷预测: 0, 辐照: 3 },
  yzConfig: [{ name: '负荷(MW)' }],
  colorMap: { 日前负荷预测: '#409eff' },
  defaults: ['日前负荷预测']
}

describe('zsjfx meta typeMeta 契约（ZW-02）', () => {
  it('带 typeMeta 时逐项透传 source 与 granularity', () => {
    const contract = toMarketInsightZsjfxMetaContract({
      payload: {
        ...basePayload,
        typeMeta: {
          辐照: { source: 'yn_irradiance/yn_irradiance_hourly(ghi 多站均值)', granularity: 'hourly' },
          水电周发电预测: { source: 'yn_disclosure_metric/forecast_hydro_weekly_output', granularity: 'weekly' }
        }
      }
    })
    expect(contract.blocks.zsjfx.meta?.typeMeta?.辐照).toEqual({
      source: 'yn_irradiance/yn_irradiance_hourly(ghi 多站均值)',
      granularity: 'hourly'
    })
    expect(contract.blocks.zsjfx.meta?.typeMeta?.水电周发电预测?.granularity).toBe('weekly')
  })

  it('旧响应无 typeMeta 时字段缺省、不炸（向后兼容）', () => {
    const contract = toMarketInsightZsjfxMetaContract({ payload: { ...basePayload } })
    expect(contract.blocks.zsjfx.meta?.typeMeta).toBeUndefined()
    expect(contract.blocks.zsjfx.meta?.groups.天气).toEqual(['辐照'])
  })

  it('typeMeta 形状异常时容错丢弃非对象项、不透传未知字段', () => {
    const contract = toMarketInsightZsjfxMetaContract({
      payload: {
        ...basePayload,
        typeMeta: {
          辐照: { source: 'x', granularity: 'hourly', bogus: '不透传' },
          坏项: 'not-an-object',
          空项: null
        }
      }
    })
    const tm = contract.blocks.zsjfx.meta?.typeMeta
    expect(tm?.辐照).toEqual({ source: 'x', granularity: 'hourly' })
    expect(tm?.坏项).toBeUndefined()
    expect(tm?.空项).toBeUndefined()
    expect(Object.keys(tm ?? {})).toEqual(['辐照'])
  })
})
